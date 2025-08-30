const express = require('express')
// 直接使用 ioredis 的 Cluster，并包装成 RedisLike 适配器
const IORedis = require('ioredis')
const { SSEKify } = require('../../lib')

// 将 ioredis Cluster 实例包装为 SSEKify 所需的 RedisLike 接口
function clusterAdapter(cluster) {
  const listeners = []
  cluster.on('message', (ch, msg) => {
    for (const l of listeners) l(ch, msg)
  })
  return {
    publish: (channel, message) => cluster.publish(channel, message),
    subscribe: async (channel) => { await cluster.subscribe(channel) },
    on: (event, cb) => { if (event === 'message') listeners.push(cb) }
  }
}

// 从环境变量读取集群节点，格式示例：
// REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002
const nodes = (process.env.REDIS_CLUSTER_NODES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(pair => {
    const [host, port] = pair.split(':')
    return { host, port: Number(port) }
  })

if (nodes.length === 0) {
  console.warn('[提示] 未设置 REDIS_CLUSTER_NODES，将仍以单实例方式运行（不跨实例）。')
}

const cluster = nodes.length > 0 ? new IORedis.Cluster(nodes, {
  redisOptions: {
    // 可选密码
    password: process.env.REDIS_PASSWORD,
  }
}) : null

const sse = new SSEKify({
  redis: cluster ? clusterAdapter(cluster) : undefined,
  channel: process.env.SSE_CHANNEL || 'ssekify:bus:cluster',
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

app.listen(3002, () => console.log('Express + Redis Cluster 示例: http://localhost:3002'))