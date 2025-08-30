const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')
const { SSEKit, createIORedisAdapter } = require('../../lib')

// Koa 官方风格示例（中文注释）
// 说明：Koa 的 ctx.res 是原生 Node 的 ServerResponse，可直接传给 SSEKit
const app = new Koa()
const router = new Router()
app.use(bodyParser())

const sse = new SSEKit({
  // 可选：跨实例分发
  // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
  channel: process.env.SSE_CHANNEL || 'ssekit:bus',
  keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
  retryMs: Number(process.env.SSE_RETRY_MS || 2000),
})

// 建立 SSE 连接（保持长连接）
router.get('/sse', async (ctx) => {
  const userId = String(ctx.query.userId || 'guest')
  // 注意：不要提前向 ctx.res 写入/flush 头部，交由 SSEKit 处理
  sse.registerConnection(userId, ctx.res, { rooms: ['global'] })
  // Koa 默认会继续后续中间件并尝试写入，这里需告知 Koa 响应已由我们接管
  ctx.respond = false
})

router.post('/notify/:userId', async (ctx) => {
  const delivered = sse.sendToUser(ctx.params.userId, ctx.request.body, { event: 'notify' })
  ctx.body = { delivered }
})

router.post('/broadcast', async (ctx) => {
  await sse.publish(ctx.request.body, undefined, { event: 'broadcast' })
  ctx.body = { ok: true }
})

router.post('/room/:room', async (ctx) => {
  const count = sse.sendToRoom(ctx.params.room, ctx.request.body, { event: 'room' })
  ctx.body = { delivered: count }
})

router.post('/publish-room/:room', async (ctx) => {
  await sse.publishToRoom(ctx.params.room, ctx.request.body, { event: 'room' })
  ctx.body = { ok: true }
})

// 关闭指定用户的所有连接（演示用）
router.post('/close/:userId', async (ctx) => {
  sse.close(ctx.params.userId)
  ctx.body = { closed: true }
})

// 简易首页
router.get('/', async (ctx) => {
  ctx.set('Content-Type', 'text/html; charset=utf-8')
  ctx.body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>sseKit Koa 示例</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>sseKit Koa 示例</h1>
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
  <p>也可以通过各框架目录下的 <code>api.http</code> 在 IDE 中发送请求（如 examples/koa/api.http）。</p>
</body>
</html>`
})

app.use(router.routes()).use(router.allowedMethods())

const port = Number(process.env.PORT || 3010)
app.listen(port, () => console.log(`Koa 示例已启动: http://localhost:${port}`))
