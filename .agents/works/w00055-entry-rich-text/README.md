---
schema: nbook.work/v1
workId: w00055-entry-rich-text
issueId: null
status: active
updated: 2026-11-26
---

# 条目主文字的富文本编辑器

## 目标

条目的主文字改用标签写法，内核与编辑器共用一个解析器（marked），作者用富文本编辑器写条目。先出演示稿与 spike 给开发者体验，需求对齐、稳定以后再实施（开发者 2026-11-26：“不用那么急着快速做。多做点演示稿，spike 让我体验后，等需求对齐了稳定了你再开始实施”）。

从 [w00039](../w00039-novel-writing-plugins/README.md) 分出来。那边的 [t38](../w00039-novel-writing-plugins/tasks/t38-kernel-shared-parser/README.md)（内核改用与章节相同的解析器）搁置的条件是“用过整篇编辑器与人物设定组”，现在已经满足（t39、t40、t41、t42 都已合入）。t38 列的难点、t39 的设计审查与 11-24 的讨论都是本 Work 的起点：

- [t38 的来由与已知的难点](../w00039-novel-writing-plugins/tasks/t38-kernel-shared-parser/README.md#来由与已知的难点)：定位、写入合同、保密关卡、带值回写、读法变化的清单。
- [t39 的设计审查](../w00039-novel-writing-plugins/tasks/t39-entry-text-editor/README.md)：富文本建在章节的解析器上、内核却用另一套解析器把关，要补的东西是原计划的两到三倍。
- [条目主文字的方向（2026-11-24 的讨论）](../w00039-novel-writing-plugins/research/2026-11-24-entry-text-direction.md)：去掉 `{}` 改用标签、标签登记表、沙箱块等提议与主会话的看法。
- t28 的 spike（分支 `spike/w00039-t28-entry-editor`）：富文本编辑条目的一次性演示，只作 Tiptap 接法的参考。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-11-23 | （w00039）解析器只留一个：扩展章节编辑器现有的解析器（marked），内核也改用它 |
| 2026-11-26 | 开发者：取值与条件**换成标签**（例如 `<V of="panel.魔力" />`），不再用 `{}`。代价开发者知悉：内核先换、编辑器跟在后面；渲染、白名单、带值回写、样本与 Agent 工具说明返工；另写 ADR 取代 [ADR 0038](../../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md) 的决策 1 与 3；已有的 `{}` 要迁移 |
| 2026-11-26 | 开发者：**富文本为主，保留源文字**。点“编辑”默认进富文本，可以切到源文字（t39、t40 的 Monaco 加高亮）；分屏预览去掉 |
| 2026-11-26 | 开发者：新开本 Work，不急着做；先多出演示稿与 spike 给开发者体验，需求对齐、稳定以后再写实施计划 |

## 范围

- 标签写法：取值、条件、条目引用、图片各用什么标签，属性怎么写，给 Agent 的带值写法。
- 解析器：内核换成 marked、共用的文法放在哪里，读法变化的清单。
- 富文本编辑器：标签在编辑器里的样子与改法，插入入口，与源文字的切换，提交与暂存沿用 t39。
- 已有数据的迁移（样本书与作品里的 `{}`）。

不在本 Work（[t38](../w00039-novel-writing-plugins/tasks/t38-kernel-shared-parser/README.md#当前状态) 原文）：标签登记表（插件提供 `<StatBar>` 这类标签）与 `<html>`、`<jsx>` 沙箱块，最多留出标签名；数据通道与 JSX 运行时另开 Work。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-demos/README.md) | 演示稿与 spike：标签写法与富文本编辑的体验 | active |

实施的 Task（内核换写法与解析器、富文本编辑器）等需求对齐以后再建。

## 分支

演示与 spike 的分支在 t01 里写明，不合并。实施开始时再开 Work 分支。
