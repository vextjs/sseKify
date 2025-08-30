### Changelog

本项目的所有对外可见变更都会记录在本文件中（遵循 Keep a Changelog 与 SemVer）。

#### [Unreleased]
##### Added
- 新增优雅关闭与运行时指标：SSEKit.stopAccepting()/shutdown() 与 sse.stats()，心跳会在可用时执行 res.flush()。
- 新增 per-connection 背压指标完善：flushQueue 成功写入计入 sent 计数。
- 新增 Payload 限制与自定义序列化：options.serializer、options.maxPayloadBytes；序列化异常与超限将通过 'error' 事件报告。
- 新增 重放缓冲治理：options.recentTTLMs、options.recentMaxUsers、sse.clearRecent(userId?)，按 TTL 与 LRU 自动清理。
- 初始房间修复：registerConnection(options.rooms) 会立即加入全局房间映射。
- 新增跨服务器推送完整示例（Express）：
  - Redis 回推方案：examples/express/cross-redis-a.js、examples/express/cross-redis-b.js（配套 examples/express/cross-redis.api.http）
  - HTTP 回调方案：examples/express/cross-callback-a.js、examples/express/cross-callback-b.js（配套 examples/express/cross-callback.api.http）
- package.json 增加对应运行脚本（dev:cross:redis:a/b、dev:cross:cb:a/b）
- README 与 STATUS 文档更新，增加“鉴权实战/运维指南/Payload 限制/重放缓冲治理”章节与示例指引

##### Changed
- 将 package.json engines.node 更新为 ">=16"，与 README 的原生 ESM 要求一致。

##### Fixed
- 修复启用 Redis 时发布者实例重复分发的问题：为消息添加 origin 并在订阅端去重，本地仍即时分发以降低延迟。
- 修复背压处理导致的重复帧：当 res.write 返回 false 时不再将当前 chunk 入队，仅等待 drain 后继续发送。

##### Deprecated
- （预留）

##### Removed
- 移除 NestJS 示例与相关脚本/文档引用（examples/nest、dev:nest）。

##### Performance
- （预留）

##### Security
- （预留）

#### [0.1.1] - 2025-08-31
##### Added
- ESM 构建：增加条件导出，支持原生 ESM 具名导入（lib/index.mjs）；CJS 仍保持 require 方式。
- 类型声明：新增并完善 index.d.ts，包含默认导出类型定义，改进 TS 开发体验。
- 背压能力：为每连接提供“写入队列 + drain”背压机制，支持队列条数/字节上限与丢弃策略（'oldest'|'newest'|'disconnect'）。
- Last-Event-ID 兼容：支持通过查询参数 ?lastEventId=... 传递，以适配部分代理/环境。
- 安全性：对 SSE 帧的 id/event 字段做换行清洗，避免非法帧注入。
- 示例扩充：
  - Express 示例完善（首页、关闭连接、房间/跨实例发布）。
  - 新增官方示例：Koa、Fastify、Hapi、Egg（含首页/路由/配置）、Nest。
  - Redis 集群与高可用示例：examples/express/redis-cluster.js、examples/express/redis-sentinel.js。
  - 每个框架目录新增 api.http 便于联调。
  - 部署样例：examples/deploy/Dockerfile 与 k8s-ssekit-express.yaml。
- 文档：README 全面重构，增加模块系统说明、背压章节、常见问题；STATUS 路线图更新。

##### Changed
- package.json 导出与 scripts 更新：
  - exports 增加 import 条目指向 lib/index.mjs；files 清理 dist。
  - 新增 dev:koa/dev:fastify/dev:hapi/dev:egg 脚本。
- 统一示例与文档说明，避免在 registerConnection 前调用 res.flushHeaders() 的错误指引。

##### Fixed
- 修正 Express 示例在建立 SSE 后误用 res.json 结束连接的问题（示例与文档同步纠正）。

##### Security
- 通过清洗 SSE 帧字段（id/event）中的换行，降低注入非法帧的风险。

#### [0.1.0] - 2025-08-01
##### Added
- 首个公开版本：
  - 框架无关 SSE 核心：连接管理、心跳、断线清理。
  - 单用户推送、全员广播、房间分发（同实例）。
  - 轻量重放（Last-Event-ID + per-user recent buffer）。
  - Redis Pub/Sub 适配（跨实例 publish/publishToRoom），REDIS_URL 即可启用。
  - 示例：Express、Egg；测试：Vitest 基础用例。

[Unreleased]: https://github.com/<your-org>/ssekit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/<your-org>/ssekit/releases/tag/v0.1.1
[0.1.0]: https://github.com/<your-org>/ssekit/releases/tag/v0.1.0