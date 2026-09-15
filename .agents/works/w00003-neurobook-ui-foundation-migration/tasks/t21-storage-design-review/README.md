---
schema: nbook.task/v2
taskId: t21-storage-design-review
role: leader
---

# Storage 设计审查与规范沉淀

## 目标与授权

2026-09-15，开发者要求先审查 Storage 设计是否适合 NeuroBook 当前需求及后续扩展，审查成功后落 Spec。
本 Task 承接 [Storage 讨论稿](../../research/2026-09-15-storage-concepts-and-sync.md) 与
[ADR 0020](../../../../../packages/neuro-book/docs/adr/0020-user-project-storage-boundaries.md)。
范围是 Config / Storage / 内存 / 领域数据边界、user/project 归属、插件消费、grid 复用与同步边界。
2026-09-16 开发者要求继续审查计划，随后回复“可以，优化补充”；本轮补齐行为 Spec、迁移合同与实现切片，纳入最小嵌套验证及必要修复计划。
本 Task 不实现 Storage service、同步、数据迁移或命令系统。
开发者随后明确授权：文档治理完成后先单独本地提交，再进入 goal 模式创建下一 tasker Task 开始实现；不写入远端。

## 执行与产物

- 工作区沿用 `.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`。
- 先读取现有消费者及合同，优先经 omp 进行只读独立审查；主 Agent 从源码与文档复核其结论。
- 可独立成立且审查通过的设计写入 `planned` Spec，链接批准依据并更新注册表；未闭合的同步产品取舍保留在提案或报告。
- walkthrough 记录审查发现、处理结果、实际验证和未验证边界；Reviewer 意见不能替代开发者的产品决定。

## 验证

运行 `bun run docs:check`、范围内 `git diff --check`；人工检查术语、跨文档语义、本地链接、批准范围与可验收性。
本次仅修改文档，不把既有 typecheck 或代码测试冒充新增 Storage 实现证据。

## 结果

架构审查通过，已落 [storage.boundaries](../../../../../docs/specs/storage/boundaries.md)（planned）。
三轮 omp 审查、修订及验证见 [审查记录](walkthroughs/001-storage-review.md)。
2026-09-16 本地服务读写、身份映射、恢复与迁移已收敛为 [storage.persistence](../../../../../docs/specs/storage/persistence.md)，
最小嵌套布局为 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)，两者均 planned。
[实施计划](../../storage-implementation-plan.md) 与 [本轮审查记录](walkthroughs/002-plan-completion.md) 承接补充结果。
跨独立 data 在线同步继续保留 draft；本 Task 完成不代表运行时实现或全部主页面视图已就绪。
