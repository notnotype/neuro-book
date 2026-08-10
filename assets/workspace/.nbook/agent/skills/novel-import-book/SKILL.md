---
name: novel-import-book
description: 整书导入管线总控：把一部完整外部小说（txt/md 单文件、番茄导入目录、或一堆按序命名的 .md/.txt 文件目录）导入当前 Project Workspace 的 manuscript/，切章、逐章摘要、重建剧情承载树、提取结构提议（主线/角色/世界观/未解钩子）并落库。用户说"把这本书导进来""导入小说后续写""迁移旧书"时使用。
when_to_use: 用户要把一部完整外部小说导入当前项目（迁移旧作 / 在成书基础上续写 / 修改旧文）；书稿尚未进 manuscript 时从本 skill 进入。
---

# novel-import-book：整书导入管线

把一部完整外部小说搬进 `manuscript/` 并整理成可续写/可修改的状态。分六步，每一步完成后再进下一步；用户确认是硬闸门，不自动跳过。

## 前置检查

- 确认当前 Project Workspace 已存在（没有就先 `workspace project ensure`）。
- 确认 `manuscript/` 为空或没有与导入章节冲突的目录。
- 书稿来源三种：
  1. 单个 `.txt` / `.md` 文件（最常见，含老书 GBK 编码）
  2. 番茄导入目录（`reference/tomato/{book}/`，含 `full.md`）
  3. 一堆按序命名的 `.md` / `.txt` 文件目录（文件名序号即章节顺序）

## 第 1 步：切章 dry-run（不写文件）

```bash
workspace node import-book <source> --json
```

- source 是 Project Workspace 内相对路径或绝对路径。
- 输出 `{mode, patternKey, confidence, total, distribution, anomalies, previews}`：
  - `mode=pattern` + `confidence=high`：切章成功，继续。
  - `confidence=low` 或 `total` 明显不对（比如 1 章或异常章很多）：**先给用户看统计，不要直接落盘**。
- 把统计与预览呈现给用户：共多少章、字数分布、异常章（<500 字或 >12000 字）清单。

### 切章置信度低时的三种修正（按顺序尝试）

1. **用户确认是书名页/前言混入**：直接检查 `previews`，若首章是书名页且被切成一章，换 `--split-points` 明确起点。
2. **AI 规则发现**：读正文开头样本（跳过前言后约 1-2 万字），让用户确认章节标记形态，然后按 `ChapterPatternDescription` 输出 JSON：
   ```json
   {"lineStart": true, "prefix": "第", "numbering": "arabic", "suffix": "回", "separator": " ", "titleOptional": false}
   ```
   传给 `--pattern-json`。
3. **无显式章节标记**：把正文按合理长度分段，AI 找出每章起始行号，输出 `{"startLines": [0, 305, 620, ...]}`，传给 `--split-points`。

dry-run 满意后进入第 2 步。

## 第 2 步：落盘

```bash
workspace node import-book <source> --apply [--chapters-per-volume 100]
```

- 默认每 100 章一卷（`manuscript/001-volume/001-chapter/`），`--single-volume` 或 `--volume <名>` 可改。
- 落盘后立即 `workspace node validate manuscript --recursive` 确认内容节点合法。
- 章节 frontmatter 自动带 `governance.source: imported`、`governance.review: proposed`，表示 AI 参与生成、待用户确认。

## 第 3 步：逐章摘要

分批调用 `run_workflow chapter-digest`，每批最多 30 章，批间循环直到全部完成：

```bash
# 先列出全部章节目录
workspace node parse --json manuscript
# 把 30 个 path 拼成逗号分隔传给 workflow
run_workflow chapter-digest --args '{"chapterPaths": "...", "model": "<廉价模型key>"}'
```

- `model` 用便宜的模型（摘要量大，不值得用好模型）；`limit` 默认 30，超出的由你循环。
- workflow 返回 `{path, summary, characters, events}` 数组；**保留 characters/events 供第 5 步复用**。
- 用一条命令批量写回 frontmatter：

```bash
# 把 workflow 返回转成 JSON Lines 写回
workspace node set-summary --stdin
```

- 摘要写回后 `workspace node parse --json manuscript` 抽查几章，确认 summary 字段已更新。
- **断点续跑**：已写回的章节跳过即可，重复跑同一批是幂等的。

## 第 4 步：重建剧情承载树

调用 `bootstrap_carrier_tree` 工具（agent 侧 Plot 写工具）：扫描 `manuscript/` 目录，为每个卷目录建 StoryAct、每章目录建 StoryChapter，并写回 `chapter:` 反指。

- 幂等，可重复跑；完成后用 `get_story_tree` 验证承载树与 manuscript 目录一致。

## 第 5 步：结构提取提议（主线/角色/世界观/钩子）

把第 3 步的摘要（不含正文）传给 `run_workflow book-structure-extract`：

```bash
run_workflow book-structure-extract --args '{"summaries": "<摘要JSON数组>", "model": "<好模型key>"}'
```

- 输入是 `{path, title, summary}[]`，直接从 `workspace node parse --json manuscript` 生成（默认不含 body，极轻量）。
- workflow 按卷分批粗提取 → 汇总去重，返回 `{threads, characters, worldFacts, openHooks}`。
- **这一步只吃摘要不吃全文，成本可控**。

### 用户确认（分类批量审核，不逐条问）

把四类提议分别展示给用户，按用户反馈调整：

| 类别 | 展示方式 | 确认后落位 |
| --- | --- | --- |
| threads 主线/支线 | 表格：线名/讲什么/起止位置 | Plot 因果树 `save_story_thread` |
| characters 角色 | 列表：角色/一句话定位/弧线 | 角色模块（`lorebook/character/{name}/`） |
| worldFacts 世界观 | 列表：条目/摘要/类型 | `lorebook/{type}/{name}/` 内容节点 |
| openHooks 未解钩子 | 列表：钩子/埋设位置 | 作为 Plot 节点记录（可后续转为 Promise） |

- 用户嫌多：先只落「主线 + 主要角色 + 核心设定」骨架，其余后续写作时按需补（lorebook 允许 `status: pending` 占位）。
- 确认过的条目 frontmatter 用 `governance.review: reviewed`；AI 提议未确认前保持 `proposed`。

## 第 6 步：续写准备（可选，用户要续写时）

只做结尾切片，不回溯全书：

1. 读最后 3-5 章正文 + 摘要。
2. 提取当前时间/地点/人物状态/未了事件 → 按 novel-setup 阶段四写 World Engine 初始切片。
3. 续写时 writer 消费：全部章摘要列表（轻量索引）+ retrieval 召回 lorebook + World Engine 状态快照。

## 修改旧文（后续常态）

- 按摘要列表定位章节 → 读原文 → 修改 → 单章重跑摘要（`chapter-digest` 只传该章 path）→ 若动了世界状态更新 World Engine 切片。
- 只重算改动的章，不整书重来。

## 边界

- 切章只认章节标记，不重排原文；正文原样保留在 index.md。
- 版权：导入的书只放当前 Project Workspace，不做自动下载、不做版权内容分发。
- 不改动 `reference/tomato/` 下的原始素材；`import-book` 是复制进 `manuscript/`，不是移动。
