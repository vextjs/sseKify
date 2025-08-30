const index = require('express')
const { SSEKify, createIORedisAdapter } = require('../../lib')

// 简单的 Express 示例，展示如何接入 ssekify
const app = index()
app.use(index.json())

// 创建 SSEKify 实例
// 提示：若需跨实例（多进程/多节点）分发消息，可配置 Redis 适配器
const sse = new SSEKify({
    // 可选：使用环境变量提供 Redis 连接串
    // redis: process.env.REDIS_URL ? createIORedisAdapter(process.env.REDIS_URL) : undefined,
    channel: 'ssekify:bus',        // 跨实例发布所用的频道名
    keepAliveMs: 15000,           // 心跳间隔，用于保持连接不断开
    retryMs: 2000,                // 建议浏览器重连的间隔（SSE 标准 retry 行）
    recentBufferSize: 20          // 每个用户最近消息缓冲，用于 Last-Event-ID 轻量重放（设 0 关闭）
})

// 建立 SSE 连接（长连接），注意此路由不要再使用 res.json/res.end
app.get('/sse', (req, res) => {
    const userId = String(req.query.userId || 'guest')
    // 重要：不要在 registerConnection 之前调用 res.flushHeaders()，SSEKify 会自动设置/发送必要的响应头
    sse.registerConnection(userId, res, { rooms: ['global'] })
    // 如确需手动 flush，可在注册之后调用（通常无需）：
    // res.flushHeaders?.()
})

// 给指定用户发送消息（同实例内直推）
app.post('/notify/:userId', (req, res) => {
    const delivered = sse.sendToUser(req.params.userId, req.body, { event: 'notify' })
    res.json({ delivered })
})

// 向所有在线连接广播（当前实例）；若要跨实例广播，请使用 publish
app.post('/broadcast', async (req, res) => {
    await sse.publish(req.body, undefined, { event: 'broadcast' })
    res.json({ ok: true })
})

// 向房间发送（仅当前实例内连接生效）
app.post('/room/:room', (req, res) => {
    const count = sse.sendToRoom(req.params.room, req.body, { event: 'room' })
    res.json({ delivered: count })
})

// 发布到房间（若已配置 Redis，则可跨实例分发）
app.post('/publish-room/:room', async (req, res) => {
    await sse.publishToRoom(req.params.room, req.body, { event: 'room' })
    res.json({ ok: true })
})

// 关闭指定用户的所有连接（演示用）
app.post('/close/:userId', (req, res) => {
    sse.close(req.params.userId)
    res.json({ closed: true })
})

// 提供一个简易首页，便于在浏览器中快速验证 SSE
app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>ssekify Express 示例</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>ssekify Express 示例</h1>
  <p>在新标签页打开 <a href="/sse?userId=alice" target="_blank" rel="noopener">/sse?userId=alice</a> 以建立 SSE 连接。</p>
  <p>然后在本页点击按钮或使用 API 发送消息。</p>
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
  <p>也可以通过各框架目录下的 <code>api.http</code> 在 IDE 中发送请求（如 examples/express/api.http）。</p>
</body>
</html>`)
})

app.listen(3000, () => console.log('Express 示例已启动: http://localhost:3000'))