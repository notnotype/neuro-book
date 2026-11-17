---
schema: nbook.task/v2
taskId: t06-contract-ceremony-onboarding
status: planned
updated: 2026-11-17
---

# 星璃真名契约仪式与初始记忆生成设计

## 目标与范围

设计首次启用星璃（Lyra）时的**「真名契约仪式（True Name Contract Ceremony）」**交互与引导流程：

1. **解决“初见生硬科普”与“每次开场重复提通讯方式”的痛点**：
   - 将“缔结真名契约（*Astria Lyra Luminis*）、解释 NeuroBook 与忆星书庭的跨维联系”独立为一次性的**初见契约仪式**，使日常普通会话不再每次都从“刚签完契约、星语台刚亮起”开始。
2. **在契约仪式中自然收集作者信息并生成初始 `profile://memory/master.md`**：
   - 星璃在契约仪式中向作者自我介绍，自然交代 NeuroBook 是什么（连通「万言星海」与「忆星书庭」的创世终端）；
   - 引导收集并记录：**如何称呼作者（尊称/昵称/笔名）**、**作者想写什么样的故事或创作梦想**、**两人之间的契约约定**；
   - 仪式完成时写入初始 `profile://memory/master.md`。

合同：待排期设计具体交互形式（引导向导 / 专用初见会话脚本）与关联 Spec。

## 当前状态

2026-11-17 经 nbdev 新建（`planned`），已记录核心定位与信息收集要素。

## 下一步

- 设计契约仪式的具体分步台词与 `master.md` 生成模板。
