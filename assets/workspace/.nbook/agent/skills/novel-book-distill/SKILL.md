---
name: novel-book-distill
description: 拆书。从外部小说或设定文本中提取设定、人设、情节、故事线、文风、写作手法，先卡片化暂存到 reference/distill/ 等待用户筛选，采纳后转写进 lorebook 或归档到 reference/ 规定目录。触发语：拆书、拆解这本书、从这本小说提取设定、提炼人设、分析文风、整理写作手法。
---

# novel-book-distill：拆书

把外部小说或设定文本拆解成可独立取舍的参考卡片。它是一个独立能力，不属于任何写作流程链：输入是用户指定的文本，输出是暂存卡片；只有用户明确采纳某张卡片后，才把内容转写进 lorebook 或归档到 reference/ 对应目录。

一次完整拆书分两个阶段：

- **阶段 A 拆解**：文本 → 逐章笔记 → 分类卡片 → 汇总索引。产物全部落在暂存区，不碰 lorebook。
- **阶段 B 采纳**：用户浏览索引后指定要哪些卡片，逐卡转写或归档，并更新卡片状态。

用户可能只做阶段 A（先拆了再说），也可能隔很久才回来做阶段 B。两个阶段都以暂存区的 `_meta.json` 为进度真相源，支持中断续跑和多次采纳。

## 边界

- 输入只接受用户明确给出的文本：Project Workspace 内的文件（通常在 `reference/` 下）或用户直接粘贴的内容。不自动扫描目录找书。
- 阶段 A 只写 `reference/distill/{书名}/`，不写 lorebook、不写 `manuscript/`。
- 阶段 B 只处理用户点名采纳的卡片；没有用户指令时不得擅自把卡片写进 lorebook。
- 提取的是结构与抽象（设定逻辑、人物弧光、节奏套路、技法归纳），不搬运原文。只有文风卡允许保留少量短引文作分析例证。
- 外部作品的设定与人物是他人创作的原型。采纳进 lorebook 时必须提醒用户改名、变形、重组后使用，不要把原型原样当成本作 canon。
- 不做质量评价类报告。这里的目标是提取可复用素材，不是书评。

## 暂存区结构

每本书一个暂存目录：

```
reference/distill/{书名}/
  _meta.json      # 来源、拆解进度、卡片状态清单
  notes/          # 逐章/逐卷中间笔记，聚合卡片的原材料
  cards/          # 待筛选卡片，每张一个文件
  INDEX.md        # 人类可读索引：每张卡片一行摘要 + 当前状态
```

`_meta.json` 结构：

```json
{
    "title": "书名",
    "source": "reference/xxx/full.md",
    "processedChapters": "1-40",
    "cards": { "cards/character-lin-yan.md": "pending" }
}
```

卡片状态只有三种：`pending`（待筛选）、`adopted`（已采纳）、`rejected`（用户明确不要）。状态同时写在卡片 frontmatter 和 `_meta.json`，以 `_meta.json` 为准。

## 卡片格式

每张卡片是一个独立可取舍的最小单元，文件名 `cards/{type}-{slug}.md`：

```markdown
---
type: character
source: reference/xxx/full.md
chapters: 1-30
status: pending
target: lorebook/character/
---

# 一句话概括这张卡片

（正文：提炼内容，说明它为什么值得参考、能怎么用）
```

- `type`：六类之一，见下节。
- `chapters`：结论的证据章节范围，方便用户回原文核对。
- `target`：建议归宿目录，阶段 B 的默认去向，用户可改。
- 一张卡片只讲一件事。一个角色一张卡，一条世界规则一张卡；不要把整本书的设定塞进一张大卡。

## 六类提取维度

| type | 提取什么 | 采纳去向 |
|---|---|---|
| `setting` | 世界规则、力量体系、制度、势力、地点、物品等静态设定 | 转写进 lorebook 对应节点 |
| `character` | 角色画像、动机、误信念、关系、角色弧 | 转写进 lorebook 角色节点 |
| `plot` | 关键情节单元：冲突设计、爽点、反转、名场面的结构拆解 | 归档 `reference/plot-patterns/` |
| `storyline` | 主线支线脉络、节奏分配、伏笔埋设与回收的整体结构 | 归档 `reference/plot-patterns/` |
| `style` | 叙事视角、句式、用词习惯、氛围营造，附少量短引文例证 | 归档 `reference/style/` |
| `technique` | 可迁移的写作手法：悬念铺设、信息释放、描写技法、POV 处理 | 归档 `reference/technique/` |

