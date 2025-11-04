# Changelog

所有显著变更将记录在此文件，遵循 Keep a Changelog 与 SemVer。

## [Unreleased]
- Added:
    - 文档：新增“本地直推 vs 跨实例发布（如何选择）”对比与决策指南。
    - 文档：新增“与 vsse 协同（postAndListen）”小节，明确 eventName/requestId/phase 约定并给出示例。
    - 文档：在“代理/网关与部署”中补充“入口承接连接拓扑”指南与常见误区。
    - **用户连接数统计功能：`getUserConnectionCount()`、`getUserConnectionIds()`、`getAllUsersConnectionStats()`、`isUserOnline()` 方法**
    - 自动注入 `timestamp`（发送前若缺失，自动补 ISO 8601 UTC）。
    - 自动注入 `seq`（默认开启、按需生效；当 `data.requestId` 或 `data.streamId` 存在时按该键作用域自增；已有 `seq` 不覆盖）。
    - `createIORedisAdapter` 增强：新增独立 KV 连接并暴露 `incr/expire/pexpire/kv`；`SSEKify` 构造时可半自动继承该 KV，用于 `seq` 的全局单调（`INCR/EXPIRE`）。
- Changed:
    - 文档：FAQ 增补“publish 收不到”和“sendToUser 无效”的排查项。
    - `SSEKify` 构造参数新增 `autoFields/enableSeq/seq.*`，并支持将 `redis` 直接写为 URL（内部懒加载适配器）。
- Documentation:
    - **vsse 集成说明**：在 README.md 开头添加 vsse 的关联说明，明确它是推荐的前端配套客户端
    - **详细协同指南扩展**：大幅扩展"与 vsse 协同（postAndListen）"章节，包含：
      - 架构模式说明（前后端职责划分）
      - 5个关键协同要点（事件名、requestId、生命周期、心跳配置、跨实例部署）
      - 完整的 AI 对话场景示例代码（前后端完整实现）
      - 业务服务与入口服务分离的架构模式
      - 重要注意事项（publish vs sendToUser、requestId 必填、phase 的重要性）
      - 参考资源链接
- Notes:
    - 未配置 KV 时，`seq` 为内存自增（每实例单调）；配置 KV 后，对同一键 `seq` 全局单调。
