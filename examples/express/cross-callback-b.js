const express = require('express')
const fetcher = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)))

// 服务器B：处理完成后以 HTTP POST 回调到 A 的 /fanout
const app = express()
app.use(express.json())

app.post('/process', async (req, res) => {
  const { userId = 'guest', cid = 'cid', payload = {}, callback } = req.body || {}
  setTimeout(async () => {
    const result = { cid, ok: true, echo: payload, at: Date.now() }
    if (callback) {
      await fetcher(callback, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, data: result }) })
    }
  }, 300)
  res.json({ processing: true })
})

const port = Number(process.env.PORT || 4005)
app.listen(port, () => console.log('Cross-Callback Server B: http://localhost:'+port))
