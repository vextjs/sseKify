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
- [与 vsse 协同（postAndListen）](#与-vsse-协同postandlisten)
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
- Express（上游 SSE 源桥接 示例）：
  - 基础版：examples/express/bridge-basic.js（启动即连接上游）
  - 懒连接版：examples/express/bridge-lazy.js（有前端连接才连接上游，空闲自动断开；内置首页 / 用于演示“广播/定向/健康”）
  - 一键联调：examples/express/bridge-upstream.api.http
  - 注意：eventsource v4 在 CommonJS 中需使用具名导入：const { EventSource } = require('eventsource')；ESM：import { EventSource } from 'eventsource'
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

#### 本地直推 vs 跨实例发布（如何选择）
- sendToUser(userId, data, opts)：仅把消息写入“当前实例上属于该用户的连接”。不依赖 Redis，不能自动跨实例。
- publish(data, userId|undefined, opts)：经 Redis Pub/Sub 跨实例分发，最终由“真正持有该用户连接的实例”写入 SSE 连接；未配置 Redis 时仅在本机生效。

选择指南：
- 单实例部署，或确认浏览器连接一定落在当前实例（如粘滞会话）→ 用 sendToUser/sendToAll/sendToRoom。
- 入口层（Ingress/LB 前的边车或网关）承接连接、业务服务在内网处理并回推 → 统一用 publish（单用户或全体广播皆可）。

注意：publish 是 Pub/Sub 分发，不是“缓存/持久化”；订阅端离线期间的消息不会补发。如需可靠投递/重放，请引入数据库/队列或 Redis Streams。

#### 两种跨服务器方案
- 方案一：Redis Pub/Sub（推荐，适合多实例/弹性扩展）
    - A 持有客户端连接；B 处理后 `sse.publish(data, userId, {event})` 回推共享频道；A 订阅后自动下发给对应用户。
    - 示例：examples/express/cross-redis-a.js（端口 3004）与 examples/express/cross-redis-b.js（端口 4004）
    - 一键联调：examples/express/cross-redis.api.http（需要 REDIS_URL）
- 方案二：HTTP 回调（Webhook）（小规模或无 Redis 时可用）
    - A 持有连接并暴露 /fanout；B 完成后 POST 回调到 A；A 本地下发给用户。
    - 示例：examples/express/cross-callback-a.js（端口 3005）与 examples/express/cross-callback-b.js（端口 4005）
    - 一键联调：examples/express/cross-callback.api.http

### 与 vsse 协同（postAndListen）
- 事件名一致：若前端 SSEClient({ eventName: 'notify' })，服务端发送时也应 { event: 'notify' }；默认均为 'message'。
- requestId 对齐：在 data JSON 顶层包含本次调用的 requestId，前端才能将消息路由到对应回调。
- 阶段建议：phase 使用 'progress' | 'done' | 'error'；前端在 done/error 时会自动取消该 requestId 的监听。

示例（业务服务不持有连接，仅发布；入口服务持有连接并订阅 Redis）：
```js
// 业务服务（仅发布）
await sse.publish({ requestId, phase: 'progress', type: 'chat', payload: { content: chunk } }, userId, { event: 'notify' })
await sse.publish({ requestId, phase: 'done',     payload: { content, length: content.length } }, userId, { event: 'notify' })
// 出错：
await sse.publish({ requestId, phase: 'error',    error: { code: 'UpstreamOrDbError', message: err.message } }, userId, { event: 'notify' })
```

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

#### 入口承接连接拓扑（Ingress/LB 终止，推荐多实例）
- 入口服务：暴露 /sse 并调用 registerConnection(userId, res)；如需跨实例，配置相同的 Redis 与 channel 进行订阅。
- 业务服务：不 registerConnection；完成任务后统一用 publish(data, userId, { event }) 将消息发布到 Redis。
- Redis：仅需内网可达；不必对公网开放；建议配置密码/ACL，必要时启用 TLS。
- 常见误区：
  - 业务服务使用 sendToUser → 若该服务并不持有该用户连接，消息不会被任何客户端收到。请改用 publish。
  - publish 被当作“缓存/持久化”使用 → Redis Pub/Sub 是瞬时分发，订阅端离线期间消息不会补发。

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
// {
//   connections, users, rooms,
//   sent, droppedOldest, droppedNewest, disconnectedByBackpressure,
//   queueItemsMax, queueBytesMax, errorCount,
//   // 新增：seq 相关指标（用于观测是否启用了全局单调、自增来源等）
//   seqIncrsLocal,           // 使用本地内存自增的次数（单实例或 KV 不可用时）
//   seqIncrsRedis,           // 使用 Redis INCR 的次数（启用 KV 时）
//   lastSeqKvFallbackAt      // 最近一次从 KV 继承失败并回退为内存自增的时间戳（epochMs；0 表示从未发生）
// }
```
- 说明：
  - 当检测到 Redis 适配器不具备 KV 能力时，库会回退为“内存自增”并仅触发一次告警事件，错误对象将带有 `code = 'SEQ_KV_FALLBACK'` 且 `level = 'warn'`；功能不受影响，但对同一键仅能保证“每实例单调”。
  - 需要“全局单调”时，请使用带 KV 的 `createIORedisAdapter(REDIS_URL)`（或显式传入 KV 客户端）。
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

- 使用了 publish，但前端收不到？
  - 自检三点：
    1) 入口与业务是否都指向同一 Redis，且 channel 一致；
    2) 浏览器的 SSE 是否连到了持有连接的入口服务；
    3) 服务端发送的 event 是否与前端 eventName 一致，且 data 内是否包含正确的 requestId（对 postAndListen 而言）。
- 为什么我用 sendToUser 没人收到？
  - sendToUser 只作用于“当前实例持有的连接”。若连接在另一台实例或入口服务上，请改用 publish（并保证两侧 Redis/channel 一致）。

---

### 示例与一键联调

#### 上游桥接快速联调（Python FastAPI SSE）
- Python 上游示例：python/main.py（FastAPI）。安装并启动：
  - pip install fastapi uvicorn
  - uvicorn main:app --host 0.0.0.0 --port 8000 --reload
- Node 侧：
  - Express 懒连接桥接：node examples/express/bridge-lazy.js 并打开 http://localhost:3000/ 查看 HTML 页面；点击“连接”。
  - Egg 懒连接桥接：npx egg-bin dev 并打开 http://localhost:7001/ 查看 HTML 页面；点击“连接”。
- 环境变量：
  - PY_SSE_URL：自定义上游地址（默认 http://localhost:8000/stream）。
  - UPSTREAM_TO：可选。当设置时，Node 在连接上游时会通过 headersProvider 注入请求头 X-Upstream-To，Python 会把该值写入每条事件 payload 的 userId 字段；Node 端按 userId 进行定向下发（不设置则保持广播）。
  - 安全：不要在日志中打印敏感值；示例代码默认不会记录头部内容。
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

---

### 新增能力（自动 timestamp / 自动 seq 与 Redis KV 继承）

本版本在不改变既有 API 的前提下，新增了两项“默认开启、按需生效”的能力，用于提升断线重连后的稳定性与顺序保障：

- 自动注入 timestamp（发送时刻）
  - 默认启用；当数据体未包含 `timestamp` 时，发送前自动注入 ISO 8601（UTC）时间戳。
  - 可通过构造参数 `autoFields.timestamp` 配置为 `'iso' | 'epochMs' | false`。
- 自动注入 seq（业务序号）
  - 默认启用；当且仅当数据体包含 `requestId`（任务流）或 `streamId`（主题流）时，按该键作用域自增；已有 `seq` 不覆盖。
  - 单实例：进程内内存自增（O(1)）；
  - 多实例：若 Redis 适配器具备 KV 能力（见下），将自动继承以 `INCR/EXPIRE` 实现“全局单调”；否则回退为内存自增并打印一次告警（不影响功能）。
  - 可选为 SSE 帧自动生成 `id`（传输层）：`seq.frameIdPolicy = 'timestamp' | ((data, nextSeq)=>string)`，便于 Last-Event-ID 补发对齐。

此外，`createIORedisAdapter` 已增强：在 Pub/Sub 之外新增独立 KV 连接（不与 SUBSCRIBE 复用），并在适配器上暴露可选 KV API：`incr/expire/pexpire` 与 `kv` 句柄。SSEKify 会在构造时“半自动继承”该能力用于 `seq` 的全局单调：

- 仅传一次 `redis: createIORedisAdapter(REDIS_URL)` 即可，同时获得“跨实例发布 + 全局单调 seq”。
- 若适配器缺少 KV，则自动回退为内存自增（每实例单调）并打印一次警告（代码：`seq_kv_unavailable_fallback_memory`）。

> 向后兼容：未带 `requestId/streamId` 的消息不注入 `seq`；已有 `seq/timestamp` 的消息保持原样；`sendTo*`/`publish*` 等 API 签名与行为不变。

---

### 快速示例：单实例与“一次性配置 Redis”

```js
const express = require('express')
const { SSEKify, createIORedisAdapter } = require('ssekify')

const app = express(); app.use(express.json())

// 单实例：开箱可用（自动 timestamp + 自动 seq〔作用域=requestId 或 streamId〕）
const sse = new SSEKify({ recentBufferSize: 20 })

// 多实例（推荐）：一次性配置 Redis（跨实例发布 + 自动继承 KV 实现 seq 全局单调）
// const sse = new SSEKify({
//   redis: createIORedisAdapter(process.env.REDIS_URL),
//   channel: 'ssekify:bus',
//   recentBufferSize: 50,
//   seq: { frameIdPolicy: 'timestamp' } // 可选：同时为帧生成 id，配合 Last-Event-ID 补发
// })

app.get('/sse', (req, res) => {
  const userId = String(req.query.userId || 'guest')
  sse.registerConnection(userId, res, { rooms: ['global'] })
})

// 任务型消息：仅需携带 requestId；库会自动补 timestamp 与 seq（已有 seq 不覆盖）
sse.sendToUser('u1', {
  traceId: '...',                 // 由业务侧生成/透传（可在 autoFields 中配置 ifMissing）
  requestId: 'req_123',           // 作用域键（推荐）
  phase: 'progress', type: 'trip.plan@v1',
  payload: { percent: 40, message: '拉取报价…' }
}, { event: 'notify' })

// 主题广播需要严格顺序时：提供 streamId
await sse.publish({
  streamId: 'price.reco:city:SHA',
  type: 'price.reco@v1',
  payload: { hotelId: 'h_123', recos: [] }
}, undefined, { event: 'broadcast' }) // 第二参 undefined ⇒ 跨实例广播
```

---

### API 新增与配置（节选）

- 构造参数新增（示例，JavaScript）：
```js
const sse = new SSEKify({
  // 自动字段（默认仅启用 timestamp）
  autoFields: {
    // 'iso' | 'epochMs' | false
    timestamp: 'iso',
    // 可选：当缺失时补齐（谨慎使用）
    // traceId:   { mode: 'ifMissing', getter: () => getTraceId(), fieldName: 'traceId' },
    // requestId: { mode: 'require' } // 缺失时抛错，或使用 { mode:'ifMissing', getter: () => crypto.randomUUID() }
  },

  // 自动 seq（默认启用、按需生效）
  enableSeq: true,
  seq: {
    // keyExtractor: d => d && (d.requestId || d.streamId), // 作用域键（默认如此）
    startAt: 0,                // 首帧 0，之后 +1
    // finalPredicate: d => d && (d.final === true || d.phase === 'done' || d.phase === 'error'),
    fieldName: 'seq',
    // 为帧自动生成 id（可选）：'timestamp' 或函数 (data, nextSeq) => string
    // frameIdPolicy: 'timestamp',
    // 半自动：若未显式提供，SSEKify 将尝试从顶层 redis 适配器继承 KV；失败回退内存并一次性告警
    // redis: kvClient,
    redisKeyPrefix: 'ssekify:seq:',
    redisTTLSeconds: 86400
  }
})
```

- Redis 适配器（`createIORedisAdapter`）增强：
  - 适配器内部维护 `pub/sub/kv` 三连接；在对象上可选暴露 `incr/expire/pexpire/kv`；
  - `SSEKify` 在构造时会尝试自动继承该 KV 作为 `seq` 的全局自增源。

- RedisLike 接口（可选 KV 能力，伪代码）：
```txt
publish(channel, message)
subscribe(channel)
on('message'|'error', cb)
close()? // 可选
// KV 能力可选：
incr(key)?
expire(key, seconds)?
pexpire(key, ms)?
kv?: { incr, expire, pexpire }
```

---

### 帧 id 策略（frameIdPolicy）

- 用途：SSE 帧 `id` 用于浏览器重连时的 `Last-Event-ID` 对齐（传输层）。与业务层 `seq` 互补。
- 默认策略：`'timestamp'`，但注意本库实现的是“复合 ID”，格式：`<epochMs>-<instanceId>-<seq>`，以降低高吞吐时同毫秒碰撞概率。
- 自定义函数策略：可根据业务需要自行生成可排序、低碰撞的 ID：
```js
const sse = new SSEKify({
  seq: {
    frameIdPolicy: (data, nextSeq) => `${Date.now()}-${process.pid}-${nextSeq}-${Math.random().toString(36).slice(2,6)}`
  }
})
```
- 高吞吐建议：
  - 若需要跨实例强顺序与稳定补发，推荐使用函数策略或内置 `'snowflake'`（未来版本提供），确保“时间戳 + 实例号 + 递增计数”的组合；
  - 同时开启 `recentBufferSize > 0`，浏览器断线后可通过 `Last-Event-ID` 精确补发；
  - 业务层仍使用 `requestId/streamId + seq` 保证流内有序与去重。

---

### 行为矩阵（单机/多实例 × KV）

- 无 `redis`：
  - `publish` 仅本实例；
  - `seq` 为内存自增（每实例独立单调）。
- 配置了 `redis`（且适配器具备 KV）：
  - `publish` 跨实例；
  - `seq` 使用 Redis `INCR/EXPIRE`，对同一键“全局单调”。
- 配置了 `redis`（但适配器不具备 KV）：
  - `publish` 跨实例；
  - `seq` 回退内存自增（打印一次警告，代码：`seq_kv_unavailable_fallback_memory`）。

---

### FAQ（选摘）

- 自动注入会影响旧项目吗？
  - 不会。未带 `requestId/streamId` 的消息不注入 `seq`；已有 `seq/timestamp` 不覆盖；API 与写出路径不变。
- 我需要严格的全局顺序吗？
  - 多实例并发对同一任务/主题发送时，建议使用带 KV 的 Redis 适配器（或显式提供 KV 客户端）以启用 `INCR` 全局单调；否则仅保证各实例内单调。
- 帧 `id` 与 `seq` 有何区别？
  - 帧 `id` 属于传输层（用于 Last-Event-ID 补发定位）；`seq` 属于业务层（按任务/主题自增序号，用于去重与按序）。
- `snowflake` 怎么用？
  - 目前建议使用函数策略：`frameIdPolicy: (data, nextSeq) => yourSnowflake()`；或直接使用 `'timestamp'`。
- 看到 `SEQ_KV_FALLBACK` 告警怎么办？
  - 语义：未能从 Redis 适配器继承 KV 能力（INCR/EXPIRE），`seq` 回退为内存自增（每实例单调）。该告警只会触发一次，错误对象将包含 `code='SEQ_KV_FALLBACK'`、`level='warn'`。
  - 排查：确认是否使用了 `createIORedisAdapter(REDIS_URL)` 或为 `seq.redis` 显式提供了 KV 客户端；检查网络与权限（Cluster/Sentinel/TLS/ACL）。
  - 影响：功能不受影响；仅在多实例并发对同一键发送时，无法保证“全局单调”。需要强保证时，请启用带 KV 的适配器或将同一键粘滞到同一实例赋号。
