---
schema: nbook.task/v2
taskId: t07-sticker-format-simplify
status: active
updated: 2026-11-18
---

# 表情包格式简化：可选描述代替 when，名字与清单可省

## 目标与范围

清单里 when 改为可选的自由描述 description；表情不写 name 时取文件名；没有 stickers.json 的图片文件夹也算一个表情包；提示词槽按有无描述写行。来源：开发者 2026-11-18 对 t02 的意见第 4 条。

合同：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 的“输入与前置条件”、输出 2、4、14、18、验收 8（标 planned）。计划：[`plan.md`](plan.md)。

## 决定

开发者 2026-11-18 在会话里确认：

1. `when` 改成可选的说明 `description`，`name` 可以不写（取文件名）；清单可省（“可以”，同意 t07、t08、t09 的拆法与先做本 Task）。
2. 没有表情列表（没有清单或清单没写 `stickers`）时，图片都算常用。
3. 文件名当不了表情名时，这张图隔离并写诊断。
4. 清单写了 `stickers` 时只认列出的项，不补没列的图。

## 当前状态

2026-11-18 Spec 已改（条目标 planned），计划已写，等开发者看计划要点后实施。

## 下一步

- 开发者确认后在 worktree 里按计划一片实现，跑 stickers 与槽的测试、类型检查和 `stickers.e2e.ts`。
- 实现审查：改动小、不碰并发与公开接口以外的东西，按“按任务大小降级”派一个 Sonnet。
