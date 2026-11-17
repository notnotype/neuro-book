---
schema: nbook.task/v2
taskId: t02-sticker-system
status: planned
updated: 2026-11-17
---

# 表情包系统（Discord 式标签符、Provider 提示词 Slot 与 stickers:// 虚拟目录）

## 目标与范围

为 NeuroBook 的 Agent 对话引入表情包表达能力（开发者 2026-11-17 提出设计方向，具体实现细节待开工时细化）：

1. **Discord 式标签符语法**：在消息文本中采用类似 Discord 的表情包标签符（例如 `:sticker_name:` 或带命名空间/ID 的行内标签）。
2. **表情包提供者（Provider）与提示词 Slot**：支持由表情包提供者（Provider）贡献表情包资源，并向 Profile 模板提供对应的表情包提示词 Slot（声明常用表情包与使用语境）。
3. **`stickers://` 虚拟目录**：完整的表情包目录（Catalog）挂载在 `stickers://` 虚拟目录方案下，供 Agent 按需浏览检索与前端渲染解析。

合同：尚未开工；开工时结合 [`docs/specs/agent/resources.md`](../../../../docs/specs/agent/resources.md) 与 [`docs/specs/harness/profile.md`](../../../../docs/specs/harness/profile.md) 制定具体规范。

## 当前状态

2026-11-17 经 `nbdev` 登记立项（`planned`），记录初步设计设想，待 `t01` 角色扮演提示词与记忆体系稳定后细化方案。

## 下一步

- 开工时细化 Discord 式标签符的具体语法、Provider 注册接口、提示词 Slot 形态以及 `stickers://` 虚拟目录的读写/渲染合同。
