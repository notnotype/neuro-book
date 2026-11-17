---
schema: nbook.task/v2
taskId: t02-sticker-system
status: active
updated: 2026-11-17
---

# 表情包系统（Discord 式标签符、Provider 提示词 Slot 与 stickers:// 虚拟目录）

## 目标与范围

为 NeuroBook 的 Agent 对话引入表情包表达能力（开发者 2026-11-17 提出设计方向，具体实现细节待开工时细化）：

1. **Discord 式标签符语法**：在消息文本中采用类似 Discord 的表情包标签符（例如 `:sticker_name:` 或带命名空间/ID 的行内标签）。
2. **表情包提供者（Provider）与提示词 Slot**：支持由表情包提供者（Provider）贡献表情包资源，并向 Profile 模板提供对应的表情包提示词 Slot（声明常用表情包与使用语境）。
3. **`stickers://` 虚拟目录**：完整的表情包目录（Catalog）挂载在 `stickers://` 虚拟目录方案下，供 Agent 按需浏览检索与前端渲染解析。

合同：[`docs/specs/agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（planned）；另改 `agent/contributions.md`、`agent/profile-settings.md`（见计划）。计划：[`plan.md`](plan.md)。

## 决定

开发者 2026-11-17 在对话里确认：

1. 写法 `:名字:`，名字可用中文，重名时 `:包/名字:`；认不出照原文显示。
2. 两种大小：夹在文字里约两倍字高，一段只有表情时显示成大图。
3. 在 Agent 回复里显示成图，用户消息不变。
4. 表情包是带清单的文件夹，照 Skill 的白名单选包（插件 Profile 在声明里写，用户 Profile 在 Profile 设置里加减）；插件可以提供表情包；星璃的包先放 `user://stickers/lyra/`。
5. 第一版不做用户发表情。
6. 先用占位图做通链路，星璃的图另起。
7. 表情写法做成 Markdown 方言，编辑器也能用。
8. 计划末尾“待确认”的默认值（大图约 120 像素、槽至多 60 个、清单上限、不设内置来源、编辑器里未知名字也变节点）照计划。
9. 后端设计审查：先开了 omp，开发者发现 omp 的缺省模型配错（gpt-6-luna），要求停掉、这次改派 Opus。

## 当前状态

2026-11-17（`active`）：Spec 草稿与计划写好，开发者已确认；设计审查进行中（前端 Sonnet，后端 Opus）。

## 下一步

- 处理设计审查，修订计划后按切片实施，先做切片 1（方言探路）。
