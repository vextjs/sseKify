# Changelog

所有显著变更将记录在此文件，遵循 Keep a Changelog 与 SemVer。

## [Unreleased]
- Added:
    - 文档：新增“本地直推 vs 跨实例发布（如何选择）”对比与决策指南。
    - 文档：新增“与 vsse 协同（postAndListen）”小节，明确 eventName/requestId/phase 约定并给出示例。
    - 文档：在“代理/网关与部署”中补充“入口承接连接拓扑”指南与常见误区。
    - 自动注入 `timestamp`（发送前若缺失，自动补 ISO 8601 UTC）。
    - 自动注入 `seq`（默认开启、按需生效；当 `data.requestId` 或 `data.streamId` 存在时按该键作用域自增；已有 `seq` 不覆盖）。
    - `createIORedisAdapter` 增强：新增独立 KV 连接并暴露 `incr/expire/pexpire/kv`；`SSEKify` 构造时可半自动继承该 KV，用于 `seq` 的全局单调（`INCR/EXPIRE`）。
- Changed:
    - 文档：FAQ 增补“publish 收不到”和“sendToUser 无效”的排查项。
    - `SSEKify` 构造参数新增 `autoFields/enableSeq/seq.*`，并支持将 `redis` 直接写为 URL（内部懒加载适配器）。
- Notes:
    - 未配置 KV 时，`seq` 为内存自增（每实例单调）；配置 KV 后，对同一键 `seq` 全局单调。

