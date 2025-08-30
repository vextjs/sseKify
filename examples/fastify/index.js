const Fastify = require('fastify')
const { SSEKit, createIORedisAdapter } = require('../../lib')

// Fastify 官方风格示例（中文注释）
// 说明：Fastify 提供原生 res via reply.raw，可传给 SSEKit
const app = Fastify()

const sse = new SSEKit({
  // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
  channel: process.env.SSE_CHANNEL || 'ssekit:bus',
  keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
  retryMs: Number(process.env.SSE_RETRY_MS || 2000),
})

app.get('/sse', async (request, reply) => {
  const userId = String((request.query && request.query.userId) || 'guest')
  sse.registerConnection(userId, reply.raw, { rooms: ['global'] })
  // 告诉 Fastify 我们自行处理了响应（长连接）
  reply.hijack()
})

app.post('/notify/:userId', async (request, reply) => {
  const delivered = sse.sendToUser(request.params.userId, request.body, { event: 'notify' })
  reply.send({ delivered })
})

app.post('/broadcast', async (request, reply) => {
  await sse.publish(request.body, undefined, { event: 'broadcast' })
  reply.send({ ok: true })
})

app.post('/room/:room', async (request, reply) => {
  const count = sse.sendToRoom(request.params.room, request.body, { event: 'room' })
  reply.send({ delivered: count })
})

app.post('/publish-room/:room', async (request, reply) => {
  await sse.publishToRoom(request.params.room, request.body, { event: 'room' })
  reply.send({ ok: true })
})

app.post('/close/:userId', async (request, reply) => {
  sse.close(request.params.userId)
  reply.send({ closed: true })
})

// 简易首页
app.get('/', async (request, reply) => {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>sseKit Fastify 示例</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>sseKit Fastify 示例</h1>
  <p>在新标签页打开 <a href="/sse?userId=alice" target="_blank" rel="noopener">/sse?userId=alice</a> 以建立 SSE 连接。</p>
  <div>
    <button id="btnNotify">向 alice 发送通知</button>
    <button id="btnBroadcast">全体广播</button>
    <button id="btnRoom">向房间 global 发送</button>
    <button id="btnClose">关闭 alice 连接</button>
  </div>
  <script>
    async function post(url, body){
      await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(body||{})})
    }
    document.getElementById('btnNotify').onclick = ()=> post('/notify/alice',{msg:'hi alice', at: Date.now()})
    document.getElementById('btnBroadcast').onclick = ()=> post('/broadcast',{msg:'hello everyone', at: Date.now()})
    document.getElementById('btnRoom').onclick = ()=> post('/room/global',{msg:'hello room', at: Date.now()})
    document.getElementById('btnClose').onclick = ()=> post('/close/alice',{})
  </script>
  <hr/>
  <p>也可以通过各框架目录下的 <code>api.http</code> 在 IDE 中发送请求（如 examples/fastify/api.http）。</p>
</body>
</html>`
  reply.type('text/html; charset=utf-8').send(html)
})

const port = Number(process.env.PORT || 3020)
app.listen({ port }).then(() => console.log(`Fastify 示例已启动: http://localhost:${port}`))
