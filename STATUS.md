### STATUS / ROADMAP

说明：本页集中呈现 ssekit 的当前能力矩阵与路线图。状态：✅ 已实现 / 🗺️ 计划中 / ❌ 未实现。

更新（本次）：新增优雅关闭 shutdown()/stopAccepting() 与运行时 stats() 指标；心跳支持 flush。

#### 能力矩阵
- 连接管理：
    - ✅ SSE 长连接 + 心跳（KeepAlive）
    - ✅ 断线清理（close/error）
    - ✅ 浏览器重连建议（retry 行）
    - ✅ 轻量重放（Last-Event-ID + per-user recent buffer + TTL/LRU 治理 + clearRecent API）
- 消息分发：
    - ✅ 单用户推送 sendToUser
    - ✅ 全员广播 sendToAll
    - ✅ 房间分发 sendToRoom（同实例）/ publishToRoom（跨实例）
- 集群：
    - ✅ Redis Pub/Sub（ioredis 适配）
        - ✅ 跨服务器推送示例：Redis 回推（examples/express/cross-redis-a.js、cross-redis-b.js）/ HTTP 回调（examples/express/cross-callback-a.js、cross-callback-b.js）
- 框架无关：
    - ✅ 原生 ServerResponse 接入
    - ✅ 示例：Express、Egg
- 性能与背压：
    - ✅ 基础写入（res.write）
    - ✅ per-connection 队列 + drain 背压（含指标计数 sent/丢弃/断开）
- 安全：
    - ✅ 鉴权放在业务层（文档指引）
    - ✅ 多租户隔离示例（examples/express/multitenant.js）

#### 路线图
- ✅ ESM 构建
- ✅ 类型声明（d.ts）
- ✅ 背压/限流增强（已实现：per-connection 队列 + drain、队列条数/字节上限、丢弃策略 'oldest'|'newest'|'disconnect'）
- ✅ Redis Cluster / Sentinel 连接示例（examples/express/redis-cluster.js、examples/express/redis-sentinel.js）
- ✅ Koa/Fastify/Egg/Hapi 官方 demo 与 Docker/K8s 部署样例（见 examples/* 与 examples/deploy/*）