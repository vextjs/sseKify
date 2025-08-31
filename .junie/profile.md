# 项目 Profile：sseKify（Junie 专用）

本节仅适用于路径 D:\Project\sseKify\... 的改动。用于指导自动化执行（测试/校验）与贡献者快速定位。使用说明、API 与示例以 sseKify/README.md 为准。

## 项目概览
- 目标：框架无关的 Server‑Sent Events（SSE）工具，支持单实例与通过 Redis Pub/Sub 的跨实例分发；具备心跳保活、Last-Event-ID 重放缓冲、每连接写入队列与背压治理、按用户/全体/房间分发、优雅关闭与基础指标。
- 模块系统：同时支持 CommonJS 与原生 ESM；内置 TypeScript 类型（index.d.ts）。
- 可选适配器：ioredis 适配器（lib/redisAdapter.js），用于跨实例发布/订阅。
- Node 版本范围（以包为准）：>=16（package.json engines）。建议在本地与 CI 优先覆盖 LTS（18.x/20.x），必要时加测 16.x。

## 关键目录（根：D:\Project\sseKify）
- lib\                      发行入口与实现（入口：lib\index.js；Redis 适配器：lib\redisAdapter.js）
- examples\                 各框架最小可运行示例（Express/Koa/Fastify/Hapi/Egg、多租户、跨实例、部署样例）
- tests\                    测试（Vitest；轻量 smoke：tests\smoke.test.ts）
- index.d.ts                公共类型声明入口
- README.md                 完整文档（中文，含 API 与示例）
- CHANGELOG.md              变更日志（Keep a Changelog）
- STATUS.md                 能力矩阵与路线图
- package.json              NPM 元数据与脚本（scripts、exports、engines）

## 如何运行测试
- Windows/PowerShell：
  - cd D:\Project\sseKify
  - npm test  （等价：npx vitest run）
- Linux（CI 参考）：
  - cd ./sseKify && npm test

说明：
- 当前测试为轻量 smoke，不依赖外部服务与 Redis；后续增加行为测试时，仍应避免真实外部依赖（可采用 stub/mocks）。
- 构建步骤：本包直接以 lib\ 发布，无需单独构建；如将来改为源码构建，请在 package.json 的 scripts 中新增并在此同步说明。

## 开发与运行（要点）
- ESM/CJS 导入：
  - CJS：const { SSEKify, createIORedisAdapter } = require('ssekify')
  - ESM：import { SSEKify, createIORedisAdapter } from 'ssekify'
- Redis 可选：
  - 推荐通过环境变量注入 URL（示例占位）：REDIS_URL=redis://user:pass@host:6379/0
  - 仅需跨实例时安装 ioredis 并启用适配器；在单实例/开发场景可不配置。
- 示例联调：
  - npm run dev:express / dev:koa / dev:fastify / dev:hapi / dev:egg
  - 多租户：npm run dev:multi
  - 跨实例：dev:cross:redis:* / dev:cross:cb:*
  - 每个示例目录提供 *.api.http 可一键发起请求

## 约定与编码风格（差异点）
- 类型与导出：index.d.ts 为唯一类型入口；exports 同时提供 import/require。
- 日志与去敏：错误/背压/超限仅记录形状与指标，不包含敏感信息（凭据/个人数据/完整连接串）。
- 背压治理：每连接 maxQueueItems / maxQueueBytes / dropPolicy（oldest|newest|disconnect），默认倾向稳健（oldest）。
- 注释：中文为主；必要英文术语用括号注明；行宽 ≤100。

## 与文档联动
- README：公共 API/默认值/示例变更时更新 sseKify/README.md（更新后快速过一遍示例可运行性）。
- CHANGELOG：每次对外可见变更在 sseKify/CHANGELOG.md 的 [Unreleased] 追加条目；发版时下沉并写日期。
- STATUS/ROADMAP：能力/里程碑更新同步 STATUS.md，并将“计划中→已实现”同步到 CHANGELOG 未发布区。

## Junie 如何校验改动
1) 按路径命中项目：D:\Project\sseKify\...
2) 在项目目录执行测试：npm test（Vitest，无外部依赖）
3) 如 npm scripts/目录结构/Node 版本范围（engines）变更，请同步本 Profile 并检查根级 CI 矩阵是否需要调整。
4) 如修改公开 API/默认值/示例，联动 README/CHANGELOG/STATUS。

## 兼容性与 CI 建议
- 运行时与 OS：
  - Node：至少覆盖 18.x、20.x（LTS）；本项目 engines 支持 >=16，如需兼容旧环境可在 CI 增加 16.x 轴。
  - OS：Windows-latest、Ubuntu-latest。
- Node 项目任务约定（参考根级指南）：
  - 安装：npm ci
  - 测试：npm test（Vitest）
  - （库）包体检查：npm pack（可选）
- 可选外部：Redis 不纳入默认 CI；跨实例逻辑以单元/契约测试 stub 方式覆盖。

## 安全与配置（占位/建议）
- 生产环境请通过环境变量注入凭据（不提交真实凭据）：
  - REDIS_URL=redis://user:pass@host:6379/0
- 代理与网关：对 /sse 路由禁用压缩与缓冲（如 X-Accel-Buffering: no）；keepAliveMs 小于上游空闲超时。

## 例外与覆盖
- Node 版本范围：本项目 engines 为 >=16。与根级默认 LTS（18/20）存在差异，建议：
  - 本地与默认 CI 以 18/20 为主；
  - 若明确需要兼容 Node 16，请在 CI 增加 16.x 轴并在 PR 中标注影响面。
- 外部依赖：ioredis 为可选依赖；跨实例相关测试建议使用 stub，避免对 CI 引入 Redis 依赖。
- 若需对根级通用规则作其他例外，请在此记录条目、理由、影响面与迁移建议，并在 PR 描述同步说明。
