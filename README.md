### ssekit

简单且高效的 Node.js Server-Sent Events (SSE) 工具，框架无关。支持单实例或集群（可通过 Redis Pub/Sub）

- 框架无关（支持 Express/Koa/Fastify/Egg/Nest/Hapi）
- 支持按用户发送、广播消息，可选房间/频道
- 可选 Redis Pub/Sub，用于跨实例消息分发
- 心跳机制 + 轻量级重放（通过 Last-Event-ID 的最近消息缓存）

#### Install
```bash
npm i ssekit
# Redis 跨实例需要 ioredis（可选）
npm i ioredis
```

#### Quick start (Express)
```js
const express = require('express')
const { SSEKit, createIORedisAdapter } = require('ssekit')

const app = express()
app.use(express.json())

// 方式 A：只传 URL（内部懒加载 ioredis 适配器；未设置则为单实例）
const sse = new SSEKit({
    redis: process.env.REDIS_URL,
    channel: process.env.SSE_CHANNEL || 'ssekit:bus',
    keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
    retryMs: Number(process.env.SSE_RETRY_MS || 2000),
    recentBufferSize: Number(process.env.SSE_RECENT_BUFFER || 20)
})

// 方式 B：显式适配器（与旧文档等价）
// const sse = new SSEKit({
//   redis: process.env.REDIS_URL ? createIORedisAdapter(process.env.REDIS_URL) : undefined,
//   channel: process.env.SSE_CHANNEL || 'ssekit:bus',
// })

app.get('/sse', (req, res) => {
    const userId = String(req.query.userId || 'guest')
    res.flushHeaders?.()
    sse.registerConnection(userId, res, { rooms: ['global'] })
})

app.post('/notify/:userId', (req, res) => {
    const delivered = sse.sendToUser(req.params.userId, req.body, { event: 'notify' })
    res.json({ delivered })
})

app.post('/broadcast', async (req, res) => {
    await sse.publish(req.body, undefined, { event: 'broadcast' })
    res.json({ ok: true })
})

app.listen(3000)
```

#### API 概览
- new SSEKit(options?)
    - options.redis?: RedisLike
    - options.channel?: string（默认 ssekit:bus）
    - options.keepAliveMs?: number（默认 15000）
    - options.retryMs?: number（默认 2000）
    - options.recentBufferSize?: number（默认 20，设 0 关闭）
- registerConnection(userId, res, options?) → { connId, close(), join(room), leave(room) }
    - options.rooms?: string[]
    - options.headers?: Record<string,string>
    - options.keepAliveMs?/retryMs?: number（覆盖实例默认）
- sendToUser(userId, data, { event?, id? })
- sendToAll(data, { event?, id? })
- sendToRoom(room, data, { event?, id? })
- publish(data, userId?, { event?, id? })（Redis 跨实例）
- publishToRoom(room, data, { event?, id? })（Redis 跨实例）
- close(userId?)（关闭指定用户或全部）

事件（EventEmitter）：'connect' | 'disconnect' | 'publish' | 'message-sent' | 'error'

#### 环境变量
- REDIS_URL=redis://:password@host:6379/0
- SSE_CHANNEL=ssekit:bus
- SSE_KEEPALIVE_MS=15000
- SSE_RETRY_MS=2000
- SSE_RECENT_BUFFER=20

#### 代理/网关注意
- 关闭代理缓冲（Nginx: proxy_buffering off; 或使用 X-Accel-Buffering: no）
- keepAliveMs 小于负载均衡/代理空闲超时

#### 示例与路线图
- 示例见 ./examples
- 路线图见 STATUS.md

#### License
MIT