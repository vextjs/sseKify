'use strict'

const { SSEKify, createIORedisAdapter } = require('../../lib')
const { UpstreamManager } = require('../shared/upstream-manager')

module.exports = app => {
  // 全局 SSE 实例
  app.sse = new SSEKify({
    // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
    channel: process.env.SSE_CHANNEL || 'ssekify:bus',
    keepAliveMs: Number(process.env.SSE_KEEPALIVE_MS || 15000),
    retryMs: Number(process.env.SSE_RETRY_MS || 2000),
  })

  // 上游 SSE 地址（例如 Python SSE 服务）
  const UPSTREAM_SSE_URL = process.env.PY_SSE_URL || 'http://localhost:8000/stream'

  // 懒连接的上游管理器：仅在有下游连接时连上游
  app.upstream = new UpstreamManager(UPSTREAM_SSE_URL, {
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

    // 需要监听的自定义事件名
    events: ['tick'],

    // 可选：空闲关闭/退避重连策略
    // idleGraceMs: 10000,
    // backoffBaseMs: 1000,
    // backoffMaxMs: 30000,
  })
}
