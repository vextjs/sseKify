const Hapi = require('@hapi/hapi')
const { SSEKit, createIORedisAdapter } = require('../../lib')

// Hapi 官方风格示例（中文注释）
// 说明：Hapi 的原生响应对象可通过 h.raw.res 获取
async function start() {
  const server = Hapi.server({ port: Number(process.env.PORT || 3030), host: '127.0.0.1' })

  const sse = new SSEKit({
    // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
    channel: process.env.SSE_CHANNEL || 'ssekit:bus',
    keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
    retryMs: Number(process.env.SSE_RETRY_MS || 2000),
  })

  server.route({
    method: 'GET',
    path: '/sse',
    handler: (request, h) => {
      const userId = String(request.query.userId || 'guest')
      const res = request.raw.res
      sse.registerConnection(userId, res, { rooms: ['global'] })
      return h.abandon
    }
  })

  server.route({
    method: 'POST',
    path: '/notify/{userId}',
    handler: (request, h) => {
      const delivered = sse.sendToUser(request.params.userId, request.payload, { event: 'notify' })
      return { delivered }
    }
  })

  server.route({
    method: 'POST',
    path: '/broadcast',
    handler: async (request, h) => {
      await sse.publish(request.payload, undefined, { event: 'broadcast' })
      return { ok: true }
    }
  })

  server.route({
    method: 'POST',
    path: '/room/{room}',
    handler: (request, h) => {
      const count = sse.sendToRoom(request.params.room, request.payload, { event: 'room' })
      return { delivered: count }
    }
  })

  server.route({
    method: 'POST',
    path: '/publish-room/{room}',
    handler: async (request, h) => {
      await sse.publishToRoom(request.params.room, request.payload, { event: 'room' })
      return { ok: true }
    }
  })

  server.route({
    method: 'POST',
    path: '/close/{userId}',
    handler: (request, h) => {
      sse.close(request.params.userId)
      return { closed: true }
    }
  })

  // 简易首页
server.route({
  method: 'GET',
  path: '/',
  handler: (request, h) => {
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>sseKit Hapi 示例</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>sseKit Hapi 示例</h1>
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
  <p>也可以通过各框架目录下的 <code>api.http</code> 在 IDE 中发送请求（如 examples/hapi/api.http）。</p>
</body>
</html>`
    return h.response(html).type('text/html; charset=utf-8')
  }
})

await server.start()
  console.log(`Hapi 示例已启动: ${server.info.uri}`)
}

start().catch((e) => { console.error(e); process.exit(1) })
