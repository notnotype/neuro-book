# t48 返工要求（Leader 复核后）

依据：t48 实现报告（`walkthroughs/implementation.md`）与其自报的 `not_done` / `risks_deviations`。被审增量在 `8263726e` 之后的未提交工作树上。

| # | 级别 | 要求 | 依据 |
|---|---|---|---|
| R1 | P2 | **暂存失败时不得丢掉旧桶三字段**。当前在 `app/stores/novel-ide.ts` 模块求值即调用 `retireLegacyBucketWriterPolicy()` 并同步移除了 `novel.ide.local` 的 `storage`/`serializer`，于是迁移未完成（原件未暂存/未备份）时，其它字段的写回会整键重写该桶并抹掉 `leftPanelWidth`/`agentPanelWidth`/`projectPickerLayoutMode` —— 而这三个值此刻只存在于旧桶里，属于不可恢复的数据丢失。按迁移合同："浏览器原件暂存失败或超过上限：保留完整旧桶，暂不启动会重写它的 writer…只有无法先保留原件时才冻结整桶并明确提示并提供重试"；"全部目标处理完成后，从旧持久化 pick 移除三个字段，解除仅用于保留源值的 serializer"。请让退役与 serializer 解除**发生在原件已安全保留之后**（判据用迁移快照：原件已暂存且 data 备份已落盘或 `phase === "complete"`），而不是模块求值；三字段不再进 `pick` 是对的（状态已不持有它们），但保留侧必须由 serializer 继续从捕获原件补齐，直到解除条件满足。 | 迁移合同「启动顺序」第 2/5 步与「失败与回滚」；`app/utils/workbench/storage-migration-legacy-bucket.ts` 的 `retireLegacyBucketWriterPolicy()` 语义 |
| R2 | 必做项 | **完成真实浏览器验收**（Task 合同把该项列为必做）。用你已经验证过的隔离环境（系统 Temp 根 + `NUXT_PORT`/`PORT` 均显式设置的空闲端口，绝不触碰 3001），打开浏览器逐场景核对并留下证据：书架模式切换、Project A/B 各自尺寸、未开项目/用户资产、同项目双标签并发分别改左右栏、刷新两次只有一个 writer。每个场景给出「操作 → 观察 → 记录文件/HTTP 证据（记录路径与关键字段）」；核对方式优先直接读隔离根下的 `*.nbook/storage/**` 记录文件与浏览器 localStorage 键。若某场景无法执行，写明具体阻塞点与已尝试命令。 | t48 README「验证与交付」 |
| R3 | 必做项 | 修完两处类型错误后**复跑全包 `bun run typecheck`** 并记录退出码；同时复跑你的聚焦测试记录用例数（t47 返工已把 `novel-ide-legacy-writer.test.ts` 改写为 4 例，注意不要覆盖 t47 的返工改动）。 | Task 合同与 Leader 复跑口径 |

## 约束

- 不得回退 t47 返工（`MigrationGate` 已完成）：`shared/storage/workbench-migration.ts` 的分块核验与容量预检、`server/storage/product-definitions.ts` 的 `globalThis` 槽注册、`storage-migration*.ts` 与 `storage-migration.test.ts` 的 26/15 例，均为已闭合内容。
- 不改 `app/utils/workbench/storage-migration*.ts` 与 `shared/storage/workbench-migration.ts` 的内部实现；R1 只改 `app/stores/novel-ide.ts`、必要的启动接线与（如需）会话侧的退役调用点。
- 不提交、不 push、不访问 3001、不覆盖用户 dirty `descriptors{,.test}.ts`。
- 完成后追加实现记录小节，并 `hub send` 通知 `Main`。