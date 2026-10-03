# ADR 0005：Application State 迁移由 Product 定义、Manager 编排

- 状态：Accepted
- 日期：2026-07-28
- 关联任务：[Task 105](../../../../.agents/tasks/105-unified-installation-manager/README.md)、[Task 118](../../.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)

## 背景

NeuroBook 的有状态升级不只包含 App SQLite。Agent Attachment 与 Session JSONL 都有独立 schema、backup、checksum、恢复和运行时 fail-closed 要求。若 Manager 分别理解 Prisma、Attachment 和 Session 格式，每新增一种 Product 状态就必须修改安装器的领域逻辑；若 Product 在 Nitro 启动时自动改写数据，则健康检查失败时 Manager 无法完整恢复旧 Product 可读的状态。

历史 Attachment 专用 Operation Journal 已证明迁移必须进入安装/更新事务，但它不是可继续复制的长期扩展点。

## 决策

Application State 迁移采用两层所有权：

- **Product** 拥有有序 catalog、step 格式、只读规划、apply/resume/rollback、step backup/checkpoint、checksum、exclusive lease 和 runtime sentinel。Manager 不解析 Session JSONL 或具体迁移目录。
- **Manager** 拥有 install lock、Operation Journal、候选 Product 选择、App SQLite 外层冷备份、启动顺序、健康检查和整个安装/更新事务的反序恢复。

当前 catalog version 3 固定按以下顺序执行：

1. `app-sqlite`
2. `agent-attachment-v1`
3. `agent-session-v2`
4. `agent-session-v2-review-repair`

Product runner 的公开入口是 `migrate:application-state`，支持 `--plan`、`--apply`、`--resume` 和 `--rollback`，stdout 只输出严格 JSON 报告。一个 Application run 使用确定性 `runId`，各 step 的 runId 由它派生；重复启动在 complete sentinel 下无副作用。Fresh State Root 也通过同一 runner 建立最新 sentinel，不存在第二套初始化路径。

Manager 的 install、update 和 start 在候选 Product 启动前调用 runner。Product runner 失败后按 `agent-session-v2-review-repair → agent-session-v2 → agent-attachment-v1 → app-sqlite` 回滚内部步骤；Manager 再按 Operation Journal 恢复数据库外层快照、Product、Source、Compose 和 wrapper。两层备份不是重复：step backup 恢复一次 migration，Manager snapshot 恢复完整安装/更新事务。

候选 Product 的只读 plan 必须发生在停服务、备份、组件切换和数据修改之前。apply 后只有候选进程或容器通过目标版本与健康检查，Manager 才能提交 Operation；ready 前失败要先终止本次候选，再反序回滚。历史 catalog、原始 sentinel 恢复和健康提交点由 [ADR 0008](0008-application-state-catalog-evolution.md) 进一步约束。

非 Manager 直接启动只运行只读兼容性检查。缺失、损坏、非 complete 或旧 catalog sentinel 一律 fail closed，并提示先运行：

```bash
bun run migrate:application-state -- --apply
```

旧 Session decoder 只能存在于 migration 目录；Nitro runtime 只接受 schema v2。

每个 Release Manifest v5 必须声明：

```ts
stateMigration: {
    policy: "none" | "automatic" | "manual";
    steps: string[];
    guide?: string;
}
```

Release 构建拒绝缺失声明。`automatic` 的 step 必须存在于 Product catalog；`manual` 必须提供 `packages/neuro-book/docs/migrations/` 下的说明，并在 Manager 修改数据或切换 Product 前停止。实际执行依据数据 sentinel，不依据应用版本号，因此可以跨多个版本直接升级。

runner 报告保留 `manual_required + guide` 协议，供未来 step 的只读 preflight 发现“无法安全自动转换、也不能降级为可读 review 状态”的数据时使用。当前 catalog 没有这种已知形状：Session 的歧义会确定性写成 `migrationReview`，该 Session 可读、不可执行且可重绑；它不会阻断其他数据升级，也不等于 release-level `manual_required`。损坏、冲突或 checksum 不一致直接失败，不伪装成人工迁移计划。

## 原因

Product 最了解每种状态格式以及如何验证逐字节恢复，Manager 最了解跨组件事务与健康检查。以稳定 JSON runner 作为两者的窄接口，可以新增 catalog step 而不把数据格式复制进 Manager，也能在 Product 尚未启动时完成迁移。

sentinel 比应用版本号更接近执行真相。版本号不能表达跨版本直升、中断恢复、同版本重试或用户复制旧 State Root 的情况。

## 后果

- 新增或修改持久状态 schema 时，必须同时新增 catalog step 或明确复用现有 step，并更新 Release 声明和迁移文档。
- Manager-managed Source、原生 Product、Container 和 Windows Portable 共用同一 runner 协议。容器通过一次性候选 Product 执行。
- Operation Journal v3/v4 只在 Manager 读取边界转换为 v5；新写入只使用 `applicationStateMigration`，并允许真实 `action: "start"`。
- runtime 不承担数据修复；迁移未完成时应用不会启动。
- `reviewItems` 是迁移后的 Session 级恢复工作量，不是整次升级失败。

## 未采用方案

- Manager 内置每种数据格式：会让安装器与 Product schema 双向耦合。
- Nitro 启动时自动迁移：无法在旧 Product、数据和健康检查之间做完整事务回滚。
- 只按应用版本执行脚本：不能正确处理跨版本升级、复制旧数据或已完成的幂等启动。
- 把任何 `migrationReview` 都升级为人工阻断：少量可读、可重绑 Session 会阻止整个实例升级，且没有必要。
