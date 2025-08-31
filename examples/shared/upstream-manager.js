// examples/shared/upstream-manager.js
// 上游连接管理：懒连接、退避重连、空闲关闭；通过回调把事件转发逻辑外置。

const { EventSource } = require('eventsource')

function safeParse(text) { try { return JSON.parse(text) } catch { return text } }

class UpstreamManager {
  /**
   * @param {string} url 上游 SSE 地址
   * @param {Object} [options]
   * @param {number} [options.idleGraceMs=10000] 最后一个下游断开后延迟关闭时长
   * @param {number} [options.backoffBaseMs=1000] 重连退避基数
   * @param {number} [options.backoffMaxMs=30000] 重连退避上限
   * @param {() => Record<string,string>} [options.headersProvider] 动态头部提供者（如携带认证）
   * @param {(payload:any, meta:{event:string,lastEventId?:string}) => void} [options.onMessage]
   * @param {(eventName:string, payload:any, meta:{lastEventId?:string}) => void} [options.onEvent]
   * @param {typeof EventSource} [options.EventSourceCtor] 注入自定义 EventSource 实现（便于测试）
   * @param {string[]} [options.events] 需要监听并转发的自定义事件名列表
   */
  constructor(url, options = {}) {
    this.url = url
    this.es = null
    this.refCount = 0
    this.idleTimer = null
    this.idleGraceMs = options.idleGraceMs ?? 10000
    this.backoffBaseMs = options.backoffBaseMs ?? 1000
    this.backoffMaxMs = options.backoffMaxMs ?? 30000
    this.backoffRetry = 0
    this.lastUpstreamId = null
    this.status = 'idle'

    this.headersProvider = options.headersProvider || (() => ({}))
    this.onMessage = options.onMessage || (() => {})
    this.onEvent = options.onEvent || (() => {})
    this.EventSourceCtor = options.EventSourceCtor || EventSource
    this.events = Array.isArray(options.events) ? options.events : ['tick']
  }

  addClientRef() {
    this.refCount++
    if (!this.es) this.connect(this.lastUpstreamId)
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  removeClientRef() {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => this.maybeClose(), this.idleGraceMs)
    }
  }

  connect(lastId) {
    if (this.es) return
    this.status = 'connecting'

    const headers = { ...this.headersProvider() }
    if (lastId) headers['Last-Event-ID'] = lastId

    console.log(`[Upstream] connect ${this.url} lastId=${lastId ?? '-'}`)

    const es = new this.EventSourceCtor(this.url, { headers })
    this.es = es

    es.onopen = () => {
      this.status = 'connected'
      this.backoffRetry = 0
      console.log('[Upstream] connected')
    }

    es.onmessage = (ev) => {
      this.lastUpstreamId = ev.lastEventId || this.lastUpstreamId
      const data = safeParse(ev.data)
      this.onMessage(data, { event: 'message', lastEventId: ev.lastEventId })
    }

    if (typeof es.addEventListener === 'function' && this.events.length) {
      const forward = (eventName) => (ev) => {
        this.lastUpstreamId = ev.lastEventId || this.lastUpstreamId
        const data = safeParse(ev.data)
        this.onEvent(eventName, data, { lastEventId: ev.lastEventId })
      }
      this.events.forEach((name) => es.addEventListener(name, forward(name)))
    }

    es.onerror = (err) => {
      // 日志去敏：不打印具体数据与敏感头部
      console.warn('[Upstream] error:', err?.message || err)
      this.teardown()
      if (this.refCount > 0) this.scheduleReconnect()
    }
  }

  scheduleReconnect() {
    // 指数退避并封顶；可加入轻微抖动降低惊群
    const base = Math.min(this.backoffBaseMs * 2 ** this.backoffRetry, this.backoffMaxMs)
    const jitter = base * (0.8 + Math.random() * 0.4)
    const wait = Math.floor(jitter)
    this.backoffRetry = Math.min(this.backoffRetry + 1, 10)
    console.log(`[Upstream] reconnect in ${wait}ms, lastId=${this.lastUpstreamId ?? '-'}`)
    setTimeout(() => {
      if (this.refCount > 0) this.connect(this.lastUpstreamId)
    }, wait)
  }

  maybeClose() {
    if (this.refCount === 0) {
      console.log('[Upstream] idle, closing')
      this.close()
    }
  }

  close() {
    this.status = 'closing'
    this.teardown()
    this.status = 'idle'
  }

  teardown() {
    if (this.es) {
      try { this.es.close() } catch {}
      this.es = null
    }
  }
}

module.exports = { UpstreamManager }
