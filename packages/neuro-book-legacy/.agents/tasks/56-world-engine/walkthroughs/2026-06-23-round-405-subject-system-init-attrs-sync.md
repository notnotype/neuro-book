# Round 405 - Subject System Init Attrs Sync

## Goal

补齐真实作者流里“同步主体系统”与 World Engine state 的拼接缺口：当 Project schema 已声明主体系统映射字段时，同步 `simulation/subjects` 主体不应只注册 World Engine subject 身份，还应把路径、六文件拓扑、RAG source 和计数这类轻量元数据写进初始化切面。

## Problem

`ming-ding-zhi-shi-2/world-engine/schema.yaml` 的 `character` type 已声明：

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

但主 Workbench 的“同步主体系统”之前只调用：

```ts
POST /api/projects/world-engine/subjects
{ id, type, name, time }
```

结果是 UI 可以继续靠 `/api/projects/rag/overview` 展示主体系统摘要，但 World Engine state / Agent state query 不一定能看到这组映射字段。对作者来说，这会造成一个割裂：左栏显示主体六文件已接入，状态查询里却缺少对应路径和文件拓扑。

## Change

### Backend / API

`POST /api/projects/world-engine/subjects` 新增可选 `attrs`：

```json
{
  "id": "player",
  "type": "character",
  "name": "薇洛丝",
  "time": "复兴纪元488年 1月15日 14:00:00",
  "attrs": {
    "sourcePath": "simulation/subjects/player",
    "subjectFiles": {
      "subject": "simulation/subjects/player/subject.md",
      "events": "simulation/subjects/player/events.jsonl"
    }
  }
}
```

`WorldEngineService.createSubject()` 现在会把 schema defaults 和显式 `attrs` 合并成同一个 `init` slice：

- 显式 `attrs` 会覆盖同名 default。
- 初始化 attrs 必须是 schema 已声明属性。
- 初始化 value 复用现有 mutation value 校验。
- 仍不复制或改写 `simulation/subjects` 六文件正文。

### Workbench

主 Workbench 同步待接入主体时，会从 RAG overview 构造主体系统初始化 attrs：

- 路径类字段：`sourcePath`、`actorImportPath`、`leaderOnlyPath`、`directStatePath`
- 元信息字段：`legacyKind`、`controlledBy`、`profile`、`canonicalSource`
- 文件拓扑：`subjectFiles`
- RAG source：`ragIndexSources`
- 计数字段：`eventCount`、`memoryCount`
- 版本标记：`subjectSystemVersion`

同时为了不破坏通用默认 schema，Workbench 只会发送当前 subject type schema 已声明的字段。默认模板没有这些字段时，同步行为仍是“只注册身份”。

## Verification

目标测试通过：

```bash
bunx vitest run server/api/projects/world-engine/[...segments].test.ts
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：

```text
server/api/projects/world-engine/[...segments].test.ts: 1 file / 42 tests passed
app/utils/world-engine-ide-entry.test.ts: 1 file / 3 tests passed
```

全量 typecheck 已尝试：

```bash
bun run typecheck
```

结果仍失败在既有无关问题：

```text
server/agent/tools/control-tools.test.ts
Property 'form' does not exist on type 'UserInputFormSpec | Promise<UserInputFormSpec | null>'
Property 'text' does not exist on type 'ImageContent | TextContent'
```

本轮未修改 Agent control tools。

只读检查真实项目：

```text
workspace/ming-ding-zhi-shi-2 / player
```

`queryState(subjectIds=["player"], attrs=["sourcePath","subjectFiles","eventCount","memoryCount","ragIndexSources"])` 已能看到：

- `sourcePath = simulation/subjects/player`
- `subjectFiles.subject/events/memory/mind/state/soul`
- `eventCount = 7`
- `memoryCount = 7`
- `ragIndexSources.events/memory`

说明真实 `ming-ding-zhi-shi-2` 当前不需要补迁移；本轮修的是后续同步路径不再丢失这些 attrs。

## Actual Result Vs Plan

- 没有执行浏览器验收；这是同步请求体和 API 初始化语义的小闭环，目标测试与真实项目只读查询足够。
- 没有写入 `ming-ding-zhi-shi-2` 六文件。
- 没有自动 backfill 已存在 World Engine subject；只读检查显示 `ming-ding-zhi-shi-2/player` 已有映射 attrs，暂不需要引入额外迁移入口。

## Follow-ups

- 如果未来发现旧 Project 里已有 World Engine subject 但缺少主体系统映射 attrs，再设计显式“刷新主体系统元数据”动作，不要在 Workbench 打开时静默改写。
- 下一步作者流仍应聚焦 `memory.jsonl` / `state.md` 是否需要显式 commit 的产品决策，或继续验收“新 Project -> schema -> 同步主体 -> 连续推演”的完整浏览器路径。
