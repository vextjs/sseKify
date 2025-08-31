'use strict'

const { Controller } = require('egg')

class SseController extends Controller {
    // 首页：带可视化 HTML（连接/断开、广播、定向、健康）
    async index() {
        const { ctx } = this
        ctx.set('Content-Type', 'text/html; charset=utf-8')
        ctx.body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>ssekify Egg - 广播与定向</title>
  <style>
    body{font-family:system-ui,Segoe UI,Arial;margin:24px;line-height:1.6}
    #log{font-family:ui-monospace,Consolas,Monaco,monospace;background:#0b1020;color:#d2e3ff;padding:12px;border-radius:8px;height:360px;overflow:auto;white-space:pre-wrap}
    .row{margin:8px 0}
    label{display:inline-block;min-width:92px}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#eef;border:1px solid #ccd}
    .ok{color:#0a0}.err{color:#a00}
    input[type=text]{padding:4px 6px}
    button{margin-right:6px}
  </style>
</head>
<body>
  <h1>Egg bridge-lazy（带 HTML、广播与定向）</h1>

  <div class="row">
    <label>userId</label>
    <input id="userId" value="alice" />
    <button id="btnConnect">连接 /sse</button>
    <button id="btnDisconnect" disabled>断开</button>
  </div>

  <div class="row">
    状态：<span id="status" class="pill">idle</span>
    <span>Last-Event-ID: <code id="leid">-</code></span>
    <button id="btnHealth">拉取 /health</button>
    <span id="health" class="pill"></span>
  </div>

  <fieldset style="padding:10px">
    <legend>服务端主动推送（当前实例）</legend>
    <div class="row">
      <label>广播 payload</label>
      <input id="broadcastPayload" type="text" value='{"msg":"hello everyone"}' style="width:360px" />
      <button id="btnBroadcast">POST /broadcast</button>
    </div>
    <div class="row">
      <label>定向 userId</label>
      <input id="notifyUser" type="text" value="alice" />
    </div>
    <div class="row">
      <label>定向 payload</label>
      <input id="notifyPayload" type="text" value='{"msg":"hi alice"}' style="width:360px" />
      <button id="btnNotify">POST /notify/:userId</button>
    </div>
  </fieldset>

  <h3>实时事件</h3>
  <div id="log"></div>

  <script>
    let es = null
    let lastId = null
    const $ = (id) => document.getElementById(id)
    const log = (line, cls) => {
      const el = $('log')
      const time = new Date().toLocaleTimeString()
      const div = document.createElement('div')
      div.textContent = '[' + time + '] ' + line
      if (cls) div.className = cls
      el.appendChild(div)
      while (el.childNodes.length > 300) el.removeChild(el.firstChild)
      el.scrollTop = el.scrollHeight
    }
    function connect() {
      const userId = $('userId').value || 'guest'
      const url = '/sse?userId=' + encodeURIComponent(userId)
      $('status').textContent = 'connecting'
      $('btnConnect').disabled = true
      $('btnDisconnect').disabled = false
      es = new EventSource(url)
      es.onopen = () => { $('status').textContent = 'connected'; log('opened ' + url, 'ok') }
      es.onmessage = (ev) => {
        lastId = ev.lastEventId || lastId
        $('leid').textContent = lastId || '-'
        try { log('message ' + JSON.stringify(JSON.parse(ev.data))) }
        catch { log('message ' + ev.data) }
      }
      es.addEventListener('tick', (ev) => {
        lastId = ev.lastEventId || lastId
        $('leid').textContent = lastId || '-'
        try { log('tick    ' + JSON.stringify(JSON.parse(ev.data))) }
        catch { log('tick    ' + ev.data) }
      })
      es.onerror = (err) => {
        $('status').textContent = 'error'
        log('error ' + (err?.message || String(err)), 'err')
      }
    }
    function disconnect() {
      if (es) { es.close(); es = null }
      $('status').textContent = 'idle'
      $('btnConnect').disabled = false
      $('btnDisconnect').disabled = true
      log('closed', 'err')
    }
    $('btnConnect').onclick = connect
    $('btnDisconnect').onclick = disconnect
    $('btnHealth').onclick = async () => {
      try {
        const r = await fetch('/health')
        const j = await r.json()
        $('health').textContent = 'ok=' + j.ok + ', upstream=' + j.upstreamStatus + ', conn=' + j.downstream
      } catch { $('health').textContent = 'health error' }
    }
    $('btnBroadcast').onclick = async () => {
      try {
        const payload = JSON.parse($('broadcastPayload').value || '{}')
        const r = await fetch('/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const j = await r.json(); log('broadcast ok=' + j.ok, 'ok')
      } catch (e) { log('broadcast error ' + e, 'err') }
    }
    $('btnNotify').onclick = async () => {
      try {
        const to = $('notifyUser').value || 'alice'
        const payload = JSON.parse($('notifyPayload').value || '{}')
        const r = await fetch('/notify/' + encodeURIComponent(to), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const j = await r.json(); log('notify delivered=' + j.delivered + ' to=' + to, 'ok')
      } catch (e) { log('notify error ' + e, 'err') }
    }
  </script>
</body>
</html>`
    }

    async stream1() {
        const { ctx } = this;

        // SSE 头设置
        ctx.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*', // 跨域
        });

        ctx.status = 200;

        let count = 0;
        const intervalId = setInterval(() => {
            count++;
            // 发送数据给客户端
            ctx.res.write(`data: ${JSON.stringify({ message: 'Hello SSE', count })}\n\n`);

            // 假设发送10次后关闭
            if (count >= 10) {
                clearInterval(intervalId);
                ctx.res.end();
            }
        }, 1000);

        // 客户端断开连接时清理
        ctx.req.on('close', () => {
            clearInterval(intervalId);
        });
    }

    // SSE 长连接入口：进入时 +1，关闭时 -1（触发 UpstreamManager 懒连接/空闲关闭）
    async stream() {
        const { ctx, app } = this
        const userId = String(ctx.query.userId || 'guest')

        // // 有新下游连接时，增加引用计数
        // app.upstream && app.upstream.addClientRef()

        // 注册下游连接
        app.sse.registerConnection(userId, ctx.res, { rooms: ['global'] })
        ctx.respond = false

        // 断开时清理
        ctx.res.on('close', () => {
            app.upstream && app.upstream.removeClientRef()
        })
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

    // 健康检查：观测 upstream/downstream 状态
    async health() {
        const { ctx, app } = this
        ctx.body = {
            ok: true,
            downstream: app.sse.stats().connections,
            upstreamStatus: app.upstream?.status || 'idle',
            upstreamRefCount: app.upstream?.refCount || 0,
            lastUpstreamEventId: app.upstream?.lastUpstreamId || null,
        }
    }
}

module.exports = SseController