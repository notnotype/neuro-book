# Round 403 - Temporary Project Event Commit Browser Acceptance

## Goal

在不写真实 `ming-ding-zhi-shi-2` 六文件的前提下，用临时 Project 验收真实 Workbench 的单条 `events.jsonl` commit 闭环：

- `appended` 分支：确认追加后写入 `events.jsonl`、刷新 subject overview、按钮变成 `已追加`。
- `already-exists` 分支：刷新页面后重复确认同一行，不重复写入，并显示已存在提示。
- 会话态分支：同一 Workbench 会话内已处理 proposal 的按钮禁用。

## Setup

通过正式 API 创建临时 Project：

- `POST /api/projects`
- title: `world-engine-round-403-acceptance`
- projectPath: `workspace/world-engine-round-403-acceptance`

通过 `PUT /api/workspace-files/write` 写入最小验收数据：

- `world-engine/schema.yaml`
- `simulation/subjects/player/subject.md`
- `simulation/subjects/player/soul.md`
- `simulation/subjects/player/mind.md`
- `simulation/subjects/player/state.md`
- `simulation/subjects/player/events.jsonl`
- `simulation/subjects/player/memory.jsonl`

随后通过 World Engine API 注册 subject 并写入测试 slice：

- subject: `player / 验收主角`
- sliceId: `68c2e03c-1c2c-4f70-832d-f1e41a2440fb`
- time: `复兴纪元1年 1月1日 00:00:10`
- title: `[验收] 主角发现门缝透光`

## Browser Acceptance

真实浏览器打开：

```text
http://localhost:3001/?project=workspace%2Fworld-engine-round-403-acceptance
```

进入主 IDE 的真实 `World Engine Workbench` 后，确认 Inspector 展示：

- 当前视角：`主体语境 验收主角`
- selected slice: `68c2e03c-1c2c-4f70-832d-f1e41a2440fb`
- `SUBJECT FILE PROPOSALS`
- `events.jsonl draft`
- `追加`
- target path: `simulation/subjects/player/events.jsonl`

候选行：

```json
{"text":"我经历了这件事：主角发现门缝透光。我发现门缝透出稳定的光，决定先保持安静观察。","time":"复兴纪元1年 1月1日 00:00:10"}
```

点击 `追加` 后应用内确认框展示：

- title: `追加 events.jsonl`
- target: `simulation/subjects/player/events.jsonl`
- subject: `验收主角`
- JSONL 行内容

点击 `确定` 后验收通过：

- 顶部 notice：`已追加到 验收主角 的 events.jsonl，并标记 events RAG dirty。`
- 左栏 subject overview 从 `1 events` 变成 `2 events`
- RAG 状态显示 `events:dirty / memory:unknown`
- Inspector 按钮变为 `已追加`
- `已追加` 按钮 disabled

文件内容确认只追加一行：

```jsonl
{"text":"我来到临时验收场景。","time":"复兴纪元1年 1月1日 00:00:00"}
{"text":"我经历了这件事：主角发现门缝透光。我发现门缝透出稳定的光，决定先保持安静观察。","time":"复兴纪元1年 1月1日 00:00:10"}
```

刷新页面后重新打开 Workbench，按钮恢复为 `追加`；再次点击并确认同一行，验收 `already-exists` 分支：

- 顶部 notice：`验收主角 的 events.jsonl 已存在相同经历。`
- event count 仍为 `2 events`
- 按钮再次变为 `已追加`
- 文件行数仍为 2，没有重复写入

## Real Project Safety

真实项目文件未被写入：

```text
workspace/ming-ding-zhi-shi-2/simulation/subjects/player/events.jsonl
SHA256 FC2A9C2664112E600DDF7F95CFCE19F84BC02CFD5FF23BCA5C2FE5515FD6D718
```

该 hash 与 Round 400 / Round 401 记录一致。

## Cleanup

尝试通过正式删除 API 清理临时 Project：

```text
DELETE /api/projects/item?projectPath=workspace%2Fworld-engine-round-403-acceptance
```

实际结果：

- 请求 30 秒超时。
- Project 已从 `/api/projects` 列表消失。
- 目录下仍残留 `workspace/world-engine-round-403-acceptance/.nbook`。

随后停止本轮启动的 dev server，确认 `port 3001 free`，并在解析绝对路径后只删除精确临时目录：

```text
C:\Users\notnotype\Documents\CodeRepository\GithubProjects\neuro-book\workspace\world-engine-round-403-acceptance
```

最终：

- 临时 Project 目录已删除。
- `port 3001 free`。

## Actual Result Vs Plan

- 计划中的 `appended / already-exists / 已追加按钮` 三条核心分支均已通过真实浏览器验收。
- 没有写入 `ming-ding-zhi-shi-2` 真实六文件。
- 临时 fixture 的 `memory.jsonl` 写成了 `{text,tags}`，而当前 RAG memory parser 期望 `topic` 等字段，因此 overview 中出现 memory source 格式提示；它不影响本轮 `events.jsonl` commit 验收，但说明临时 fixture 不是完整 subject memory 示例。
- Project 删除 API 在打开过真实 Workbench 的临时 Project 上出现超时和目录残留；本轮已安全清理，但后续如果要把临时验收做成常规流程，应该单独排查 Project delete 在活跃 Project SQLite / `.nbook` 残留下的行为。

## Follow-ups

- 单条 `events.jsonl` commit 的真实临时 Project 闭环已补齐；除非用户明确授权目标行，不需要再对 `ming-ding-zhi-shi-2` 执行确认写入。
- 若继续推进主体六文件桥接，下一步应讨论 `memory.jsonl` / `state.md` 的显式 commit 设计，而不是扩大自动写入范围。
