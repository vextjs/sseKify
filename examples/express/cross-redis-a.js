const express = require('express')
const fetcher = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)))
const { SSEKify, createIORedisAdapter } = require('../../lib')

// 服务器A：持有客户端 SSE 连接；将客户端任务转发给 B；B 完成后通过 Redis 发布回推，A 自动下发
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const CHANNEL = process.env.SSE_CHANNEL || 'ssekify:bus'

const sse = new SSEKify({
  redis: createIORedisAdapter ? createIORedisAdapter(REDIS_URL) : undefined,
  channel: CHANNEL,
  keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
  retryMs: Number(process.env.SSE_RETRY_MS || 2000),
  recentBufferSize: Number(process.env.SSE_RECENT_BUFFER || 20),
})

const app = express()
app.use(express.json())

app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
  sse.registerConnection(userId, res, { rooms: ['global'] })
})

// 客户端触发任务：A -> B
app.post('/start', async (req, res) => {
  const { userId = 'guest', payload = {} } = req.body || {}
  const cid = 'cid_' + Date.now()
  await fetcher('http://localhost:4004/process', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, cid, payload })
  })
  res.json({ accepted: true, cid })
})

// 为了演示方便，提供首页
app.get('/', (_req, rsp) => {
  rsp.setHeader('Content-Type', 'text/html; charset=utf-8')
  rsp.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"/><title>A</title>
  <body style="font-family:system-ui,Segoe UI,Arial;margin:24px">
    <h1>Cross-Server via Redis 示例：服务器A (3004)</h1>
    <p><a target="_blank" href="/sse?userId=alice">打开 SSE（alice）</a></p>
    <button onclick="post('/start',{userId:'alice',payload:{foo:1,at:Date.now()}})">发起任务（A->B->Redis->A->alice）</button>
    <script>
      async function post(url, body){ await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(body||{})}) }
    </script>
  </body></html>`)
})

const port = Number(process.env.PORT || 3004)
app.listen(port, () => console.log('Cross-Redis Server A: http://localhost:'+port))
