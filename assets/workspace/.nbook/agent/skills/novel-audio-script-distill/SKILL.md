---
name: novel-audio-script-distill
description: 音声台本拆解。从音声作品（ASMR / ドラマCD / DLsite 音声）的台本（WEBVTT / SRT / LRC / 剧本体 / 纯文本）中提取角色人设、故事发展、世界观、说话风格与叙事手法，先卡片化暂存到 reference/distill/ 等待用户筛选，采纳后转写进 lorebook 或归档到 reference/ 规定目录。核心方法：单侧台词的隐性对话重建 + 听者角色（视点）解析 + 推断分级标注。触发语：拆台本、拆音声、音声台本整理、从这个音声提取人设、拆这个 RJ 作品。
---

# novel-audio-script-distill：音声台本拆解

把音声作品的台本拆解成可独立取舍的参考卡片。它是一个独立能力，不属于任何写作流程链：输入是用户指定的台本文件或目录，输出是暂存卡片；只有用户明确采纳某张卡片后，才把内容转写进 lorebook 或归档到 reference/ 对应目录。

**音声台本区别于小说文本的关键：它几乎总是单侧有声——台本里只有出声角色的台词，听者角色（主人公）的言行必须从出声角色的回应里反推。拆台本 = 把碎片化的单侧台词还原成完整的人物、故事和世界，并对每条还原信息标注推断等级。**

一次完整拆解分两个阶段：

- **阶段 A 拆解**：台本 → 逐轨笔记 → 分类卡片 → 汇总索引。产物全部落在暂存区，不碰 lorebook。
- **阶段 B 采纳**：用户浏览索引后指定要哪些卡片，逐卡转写或归档，并更新卡片状态。

用户可能只做阶段 A，也可能隔很久才回来做阶段 B。两个阶段都以暂存区的 `_meta.json` 为进度真相源，支持中断续跑和多次采纳。

## 边界

- 输入只接受用户明确给出的台本：Project Workspace 内的文件（通常在 `reference/` 下）、用户给出的外部路径或直接粘贴的内容。不自动扫描目录找台本。
- 外部路径或粘贴的台本，先原样归档到 `reference/audio-script/{作品名}/` 再开始拆解；已在 Project Workspace 内的台本不移动，`_meta.json.source` 记录其位置。
- 阶段 A 只写 `reference/audio-script/{作品名}/` 与 `reference/distill/{作品名}/`，不写 lorebook、不写 `manuscript/`。
- 阶段 B 只处理用户点名采纳的卡片；没有用户指令时不得擅自把卡片写进 lorebook。
- 提取的是结构与抽象（人设逻辑、关系发展、世界规则、技法归纳），不搬运原文。只有说话风格类卡片允许保留少量短台词作分析例证，且优先挑非露骨、信息密度高的句子。
- 音声作品常含成人内容。全部角色按音声作品发行规范视为成年虚构角色；拆解目标——人设、关系、故事、世界观——本身是非露骨信息。露骨段落按噪音分级规则只计数、不逐行分析，卡片和笔记里用转述 + 出处定位替代直引。个别片段无法处理则跳过、照常续完其余，不以题材为由中止整部作品的拆解。
- 外部作品的设定与人物是他人创作的原型。采纳进 lorebook 时必须提醒用户改名、变形、重组后使用，不要把原型原样当成本作 canon。
- 不做质量评价类报告。这里的目标是提取可复用素材，不是作品测评。

## 推断分级（全程强制）

单侧台本的信息大半靠反推，卡片必须让用户能区分「原作如此」和「分析师脑补」。逐轨笔记与卡片中的**每条结论**末尾标注：

- 【实证】：台词直接说了、复述法还原，或官方简介写明。
- 【强推断】：从单侧台词反推，合理解释基本唯一，或多轨互证。
- 【弱推断】：空隙补完、经验补齐；写作时可自由改动。

判定细则与还原手法见 [references/extraction-methods.md](references/extraction-methods.md)。

## 暂存区结构

每个作品一个暂存目录：

