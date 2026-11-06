---
schema: nbook.task/v2
taskId: t26-write-interface
status: done
updated: 2026-11-03
---

# 写入接口：读、暂存与提交、文件操作、操作分组与记账槽（文件访问第 1 阶段）

## 目标与范围

按提案 [文件访问与改动记账](../../../../../docs/proposals/file-access-and-history.md) 第 1 阶段与 [ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)，在 nbook.files 里实现写入接口，并把 Agent 的资源视图改成它的会话绑定版，作为 [t12](../t12-builtin-tools/README.md) 基础工具的底座。从 t12 拆出（2026-11-02）：写入接口属于 nbook.files，自成一段可验收的行为。

合同：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 标 `(planned)` 的写入接口各条与验收 11–15；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 10 与验收 6。

## 当前状态

执行位置：`.worktree/w00032-t26-write-interface`，分支 `feat/w00032-t26-write-interface`（从 master）。开发者 2026-11-03 允许合并，已合入 master（合并提交见 `git log --merges`，合并前先把 master 并进分支、重跑类型检查与相关测试 257 个全过）。

计划第二稿（[plan.md](plan.md)）的五个切片都已实现、单独提交（`00c8b90de` 暂存提交与项目合同版本 7；`d10d9f977` 服务端与项目实例的写入接口；`0d2af6211` 记账槽；`e60e137ce` Agent 资源视图迁移、删掉 `serverFilesKey`；`c359db1c5`、`fae5e8e77` SDK 的 `/files`；`2ff532c19` 修一条 t08 漏改的 e2e 断言）。设计审查（omp，27 条）的处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。

收口验证见 [evidences/closing-verification.txt](evidences/closing-verification.txt)：类型检查通过；受影响测试全过（闭包断言已修）；全量 e2e 297 过，余下 `plugins.e2e.ts` 一条与治理检查的 `Drawer.md` 一条在分支起点上同样失败，是基线问题。未验证：`absent` 提交在身份核对与 `link` 之间被并发新建的窗口；Windows、macOS。

照推荐做、待开发者追认的五条记在 [待确认清单](../../pending-confirmations.md)（硬链接断开、结果不确定不按内容判定成功、跨盘拷入、文件操作的记账推迟到第 3 阶段、提交新建不改清单）。

实现审查（omp，6 条重要）已处理（[处理](evidences/impl-review-disposition.md)），修正在 `28ccc1dca`：写暂存期间持项目租约、跨盘新建在目标盘不支持硬链接时排他拷入、读路径的 Windows 段名校验、浏览器合同的 `write` 带分组、记账者撤回与迟到失败的测试。修正后类型检查通过，files、backend、agent、sdk 测试 222 个全过。

## 下一步

- 两份 Spec 里标 `(planned)` 的写入接口各条等开发者批准后晋升为 `implemented`（补实现合同与证据）。
- t12 按新的读写分工改计划后审查、实施。
