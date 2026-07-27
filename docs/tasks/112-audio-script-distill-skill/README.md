# 112 novel-audio-script-distill 音声台本拆解 skill

## Relative documents refs

- `assets/workspace/.nbook/agent/skills/novel-audio-script-distill/SKILL.md`：skill 真相源。
- `assets/workspace/.nbook/agent/skills/novel-audio-script-distill/references/script-parsing.md`：台本格式探测、文件名/音轨标记解析、A/B/C 噪音分级、长轨采样。
- `assets/workspace/.nbook/agent/skills/novel-audio-script-distill/references/extraction-methods.md`：单侧对话重建、听者角色/视点解析、称呼口癖提取、时间线重建、推断分级、音声题材标签。
- `assets/workspace/.nbook/agent/skills/novel-book-distill/SKILL.md`：两阶段卡片契约的参照来源（暂存区结构、卡片格式、采纳规则与本 skill 对齐；采纳规则按 111 的「独立能力」决策内联，不做 skill 间流程引用）。
- `docs/tasks/111-novel-book-distill-skill/README.md`：拆书 skill 的设计决策前例。
- 仓库根 `参考/RJ01526764/`：用户提供的样例台本（WEBVTT 多音轨、单 CV、双听者 NTR 结构），skill 方法论的形态依据；不属于 Bundled Workspace Template。

## User Request / Topic

- 编写一套 skill：通过音声台本整理出角色人设、故事发展、世界观等有效用于写作的信息。样例台本放在仓库根 `参考/` 下。
- 第二轮澄清：该 skill 用于本项目（NeuroBook 应用内 Agent），作为项目默认携带能力之一，需要适配本项目的 skill 形式；不是 Claude Code 会话级 skill。第一轮误产出的 `~/.claude/skills/story-audio-analyze/` 已删除，story 路由表改动已还原。

## Goal

新增 bundled workspace skill `novel-audio-script-distill`：把音声作品台本（WEBVTT/SRT/LRC/剧本体/纯文本）拆解为可独立取舍的卡片，支持两阶段采纳（暂存 → 用户点名 → lorebook 转写 / reference 归档）。验证面：SKILL.md 描述的暂存区结构、卡片契约与 `novel-book-distill` 对齐且自洽；音声特有方法论（单侧台词重建、听者角色/视点、推断分级）完整可执行。约束：阶段 A 只写 `reference/audio-script/` 与 `reference/distill/`；阶段 B 只处理用户点名卡片；不搬运原文、不复述露骨内容。

## Current State

- Implemented（skill 文本已落地，未经过真实 Agent 会话实测）。

## Decisions / Discussion

- **对齐 novel-book-distill 契约而非另起体系**：暂存区同样落 `reference/distill/{作品名}/`（`_meta.json` + `notes/` + `cards/` + `INDEX.md`），卡片沿用六类维度（setting/character/plot/storyline/style/technique）与三态状态机（pending/adopted/rejected），采纳去向一致。差异只在证据字段：`chapters` → `tracks`，进度字段 `processedChapters` → `processedTracks`，`_meta.json` 增加 `rjCode` 与 `tracks` 音轨清单。这样用户在同一个 `reference/distill/` 下浏览拆书和拆台本的产物，操作习惯一致。
- **音声台本区别于小说的三个核心方法**（skill 的存在理由，放 references/）：
  1. **单侧对话重建**——台本只有出声角色台词，听者角色言行按复述法（【实证】）/ 回应反推法（【强推断】）/ 空隙补完法（【弱推断】）三级手法还原，每轨产出「听者言行还原表」。
  2. **出声角色 ≠ 听者角色 ≠ 视点**——文件名 `（※XX的视点）` 指听者切换而非说话人切换（样例台本「学长视点」轨出声的仍是女主）；双听者交替是 NTR/三角类的标准结构，同一出声角色对不同听者的话术差值即表/里人格素材。
  3. **推断分级全程强制**——每条结论标【实证】/【强推断】/【弱推断】，阶段 B 转写 lorebook 时只保留前两级为节点主体，【弱推断】需用户确认后作为本作自有设定重写。防止分析师脑补污染 canon。
- **A/B/C 噪音分级**：音声台本大量行是喘息/拟声（C 类），只计数不逐行分析（占比本身是节奏信息）；含设定/称呼/底线信息的行（A 类）逐行登记，A/C 混合行按 A 处理但转述不直引。同时解决 token 浪费和露骨内容复述两个问题。
- **成人内容边界**：写进 skill 边界节——角色按发行规范视为成年虚构角色；提取目标（人设/关系/故事/世界观）本身是非露骨信息；露骨段转述 + 出处定位；个别片段无法处理跳过续完，不因题材中止整部拆解。
- **原始台本归档位**：外部路径/粘贴内容先归档 `reference/audio-script/{作品名}/`（对齐 `reference/tomato/`、`reference/silly-tavern/` 的来源目录惯例）；官方简介/角色介绍存 `_官方信息.md`，作为推断锚点。
- **听者角色强制立卡**：主人公零台词但全部信息可还原，是改写小说时的第一视角骨架，不得以无台词为由略过。
- **空白区清单**进 `INDEX.md` 末尾：台本未交代、改写必须自行补完的设定，即新作自由发挥许可清单。

## Verification / Test

- 纯提示词 skill，无代码与脚本，未运行测试。`SkillCatalog` 按目录自动发现（`server/agent/skills/skill-catalog.ts`），无需注册。
- 真实 Agent 会话实测（用 `参考/RJ01526764/` 跑完阶段 A + 阶段 B）待用户后续执行。

## Implementation Walkthrough

- 新建 `assets/workspace/.nbook/agent/skills/novel-audio-script-distill/SKILL.md`：定位与两阶段管道 / 边界（含成人内容处理）/ 推断分级 / 暂存区结构（`_meta.json` schema）/ 卡片格式（`tracks` 证据字段）/ 六类提取维度 / 阶段 A 六步流程（归档 → 音轨清单 → 逐轨笔记 → 聚合出卡 → INDEX + 空白区 → 汇报）/ 阶段 B 采纳（lorebook 转写规则内联 + reference 归档规则）/ 完成标准。
- 新建 `references/script-parsing.md`：文件名/音轨标记语义表、五种格式探测与解析要点、时间戳节奏利用（长静默 = 场景转换）、A/B/C 分级表、长轨采样策略。
- 新建 `references/extraction-methods.md`：单侧对话重建三手法 + 听者言行还原表、出声/听者/视点三概念与双听者结构、称呼表与口癖提取、时间线重建五步（轨序 vs 故事序、并行轨、EX 归位）、世界观物证归纳、推断分级细则、音声题材标签速查、角色弧线常见模式。
- 清理第一轮误产出：删除 `C:\Users\liu\.claude\skills\story-audio-analyze\`，还原 `C:\Users\liu\.claude\skills\story\SKILL.md` 路由表改动。

## TODO / Follow-ups

- 用 `参考/RJ01526764/` 真实实测一轮（阶段 A + 阶段 B），重点观察：单侧还原表质量、双听者时间线对齐、C 类过滤是否漏掉 A 类混合行、推断等级是否虚高。
- 实测后评估 `reference/distill/` 卡片是否需要 UI 侧浏览/勾选入口（与 111 共用同一个 TODO）。
