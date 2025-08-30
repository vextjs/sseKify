### STATUS / ROADMAP

说明：本页集中呈现 ssekit 的当前能力矩阵与路线图。状态：✅ 已实现 / 🗺️ 计划中 / ❌ 未实现。

#### 能力矩阵
- 连接管理：
    - ✅ SSE 长连接 + 心跳（KeepAlive）
    - ✅ 断线清理（close/error）
    - ✅ 浏览器重连建议（retry 行）
    - ✅ 轻量重放（Last-Event-ID + per-user recent buffer）
- 消息分发：
    - ✅ 单用户推送 sendToUser
    - ✅ 全员广播 sendToAll
    - ✅ 房间分发 sendToRoom（同实例）/ publishToRoom（跨实例）
- 集群：
    - ✅ Redis Pub/Sub（ioredis 适配）
- 框架无关：
    - ✅ 原生 ServerResponse 接入
    - ✅ 示例：Express、Egg
- 性能与背压：
    - ✅ 基础写入（res.write）
    - 🗺️ per-connection 队列 + drain 背压
- 安全：
    - ✅ 鉴权放在业务层（文档指引）
    - 🗺️ 多租户隔离示例

#### 路线图
- 🗺️ ESM 构建与类型声明（d.ts）
- 🗺️ 背压/限流增强
- 🗺️ Redis Cluster / Sentinel 连接示例
- 🗺️ Koa/Fastify/Nest 官方 demo 与 Docker/K8s 部署样例