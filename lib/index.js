const { EventEmitter } = require('events')

/**
 * JSDoc 类型提示（可选）：
 * @typedef {string} ConnectionId
 * @typedef {string} UserId
 *
 * @typedef {Object} SendOptions
 * @property {string} [event]
 * @property {string} [id]
 *
 * @typedef {Object} RegisterOptions
 * @property {string[]} [rooms]
 * @property {Object.<string,string>} [headers]
 * @property {number} [keepAliveMs]
 * @property {number} [retryMs]
 * @property {number} [maxQueueItems]   // 每连接最大排队条数（默认 100）
 * @property {number} [maxQueueBytes]   // 每连接最大排队字节数（默认 262144 = 256KiB）
 * @property {'oldest'|'newest'|'disconnect'} [dropPolicy] // 超限策略（默认 'oldest'）
 *
 * @typedef {Object} Envelope
 * @property {'all'|'user'|'room'} type
 * @property {string} [target]
 * @property {*} data
 * @property {string} [event]
 * @property {string} [id]
 * @property {number} at
 *
 * @typedef {Object} RedisLike
 * @property {(channel:string, message:string)=>Promise<number>|number} publish
 * @property {(channel:string)=>Promise<void>|void} subscribe
 * @property {(event:'message', cb:(channel:string, message:string)=>void)=>void} on
 *
 * @typedef {Object} SSEKitOptions
 * @property {RedisLike|string} [redis]  // 优化点：可直接传 URL 字符串
 * @property {string} [channel]
 * @property {number} [keepAliveMs]
 * @property {number} [retryMs]
 * @property {number} [recentBufferSize]
 * @property {(data:any)=>string} [serializer]
 * @property {number} [maxPayloadBytes]
 * @property {number} [recentTTLMs]
 * @property {number} [recentMaxUsers]
 */

class SSEKit extends EventEmitter {
    /**
     * Expose basic stats and graceful shutdown support
     */
    /**
     * @param {SSEKitOptions} [opts]
     */
    constructor(opts = {}) {
        super()

        this.accepting = true
        this.metrics = {
                sent: 0,
                droppedOldest: 0,
                droppedNewest: 0,
                disconnectedByBackpressure: 0,
                queueItemsMax: 0,
                queueBytesMax: 0,
                errorCount: 0,
            }
            // 统计 error 次数，便于可观测性
            this.on('error', () => { this.metrics.errorCount++ })

        /** @type {Map<UserId, Map<ConnectionId, any>>} */
        this.connectionsByUser = new Map()
        /** @type {Map<ConnectionId, any>} */
        this.connections = new Map()
        /** @type {Map<string, Set<ConnectionId>>} */
        this.rooms = new Map()
        /** @type {Map<UserId, Array<{ id: string, payload: string }>>} */
        this.recentByUser = new Map()

        // —— 优化点 1：redis 可直接传 URL 字符串（懒加载适配器） ——
        /** @type {RedisLike|undefined} */
        this.redis = undefined
        if (typeof opts.redis === 'string') {
            // 用户只传了 URL，尝试懒加载 redis 适配器（不强依赖 ioredis）
            try {
                const { createIORedisAdapter } = require('./redisAdapter')
                this.redis = createIORedisAdapter(opts.redis)
            } catch (e) {
                const msg = 'Redis URL provided but ioredis adapter is not available. Please install ioredis.'
                const err = new Error(msg)
                err.cause = e
                throw err
            }
        } else {
            this.redis = opts.redis
        }

        this.channel = opts.channel ?? 'ssekit:bus'
        this.keepAliveMs = typeof opts.keepAliveMs === 'number' ? opts.keepAliveMs : 15000
        this.retryMs = typeof opts.retryMs === 'number' ? opts.retryMs : 2000
        this.recentBufferSize = Math.max(0, typeof opts.recentBufferSize === 'number' ? opts.recentBufferSize : 20)
        // Serializer and payload limit
        this.serializer = typeof opts.serializer === 'function' ? opts.serializer : JSON.stringify
        this.maxPayloadBytes = typeof opts.maxPayloadBytes === 'number' ? opts.maxPayloadBytes : 1024 * 1024
        // Recent buffer governance
        this.recentMeta = new Map() // userId -> { lastActiveAt: number }
        this.recentTTLMs = typeof opts.recentTTLMs === 'number' ? opts.recentTTLMs : 30 * 60 * 1000
        this.recentMaxUsers = typeof opts.recentMaxUsers === 'number' ? opts.recentMaxUsers : 10000
        // recentTTLMs=0 表示禁用定时清理；>0 则以不小于 10s 的周期运行清理器
        if (this.recentTTLMs > 0) {
            const period = Math.max(10 * 1000, Math.min(this.recentTTLMs, 60 * 1000))
            this._recentSweeper = setInterval(() => this.sweepRecent(), period)
        }

        // Unique instance id for dedup across Redis
        this.instanceId = Math.random().toString(36).slice(2) + '-' + process.pid

        if (this.redis) {
            Promise
                .resolve(this.redis.subscribe(this.channel))
                .catch((e) => this.emit('error', e))

            this.redis.on('message', (ch, msg) => {
                if (ch !== this.channel) return
                try {
                    const env = JSON.parse(msg)
                    if (env && env.origin === this.instanceId) return // ignore self-published
                    this.emit('publish', env)
                    this.dispatchEnvelope(env)
                } catch (e) {
                    this.emit('error', e)
                }
            })
            // Forward adapter errors if supported
            try { this.redis.on && this.redis.on('error', (e) => this.emit('error', e)) } catch {}
        }
    }