拆解时不必六类齐全。设定集文本可能只出 setting/character 卡；用户点名"只拆文风"时只做 style/technique。按文本实际内容和用户意图取舍。

## 阶段 A：拆解

用 task_create 建立 checklist 并用 task_set_status 逐步推进，不要一次性做完再汇报：

1. 确认输入文本和书名，创建暂存目录与 `_meta.json`。已存在则读取进度，从断点续跑。
2. 分章切片。长篇按卷或按 20~40 章分批处理，每批完成后更新 `_meta.json` 的 `processedChapters`。
3. 逐章写笔记到 `notes/`。笔记只记事实：出场人物及其行动、新出现的设定、情节事件、值得注意的写法，不在这一步下结论。
4. 全部批次完成后，聚合笔记产出分类卡片写入 `cards/`。聚合时合并同一对象的跨章信息（一个角色的所有表现收进一张卡），剔除只出现一次、无复用价值的细节。
5. 生成或更新 `INDEX.md`：按类型分组，每张卡片一行"文件名 — 一句话摘要 — 状态"。
6. 汇报卡片总数、各类分布和值得优先看的亮点卡，提示用户浏览 `INDEX.md` 后指定采纳。

短文本（单篇短篇、一份设定集）可以跳过分批，直接逐段笔记后出卡。

## 阶段 B：采纳

用户可能说"采纳 3、7、12""人设全要""文风的都不要"。执行：

1. 读取 `_meta.json` 和被点名的卡片，确认当前状态是 `pending`；已是 `adopted` 的跳过并说明，保证重复执行不产生重复节点。
2. 按卡片类型分流处理（见下）。
3. 处理完成后更新卡片 frontmatter 和 `_meta.json` 中的状态；用户明确不要的标记 `rejected`。
4. 更新 `INDEX.md` 状态列，汇报每张卡片的实际去向。

采纳后卡片文件留在暂存区不删除，作为来源追溯；用户要求清理时才删。

### setting / character：转写进 lorebook

这条路是转写，不是移动文件。lorebook 节点有自己的契约，必须按契约重写：

- 缺节点时用 `workspace node new TARGET --type TYPE --title TITLE` 创建（角色加 `--state`），再编辑生成的 `index.md`。
- 按内容选位置：世界规则进 `lorebook/world/rule/`，可运行机制进 `lorebook/system/`，势力进 `lorebook/faction/`，地点进 `lorebook/location/`，物品进 `lorebook/item/`，总览性材料进 `lorebook/note/`；核心角色进 `lorebook/character/{slug}/`，地点或势力绑定的角色放对应节点之下。
- `summary` 短而可复用；正文说明设定如何影响角色、社会和剧情；`refs` 建立到相关节点的必要引用；`tags` 用有意义的中文短标签，并加来源书名标签（如 `拆书-某某书`）标明原型出处。
- 稳定设定写 `index.md`，可变当前状态写 `state.md`，不要混写。
- 转写前先和用户确认变形方案：改名、能力重组、背景嫁接，或用户明确表示按原样引入。没有确认前不落笔。
- 先检查 lorebook 里是否已有同主题节点：有则并入更新，不要另建重复节点。

### plot / storyline / style / technique：归档

直接把卡片内容整理成正式参考文件写入对应目录：

- `plot` / `storyline` → `reference/plot-patterns/{slug}.md`
- `style` → `reference/style/{slug}.md`
- `technique` → `reference/technique/{slug}.md`

归档文件保留卡片的 `source` / `chapters` 出处信息，去掉 `status` / `target` 等暂存字段。同目录已有相近主题文件时并入更新。

## 完成标准

- 阶段 A：`_meta.json` 进度与实际处理章节一致；`cards/` 内每张卡片单一主题、带完整 frontmatter；`INDEX.md` 与卡片一一对应；全程没有写入 lorebook。
- 阶段 B：被采纳卡片全部落到目标位置且状态已更新；lorebook 侧遵守节点契约与变形确认；重复执行不产生重复节点。
- 任何阶段结束时，用户都能只看 `INDEX.md` 掌握这本书的拆解结果和取舍现状。
