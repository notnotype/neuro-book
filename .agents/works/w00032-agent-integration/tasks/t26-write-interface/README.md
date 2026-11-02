---
schema: nbook.task/v2
taskId: t26-write-interface
status: planned
updated: 2026-11-02
---

# 写入接口：读、暂存与提交、文件操作、操作分组与记账槽（文件访问第 1 阶段）

## 目标与范围

按提案 [文件访问与改动记账](../../../../../docs/proposals/file-access-and-history.md) 第 1 阶段与 [ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)，在 nbook.files 里实现写入接口，并把 Agent 的资源视图改成它的会话绑定版，作为 [t12](../t12-builtin-tools/README.md) 基础工具的底座。从 t12 拆出（2026-11-02）：写入接口属于 nbook.files，自成一段可验收的行为。

合同：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 标 `(planned)` 的写入接口各条与验收 11–15；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 10 与验收 6。

## 当前状态

计划第一稿 [plan.md](plan.md) 开发者已确认（2026-11-02，见计划末尾“开发者的决定”）：锁沿用现有规则；**在单独的分支上做，没有开发者允许不合并到 master**。正在做设计审查。

## 下一步

开发者确认计划后做设计审查（后端，omp），处理后在 w00032 的 worktree 按切片实施。
