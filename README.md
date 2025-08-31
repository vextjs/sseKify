### ssekify

一个简单高效、框架无关的 Node.js Server‑Sent Events (SSE) 工具。单实例即可使用；支持横向扩展，支持通过 Redis Pub/Sub 实现跨实例消息分发。

- Express / Koa / Fastify / Egg / Hapi 示例齐全
- 支持按用户发送、全员广播、房间分发
- 可选 Redis Pub/Sub，用于跨进程 / 跨节点分发
- 心跳保活与轻量级重放（Last-Event-ID + 每用户最近消息缓冲；心跳在可用时会 flush）
- 每连接写入队列 + drain 背压（队列条数/字节上限、丢弃策略）
- 同时支持 CommonJS 与原生 ESM，内置 TypeScript 类型声明

---

### 目录
- [特性总览](#特性总览)
- [安装](#安装)
- [快速开始（Express）](#快速开始express)
- [更多框架最小示例](#更多框架最小示例)
- [模块系统与导入方式（ESM/CJS）](#模块系统与导入方式esmcjs)
- [TypeScript 使用](#typescript-使用)
- [API 参考](#api-参考)
- [背压与写入队列](#背压与写入队列)
- [Payload 限制与自定义序列化](#payload-限制与自定义序列化)
- [重放缓冲治理（Last-Event-ID / TTL / LRU / clearRecent）](#重放缓冲治理last-event-id--ttl--lru--clearrecent)
- [鉴权实战](#鉴权实战)
- [跨服务器推送（两种方案）](#跨服务器推送两种方案)
- [多租户隔离](#多租户隔离)
- [Redis 高可用（Cluster/Sentinel）](#redis-高可用clustersentinel)
- [代理/网关与部署](#代理网关与部署)
- [优雅关闭与运行时指标](#优雅关闭与运行时指标)
- [性能与调优建议](#性能与调优建议)
- [常见问题与排查（FAQ）](#常见问题与排查faq)
- [示例与一键联调](#示例与一键联调)
- [路线图与状态](#路线图与状态)
- [贡献与许可证](#贡献与许可证)
- [快捷导航](#快捷导航)

---

### 特性总览
- 单实例/跨实例推送（Redis Pub/Sub）
- 用户/全体/房间维度发送
- Last-Event-ID 重放与每用户最近消息缓冲（支持 TTL/LRU 治理）
- 心跳注释行 + 可用时自动 flush
- 每连接写队列 + drain 背压（队列条数/字节上限、丢弃策略）
- ESM/CJS 双形态导入，内置 d.ts 类型
- 多框架官方示例与 Docker/K8s 样例

---

### 安装
```bash
npm i ssekify
# 如需 Redis 跨实例，请额外安装（可选）
npm i ioredis
```

---

### 快速开始（Express）
一眼看全主要能力（SSE 长连接、单用户通知、广播、房间、本地发送与跨实例发布、关闭连接）。

```js
const express = require('express')
const { SSEKify, createIORedisAdapter } = require('ssekify')

const app = express()
app.use(express.json())

// 1) 初始化：单实例即可用；如需跨实例（多进程/多节点），配置 Redis 即可
const sse = new SSEKify({
  // 可选：REDIS_URL=redis://user:pass@host:6379/0
  // redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
  channel: 'ssekify:bus',      // 跨实例发布/订阅的频道名
  keepAliveMs: 15000,         // 心跳间隔（确保代理/网关不超时）
  retryMs: 2000,              // 浏览器重连建议（SSE 帧 retry 行）
  recentBufferSize: 20        // 每用户最近消息缓冲（用于 Last-Event-ID 重放）；设 0 关闭
  // 高级项（可选）：serializer、maxPayloadBytes、recentTTLMs、recentMaxUsers
})

// 2) 建立 SSE 长连接（关键点）：
//    - 不要在 registerConnection 之前 flush/写入任何响应
//    - 建立 SSE 后不要对该响应 res.json/res.end（保持连接）
app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
  sse.registerConnection(userId, res, {
    rooms: ['global'],
    // 背压 & 慢客户端策略（可选）：
    // maxQueueItems: 100,
    // maxQueueBytes: 256*1024,
    // dropPolicy: 'oldest' // 也可 'newest' | 'disconnect'
  })
  // 如确需手动 flush，可在注册之后调用（一般不需要）：
  // res.flushHeaders?.()
})

// 3) 单用户通知（同实例直推）
app.post('/notify/:userId', (req, res) => {
  const delivered = sse.sendToUser(req.params.userId, req.body, { event: 'notify' })
  res.json({ delivered })
})

// 4) 全体广播（跨实例推荐用 publish）
//    - sendToAll 仅同实例；publish 会经 Redis 跨实例分发
app.post('/broadcast', async (req, res) => {
  await sse.publish(req.body, undefined, { event: 'broadcast' })
  res.json({ ok: true })
})

// 5) 房间消息（同实例）
app.post('/room/:room', (req, res) => {
  const count = sse.sendToRoom(req.params.room, req.body, { event: 'room' })
  res.json({ delivered: count })
})

// 6) 发布到房间（跨实例，需配置 Redis）
app.post('/publish-room/:room', async (req, res) => {
  await sse.publishToRoom(req.params.room, req.body, { event: 'room' })
  res.json({ ok: true })
})

// 7) 关闭指定用户的所有连接（演示/排障常用）
app.post('/close/:userId', (req, res) => {
  sse.close(req.params.userId)
  res.json({ closed: true })
})

app.listen(3000, () => console.log('Express 示例: http://localhost:3000'))
```

浏览器端最小示例（直接在控制台试用）：
```html
<script>
  const es = new EventSource('/sse?userId=alice') // 重连时浏览器会自动携带 Last-Event-ID
  es.addEventListener('notify', e => console.log('notify', e.data))
  es.addEventListener('broadcast', e => console.log('broadcast', e.data))
  es.onmessage = e => console.log('message', e.lastEventId, e.data)
  es.onerror = () => console.warn('SSE error, browser will retry...')
</script>
```

一键联调文件（IDE HTTP Client）：examples/express/api.http  
常见踩坑与建议：
- 不要在 registerConnection 前 flush/写头；不要在 SSE 响应上再用 res.json/res.end；
- 对 /sse 路由禁用压缩与代理缓冲（Nginx: proxy_buffering off；或 X-Accel-Buffering: no）；
- keepAliveMs 要小于代理/负载均衡的空闲超时；
- Last-Event-ID：默认从请求头读取；若不便设置，可使用 ?lastEventId=... 查询参数。

---

### 更多框架最小示例
- Express: examples/express/index.js（npm run dev:express）
- Koa: examples/koa/index.js（npm run dev:koa）
- Fastify: examples/fastify/index.js（npm run dev:fastify）
- Hapi: examples/hapi/index.js（npm run dev:hapi）
- Egg: examples/egg（npm run dev:egg）

每个目录均提供 api.http，便于一键联调。

---

### 模块系统与导入方式（ESM/CJS）
本包同时支持 CommonJS 与原生 ESM。

- CommonJS：
```js
const { SSEKify, createIORedisAdapter } = require('ssekify')
```
- 原生 ESM（Node >= 16）：
```js
import { SSEKify, createIORedisAdapter } from 'ssekify'
// 也支持默认导入再解构：
// import ssekify from 'ssekify'
// const { SSEKify, createIORedisAdapter } = ssekify
```

---

### TypeScript 使用
本包内置类型声明（index.d.ts），具名导入/默认导入均有完整提示。

```ts
import { SSEKify, type SSEKifyOptions } from 'ssekify'
const sse = new SSEKify({ channel: 'ssekify:bus' } satisfies SSEKifyOptions)
```

可选 ioredis 适配器：
```ts
import { createIORedisAdapter } from 'ssekify'
const sse = new SSEKify({ redis: createIORedisAdapter('redis://localhost:6379') })
```

---

### API 参考
- new SSEKify(options?: SSEKifyOptions)
    - options.redis?: RedisLike | string
        - 跨实例分发所用的 Redis 适配器。可传 `createIORedisAdapter(url)` 的返回值；也支持直接传 URL 字符串（简化启用）。
        - 不配置则仅限当前实例内分发（适合单实例或开发环境）。
    - options.channel?: string = 'ssekify:bus'
        - 跨实例消息的 Pub/Sub 频道名；多租户建议每租户独立前缀（如 `ssekify:bus:tenant:{id}`）。
    - options.keepAliveMs?: number = 15000
        - 心跳间隔（`: ping` 注释行）。建议小于代理/网关的空闲超时，以防被断开。
    - options.retryMs?: number = 2000
        - SSE 帧中的 `retry:` 行，提示浏览器“建议重连间隔”。
    - options.recentBufferSize?: number = 20
        - 每用户最近消息条数，用于 Last-Event-ID 重放。设 0 可关闭（节省内存）。
    - options.serializer?: (data:any)=>string = JSON.stringify
        - 自定义序列化（如 safe-stable-stringify）以避免循环引用导致的异常。
    - options.maxPayloadBytes?: number = 1 MiB
        - 单条消息序列化后的最大字节数，超限将跳过该条并触发 'error' 事件（不中断连接）。
    - options.recentTTLMs?: number = 30 分钟
        - 最近消息缓冲的用户不活跃 TTL，超时清理，防止长期运行内存膨胀。
    - options.recentMaxUsers?: number = 10000
        - 最近消息缓冲的全局用户上限，超过后按 LRU 淘汰最久未活跃用户。

- registerConnection(userId: string, res: ServerResponse, options?: RegisterOptions)
    - 返回：`{ connId, close(), join(room), leave(room) }`
    - 说明：建立 SSE 长连接。库会设置并发送 SSE 头；不要在调用前自行 flush/写头；建立后不要再对该响应 `res.json/res.end`。
    - options.rooms?: string[]
        - 初始加入的房间名数组（会自动加入全局房间映射）。
    - options.headers?: Record<string,string>
        - 额外响应头（如 CORS）。库已设置 Content-Type、Cache-Control 等核心头，避免重复冲突。
    - options.keepAliveMs?/retryMs?: number
        - 覆盖实例默认的心跳与 retry（仅此连接生效）。
    - options.maxQueueItems?: number = 100
        - 每连接写队列“最大条数”。当 `res.write` 返回 `false` 时进入队列，避免无界内存。
    - options.maxQueueBytes?: number = 256 KiB
        - 每连接写队列“最大字节数”，与条数一起限制队列规模。
    - options.dropPolicy?: 'oldest'|'newest'|'disconnect' = 'oldest'
        - 队列超限时策略：丢队首（oldest）、丢新消息（newest）、直接断开（disconnect）。慢客户端多时可考虑 'disconnect'。

- sendToUser(userId, data, { event?, id? }): number
    - 同实例按用户直推；返回实际投递连接数。`event` 对应浏览器 `addEventListener` 的事件名；`id` 会成为 SSE 帧 id，浏览器重连会带 Last-Event-ID。
- sendToAll(data, { event?, id? }): number
    - 同实例广播（不跨实例）。如需跨实例广播，请使用 `publish`。
- sendToRoom(room, data, { event?, id? }): number
    - 同实例按房间发送（注册时 rooms 指定或 handle.join 加入的房间）。
- publish(data, userId?, { event?, id? }): Promise<void>
    - 跨实例发布：传 userId 则面向该用户；不传则作为跨实例广播。
- publishToRoom(room, data, { event?, id? }): Promise<void>
    - 跨实例发布到房间：所有实例中加入该房间的连接都会收到。
- close(userId?): void
    - 关闭指定用户的所有连接；不传 userId 则关闭全部（谨慎操作）。

- stopAccepting(): void
    - 停止接受新连接（现有连接保持）。常见于滚动发布前的准备阶段。
- shutdown({ announce = true, event = 'server:shutdown', graceMs = 5000 }?)
    - 优雅关闭：广播“即将关闭”事件，等待宽限期后断开所有连接；如 Redis 适配器实现了 `close()`，会在最后调用。结束后清理内部定时器。
- stats(): object
    - 返回基础指标：
    - `{ connections, users, rooms, sent, droppedOldest, droppedNewest, disconnectedByBackpressure, queueItemsMax, queueBytesMax, errorCount }`
- clearRecent(userId?: string): void
    - 清理最近消息缓冲（指定用户或全部）。

- 事件（EventEmitter）：
    - `'connect' | 'disconnect' | 'publish' | 'message-sent' | 'error'`
    - 建议监听 `'error'`（序列化失败/超大 payload/背压断开等会触发），用于日志与监控。

- RedisLike 接口（适配器）
    - 必需：`publish(channel, message)`, `subscribe(channel)`, `on('message', cb)`
    - 可选：`close(): Promise<void> | void`（便于 shutdown 优雅关闭）
    - 若适配器/底层客户端提供 `'error'` 事件，可转发到 `sse.emit('error', e)` 以便观测。

---

### 背压与写入队列
- 当 res.write 返回 false 时，消息进入该连接的内存队列，等待 'drain' 后继续发送。
- 队列具有限制与丢弃策略，避免无界内存增长。
- 可配置项（RegisterOptions）：
    - maxQueueItems（默认 100）
    - maxQueueBytes（默认 256 KiB）
    - dropPolicy（'oldest' | 'newest' | 'disconnect'；默认 'oldest'）
- 建议：
    - 对非关键事件可保持默认策略；
    - 若宁可断开也不丢消息，设置 dropPolicy: 'disconnect'；
    - 慢客户端多时，适当调低 recentBufferSize 与队列上限。

---

### Payload 限制与自定义序列化
- options.serializer：自定义序列化逻辑（默认 JSON.stringify；可用 safe-stable-stringify）。
- options.maxPayloadBytes：单条事件序列化后的最大字节数（默认 1 MiB）。
- 序列化失败（如循环引用）或超过大小限制，将跳过该条并触发 'error' 事件（不中断连接）。
- 示例：
```js
const safeStringify = require('safe-stable-stringify')
const sse = new SSEKify({ serializer: safeStringify, maxPayloadBytes: 512 * 1024 })
```

---

### 重放缓冲治理（Last-Event-ID / TTL / LRU / clearRecent）
- recentBufferSize：每用户最近保留的消息条数（用于 Last-Event-ID 重放）。
- recentTTLMs（默认 30 分钟）：清理长时间不活跃用户的重放缓冲；设为 0 表示禁用定时清理。
- recentMaxUsers（默认 10000）：全局用户缓冲上限，超过后按最久未活跃（LRU）淘汰。
- clearRecent(userId?)：可清理指定用户或全部用户的重放缓冲。
- Last-Event-ID：
    - 浏览器会在重连时自动携带；
    - 若不便设置请求头，也可使用查询参数 ?lastEventId=...（已支持）。

---

### 鉴权实战
- Token / Query：URL 携带短期有效 JWT，服务端验证后提取 userId/tenant 等再注册连接（Token 务必短期有效与签名校验）。
- Cookie / Session：同域场景复用登录态，读取 session.userId 后 registerConnection；跨域需正确配置 SameSite/Secure/CORS。
- 预签名 URL：EventSource 不支持自定义 Header，若需携带认证信息，可先调用后端换取短期预签名 URL，再用该 URL 打开 SSE。
- 示例（Express + jsonwebtoken）：
```js
const jwt = require('jsonwebtoken')
function authFromQuery(req,res,next){
  try{
    const payload = jwt.verify(String(req.query.token||''), process.env.JWT_SECRET)
    req.user = { id: payload.sub, tenant: payload.tenant }
    next()
  }catch(e){ res.status(401).json({error:'unauthorized'}) }
}
app.get('/sse', authFromQuery, (req,res)=>{
  sse.registerConnection(String(req.user.id), res, { rooms:['global'] })
})
```

---

### 跨服务器推送（两种方案）
- 方案一：Redis Pub/Sub（推荐，适合多实例/弹性扩展）
    - A 持有客户端连接；B 处理后 `sse.publish(data, userId, {event})` 回推共享频道；A 订阅后自动下发给对应用户。
    - 示例：examples/express/cross-redis-a.js（端口 3004）与 examples/express/cross-redis-b.js（端口 4004）
    - 一键联调：examples/express/cross-redis.api.http（需要 REDIS_URL）
- 方案二：HTTP 回调（Webhook）（小规模或无 Redis 时可用）
    - A 持有连接并暴露 /fanout；B 完成后 POST 回调到 A；A 本地下发给用户。
    - 示例：examples/express/cross-callback-a.js（端口 3005）与 examples/express/cross-callback-b.js（端口 4005）
    - 一键联调：examples/express/cross-callback.api.http

---

### 多租户隔离
- 每租户一个 SSEKify 实例 + 独立 Redis 频道（ssekify:bus:tenant:{tenant}）。
- 路由以租户前缀组织（如 /:tenant/sse、/:tenant/publish-room/:room）。
- 完整示例：examples/express/multitenant.js（npm run dev:multi）
- 请求示例：examples/express/multitenant.api.http
- 最小代码片段：
```js
const kits = new Map()
function getKit(tenant){
  if(!kits.has(tenant)){
    kits.set(tenant, new SSEKify({
      redis: process.env.REDIS_URL && createIORedisAdapter(process.env.REDIS_URL),
      channel: `ssekify:bus:tenant:${tenant}`
    }))
  }
  return kits.get(tenant)
}
```

---

### Redis 高可用（Cluster/Sentinel）
- Redis Cluster：examples/express/redis-cluster.js（使用 ioredis.Cluster 并包装为 RedisLike 适配器）。
- Redis Sentinel：examples/express/redis-sentinel.js（通过 Sentinel 连接主库并包装适配器）。
- 环境变量建议：
    - Cluster: REDIS_CLUSTER_NODES, REDIS_PASSWORD
    - Sentinel: REDIS_SENTINELS, REDIS_SENTINEL_MASTER, REDIS_PASSWORD

---

### 代理/网关与部署
- 对 /sse 路由禁用压缩与缓冲（Nginx: `proxy_buffering off` 或返回 `X-Accel-Buffering: no`）。
- keepAliveMs 小于负载均衡/代理空闲超时。
- 心跳会在可用时 `res.flush()`，确保事件及时穿透代理。
- Docker 构建并运行（以 Express 示例为例）：
```bash
docker build -t ssekify-demo --build-arg EXAMPLE_PATH=examples/express/index.js -f examples/deploy/Dockerfile .
docker run -p 3000:3000 --name ssekify-demo ssekify-demo
```
- K8s（以 Express 示例为例）：
```bash
kubectl apply -f examples/deploy/k8s-ssekify-express.yaml
```

---

### 优雅关闭与运行时指标
- 停止接入新连接（不立即断开已有连接）：
```js
sse.stopAccepting()
```
- 优雅关闭（公告 + 宽限 + 断开 + 关闭 Redis）：
```js
await sse.shutdown({ announce: true, event: 'server:shutdown', graceMs: 5000 })
```
- 指标：
```js
const st = sse.stats()
// { connections, users, rooms, sent, droppedOldest, droppedNewest, disconnectedByBackpressure, queueItemsMax, queueBytesMax, errorCount }
```
- 说明：若 Redis 适配器实现了 close()，shutdown 会在断开所有连接后调用 redis.close()。

---

### 性能与调优建议
- 慢客户端/IoT：
    - 较小 maxQueueBytes（64–128KiB）、dropPolicy='disconnect'、调低 recentBufferSize。
- 高吞吐：
    - maxPayloadBytes 256–512KiB，自定义 serializer；合理的队列上限与丢弃策略。
- 多租户：
    - 独立频道 + 租户级限流/配额。
- 压测与观测：
    - 关注 sent/丢弃/断开/队列峰值与端到端延迟；必要时导出 Prometheus 指标（可参考 prom-client 结合 sse.stats() 自行映射）。

---

### 常见问题与排查（FAQ）
- ERR_HTTP_HEADERS_SENT
    - 原因：在调用 registerConnection 前就 flush 了响应头，或其他中间件已写入。
    - 解决：不要在 registerConnection 前调用 res.flushHeaders()；必要时可在注册后再调用。库对 headersSent=true 有容错，会跳过重复设置头，但仍建议避免提前 flush。
- 已建立 SSE 后不要再对该响应调用 res.json / res.end。
- Last-Event-ID 获取：默认从请求头读取；若不便设置请求头，也支持查询参数 ?lastEventId=...

---

### 示例与一键联调
- 示例：examples/*（Express/Koa/Fastify/Hapi/Egg、多租户、Redis Cluster/Sentinel、跨服务器推送）
- 每个目录配有 api.http，可在 IDE 中直接发起请求验证。
- 部署样例：examples/deploy/*（Dockerfile、K8s YAML）。
- 常用脚本（package.json scripts）：
    - dev:express / dev:koa / dev:fastify / dev:hapi / dev:egg
    - dev:multi（多租户示例）
    - dev:cross:redis:a / dev:cross:redis:b（跨服务器 Redis 回推）
    - dev:cross:cb:a / dev:cross:cb:b（跨服务器 HTTP 回调）

---

### 路线图与状态
- 请见 STATUS.md（能力矩阵与里程碑）。

---

### 贡献与许可证
- 欢迎 Issue/PR；建议在提交前附最小复现或对照示例。
- License: MIT

---

### 快捷导航
- 返回目录 → [回到顶部](#目录)
- 示例索引 → [示例与一键联调](#示例与一键联调)
- API → [API 参考](#api-参考)
- 运维 → [代理/网关与部署](#代理网关与部署) | [优雅关闭与运行时指标](#优雅关闭与运行时指标)