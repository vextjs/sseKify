// bridge-lazy.js
// 功能：仅在有浏览器连接时连接上游；最后一个客户端离线后延时关闭上游。

const express = require('express')
const { SSEKify /*, createIORedisAdapter */ } = require('../../lib')
const { UpstreamManager } = require('../shared/upstream-manager')

const app = express()
app.use(express.json())

const sse = new SSEKify({
    keepAliveMs: 15000,     // 心跳时间
    retryMs: 2000,          // 客户端断线重连间隔
    recentBufferSize: 20    //消息补发缓存大小
})
const UPSTREAM_SSE_URL = process.env.PY_SSE_URL || 'http://localhost:8000/stream'

const upstream = new UpstreamManager(UPSTREAM_SSE_URL, {
    // 方案 C：通过请求头把“上游目标用户”传给 Python（可选）
    // 设置环境变量 UPSTREAM_TO=alice 即可由上游直接决定定向用户；不设置则保持广播。
    headersProvider: () => (process.env.UPSTREAM_TO ? { 'x-upstream-to': String(process.env.UPSTREAM_TO) } : {}),

    // 路由策略：
    // - 若上游 payload 含 userId 或 to 字段，则定向转发给该用户；
    // - 否则保持示例默认：广播给所有连接（可按需修改为忽略或房间路由）。
    onMessage: (payload) => {
        const target = payload && (payload.userId || payload.to)
        if (target) {
            app.sse.sendToUser(String(target), payload, { event: 'message' })
        } else {
            app.sse.sendToAll(payload, { event: 'message' })
        }
    },

    // 自定义事件同样按 userId/to 优先定向，否则广播
    onEvent: (eventName, payload) => {
        const target = payload && (payload.userId || payload.to)
        if (target) {
            app.sse.sendToUser(String(target), payload, { event: eventName })
        } else {
            app.sse.sendToAll(payload, { event: eventName })
        }
    },
    events: ['tick'],
})

// /sse：浏览器建立 SSE 长连接；进入时 +1，关闭时 -1
app.get('/sse', (req, res) => {
    const userId = String(req.query.userId || 'guest')
    upstream.addClientRef()
    sse.registerConnection(userId, res, { rooms: ['global'] })
    req.on('close', () => upstream.removeClientRef())
})

// 广播：POST /broadcast { ...payload }
app.post('/broadcast', (req, res) => {
    const payload = req.body || {}
    sse.sendToAll(payload, { event: 'broadcast' })
    res.json({ ok: true })
})

// 定向：POST /notify/:userId { ...payload }
app.post('/notify/:userId', (req, res) => {
    const payload = req.body || {}
    const delivered = sse.sendToUser(String(req.params.userId), payload, { event: 'notify' })
    res.json({ delivered })
})

// 可选：健康检查
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        downstream: sse.stats().connections,
        upstreamStatus: upstream.status,
        upstreamRefCount: upstream.refCount,
        lastUpstreamEventId: upstream.lastUpstreamId,
    })
})

// 简易首页：带可视化的 HTML（连接/断开、广播、定向、健康）
app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>SSEKify - Express bridge-lazy（广播/定向）</title>
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
  <h1>Express bridge-lazy（带 HTML、广播与定向）</h1>

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
    <legend>服务端主动推送（本实例）</legend>
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
</html>`)
})

const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
    console.log(`SSE bridge (lazy) ready at http://localhost:${PORT}/`)
})