    /**
     * 注册 SSE 连接（框架无关，需传入原生 Node Response）
     * @param {UserId} userId
     * @param {import('http').ServerResponse} res
     * @param {RegisterOptions} [options]
     * @returns {{ connId: string, close: ()=>void, join: (room: string)=>boolean, leave: (room: string)=>boolean }}
     */
    registerConnection(userId, res, options = {}) {
            if (!this.accepting) {
                try {
                    res.statusCode = 503
                    res.setHeader('Retry-After', '2')
                    res.end('Server is shutting down')
                } catch {}
                return { connId: '', close: ()=>{}, join: ()=>false, leave: ()=>false }
            }
        const connId = this.generateId()
        const rooms = new Set(options.rooms || [])

        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...(options.headers || {}),
        }
        // 容错：若上游已发送响应头，则跳过设置，避免 ERR_HTTP_HEADERS_SENT
        if (!res.headersSent) {
            for (const [k, v] of Object.entries(headers)) {
                try { res.setHeader(k, v) } catch {}
            }
        }

        try { res.write(`retry: ${options.retryMs ?? this.retryMs}\n\n`) } catch {}

        const conn = {
            id: connId,
            userId,
            res,
            rooms,
            createdAt: Date.now(),
            heartbeat: undefined,
            // 背压与队列
            queue: [],           // string[]
            queuedBytes: 0,      // number
            writing: false,      // 是否正在等待 drain
            // per-connection limits (resolved)
            maxQueueItems: typeof options.maxQueueItems === 'number' ? options.maxQueueItems : 100,
            maxQueueBytes: typeof options.maxQueueBytes === 'number' ? options.maxQueueBytes : 256 * 1024,
            dropPolicy: options.dropPolicy || 'oldest',
        }

        if (!this.connectionsByUser.has(userId)) this.connectionsByUser.set(userId, new Map())
        this.connectionsByUser.get(userId).set(connId, conn)
        this.connections.set(connId, conn)
        // Ensure initial rooms are added to global rooms mapping
        for (const r of rooms) {
            this.joinRoom(connId, r)
        }

        const keepAliveMs = options.keepAliveMs ?? this.keepAliveMs
        conn.heartbeat = setInterval(() => {
            this.safeWrite(conn, `: ping ${Date.now()}\n\n`)
                        conn.res.flush?.()
        }, keepAliveMs)

        const cleanUp = () => this.teardown(connId)
        res.on('close', cleanUp)
        res.on('error', cleanUp)

        const req = res.req
        const headersIn = (req && req.headers) || {}
        let lastEventId = headersIn['last-event-id'] || headersIn['Last-Event-ID']
        // Also support picking lastEventId from query string for environments where setting headers is hard
        if (!lastEventId && req && typeof req.url === 'string') {
            try {
                const qs = req.url.split('?', 2)[1]
                if (qs) {
                    const sp = new URLSearchParams(qs)
                    const qId = sp.get('lastEventId') || sp.get('last-event-id') || sp.get('Last-Event-ID')
                    if (qId) lastEventId = qId
                }
            } catch (_) {}
        }
        if (lastEventId && this.recentBufferSize > 0) {
            this.replayFrom(userId, conn, String(lastEventId))
        }

        this.emit('connect', { userId, connId })