```
reference/distill/{作品名}/
  _meta.json      # 来源、音轨清单、拆解进度、卡片状态清单
  notes/          # 逐轨笔记（notes/track-01.md ...），聚合卡片的原材料
  cards/          # 待筛选卡片，每张一个文件
  INDEX.md        # 人类可读索引：每张卡片一行摘要 + 当前状态 + 空白区清单
```

`_meta.json` 结构：

```json
{
    "title": "作品名",
    "rjCode": "RJ01526764",
    "source": "reference/audio-script/作品名/",
    "tracks": ["01. 序章 ...", "02.（※XX的视点）..."],
    "processedTracks": "01-05",
    "cards": { "cards/character-nv-zhu.md": "pending" }
}
```

`rjCode` 无则为 null。卡片状态只有三种：`pending`（待筛选）、`adopted`（已采纳）、`rejected`（用户明确不要）。状态同时写在卡片 frontmatter 和 `_meta.json`，以 `_meta.json` 为准。

## 卡片格式

每张卡片是一个独立可取舍的最小单元，文件名 `cards/{type}-{slug}.md`：

```markdown
---
type: character
source: reference/audio-script/作品名/
tracks: 01,03,06
status: pending
target: lorebook/character/
---

# 一句话概括这张卡片

（正文：提炼内容 + 每条结论的推断等级，说明它为什么值得参考、能怎么用）
```

- `type`：六类之一，见下节。
- `tracks`：结论的证据音轨，方便用户回台本核对；笔记内保留行号/时间戳级定位。
- `target`:建议归宿目录，阶段 B 的默认去向，用户可改。
- 一张卡片只讲一件事。一个角色一张卡，一条世界规则一张卡；不要把整部作品塞进一张大卡。
- **听者角色（主人公）必须单独立卡**：他没有一句台词，但正因全部信息来自还原，他往往是改写成小说时的第一视角骨架，不得以「没有台词」为由略过。

## 六类提取维度

| type | 提取什么 | 采纳去向 |
|---|---|---|
| `setting` | 场景地点、时代物证、社会关系网、规则设定（催眠/契约等特殊玩法的边界与代价）、道具 | 转写进 lorebook 对应节点 |
| `character` | 角色画像：身份、表/里性格、动机欲望、角色弧线与不可逆点；含听者角色还原档案 | 转写进 lorebook 角色节点 |
| `plot` | 关键情节单元：转折点、不可逆点、名场面的结构拆解 | 归档 `reference/plot-patterns/` |
| `storyline` | 时间线重建（轨序 vs 故事序）、并行视点对齐、关系阶段划分、信息差设计 | 归档 `reference/plot-patterns/` |
| `style` | 说话风格：称呼表及其变化、口癖、语气基线与漂移，附少量短台词例证 | 归档 `reference/style/` |
| `technique` | 可迁移的叙事手法：单侧台词的信息传递术、视点切换用途、静默段设计、听众情绪曲线 | 归档 `reference/technique/` |

拆解时不必六类齐全。无剧情的纯服务向作品可能只出 style/technique 卡；用户点名「只要人设」时只做 character/style。按台本实际内容和用户意图取舍。

## 阶段 A：拆解

用 task_create 建立 checklist 并用 task_set_status 逐步推进，不要一次性做完再汇报：

1. 确认台本来源与作品名（用户标题 > RJ 号目录名 > 首文件名）。外部/粘贴台本先归档 `reference/audio-script/{作品名}/`。创建暂存目录与 `_meta.json`；已存在则读取进度，从断点续跑。
2. 解析音轨清单：每个文件的格式（WEBVTT/SRT/LRC/剧本体/纯文本）、文件名标记（序号、`（※XX的视点）`、序章/EX/After）。清单写进 `_meta.json.tracks` 并向用户确认；有官方简介 / 角色介绍时请用户提供，存 `reference/audio-script/{作品名}/_官方信息.md`——推断可锚定官方设定。格式与标记解析规则见 [references/script-parsing.md](references/script-parsing.md)。
3. 逐轨写笔记到 `notes/track-{NN}.md`。每轨记：场景/时间、出声角色、**听者角色（视点）**、事件链、A 类新信息登记（设定/称呼/事件/底线/心理）、听者言行还原表、关系温度。台词行按 A/B/C 信息密度分级过滤（露骨拟声行只计数不分析）；每完成一轨更新 `_meta.json.processedTracks`。还原方法见 [references/extraction-methods.md](references/extraction-methods.md)。
4. 全部音轨完成后，聚合笔记产出分类卡片写入 `cards/`。聚合时合并同一对象的跨轨信息（一个角色的所有表现收进一张卡）；单轨【弱推断】被他轨印证的升级为【强推断】并注明互证轨。
5. 生成或更新 `INDEX.md`：按类型分组，每张卡片一行「文件名 — 一句话摘要 — 状态」；末尾附**空白区清单**——台本从未交代、改写成小说必须自行补完的设定（姓名、外貌、前史……），这是新作的自由发挥许可清单。
6. 汇报卡片总数、各类分布和值得优先看的亮点卡，提示用户浏览 `INDEX.md` 后指定采纳。

