# Changelog

所有显著变更将记录在此文件，遵循 Keep a Changelog 与 SemVer。

## [Unreleased]
- Added:
    - 自动注入 `timestamp`（发送前若缺失，自动补 ISO 8601 UTC）。
    - 自动注入 `seq`（默认开启、按需生效；当 `data.requestId` 或 `data.streamId` 存在时按该键作用域自增；已有 `seq` 不覆盖）。
    - `createIORedisAdapter` 增强：新增独立 KV 连接并暴露 `incr/expire/pexpire/kv`；`SSEKify` 构造时可半自动继承该 KV，用于 `seq` 的全局单调（`INCR/EXPIRE`）。
- Changed:
    - `SSEKify` 构造参数新增 `autoFields/enableSeq/seq.*`，并支持将 `redis` 直接写为 URL（内部懒加载适配器）。
- Notes:
    - 未配置 KV 时，`seq` 为内存自增（每实例单调）；配置 KV 后，对同一键 `seq` 全局单调。