        return {
            connId,
            close: () => this.teardown(connId),
            join: (room) => this.joinRoom(connId, room),
            leave: (room) => this.leaveRoom(connId, room),
        }
    }

    /**
     * @param {UserId} userId
     * @param {*} data
     * @param {SendOptions} [opts]
     */
    sendToUser(userId, data, opts = {}) {
        const payload = this.formatEvent(data, opts)
        const bucket = this.connectionsByUser.get(userId)
        if (!bucket) return 0
        let count = 0
        for (const conn of bucket.values()) {
            if (this.safeWrite(conn, payload)) count++
        }
        if (opts.id && this.recentBufferSize > 0) this.pushRecent(userId, opts.id, payload)
        this.emit('message-sent', { scope: 'user', userId, count })
        return count
    }

    /**
     * @param {*} data
     * @param {SendOptions} [opts]
     */
    sendToAll(data, opts = {}) {
        const payload = this.formatEvent(data, opts)
        let count = 0
        for (const conn of this.connections.values()) {
            if (this.safeWrite(conn, payload)) count++
        }
        if (opts.id && this.recentBufferSize > 0) {
            const seen = new Set()
            for (const conn of this.connections.values()) {
                if (seen.has(conn.userId)) continue
                seen.add(conn.userId)
                this.pushRecent(conn.userId, opts.id, payload)
            }
        }
        this.emit('message-sent', { scope: 'all', count })
        return count
    }

    /**
     * @param {string} room
     * @param {*} data
     * @param {SendOptions} [opts]
     */
    sendToRoom(room, data, opts = {}) {
        const ids = this.rooms.get(room)
        if (!ids || ids.size === 0) return 0
        const payload = this.formatEvent(data, opts)
        let count = 0
        for (const connId of ids) {
            const conn = this.connections.get(connId)
            if (conn && this.safeWrite(conn, payload)) count++
        }
        if (opts.id && this.recentBufferSize > 0) {
            const seen = new Set()
            for (const connId of ids) {
                const c = this.connections.get(connId)
                if (!c) continue
                if (seen.has(c.userId)) continue
                seen.add(c.userId)
                this.pushRecent(c.userId, opts.id, payload)
            }
        }
        this.emit('message-sent', { scope: 'room', room, count })
        return count
    }

    /**
     * 跨实例发布（本地也会立即分发）
     * @param {*} data
     * @param {UserId} [userId]
     * @param {SendOptions} [opts]
     */
    async publish(data, userId, opts = {}) {
        const env = {
            type: userId ? 'user' : 'all',
            target: userId,
            data,
            event: opts.event,
            id: opts.id,
            at: Date.now(),
            origin: this.instanceId,
        }
        // Local dispatch to minimize latency; Redis subscriber will ignore our own origin
        this.dispatchEnvelope(env)
        if (this.redis) {
            await Promise.resolve(this.redis.publish(this.channel, JSON.stringify(env)))
        }
    }

    /**
     * 可选：按房间跨实例发布
     * @param {string} room
     * @param {*} data
     * @param {SendOptions} [opts]
     */
    async publishToRoom(room, data, opts = {}) {
        const env = {
            type: 'room',
            target: room,
            data,
            event: opts.event,
            id: opts.id,
            at: Date.now(),
            origin: this.instanceId,
        }
        // Local dispatch first; Redis subscriber will dedup by origin
        this.dispatchEnvelope(env)
        if (this.redis) {
            await Promise.resolve(this.redis.publish(this.channel, JSON.stringify(env)))
        }
    }

    /**
     * 关闭连接（指定用户或全部）
     * @param {UserId} [userId]
     */
    close(userId) {
        if (!userId) {
            for (const id of Array.from(this.connections.keys())) this.teardown(id)
            return
        }
        const bucket = this.connectionsByUser.get(userId)
        if (!bucket) return
        for (const id of Array.from(bucket.keys())) this.teardown(id)
    }

    // —— 内部方法 ——

    /** @param {Envelope} env */
    dispatchEnvelope(env) {
        const { type, target, data, event, id } = env
        if (type === 'all') {
            this.sendToAll(data, { event, id })
        } else if (type === 'user') {
            if (!target) return
            this.sendToUser(target, data, { event, id })
        } else if (type === 'room') {
            if (!target) return
            this.sendToRoom(target, data, { event, id })
        }
    }

    generateId() {
        return Math.random().toString(36).slice(2) + Date.now().toString(36)
    }

    /**
     * @param {*} data
     * @param {SendOptions} opts
     */
    formatEvent(data, opts) {
        const lines = []
        // Sanitize id and event to avoid injecting newlines into SSE frames
        if (opts.id) {
            const cleanId = String(opts.id).replace(/[\r\n]/g, ' ')
            lines.push(`id: ${cleanId}`)
        }
        if (opts.event) {
            const cleanEvent = String(opts.event).replace(/[\r\n]/g, ' ')
            lines.push(`event: ${cleanEvent}`)
        }
        let json
        try {
            json = this.serializer(data)
        } catch (e) {
            this.emit('error', new Error('serialize_failed: ' + (e && e.message || e)))
            return ''
        }
        const size = Buffer.byteLength(json)
        if (this.maxPayloadBytes > 0 && size > this.maxPayloadBytes) {
            this.emit('error', new Error(`payload_too_large: ${size} > ${this.maxPayloadBytes}`))
            return ''
        }
        for (const ln of json.split(/\n/)) lines.push(`data: ${ln}`)
        lines.push('')
        return lines.join('\n') + '\n'
    }

    /** @param {any} conn @param {string} chunk */
    safeWrite(conn, chunk) {
        try {
            // 若此前处于写入阻塞或队列中，直接入队
            if (conn.writing || conn.queue.length > 0) {
                return this.enqueue(conn, chunk)
            }
            const ok = conn.res.write(chunk)
            if (ok !== false) {
                this.metrics.sent++
                return true
            }
            // ok === false: chunk already in kernel buffer; don't enqueue the same chunk
            conn.writing = true
            this.attachDrain(conn)
            return true
        } catch (e) {
            this.teardown(conn.id)
            return false
        }
    }

    /** 将 chunk 放入连接队列，按限额处理 */
    enqueue(conn, chunk) {
        const size = Buffer.byteLength(chunk)
        // 超限处理：根据策略
        if (conn.queue.length >= conn.maxQueueItems || (conn.queuedBytes + size) > conn.maxQueueBytes) {
            if (conn.dropPolicy === 'disconnect') {
                            this.metrics.disconnectedByBackpressure++
                this.emit('error', new Error('backpressure: queue limit exceeded, disconnecting ' + conn.id))
                this.teardown(conn.id)
                return false
            }
            if (conn.dropPolicy === 'newest') {
                // 丢弃新消息
                this.metrics.droppedNewest++
                return false
            }
            // 默认 'oldest'：丢弃队首直到可以放入
            while (conn.queue.length > 0 && (conn.queue.length >= conn.maxQueueItems || (conn.queuedBytes + size) > conn.maxQueueBytes)) {
                const removed = conn.queue.shift()
                conn.queuedBytes -= Buffer.byteLength(removed)
                this.metrics.droppedOldest++
            }
        }
        conn.queue.push(chunk)
        conn.queuedBytes += size
        if (conn.queue.length > this.metrics.queueItemsMax) this.metrics.queueItemsMax = conn.queue.length
        if (conn.queuedBytes > this.metrics.queueBytesMax) this.metrics.queueBytesMax = conn.queuedBytes
        // 确保已监听 drain
        if (!conn.writing) {
            conn.writing = true
            this.attachDrain(conn)
            // 立即尝试 flush（有可能并未真正 backpressure，只是队列模式）
            this.flushQueue(conn)
        }
        return true
    }

    attachDrain(conn) {
        if (!conn || !conn.res || conn._drainAttached) return
        conn._drainAttached = true
        conn.res.once('drain', () => {
            conn._drainAttached = false
            this.flushQueue(conn)
        })
    }

    flushQueue(conn) {
        if (!conn || !conn.res) return
        try {
            while (conn.queue.length > 0) {
                const part = conn.queue[0]
                const ok = conn.res.write(part)
                if (ok === false) {
                    // 等待下一次 drain
                    this.attachDrain(conn)
                    return
                }
                this.metrics.sent++
                conn.queue.shift()
                conn.queuedBytes -= Buffer.byteLength(part)
            }
            conn.writing = false
        } catch (e) {
            this.teardown(conn.id)
        }
    }

    /** @param {ConnectionId} connId */
    teardown(connId) {
        const conn = this.connections.get(connId)
        if (!conn) return
        if (conn.heartbeat) clearInterval(conn.heartbeat)
        // 清理背压状态与监听
        try { if (conn._drainAttached) { conn._drainAttached = false } } catch {}
        try { conn.queue = [] } catch {}
        try { conn.queuedBytes = 0 } catch {}

        for (const room of conn.rooms) {
            const set = this.rooms.get(room)
            if (set) {
                set.delete(connId)
                if (set.size === 0) this.rooms.delete(room)
            }
        }

        const bucket = this.connectionsByUser.get(conn.userId)
        if (bucket) {
            bucket.delete(connId)
            if (bucket.size === 0) this.connectionsByUser.delete(conn.userId)
        }

        try { conn.res.end() } catch {}

        this.connections.delete(connId)
        this.emit('disconnect', { userId: conn.userId, connId })
    }

    /** @param {ConnectionId} connId @param {string} room */
    joinRoom(connId, room) {
        const conn = this.connections.get(connId)
        if (!conn) return false
        if (!this.rooms.has(room)) this.rooms.set(room, new Set())
        this.rooms.get(room).add(connId)
        conn.rooms.add(room)
        return true
    }

    /** @param {ConnectionId} connId @param {string} room */
    leaveRoom(connId, room) {
        const conn = this.connections.get(connId)
        if (!conn) return false
        const set = this.rooms.get(room)
        if (set) {
            set.delete(connId)
            if (set.size === 0) this.rooms.delete(room)
        }
        conn.rooms.delete(room)
        return true
    }

    /** @param {UserId} userId @param {string} id @param {string} payload */
    pushRecent(userId, id, payload) {
        if (this.recentBufferSize <= 0) return
        const buf = this.recentByUser.get(userId) || []
        buf.push({ id, payload })
        while (buf.length > this.recentBufferSize) buf.shift()
        this.recentByUser.set(userId, buf)
        this.touchRecent(userId)
        this.ensureRecentCapacity()
    }

    /** @param {UserId} userId @param {any} conn @param {string} lastEventId */
    replayFrom(userId, conn, lastEventId) {
        const buf = this.recentByUser.get(userId)
        if (!buf || buf.length === 0) return
        let start = buf.findIndex(x => x.id === lastEventId)
        if (start === -1) return
        for (let i = start + 1; i < buf.length; i++) {
            this.safeWrite(conn, buf[i].payload)
        }
        this.touchRecent(userId)
    }

    touchRecent(userId) {
        this.recentMeta.set(userId, { lastActiveAt: Date.now() })
    }

    ensureRecentCapacity() {
        if (this.recentMeta.size <= this.recentMaxUsers) return
        const arr = Array.from(this.recentMeta.entries()).sort((a,b)=>a[1].lastActiveAt - b[1].lastActiveAt)
        const over = this.recentMeta.size - this.recentMaxUsers
        for (let i=0;i<over;i++) {
            const uid = arr[i][0]
            this.recentMeta.delete(uid)
            this.recentByUser.delete(uid)
        }
    }

    sweepRecent() {
        const now = Date.now()
        for (const [uid, meta] of this.recentMeta) {
            if (now - meta.lastActiveAt > this.recentTTLMs) {
                this.recentMeta.delete(uid)
                this.recentByUser.delete(uid)
            }
        }
        this.ensureRecentCapacity()
    }

    clearRecent(userId) {
        if (userId) {
            this.recentMeta.delete(userId)
            this.recentByUser.delete(userId)
        } else {
            this.recentMeta.clear()
            this.recentByUser.clear()
        }
    }

    /** 停止接受新连接 */
    stopAccepting() {
        this.accepting = false
    }

    /** 优雅关闭：可选公告 + 等待宽限期，随后断开所有连接并关闭 Redis 适配器（如支持） */
    async shutdown(opts = {}) {
        const { announce = true, event = 'server:shutdown', graceMs = 5000 } = opts
        this.stopAccepting()
        if (announce) {
            try { this.sendToAll({ code: 'SHUTDOWN', at: Date.now() }, { event }) } catch {}
        }
        await new Promise(r => setTimeout(r, graceMs))
        // 断开所有连接
        for (const id of Array.from(this.connections.keys())) this.teardown(id)
        // 断开所有连接后，清理 recent sweeper 定时器
        if (this._recentSweeper) {
            try { clearInterval(this._recentSweeper) } catch {}
            this._recentSweeper = undefined
        }
        // 关闭 Redis 适配器（若支持 close）
        const r = this.redis
        if (r && typeof r.close === 'function') {
            try { await r.close() } catch {}
        }
    }

    /** 基础指标 */
    stats() {
        return {
            connections: this.connections.size,
            users: this.connectionsByUser.size,
            rooms: this.rooms.size,
            ...this.metrics,
        }
    }
}

// —— 优化点 2：主入口安全导出 createIORedisAdapter（不强制安装 ioredis） ——
// 这样调用方可以：const { SSEKit, createIORedisAdapter } = require('ssekit')
const exportsObject = { SSEKit, createIORedisAdapter: undefined }
try {
    exportsObject.createIORedisAdapter = require('./redisAdapter').createIORedisAdapter
} catch (_) {
    // 提供兜底函数，调用时给出清晰错误提示
    exportsObject.createIORedisAdapter = function () {
        throw new Error('ioredis adapter is not available. Please install ioredis to use createIORedisAdapter.')
    }
}

module.exports = exportsObject