---
schema: nbook.task/v2
taskId: t26-write-interface
status: active
updated: 2026-11-02
---

# 写入接口：读、暂存与提交、文件操作、操作分组与记账槽（文件访问第 1 阶段）

## 目标与范围

按提案 [文件访问与改动记账](../../../../../docs/proposals/file-access-and-history.md) 第 1 阶段与 [ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)，在 nbook.files 里实现写入接口，并把 Agent 的资源视图改成它的会话绑定版，作为 [t12](../t12-builtin-tools/README.md) 基础工具的底座。从 t12 拆出（2026-11-02）：写入接口属于 nbook.files，自成一段可验收的行为。

合同：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 标 `(planned)` 的写入接口各条与验收 11–15；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 10 与验收 6。

## 当前状态

执行位置：`.worktree/w00032-t26-write-interface`，分支 `feat/w00032-t26-write-interface`（从 master）。**没有开发者允许不合并到 master。**

计划第二稿（[plan.md](plan.md)）的五个切片都已实现、单独提交（`00c8b90de` 暂存提交与项目合同版本 7；`d10d9f977` 服务端与项目实例的写入接口；`0d2af6211` 记账槽；`e60e137ce` Agent 资源视图迁移、删掉 `serverFilesKey`；`c359db1c5`、`fae5e8e77` SDK 的 `/files`；`2ff532c19` 修一条 t08 漏改的 e2e 断言）。设计审查（omp，27 条）的处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。

收口验证见 [evidences/closing-verification.txt](evidences/closing-verification.txt)：类型检查通过；受影响测试全过（闭包断言已修）；全量 e2e 297 过，余下 `plugins.e2e.ts` 一条与治理检查的 `Drawer.md` 一条在分支起点上同样失败，是基线问题。未验证：`absent` 提交在身份核对与 `link` 之间被并发新建的窗口；Windows、macOS。

照推荐做、待开发者追认的五条记在 [待确认清单](../../pending-confirmations.md)（硬链接断开、结果不确定不按内容判定成功、跨盘拷入、文件操作的记账推迟到第 3 阶段、提交新建不改清单）。

实现审查（omp）已启动，待处理。

## 下一步

处理实现审查，修正单独提交；之后请开发者决定是否合并到 master。合并后 t12 按新的读写分工改计划（读与写都经写入接口，`artifacts/` 用 `stage` 流式写）。
