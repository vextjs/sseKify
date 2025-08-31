// bridge-basic.js
// 功能：服务启动即连接上游 SSE 源；把上游事件转发给所有浏览器客户端。

const express = require('express')
const { EventSource } = require('eventsource')
const { SSEKify /*, createIORedisAdapter */ } = require('../../lib')

const app = express()
app.use(express.json())

// 初始化：SSE 管理（心跳、重连建议、轻量重放；可选 Redis 跨实例）
const sse = new SSEKify({
    // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
    channel: 'ssekify:bus',
    keepAliveMs: 15000,     // 心跳时间
    retryMs: 2000,          // 客户端断线重连间隔
    recentBufferSize: 20    //消息补发缓存大小
})

// /sse：浏览器建立 SSE 长连接
app.get('/sse', (req, res) => {
    const userId = String(req.query.userId || 'guest')
    sse.registerConnection(userId, res, { rooms: ['global'] })
})

// 上游 SSE 源地址（替换为你的地址）
const UPSTREAM_SSE_URL = process.env.PY_SSE_URL || 'http://localhost:8000/stream'
let lastUpstreamId = null // 记录上游事件 ID（用于断线续传，取决于上游是否支持）

// 连接上游：订阅并转发事件
function connectUpstream(lastId) {
    const headers = {}
    if (lastId) headers['Last-Event-ID'] = lastId
    const es = new EventSource(UPSTREAM_SSE_URL, { headers })

    es.onopen = () => console.log('[UPSTREAM] connected')

    // 默认事件：转发为 message（或自定义 event）
    es.onmessage = (ev) => {
        lastUpstreamId = ev.lastEventId || lastUpstreamId
        sse.sendToAll(safeParse(ev.data), { event: 'message' })
    }

    // 示例：自定义事件（如 event: tick）
    es.addEventListener?.('tick', (ev) => {
        lastUpstreamId = ev.lastEventId || lastUpstreamId
        sse.sendToAll(safeParse(ev.data), { event: 'tick' })
    })

    // 出错：关闭后延时重连
    es.onerror = (err) => {
        console.warn('[UPSTREAM] error, will reconnect:', err?.message || err)
        es.close()
        setTimeout(() => connectUpstream(lastUpstreamId), 3000)
    }

    return es
}

function safeParse(text) { try { return JSON.parse(text) } catch { return text } }

// 启动即连接上游
connectUpstream(lastUpstreamId)

const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
    console.log(`SSE bridge (basic) listening at http://localhost:${PORT}/sse`)
})
