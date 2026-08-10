---
name: novel-guide
description: NeuroBook 小说写作流程总览。当不确定当前应该用哪个写作 skill、用户问"接下来做什么"、或需要向用户解释整体创作流程时读取。它是写作 skill 体系的唯一路线图。
when_to_use: 不确定该进入哪个写作 skill 时；用户新接触 NeuroBook 问整体流程时；需要判断当前项目处于哪个创作阶段时。
---

# novel-guide：写作流程总览

NeuroBook 的写作 skill 分三层。本文件是唯一的全局路线图；各 skill 的 frontmatter 只描述自己的触发时机，不重复全局流程。

## 三层结构

**1. 工具支持层** —— 数据获取与导入，随时可用，无流程依赖：

| skill | 用途 |
| --- | --- |
| `novel-import-silly-tavern-card` | 导入本地 SillyTavern 角色卡 / worldbook 到当前 Project Workspace |
| `novel-import-tomato-reference` | 导入番茄小说等外部书稿到 `reference/tomato/`，供拆书分析 |
| `novel-import-book` | 整书导入管线：外部书稿 → `manuscript/` 切章落盘 → 逐章摘要 → 承载树重建 → 结构提取（主线/角色/世界观/钩子）确认落库 |

**2. 随时可用层** —— 不挂在主流程上，任何阶段都可以进入：

| skill | 用途 |
| --- | --- |
| `novel-idea-exploration` | 灵感探索：把模糊灵感收束成长简介式故事概述 |
| `novel-genre-research` | 题材与竞品调研：novel-api 榜单选题 → 导入对标书 → book-deconstruct 拆书 → 结论落 lorebook |
| `novel-technique-character-card-workshop` | 重量级角色理解与写卡技法：20/24/80/200 问、调色盘、三面性 |

**3. 创作流程层** —— 有先后依赖的主线：

| skill | 用途 | 进入条件 | 出口 |
| --- | --- | --- | --- |
| `novel-setup` | 项目搭建四阶段：项目初始化 → 世界书框架 → 角色设计与细化 → World Engine 初始化 | 新开书、导入书、续写已有书 | 进入 `novel-writing` 开局模式 |
| `novel-writing` | 剧情写作循环：剧情设计 → 用户拍板落库 → 正文/评审/修订 | `novel-setup` 完成（或老项目已有等价基础） | 每章循环一次，持续使用 |
| `novel-writer-execution` | Writer 执行手册（writer profile 内部参考，leader 不直接调用） | — | — |

## 典型旅程（新开一本书）

1. 只有模糊灵感 → `novel-idea-exploration` 聊出故事概述。
2. 方向确定 → `novel-setup` 走四阶段：定位与最小骨架、世界书框架（大量占位可接受）、角色与 lorebook 细化、World Engine 初始化。
3. 开始写 → `novel-writing`，首轮走开局模式（黄金三章），之后每章循环：设计 → 拍板落库 → 正文 → 评审 → 修订。
4. 中途随时可插入：角色深挖（character-card-workshop）、导入外部素材（import 系列）、竞品调研（genre-research）。

导入已有作品（酒馆卡 / 已有书稿 / 续写）也从 `novel-setup` 进入，它的入口判断会分流。

## 内置 workflow

`run_workflow` 可用的编排（多 agent 并行、结构化产出），写作场景常用：

| workflow | 用途 | 典型接入点 |
| --- | --- | --- |
| `parallel-brainstorm` | 多角度并发脑暴后收敛 | `novel-writing` 剧情设计阶段、`novel-idea-exploration` 方向发散 |
| `write-review-loop` | 临时写手+评审的固定轮数写-评-修（不写文件） | 简介、文案、短文本打磨；正式章节用 `chapter-write-review-revise` |
| `chapter-write-review-revise` | 真实 writer 写章节到目标文件 + 三维评审（一致性/节奏/文风）+ 按 major 问题修订循环 | `novel-writing` 正文循环；前提=剧情事实已拍板、World Engine 已推进 |
| `consistency-audit` | 按章并发对照 lorebook 摘录与世界状态事实找矛盾（位置/伤势/物品/认知/时间线/设定），跨章汇总 | 写完若干章后的体检；调用前 leader 先列章节路径、预查 World Engine 事实传入 |
| `book-deconstruct` | 整本外部书稿的商业拆书：章节采样后逐章分析钩子/承诺/爽点/节奏，汇总拆书报告 | `novel-genre-research` 竞品分析；输入=番茄导入目录或单 .md 书稿 |
| `character-qa-fanout` | 角色理解题批量生成候选答案（分组扇出），供用户逐题挑选 | `novel-technique-character-card-workshop` 的可选批量模式；默认逐题交互不用它 |
| `split-book` | 按章拆书分析书稿结构与剧情脉络（轻量单文件版） | 快速看结构用它；完整商业拆书用 `book-deconstruct` |
| `chapter-digest` | 整书导入管线第二步：批量生成章节摘要（summary/人物/事件），由 leader 写回 frontmatter | 导入书稿进 `manuscript/` 后、续写/结构提取前；配合 `workspace node set-summary` 落盘 |
| `book-structure-extract` | 整书导入管线第四步：按逐章摘要提取主线/角色/世界观/未解钩子提议，用户确认后落库 | `chapter-digest` 完成后；`novel-import-book` 第 5 步 |

## 阶段判断速查

- 用户说不清要写什么 → `novel-idea-exploration`。
- 项目没有定位 / lorebook / World Engine → `novel-setup`（从缺的阶段进入，不必从头走）。
- 讨论剧情、推演局势、写章、改章 → `novel-writing`。
- 只整理角色感觉、标签、萌点 → `novel-technique-character-card-workshop`。
- 要导入外部素材 → import 系列。
- 分析别人的书、找对标 → `novel-genre-research`。
