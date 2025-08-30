'use strict'

const { Controller } = require('egg')

class SseController extends Controller {
    // 简易首页：提供按钮快速体验
    async index() {
        const { ctx } = this
        ctx.set('Content-Type', 'text/html; charset=utf-8')
        ctx.body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>ssekify Egg 示例</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
  <h1>ssekify Egg 示例</h1>
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
  <p>也可以通过本目录的 <code>api.http</code> 在 IDE 中发送请求（examples/egg/api.http）。</p>
</body>
</html>`
    }

    // SSE 长连接入口
    async stream() {
        const { ctx, app } = this
        const userId = String(ctx.query.userId || 'guest')
        app.sse.registerConnection(userId, ctx.res, { rooms: ['global'] })
        ctx.respond = false
    }

    // 单用户推送
    async notify() {
        const { ctx, app } = this
        const delivered = app.sse.sendToUser(ctx.params.userId, ctx.request.body, { event: 'notify' })
        ctx.body = { delivered }
    }

    // 全员广播（如配置了 Redis，则 publish 会跨实例分发）
    async broadcast() {
        const { ctx, app } = this
        await app.sse.publish(ctx.request.body, undefined, { event: 'broadcast' })
        ctx.body = { ok: true }
    }

    // 向房间发送（仅当前实例）
    async room() {
        const { ctx, app } = this
        const count = app.sse.sendToRoom(ctx.params.room, ctx.request.body, { event: 'room' })
        ctx.body = { delivered: count }
    }

    // 发布到房间（如配置 Redis，可跨实例分发）
    async publishRoom() {
        const { ctx, app } = this
        await app.sse.publishToRoom(ctx.params.room, ctx.request.body, { event: 'room' })
        ctx.body = { ok: true }
    }

    // 关闭指定用户的所有连接（演示）
    async close() {
        const { ctx, app } = this
        app.sse.close(ctx.params.userId)
        ctx.body = { closed: true }
    }
}

module.exports = SseController