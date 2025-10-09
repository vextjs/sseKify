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
 * @typedef {Object} SSEKifyOptions
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

class SSEKify extends EventEmitter {
    /**
     * Expose basic stats and graceful shutdown support
     */
    /**
     * @param {SSEKifyOptions} [opts]
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
                seqIncrsLocal: 0,
                seqIncrsRedis: 0,
                lastSeqKvFallbackAt: 0,
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

        this.channel = opts.channel ?? 'ssekify:bus'
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

        // ===== 自动字段与自动 seq 默认配置（向后兼容） =====
        const autoFields = opts.autoFields || {}
        this.autoTimestamp = autoFields.timestamp === false ? false : (autoFields.timestamp || 'iso') // 'iso' | 'epochMs' | false
        this.autoTrace = autoFields.traceId || { mode: 'off' }
        this.autoRequest = autoFields.requestId || { mode: 'off' }

        this.enableSeq = opts.enableSeq === undefined ? true : !!opts.enableSeq
        const seq = opts.seq || {}
        this.seqField = seq.fieldName || 'seq'
        this.seqStartAt = typeof seq.startAt === 'number' ? seq.startAt : 0
        this.seqKeyExtractor = typeof seq.keyExtractor === 'function'
            ? seq.keyExtractor
            : (d) => (d && typeof d === 'object') ? (d.requestId || d.streamId) : undefined
        this.seqFinalPredicate = typeof seq.finalPredicate === 'function'
            ? seq.finalPredicate
            : (d) => d && typeof d === 'object' && (d.final === true || (d.phase === 'done' || d.phase === 'error'))
        this.seqFrameIdPolicy = seq.frameIdPolicy || 'none' // 'none'|'timestamp'|'snowflake'|fn
        this.seqKeyPrefix = seq.redisKeyPrefix || 'ssekify:seq:'
        this.seqRedisTTLSeconds = typeof seq.redisTTLSeconds === 'number' ? seq.redisTTLSeconds : 86400
        this._seqMap = new Map()
        this._warnedNoKV = false
        // 解析 seq KV：显式优先；否则尝试从顶层 redis 适配器继承；失败回退内存
        if (seq && Object.prototype.hasOwnProperty.call(seq, 'redis')) {
            this._seqKV = seq.redis || null
        } else if (this.redis && (typeof this.redis.incr === 'function' && typeof this.redis.expire === 'function')) {
            this._seqKV = this.redis
        } else if (this.redis && this.redis.kv && typeof this.redis.kv.incr === 'function') {
            this._seqKV = this.redis.kv
        } else {
            this._seqKV = null
        }
        // 本地 seqMap 闲置清理（使用与 Redis TTL 对齐的近似周期）
        this._seqLocalTTLMs = (this.seqRedisTTLSeconds > 0 ? this.seqRedisTTLSeconds * 1000 : 24 * 60 * 60 * 1000)
        const seqSweepPeriod = Math.max(10 * 1000, Math.min(this._seqLocalTTLMs, 60 * 1000))
        this._seqSweeper = setInterval(() => this.sweepSeqMap(), seqSweepPeriod)
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
        const enhanced = this._enhanceSync(data, opts)
        const finalOpts = enhanced.opts
        const payload = this.formatEvent(enhanced.data, finalOpts)
        const bucket = this.connectionsByUser.get(userId)
        if (!bucket) return 0
        let count = 0
        for (const conn of bucket.values()) {
            if (this.safeWrite(conn, payload)) count++
        }
        if (finalOpts.id && this.recentBufferSize > 0) this.pushRecent(userId, finalOpts.id, payload)
        this.emit('message-sent', { scope: 'user', userId, count })
        return count
    }

    /**
     * @param {*} data
     * @param {SendOptions} [opts]
     */
    sendToAll(data, opts = {}) {
        const enhanced = this._enhanceSync(data, opts)
        const finalOpts = enhanced.opts
        const payload = this.formatEvent(enhanced.data, finalOpts)
        let count = 0
        for (const conn of this.connections.values()) {
            if (this.safeWrite(conn, payload)) count++
        }
        if (finalOpts.id && this.recentBufferSize > 0) {
            const seen = new Set()
            for (const conn of this.connections.values()) {
                if (seen.has(conn.userId)) continue
                seen.add(conn.userId)
                this.pushRecent(conn.userId, finalOpts.id, payload)
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
        const enhanced = this._enhanceSync(data, opts)
        const finalOpts = enhanced.opts
        const payload = this.formatEvent(enhanced.data, finalOpts)
        let count = 0
        for (const connId of ids) {
            const conn = this.connections.get(connId)
            if (conn && this.safeWrite(conn, payload)) count++
        }
        if (finalOpts.id && this.recentBufferSize > 0) {
            const seen = new Set()
            for (const connId of ids) {
                const c = this.connections.get(connId)
                if (!c) continue
                if (seen.has(c.userId)) continue
                seen.add(c.userId)
                this.pushRecent(c.userId, finalOpts.id, payload)
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
        const enhanced = await this._enhanceAsync(data, opts)
        const finalOpts = enhanced.opts
        const env = {
            type: userId ? 'user' : 'all',
            target: userId,
            data: enhanced.data,
            event: finalOpts.event,
            id: finalOpts.id,
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
        const enhanced = await this._enhanceAsync(data, opts)
        const finalOpts = enhanced.opts
        const env = {
            type: 'room',
            target: room,
            data: enhanced.data,
            event: finalOpts.event,
            id: finalOpts.id,
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

    // ===== 自动字段与 seq 注入（内部辅助） =====
    _applyAutoFields(data) {
        if (!data || typeof data !== 'object') return data
        let out = data
        // timestamp
        if (this.autoTimestamp && out.timestamp == null) {
            out = { ...out, timestamp: this.autoTimestamp === 'epochMs' ? Date.now() : new Date().toISOString() }
        }
        // requestId / traceId 的自动补齐保留可配置接口（默认 off）
        const r = this.autoRequest
        const rName = (r && r.fieldName) || 'requestId'
        if (r && r.mode === 'require' && out[rName] == null) throw new Error('requestId is required but missing')
        if (r && r.mode === 'ifMissing' && out[rName] == null && typeof r.getter === 'function') {
            out = { ...out, [rName]: r.getter() }
        }
        const t = this.autoTrace
        const tName = (t && t.fieldName) || 'traceId'
        if (t && t.mode === 'ifMissing' && out[tName] == null && typeof t.getter === 'function') {
            out = { ...out, [tName]: t.getter() }
        }
        return out
    }

    _getSeqKey(data) {
        try { return this.seqKeyExtractor ? this.seqKeyExtractor(data) : undefined } catch (_) { return undefined }
    }

    _nextSeqSync(key, data) {
        let st = this._seqMap.get(key)
        if (!st) { st = { seq: this.seqStartAt - 1, lastAt: Date.now() }; this._seqMap.set(key, st) }
        st.seq += 1
        st.lastAt = Date.now()
        const seq = st.seq
        // 终止清理
        try { if (this.seqFinalPredicate && this.seqFinalPredicate(data)) this._seqMap.delete(key) } catch {}
        // 指标：本地自增计数
        this.metrics.seqIncrsLocal++
        return seq
    }

    async _nextSeqKV(key, data) {
        if (!this._seqKV) {
            if (!this._warnedNoKV && this.redis) {
                this._warnedNoKV = true
                try {
                    const err = new Error('seq_kv_unavailable_fallback_memory')
                    // 降级为告警语义，避免监控误报
                    // @ts-ignore
                    err.code = 'SEQ_KV_FALLBACK'
                    // @ts-ignore
                    err.level = 'warn'
                    this.emit('error', err)
                } catch {}
                this.metrics.lastSeqKvFallbackAt = Date.now()
            }
            return this._nextSeqSync(key, data)
        }
        try {
            const n = await this._seqKV.incr((this.seqKeyPrefix || 'ssekify:seq:') + key)
            const seq = (this.seqStartAt === 0) ? (n - 1) : n
            const ttl = this.seqRedisTTLSeconds || 86400
            if (typeof this._seqKV.expire === 'function' && ttl > 0) await this._seqKV.expire((this.seqKeyPrefix || 'ssekify:seq:') + key, ttl)
            // final 缩短 TTL
            try { if (this.seqFinalPredicate && this.seqFinalPredicate(data) && typeof this._seqKV.expire === 'function') await this._seqKV.expire((this.seqKeyPrefix || 'ssekify:seq:') + key, 60) } catch {}
            // 指标：Redis 自增计数
            this.metrics.seqIncrsRedis++
            return seq
        } catch (_) {
            return this._nextSeqSync(key, data)
        }
    }

    _maybeGenFrameId(existingId, data, nextSeq) {
        if (existingId) return undefined
        if (this.seqFrameIdPolicy === 'timestamp') return `${Date.now()}-${this.instanceId}-${typeof nextSeq === 'number' ? nextSeq : 0}`
        if (typeof this.seqFrameIdPolicy === 'function') {
            try { return this.seqFrameIdPolicy(data, typeof nextSeq === 'number' ? nextSeq : 0) } catch { return undefined }
        }
        return undefined
    }

    _enhanceSync(data, opts = {}) {
        let out = this._applyAutoFields(data)
        let id = undefined
        let seqVal
        if (this.enableSeq && out && typeof out === 'object' && out[this.seqField] == null) {
            const key = this._getSeqKey(out)
            if (key) {
                const seq = this._nextSeqSync(key, out)
                seqVal = seq
                out = { ...out, [this.seqField]: seq }
            }
        } else if (out && typeof out === 'object') {
            seqVal = out[this.seqField]
        }
        // 帧 id 策略
        const genId = this._maybeGenFrameId(opts.id, out, seqVal)
        if (genId) id = genId
        return { data: out, opts: id ? { ...opts, id } : opts }
    }

    async _enhanceAsync(data, opts = {}) {
        let out = this._applyAutoFields(data)
        let id = undefined
        let seqVal
        if (this.enableSeq && out && typeof out === 'object' && out[this.seqField] == null) {
            const key = this._getSeqKey(out)
            if (key) {
                const seq = await this._nextSeqKV(key, out)
                seqVal = seq
                out = { ...out, [this.seqField]: seq }
            }
        } else if (out && typeof out === 'object') {
            seqVal = out[this.seqField]
        }
        const genId = this._maybeGenFrameId(opts.id, out, seqVal)
        if (genId) id = genId
        return { data: out, opts: id ? { ...opts, id } : opts }
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

    // 清理本地 seqMap：按 _seqLocalTTLMs 过期时间删除久未活跃的键
    sweepSeqMap() {
        try {
            if (!this._seqMap || !this._seqLocalTTLMs) return
            const ttl = this._seqLocalTTLMs
            if (ttl <= 0) return
            const now = Date.now()
            for (const [key, st] of this._seqMap) {
                const last = st && (st.lastAt || st.at || st.ts || 0)
                if (!st || (now - last) > ttl) {
                    this._seqMap.delete(key)
                }
            }
        } catch (e) {
            // 不让清理器影响进程稳定性
            try { this.emit('error', e) } catch {}
        }
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
        // 断开所有连接后，清理定时器（recent/seq sweeper）
        if (this._recentSweeper) { try { clearInterval(this._recentSweeper) } catch {} ; this._recentSweeper = undefined }
        if (this._seqSweeper) { try { clearInterval(this._seqSweeper) } catch {} ; this._seqSweeper = undefined }
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

    /**
     * 获取指定用户的连接数量
     * @param {UserId} userId 用户ID
     * @returns {number} 该用户的连接数量
     */
    getUserConnectionCount(userId) {
        if (!userId) return 0
        const userConnections = this.connectionsByUser.get(userId)
        return userConnections ? userConnections.size : 0
    }

    /**
     * 获取指定用户的所有连接ID
     * @param {UserId} userId 用户ID
     * @returns {string[]} 该用户的所有连接ID数组
     */
    getUserConnectionIds(userId) {
        if (!userId) return []
        const userConnections = this.connectionsByUser.get(userId)
        return userConnections ? Array.from(userConnections.keys()) : []
    }

    /**
     * 获取所有用户的连接统计信息
     * @returns {Object.<string, number>} 用户ID到连接数的映射
     */
    getAllUsersConnectionStats() {
        const stats = {}
        for (const [userId, connections] of this.connectionsByUser) {
            stats[userId] = connections.size
        }
        return stats
    }

    /**
     * 检查用户是否在线（有至少一个连接）
     * @param {UserId} userId 用户ID
     * @returns {boolean} 用户是否在线
     */
    isUserOnline(userId) {
        return this.getUserConnectionCount(userId) > 0
    }
}

// —— 优化点 2：主入口安全导出 createIORedisAdapter（不强制安装 ioredis） ——
// 这样调用方可以：const { SSEKify, createIORedisAdapter } = require('ssekify')
const exportsObject = { SSEKify, createIORedisAdapter: undefined }
try {
    exportsObject.createIORedisAdapter = require('./redisAdapter').createIORedisAdapter
} catch (_) {
    // 提供兜底函数，调用时给出清晰错误提示
    exportsObject.createIORedisAdapter = function () {
        throw new Error('ioredis adapter is not available. Please install ioredis to use createIORedisAdapter.')
    }
}

module.exports = exportsObject
