# Round 373 - Pre Browser Static Acceptance Audit

## 背景

Round 363 / 370 已固化真实作者流浏览器验收清单，Round 371 / 372 已确认 `ming-ding-zhi-shi-2 / 命定之诗2` 的磁盘与 Project SQLite 起点。本轮继续做浏览器验收前的静态审查：只核对当前代码和窄测试证据，不自动跑浏览器。

## 本轮目标

- 对照验收清单核对当前 Workbench / Preview 关键入口。
- 只运行 World Engine 相关的窄测试。
- 修正静态审查中发现的文档偏差。
- 不修改业务代码，不执行浏览器验收。

## 静态核对结果

已在当前代码中确认这些验收入口存在：

- 真实 Workbench 调用 `/api/projects/world-engine/schema`、`subjects`、`slices`、`state/query`、`state`。
- 主 Workbench 存在 `syncPendingSubjectSystemSubjects()` 同步主体系统入口。
- 主 Workbench / mock preview 都支持 `openInspectorPanel("subject-file-proposals")`。
- Timeline slice list 的 `files N` 入口会调用 `props.openInspectorPanel("subject-file-proposals")`。
- Inspector 存在 `Subject file proposals`、复制单个 proposal、复制全部、复制 `events.jsonl` 行、复制 `memory.jsonl` 候选行、复制 `state.md` 审查提示。
- 主体文件建议复制失败路径会提示 `复制失败，请手动选择文本后复制。`。
- 独立 Preview 仍覆盖 `writeSlice`、`deleteSlice`、`queryState` 和 `state/query` 调试入口。

## 修正的偏差

Round 372 初稿把 `sample-npc` 写成待接入主体验收点。静态核对发现这是错误的：

- `app/utils/world-engine-workbench-real.ts` 有 `ignoredSubjectSystemIds = new Set(["sample-npc"])`。
- `visibleRagSubjects()` 会过滤掉 `sample-npc`。
- `app/utils/world-engine-ide-entry.test.ts` 已断言 overview 里出现 `sample-npc` 时，合并后的 subjects / subject system summaries 仍不会包含它。

因此已修正文档：`sample-npc` 是被 Workbench 显式忽略的示例主体，不能作为待接入主体路径验收点。若后续要验收 pending subject，需要使用真实未注册主体目录，或在验收前创建一个非示例 subject。

## 验证

运行：

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-preview.test.ts
```

结果：

- 3 files passed。
- 28 tests passed。

本轮没有运行全量 typecheck，因为目标是浏览器验收前的 World Engine 窄证据，且全量 typecheck 最近已知会被无关测试类型漂移阻塞。

## 与计划出入

- 没有自动执行浏览器验收；仍需用户明确允许后才能跑真实 UI。
- 没有新增代码测试，只运行现有相关测试。
- 本轮实际发现并修正文档偏差，这比继续补实现更重要：浏览器验收不能按错误的 `sample-npc` 待接入假设执行。
