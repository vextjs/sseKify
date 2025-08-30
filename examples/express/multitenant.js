const express = require('express')
const { SSEKit, createIORedisAdapter } = require('../../lib')

// 多租户隔离示例：每个租户一个独立的 SSEKit 实例 + 独立 Redis 频道
const kits = new Map()
function getKit(tenant) {
  if (!kits.has(tenant)) {
    const channel = `ssekit:bus:tenant:${tenant}`
    const redisUrl = process.env.REDIS_URL
    const redis = redisUrl ? createIORedisAdapter?.(redisUrl) : undefined
    const kit = new SSEKit({
      redis,
      channel,
      keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
      retryMs: Number(process.env.SSE_RETRY_MS || 2000),
      recentBufferSize: Number(process.env.SSE_RECENT_BUFFER || 20),
    })
    kits.set(tenant, kit)
  }
  return kits.get(tenant)
}

const app = express()
app.use(express.json())

// 简易首页
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>sseKit 多租户示例</title>
<style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>sseKit 多租户隔离示例</h1>
  <p>打开两个标签页，分别连接不同租户：</p>
  <ul>
    <li><a target="_blank" href="/t1/sse?userId=alice">租户 t1 的 SSE（alice）</a></li>
    <li><a target="_blank" href="/t2/sse?userId=alice">租户 t2 的 SSE（alice）</a></li>
  </ul>
  <div>
    <button onclick="post('/t1/notify/alice',{msg:'hi alice from t1',at:Date.now()})">t1 -> alice</button>
    <button onclick="post('/t2/notify/alice',{msg:'hi alice from t2',at:Date.now()})">t2 -> alice</button>
    <button onclick="post('/t1/broadcast',{msg:'broadcast from t1',at:Date.now()})">t1 广播</button>
    <button onclick="post('/t2/broadcast',{msg:'broadcast from t2',at:Date.now()})">t2 广播</button>
    <button onclick="post('/t1/publish-room/global',{msg:'t1 publish room global',at:Date.now()})">t1 发布到房间 global</button>
    <button onclick="post('/t2/publish-room/global',{msg:'t2 publish room global',at:Date.now()})">t2 发布到房间 global</button>
  </div>
  <script>
    async function post(url, body){ await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(body||{})}) }
  </script>
  <hr/>
  <pre><code>GET  /t1/sse?userId=alice
POST /t1/notify/alice
POST /t1/broadcast
POST /t1/room/global
POST /t1/publish-room/global
（t2 同理）
</code></pre>
</body>
</html>`) 
})

app.get('/:tenant/sse', (req, res) => {
  const tenant = String(req.params.tenant)
  const userId = String(req.query.userId || 'guest')
  const sse = getKit(tenant)
  sse.registerConnection(userId, res, { rooms: ['global'] })
})

app.post('/:tenant/notify/:userId', (req, res) => {
  const sse = getKit(String(req.params.tenant))
  const delivered = sse.sendToUser(String(req.params.userId), req.body, { event: 'notify' })
  res.json({ delivered })
})

app.post('/:tenant/broadcast', async (req, res) => {
  const sse = getKit(String(req.params.tenant))
  await sse.publish(req.body, undefined, { event: 'broadcast' })
  res.json({ ok: true })
})

app.post('/:tenant/room/:room', (req, res) => {
  const sse = getKit(String(req.params.tenant))
  const count = sse.sendToRoom(String(req.params.room), req.body, { event: 'room' })
  res.json({ delivered: count })
})

app.post('/:tenant/publish-room/:room', async (req, res) => {
  const sse = getKit(String(req.params.tenant))
  await sse.publishToRoom(String(req.params.room), req.body, { event: 'room' })
  res.json({ ok: true })
})

app.post('/:tenant/close/:userId', (req, res) => {
  const sse = getKit(String(req.params.tenant))
  sse.close(String(req.params.userId))
  res.json({ closed: true })
})

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  console.log(`Multi-tenant SSE demo: http://localhost:${port}`)
  console.log(`示例：/t1/sse?userId=alice, /t2/sse?userId=alice`)
})