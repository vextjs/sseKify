const express = require('express')
const { SSEKit,createIORedisAdapter } = require('../lib/index')

const app = express()
app.use(express.json())

const sse = new SSEKit({
    // redis: process.env.REDIS_URL ? createIORedisAdapter(process.env.REDIS_URL) : undefined,
    channel: 'ssekit:bus',
    keepAliveMs: 15000,
    retryMs: 2000,
    recentBufferSize: 20
})

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

app.listen(3000, () => console.log('Express demo: http://localhost:3000'))