单文件整部作品（无音轨切分）按内部标记（章节行、长静默、场景跳变）先切逻辑轨再走同一流程。

## 阶段 B：采纳

用户可能说「采纳 3、7、12」「人设全要」「手法的都不要」。执行：

1. 读取 `_meta.json` 和被点名的卡片，确认当前状态是 `pending`；已是 `adopted` 的跳过并说明，保证重复执行不产生重复节点。
2. 按卡片类型分流处理（见下）。
3. 处理完成后更新卡片 frontmatter 和 `_meta.json` 中的状态；用户明确不要的标记 `rejected`。
4. 更新 `INDEX.md` 状态列，汇报每张卡片的实际去向。

采纳后卡片文件留在暂存区不删除，作为来源追溯；用户要求清理时才删。

### setting / character：转写进 lorebook

这条路是转写，不是移动文件。lorebook 节点有自己的契约，必须按契约重写：

- 缺节点时用 `workspace node new TARGET --type TYPE --title TITLE` 创建（角色加 `--state`），再编辑生成的 `index.md`。
- 按内容选位置：世界规则进 `lorebook/world/rule/`，可运行机制进 `lorebook/system/`，势力进 `lorebook/faction/`，地点进 `lorebook/location/`，物品进 `lorebook/item/`，总览性材料进 `lorebook/note/`；核心角色进 `lorebook/character/{slug}/`，地点或势力绑定的角色放对应节点之下。
- `summary` 短而可复用；正文说明设定如何影响角色、社会和剧情；`refs` 建立到相关节点的必要引用；`tags` 用有意义的中文短标签，并加来源作品标签（如 `拆台本-某某作品`）标明原型出处。
- 转写时只保留【实证】【强推断】内容为节点主体；【弱推断】要么舍弃，要么与用户确认后作为本作自有设定重写，不再携带推断标注。
- 稳定设定写 `index.md`，可变当前状态写 `state.md`，不要混写。
- 转写前先和用户确认变形方案：改名、关系重组、背景嫁接，或用户明确表示按原样引入。没有确认前不落笔。
- 先检查 lorebook 里是否已有同主题节点：有则并入更新，不要另建重复节点。

### plot / storyline / style / technique：归档

直接把卡片内容整理成正式参考文件写入对应目录：

- `plot` / `storyline` → `reference/plot-patterns/{slug}.md`
- `style` → `reference/style/{slug}.md`
- `technique` → `reference/technique/{slug}.md`

归档文件保留卡片的 `source` / `tracks` 出处信息与推断等级标注，去掉 `status` / `target` 等暂存字段。同目录已有相近主题文件时并入更新。

## 完成标准

- 阶段 A：`_meta.json` 进度与实际处理音轨一致；每轨一份笔记且听者角色明确；`cards/` 内每张卡片单一主题、带完整 frontmatter、结论带推断等级；出声角色与听者角色都有 character 卡；`INDEX.md` 与卡片一一对应且含空白区清单；全程没有写入 lorebook。
- 阶段 B：被采纳卡片全部落到目标位置且状态已更新；lorebook 侧遵守节点契约与变形确认；重复执行不产生重复节点。
- 任何阶段结束时，用户都能只看 `INDEX.md` 掌握这个作品的拆解结果和取舍现状。
