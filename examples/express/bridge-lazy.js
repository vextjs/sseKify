// bridge-lazy.js
// 功能：仅在有浏览器连接时连接上游；最后一个客户端离线后延时关闭上游。

const express = require('express')
const { EventSource } = require('eventsource')
const { SSEKify /*, createIORedisAdapter */ } = require('../../lib')

const app = express()
app.use(express.json())

const sse = new SSEKify({
    keepAliveMs: 15000,     // 心跳时间
    retryMs: 2000,          // 客户端断线重连间隔
    recentBufferSize: 20    //消息补发缓存大小
})
const UPSTREAM_SSE_URL = process.env.PY_SSE_URL || 'http://localhost:8000/stream'

// 上游连接管理：懒连接、退避重连、空闲关闭
class UpstreamManager {
    constructor(url) {
        this.url = url            // 上游 SSE 服务的 URL (例如 Python 后端的 SSE 接口)
        this.es = null            // 当前上游的 EventSource 连接实例
        this.refCount = 0         // 当前有多少个浏览器客户端正在依赖这个上游连接
        this.idleTimer = null     // 计时器：当最后一个浏览器断开时，延迟关闭上游连接
        this.idleGraceMs = 10000  // 延迟关闭的等待时间（10 秒），避免频繁开关
        this.backoffBaseMs = 1000 // 重连退避的基础时间（1 秒）
        this.backoffMaxMs = 30000 // 重连退避的最大时间（30 秒）
        this.backoffRetry = 0     // 当前已重试次数（用于指数退避计算）
        this.lastUpstreamId = null// 记录最后接收到的 eventId（支持断点续传）
        this.status = 'idle'      // 状态：idle | connecting | connected | closing
    }

    // 当有一个新的浏览器客户端订阅时调用
    addClientRef() {
        this.refCount++
        // 如果还没有连接上游，则建立连接
        if (!this.es) this.connect(this.lastUpstreamId)
        // 如果之前有关闭的定时器，取消它
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    }

    // 当有一个浏览器客户端断开时调用
    removeClientRef() {
        this.refCount = Math.max(0, this.refCount - 1)
        // 如果已经没有客户端了，启动一个延迟关闭定时器
        if (this.refCount === 0 && !this.idleTimer) {
            this.idleTimer = setTimeout(() => this.maybeClose(), this.idleGraceMs)
        }
    }

    // 建立到上游的 SSE 连接
    connect(lastId) {
        if (this.es) return // 已经连接了就不重复连接
        this.status = 'connecting'

        const headers = {}
        if (lastId) headers['Last-Event-ID'] = lastId // 带上最后的 eventId，用于断点续传

        console.log(`[Upstream] connect ${this.url} lastId=${lastId ?? '-'}`)

        // 建立 EventSource 连接（Node 里可能用 eventsource 包）
        const es = new EventSource(this.url, { headers })
        this.es = es

        // 上游连接成功
        es.onopen = () => {
            this.status = 'connected'
            this.backoffRetry = 0 // 重置重连计数
            console.log('[Upstream] connected')
        }

        // 默认消息事件转发给所有下游浏览器
        es.onmessage = (ev) => {
            this.lastUpstreamId = ev.lastEventId || this.lastUpstreamId
            sse.sendToAll(safeParse(ev.data), { event: 'message' })
        }

        // 示例：监听自定义事件 "tick"，转发给下游
        es.addEventListener?.('tick', (ev) => {
            this.lastUpstreamId = ev.lastEventId || this.lastUpstreamId
            sse.sendToAll(safeParse(ev.data), { event: 'tick' })
        })

        // 出错处理：关闭连接，并尝试重连（如果还有下游订阅者）
        es.onerror = (err) => {
            console.warn('[Upstream] error:', err?.message || err)
            this.teardown()
            if (this.refCount > 0) this.scheduleReconnect()
        }
    }

    // 安排退避重连
    scheduleReconnect() {
        // 指数退避：1s → 2s → 4s → …，直到 30s 封顶
        const wait = Math.min(this.backoffBaseMs * 2 ** this.backoffRetry, this.backoffMaxMs)
        this.backoffRetry = Math.min(this.backoffRetry + 1, 10)
        console.log(`[Upstream] reconnect in ${wait}ms, lastId=${this.lastUpstreamId ?? '-'}`)
        setTimeout(() => {
            if (this.refCount > 0) this.connect(this.lastUpstreamId)
        }, wait)
    }

    // 延迟关闭逻辑：如果没有下游客户端了，才真正关闭
    maybeClose() {
        if (this.refCount === 0) {
            console.log('[Upstream] idle, closing')
            this.close()
        }
    }

    // 主动关闭上游连接
    close() {
        this.status = 'closing'
        this.teardown()
        this.status = 'idle'
    }

    // 清理连接
    teardown() {
        if (this.es) {
            try { this.es.close() } catch {}
            this.es = null
        }
    }
}


function safeParse(text) { try { return JSON.parse(text) } catch { return text } }

const upstream = new UpstreamManager(UPSTREAM_SSE_URL)

// /sse：浏览器建立 SSE 长连接；进入时 +1，关闭时 -1
app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
  upstream.addClientRef()
  sse.registerConnection(userId, res, { rooms: ['global'] })
  req.on('close', () => upstream.removeClientRef())
})

// 可选：健康检查
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    downstream: sse.stats().connections,
    upstreamStatus: upstream.status,
    upstreamRefCount: upstream.refCount,
    lastUpstreamEventId: upstream.lastUpstreamId,
  })
})

const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
  console.log(`SSE bridge (lazy) ready at http://localhost:${PORT}/sse`)
})
