### Changelog

本项目的所有对外可见变更都会记录在本文件中（遵循 Keep a Changelog 与 SemVer）。

#### [Unreleased]
##### Added
- 框架无关 SSE 核心：连接管理、心跳、断线清理
- 单用户推送、全员广播、房间分发（同实例）
- 轻量重放（Last-Event-ID + per-user recent buffer）
- Redis Pub/Sub 适配（跨实例 publish/publishToRoom），REDIS_URL 即可启用
- 示例：Express、Egg；测试：Vitest 基础用例

##### Changed
- （预留）

##### Fixed
- （预留）

##### Deprecated
- （预留）

##### Removed
- （预留）

##### Performance
- （预留）

##### Security
- （预留）

#### [0.1.0] - 2025-08-xx
##### Added
- 首个公开版本（同上）

[Unreleased]: https://github.com/<your-org>/ssekit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<your-org>/ssekit/releases/tag/v0.1.0