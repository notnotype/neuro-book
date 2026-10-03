---
name: novel-writing
description: 剧情写作循环总控：剧情设计 → 用户拍板后落库 World Engine 与 Plot → 章节正文/评审/修订。用于讨论剧情、推演局势、把确认的剧情事实写入 World Engine、调用 writer 写章节、修改已有正文。开局黄金三章走本 skill 的开局模式。各环节细节在本 skill 目录 phases/ 下按需读取。
when_to_use: 用户想讨论剧情、推演当前局势、设计某段走向；用户讲述剧情需要落库；用户要写一章、续写、润色或修改已有章节；新书 setup 完成后设计开局。
---

# novel-writing：剧情写作循环

写作模式的主循环。每一轮大致经过三个环节：**剧情设计 → 拍板落库 → 正文循环**；用户可以从任何环节进入，也可以只做其中一个环节。

用户是主创。未确认的推演、候选、随机素材和角色代入都不是 canon，不能写进 World Engine。剧情事实一旦确认，World Engine 就是动态世界状态与时间线的唯一真相源。

各环节的详细流程放在本 skill 目录下，按当前环节读取，不要一次全读：

| 环节 | 文件 | 内容 |
| --- | --- | --- |
| 剧情设计 | `phases/01-plot-design.md` | 讨论、推演、多视角代入、脑暴（可用 `parallel-brainstorm` workflow） |
| 拍板落库 | `phases/02-canon-commit.md` | 确认剧情事实，LOD 判断，写入 World Engine，更新 Plot Workbench |
| 正文循环 | `phases/03-chapter-loop.md` | Leader-Writer 写章 → 评审 → 修订；已有章节的润色修订 |
| 开局模式 | `phases/04-opening-mode.md` | 新书首轮特化：黄金三章设计要点与开局评审 |

## 判断本轮意图

先判断用户这句话属于哪一类，再进对应环节：

| 用户意图 | 处理方式 |
| --- | --- |
| 自由探索 | 只讨论灵感、主题、角色可能性（`01`），不查或写 World Engine，除非用户要求看现状。 |
| 宏观剧情设计 | 讨论阶段目标、主线冲突、角色关系和主题承诺（`01`）；通常不急着写入。 |
| 当前片段推进 | 查询当前状态，用角色代入和状态推导帮助设计下一段（`01` + `02` 的查询部分）。 |
| 已确认剧情事实 | 进入 `02`，把状态变化写入 World Engine。 |
| 写章节 | 先确认本章剧情事实已落库（`02`），再进入 `03` 调用 writer。 |
| 改已有正文 | 进入 `03` 的修订段；改变事件结果时先回 `02` 确认事实。 |
| 新书设计开局 | 进入 `04`，用 `01` 的方法设计、`02` 落库、`03` 成文。 |

核心规则：**未确认的推演不是 canon，不写入 World Engine。**

## 协作原则

- 先回应用户的想法，再提出分析。不要把剧情讨论变成任务报告。
- 用户没有明确范围时，先判断本轮是在自由探索、宏观设计、当前片段推进，还是准备落库。
- 用户确认前，只给候选、风险、推演和问题，不写 World Engine。
- 用户确认后，用人话复述将要成为 canon 的剧情事实，再写入 World Engine。
- 对用户透明处理技术细节。用户只需要听到“时间线新增了什么、当前状态是什么”，不需要看到 slice / patch / op / JSON。

> 边界：本流程不使用 director / simulator / emulation 维护写作模式世界状态。剧情确定后的状态变化只落 World Engine：使用单一 `execute_world` 工具；leader / world.engine 可在脚本内用 `world.slice.write`、`world.slice.editPatches`、`world.slice.delete` 写入、修正或清理切面，writer 只有 readonly 查询能力。

## 前置

- World Engine 已初始化（calendar、纪元锚点、需追踪的角色 subject）。未初始化时只能讨论剧情；用户要正式落库或写章节时，先转 `novel-setup` 阶段四。
- 世界书基础缺失时，先转 `novel-setup` 阶段二。

## 完成标准（每轮循环）

- 已判断本轮意图并进入正确环节。
- 只有用户确认过的剧情事实被写入 World Engine。
- 写章节时正文进入唯一目标章节 `index.md`，状态变化已先行落库。
- 已向用户回报时间线 / 当前状态 / 正文落点的人读摘要。
