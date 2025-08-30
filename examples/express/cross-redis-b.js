const express = require('express')
const { SSEKit, createIORedisAdapter } = require('../../lib')

// 服务器B：处理任务后通过 Redis publish 回推到共享频道
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const CHANNEL = process.env.SSE_CHANNEL || 'ssekit:bus'

const sse = new SSEKit({
  redis: createIORedisAdapter ? createIORedisAdapter(REDIS_URL) : undefined,
  channel: CHANNEL,
})

const app = express()
app.use(express.json())

app.post('/process', async (req, res) => {
  const { userId = 'guest', cid = 'cid', payload = {} } = req.body || {}
  setTimeout(async () => {
    const result = { cid, ok: true, echo: payload, at: Date.now() }
    await sse.publish(result, userId, { event: 'job:done' })
  }, 300)
  res.json({ processing: true })
})

const port = Number(process.env.PORT || 4004)
app.listen(port, () => console.log('Cross-Redis Server B: http://localhost:'+port))
