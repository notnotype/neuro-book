---
schema: nbook.task/v2
taskId: t14-plugin-split
status: planned
updated: 2026-10-31
---

# 插件切分、包边界与 nb-memory 去留

## 目标与范围

定这套功能分几个插件、几个包，彼此怎么依赖，以及现有 `nb-memory` 包怎么处理。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t02、t09。

## 要讨论的问题

1. 插件怎么切：剧情图谱（nb-story）、设定库（含表单）、剧情工坊（活页夹、大纲、伏笔）三个，还是一个“小说创作”插件；共享模型单独成包。
2. 依赖与降级：只启用设定库、不启用剧情工坊时能用到什么；`.binder` 由哪个插件认领。
3. nb-story 的双重身份：已发布到 npm 的独立命令行 `nbstory` 与工作台插件共用核心；合并模型后它的数据格式、命令行要不要改。
4. `nb-memory`（episode、facts、主体注册表）与新模型重叠：废弃、并入还是作为底层。
5. 中文名与命名：剧情图谱、设定库、剧情工坊、世界引擎这些名字在新模型下还对不对。

材料：[剧情图谱：以后接入 NeuroBook](../../../../../docs/proposals/novel-story-app.md)；[`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
