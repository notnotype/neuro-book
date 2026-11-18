---
schema: nbook.task/v2
taskId: t07-sticker-format-simplify
status: done
updated: 2026-11-18
---

# 表情包格式简化：可选描述代替 when，名字与清单可省

## 目标与范围

清单里 when 改为可选的自由描述 description；表情不写 name 时取文件名；没有 stickers.json 的图片文件夹也算一个表情包；提示词槽按有无描述写行。来源：开发者 2026-11-18 对 t02 的意见第 4 条。

合同：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 的“输入与前置条件”、输出 2、4、14、18、验收 8。计划：[`plan.md`](plan.md)。

## 决定

开发者 2026-11-18 在会话里确认：

1. `when` 改成可选的说明 `description`，`name` 可以不写（取文件名）；清单可省（“可以”，同意 t07、t08、t09 的拆法与先做本 Task）。
2. 没有表情列表（没有清单或清单没写 `stickers`）时，图片都算常用。
3. 文件名当不了表情名时，这张图隔离并写诊断。
4. 清单写了 `stickers` 时只认列出的项，不补没列的图。

## 当前状态

2026-11-18 完成，快进合入 master（1d0c1936e、80943e1a4），worktree 与分支已删。Spec 的 planned 标记已去掉。

- 实现：`stickers/shared/manifest.ts`（`parseManifest` 在没写列表时交回 null，新增 `stickersFromFiles`）、`backend/catalog.ts`（没有清单当作 `{}`，没有列表时列文件夹；清单或文件夹读不了时表情包无效，新问题码 `folder-unreadable`）、提示词槽与 `stickers://` 的说明。
- 实现审查：一个 Sonnet，阻断 0、重要 1、建议 6；改了 5 条，不改 2 条（[`impl-review.txt`](evidences/impl-review.txt)、[`impl-review-disposition.txt`](evidences/impl-review-disposition.txt)）。审查之后 Spec 输出 2 补了“文件夹读不了”。
- 验证：stickers 与槽的 bun 测试 24 条、`bun run typecheck`、build 与 build:e2e 后 `stickers.e2e.ts` 4 条（含验收 8）都通过；变异检查覆盖排序、截断、NFC 重名、链接、读不了的两种文件夹、`stickers` 写错。

## 下一步

- t08 表情包设置页按这个格式写清单与导入导出。
