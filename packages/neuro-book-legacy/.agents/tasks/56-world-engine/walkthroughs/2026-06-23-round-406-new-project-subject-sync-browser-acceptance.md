# Round 406 - New Project Subject Sync Browser Acceptance

## Goal

按更接近作者视角的路径，用临时 Project 浏览器验收 World Engine 从新 Project 到主体同步、连续推演和常用删除操作的闭环：

1. 在 Preview 中新建 Project。
2. 写入命定之诗式 `world-engine/schema.yaml` / `calendar.yaml` 和最小 `simulation/subjects` 六文件 fixture。
3. 在主 IDE 打开 World Engine Workbench。
4. 同步待接入主体。
5. 写入连续 slice，并观察主体文件建议和状态快照。
6. 删除一条 slice，确认状态回退。
7. 清理临时 Project。

## Setup

开发服务：

```bash
bun run dev -- --port 3001 --host 127.0.0.1
```

Preview 新建临时 Project：

```text
title: world-engine-round-406-browser-flow-1782182394477
projectPath: workspace/world-engine-round-406-browser-flow-1782182394477
```

随后通过应用 `workspace-files/write` API 写入 fixture：

- `world-engine/schema.yaml`
- `world-engine/calendar.yaml`
- `simulation/subjects/player/subject.md`
- `simulation/subjects/player/soul.md`
- `simulation/subjects/player/mind.md`
- `simulation/subjects/player/state.md`
- `simulation/subjects/player/events.jsonl`
- `simulation/subjects/player/memory.jsonl`

schema 采用命定之诗式最小主体系统映射字段：

- `sourcePath`
- `legacyKind`
- `controlledBy`
- `profile`
- `canonicalSource`
- `subjectFiles`
- `actorImportPath`
- `leaderOnlyPath`
- `directStatePath`
- `ragIndexSources`
- `eventCount`
- `memoryCount`
- `subjectSystemVersion`

## Browser Acceptance

### 1. Project 创建与配置入口

`/world-engine.preview` 中点击 `新建 Project` 后：

- Project select 选中 `world-engine-round-406-browser-flow-1782182394477`。
- 页面显示 `workspace/world-engine-round-406-browser-flow-1782182394477`。
- 初始状态为 `0 subjects · 0 slices`。
- Schema 区展示 `world-engine/schema.yaml` / `world-engine/calendar.yaml` 配置入口。

### 2. 主 IDE Workbench 同步主体系统

打开：

```text
http://127.0.0.1:3001/?project=workspace%2Fworld-engine-round-406-browser-flow-1782182394477
```

点击顶部 `World` 后，Workbench 显示：

- `主体系统待接入`
- `1 个 simulation/subjects 主体还没有 World Engine subject 身份。`
- subject card：`验收主角 / player / 待接入 / 1 events / 1 memory`
- 初始化时间：`复兴纪元1年 1月1日 00:00:00`

点击左侧同步面板的 `同步主体系统` 后：

- notice：`已接入 1 个主体系统 subject。`
- 待接入面板消失。
- timeline 出现 `init` slice：`创建 验收主角`。
- init slice 中显示 `15 mutations`，包括：
  - `hp set 100`
  - `maxHp set 100`
  - `eventCount set 1`
  - `memoryCount set 1`
  - `actorImportPath set simulation/subjects/player/soul.md`
  - `canonicalSource set reference/round-406.md`
- Inspector State Snapshot 展示：
  - `sourcePath = simulation/subjects/player`
  - `subjectFiles.subject/soul/mind/state/events/memory`
  - `ragIndexSources.events/memory`
  - `subjectSystemVersion = simulation-subjects-overview`

这验证 Round 405 的 `attrs` 初始化路径在真实 Workbench 同步中生效。

### 3. 连续推演 slice

打开 `新建 Slice` 后，第一次尝试写：

```json
[
  {"subjectId":"world","attr":"events","op":"listAppend","value":"验收主角发现门缝透出稳定的光。"},
  {"subjectId":"player","attr":"location","op":"set","value":"临时验收大厅门口"}
]
```

结果返回：

```text
subject 不存在：world
```

原因：本临时 Project schema 声明了 `world` type，但当前只同步了 `player`，还没有创建 `world` subject。该问题不影响后续 player-only 推演，但暴露了新 Project 作者流里的一个真实卡点：schema 有 world shortcuts，不等于 Project 已有 world subject。

