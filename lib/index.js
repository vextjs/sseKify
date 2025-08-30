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
 */

class SSEKit extends EventEmitter {
    /**
     * @param {SSEKitOptions} [opts]
     */
    constructor(opts = {}) {
        super()

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

        if (this.redis) {
            Promise
                .resolve(this.redis.subscribe(this.channel))
                .catch((e) => this.emit('error', e))

            this.redis.on('message', (ch, msg) => {
                if (ch !== this.channel) return
                try {
                    const env = JSON.parse(msg)
                    this.emit('publish', env)
                    this.dispatchEnvelope(env)
                } catch (e) {
                    this.emit('error', e)
                }
            })
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
        const connId = this.generateId()
        const rooms = new Set(options.rooms || [])

        const headers = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            ...(options.headers || {}),
        }
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

        res.write(`retry: ${options.retryMs ?? this.retryMs}\n\n`)

        const conn = {
            id: connId,
            userId,
            res,
            rooms,
            createdAt: Date.now(),
            heartbeat: undefined,
        }

        if (!this.connectionsByUser.has(userId)) this.connectionsByUser.set(userId, new Map())
        this.connectionsByUser.get(userId).set(connId, conn)
        this.connections.set(connId, conn)

        const keepAliveMs = options.keepAliveMs ?? this.keepAliveMs
        conn.heartbeat = setInterval(() => {
            this.safeWrite(conn, `: ping ${Date.now()}\n\n`)
        }, keepAliveMs)

        const cleanUp = () => this.teardown(connId)
        res.on('close', cleanUp)
        res.on('error', cleanUp)

        const req = res.req || (res.socket && res.socket.parser && res.socket.parser.incoming)
        const headersIn = (req && req.headers) || {}
        const lastEventId = headersIn['last-event-id'] || headersIn['Last-Event-ID']
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
        }
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
        }
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
        if (opts.id) lines.push(`id: ${opts.id}`)
        if (opts.event) lines.push(`event: ${opts.event}`)
        const json = JSON.stringify(data)
        for (const ln of json.split(/\n/)) lines.push(`data: ${ln}`)
        lines.push('')
        return lines.join('\n') + '\n'
    }

    /** @param {any} conn @param {string} chunk */
    safeWrite(conn, chunk) {
        try {
            const ok = conn.res.write(chunk)
            return ok !== false
        } catch (e) {
            this.teardown(conn.id)
            return false
        }
    }

    /** @param {ConnectionId} connId */
    teardown(connId) {
        const conn = this.connections.get(connId)
        if (!conn) return
        if (conn.heartbeat) clearInterval(conn.heartbeat)

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
    }
}

// —— 优化点 2：主入口安全导出 createIORedisAdapter（不强制安装 ioredis） ——
// 这样调用方可以：const { SSEKit, createIORedisAdapter } = require('ssekit')
const exportsObject = { SSEKit, createIORedisAdapter: undefined }
try {
    exportsObject.createIORedisAdapter = require('./redisAdapter').createIORedisAdapter
} catch (_) {
    // 用户未安装 ioredis 或没有 redisAdapter.js 时，这里保持 undefined，避免硬依赖
}

module.exports = exportsObject