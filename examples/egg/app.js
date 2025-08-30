'use strict'

const { SSEKit, createIORedisAdapter } = require('../../lib')

module.exports = app => {
  // 在 Egg 应用启动时，挂载一个全局的 sse 实例到 app 上
  app.sse = new SSEKit({
    // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
    channel: process.env.SSE_CHANNEL || 'ssekit:bus',
    keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
    retryMs: Number(process.env.SSE_RETRY_MS || 2000),
  })
}
