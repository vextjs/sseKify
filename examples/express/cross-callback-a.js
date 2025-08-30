const express = require('express')
const fetcher = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)))
const { SSEKit } = require('../../lib')

// 服务器A：持有客户端 SSE 连接；将任务转发给 B，并提供回调地址 /fanout
const sse = new SSEKit({ keepAliveMs: 15000, retryMs: 2000 })

const app = express()
app.use(express.json())

app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
  sse.registerConnection(userId, res, { rooms: ['global'] })
})

app.post('/start', async (req, res) => {
  const { userId = 'guest', payload = {} } = req.body || {}
  const cid = 'cid_' + Date.now()
  await fetcher('http://localhost:4005/process', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, cid, payload, callback: 'http://localhost:3005/fanout' })
  })
  res.json({ accepted: true, cid })
})

// B 回调到此，A 本地下发给用户
app.post('/fanout', (req, res) => {
  const { userId = 'guest', data = {} } = req.body || {}
  sse.sendToUser(String(userId), data, { event: 'job:done' })
  res.json({ ok: true })
})

app.get('/', (_req, rsp) => {
  rsp.setHeader('Content-Type', 'text/html; charset=utf-8')
  rsp.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"/><title>A</title>
  <body style="font-family:system-ui,Segoe UI,Arial;margin:24px">
    <h1>HTTP 回调（Webhook）示例：服务器A (3005)</h1>
    <p><a target="_blank" href="/sse?userId=alice">打开 SSE（alice）</a></p>
    <button onclick="post('/start',{userId:'alice',payload:{foo:1,at:Date.now()}})">发起任务（A->B->HTTP 回调->A->alice）</button>
    <script>
      async function post(url, body){ await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(body||{})}) }
    </script>
  </body></html>`)
})

const port = Number(process.env.PORT || 3005)
app.listen(port, () => console.log('Cross-Callback Server A: http://localhost:'+port))
