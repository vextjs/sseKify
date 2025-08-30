const express = require('express')
// 使用 ioredis 通过 Sentinel 连接主库
const IORedis = require('ioredis')
const { SSEKit } = require('../../lib')

// 将单个 ioredis 实例包装为 RedisLike 适配器
function instanceAdapter(instance) {
  const listeners = []
  instance.on('message', (ch, msg) => {
    for (const l of listeners) l(ch, msg)
  })
  return {
    publish: (channel, message) => instance.publish(channel, message),
    subscribe: async (channel) => { await instance.subscribe(channel) },
    on: (event, cb) => { if (event === 'message') listeners.push(cb) }
  }
}

// 环境变量示例：
// REDIS_SENTINELS=127.0.0.1:26379,127.0.0.1:26380
// REDIS_SENTINEL_MASTER=mymaster
// REDIS_PASSWORD=yourRedisPassword   # 可选
const sentinelPairs = (process.env.REDIS_SENTINELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(pair => {
    const [host, port] = pair.split(':')
    return { host, port: Number(port) }
  })

if (sentinelPairs.length === 0) {
  console.warn('[提示] 未设置 REDIS_SENTINELS，将仍以单实例方式运行（不跨实例）。')
}

const masterName = process.env.REDIS_SENTINEL_MASTER || 'mymaster'

const redis = sentinelPairs.length > 0 ? new IORedis({
  sentinels: sentinelPairs,
  name: masterName,
  password: process.env.REDIS_PASSWORD, // 可选
}) : null

const sse = new SSEKit({
  redis: redis ? instanceAdapter(redis) : undefined,
  channel: process.env.SSE_CHANNEL || 'ssekit:bus:sentinel',
  keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
  retryMs: Number(process.env.SSE_RETRY_MS || 2000),
})

const app = express()
app.use(express.json())

app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
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

app.post('/publish-room/:room', async (req, res) => {
  await sse.publishToRoom(req.params.room, req.body, { event: 'room' })
  res.json({ ok: true })
})

app.listen(3003, () => console.log('Express + Redis Sentinel 示例: http://localhost:3003'))