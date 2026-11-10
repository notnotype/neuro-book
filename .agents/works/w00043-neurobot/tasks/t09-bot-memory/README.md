---
schema: nbook.task/v2
taskId: t09-bot-memory
status: planned
updated: 2026-11-10
---

# bot 的记忆

## 目标与范围

每个 bot 的记忆目录（写锁、改动记录）、核心记忆的快照与长度上限、压缩后把摘要追加进按天的日记、关键词检索工具；web 的记忆页与“让她改这一段”。

合同：`docs/specs/bot/memory.md` 的记忆部分（还不存在）：记忆目录、写锁与改动记录、核心记忆的快照与上限、日记、检索。核心记忆的快照经内核的开场（`opening`），按 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 压缩后重读开场的规则。

依赖：t06、t08（压缩成功后追加日记）。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等 t06、t08。