随后改为 player-only 第一条 slice：

```json
[
  {"subjectId":"player","attr":"location","op":"set","value":"临时验收大厅门口"}
]
```

填写：

- time: `复兴纪元488年 1月15日 14:00:01`
- title: `[浏览器验收] 主角发现门缝透光`
- summary: `验收主角发现门缝透出稳定的光，决定先保持安静观察。`

点击 `写入并继续下一步` 后：

- notice：`已写入 slice ...，已准备下一步草稿 可在右侧 Inspector 查看 1 个主体文件建议。`
- Composer 下一条 time 自动推进到 `复兴纪元488年 1月15日 14:00:02`。
- timeline 中第一条 event slice 显示 `files 1`。

第二条 slice：

```json
[
  {"subjectId":"player","attr":"hp","op":"add","value":-5}
]
```

填写：

- title: `[浏览器验收] 主角被光刺痛`
- summary: `门缝光线短暂增强，验收主角感到刺痛但仍保持行动能力。`

点击 `写入 Slice` 后：

- timeline 变为 `3 / 3`。
- kind 统计：`init 1 / event 2`。
- 第二条 event slice 显示 `files 1`。
- Inspector `Subject file proposals` 显示：
  - `events.jsonl draft`
  - `追加`
  - `state.md review`
  - `检查 state.md「资源」：player.hp add = -5`
- State Snapshot 显示：
  - `hp : 95`
  - `location : 临时验收大厅门口`
  - 主体系统映射 attrs 仍存在。

### 4. 删除 slice

点击顶部 `删除 Slice` 后，应用内确认框显示：

```text
删除 World Engine Slice
确定要删除 slice「[浏览器验收] 主角被光刺痛」吗？此操作不可恢复。
```

点击 `确定` 后：

- Dialog 消失。
- notice：`已删除 slice ...`
- timeline 回到 `2 / 2`。
- 第二条 title 不再出现。
- 第一条 `[浏览器验收] 主角发现门缝透光` 仍保留。
- State Snapshot 回到 `hp : 100`，保留 `location : 临时验收大厅门口`。

## Cleanup

关闭浏览器 tab 后，通过正式删除 API 清理临时 Project：

```text
DELETE /api/projects/item?projectPath=workspace%2Fworld-engine-round-406-browser-flow-1782182394477
```

实际结果：

- 客户端 45 秒超时。
- 约 5 秒后复查目录已不存在。
- `/api/projects` 仍可响应。

最终状态：

- `workspace/world-engine-round-406-browser-flow-1782182394477` 不存在。
- `port 3001` 已关闭。
- 真实 `ming-ding-zhi-shi-2/simulation/subjects/player/events.jsonl` SHA256 仍为：

```text
FC2A9C2664112E600DDF7F95CFCE19F84BC02CFD5FF23BCA5C2FE5515FD6D718
```

## Actual Result Vs Plan

- 计划覆盖的新 Project、schema 配置、主体同步、连续推演、主体文件建议、状态快照和删除操作均已完成。
- 没有对真实 `ming-ding-zhi-shi-2` 六文件执行确认写入。
- fixture 写入通过应用 `workspace-files/write` API 完成，不是浏览器里手动逐字编辑 schema；本轮重点是 Workbench 拼接和推演闭环。
- 删除 API 虽然最终删除成功，但客户端仍会超时；Round 404 释放 World Engine client 后，仍存在“响应时间过长或其它句柄释放慢”的清理体验问题。

## Findings

1. 新 Project 如果 schema 声明 `world` type 但尚未创建 `world` subject，用户写 `world.events` 会得到 `subject 不存在：world`。当前 Workbench 会展示 world schema shortcuts，但主体下拉里没有 world subject；这容易让作者误以为可以直接写 world 事件。后续应决定：默认创建 `world` subject、同步主体系统时顺手补 world、还是在 schema shortcuts / Composer 中明确提示“该 type 尚无 subject”。
2. Project delete API 在打开过主 IDE / Workbench 的临时 Project 上仍可能客户端超时。目录最终消失，说明后端有完成清理，但响应时长不可接受；后续如果要频繁做浏览器验收，应继续定位删除流程慢点。
