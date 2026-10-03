# Round 396 - Subject Context Visibility

## Summary

本轮继续从真实作者流检查 `World Engine slice -> simulation/subjects 六文件建议` 的 P0 路径。

目标问题不是继续补低频边界，而是确认作者写完 / 回看 slice 后，能不能清楚地知道当前是否已经设置了主体文件建议语境，以及下一步是否能看到 `files N` 和 `Subject file proposals`。

## Browser Finding

验收对象：

- Project：`workspace/ming-ding-zhi-shi-2`
- URL：`http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`
- 入口：主 IDE 顶部 `World`

真实浏览器观察到：

- Workbench 初始选中最新 `[验收]` world event slice。
- 左栏显示 `清语境`，但没有任何 subject 卡显示 `语境中`。
- 中间三条 `[验收]` event slice 没有 `files 1`。
- 右侧没有 `Subject file proposals`。
- 显式点击 `薇洛丝 -> 语境` 后，`语境中`、三条 `files 1`、右侧 `Subject file proposals`、`复制并打开` 和 `确认后追加到 events.jsonl 末尾` 都正常出现。

根因：`focusedSubjectId` 同时承担当前切片焦点 / Composer 默认 subject / 主体文件建议语境。选中 `world.events` slice 时，`focusedSubjectId` 会回落为 `world`；左栏 `清语境` 只检查 `focusedSubjectId` 是否非空，所以把 `world` 显示成“主体文件建议语境”，但 `world` 不是 `simulation/subjects` 主体系统 subject，无法生成角色六文件 proposal。

## Change

改动文件：

- `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue`
- `app/utils/world-engine-ide-entry.test.ts`
- `app/utils/world-engine-workbench-preview.test.ts`

实现：

- 新增 `activeSubjectContextId`，只有 `focusedSubjectId` 存在于 `subjectSystemSummaries` 时才视为有效主体文件建议语境。
- 左栏 `清语境` 只在 `activeSubjectContextId` 非空时显示。
- subject 卡的 `语境中`、高亮、`aria-pressed` 和 title 都改用 `activeSubjectContextId`。
- 不改变 `focusedSubjectId` 本身，避免影响 Composer 默认 subject、切片焦点和现有状态快照逻辑。

## Verification

已通过：

```text
bunx vitest run app/utils/world-engine-workbench-preview.test.ts
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：

- 2 个文件 / 9 条测试通过。

真实浏览器复验：

- 刷新主 IDE 后重新打开 Workbench，初始状态 `clearContextCount = 0`、`contextActiveCount = 0`。
- 点击 `薇洛丝 -> 语境` 后，`clearContextCount = 1`、`contextActiveCount = 1`、`filesButtonCount = 4`，可见 `Subject file proposals`、`复制并打开` 与 `确认后追加到 events.jsonl 末尾`。
- 本轮没有保存、删除或写 Project SQLite，也没有修改 `simulation/subjects` 六文件。

`bun run typecheck` 结果：

- 失败于既有无关 `server/agent/tools/control-tools.test.ts` 类型漂移：`UserInputFormSpec | Promise<UserInputFormSpec | null>` 上直接访问 `.form`，以及 `ImageContent | TextContent` 上直接访问 `.text`。
- 本轮未修无关 Agent control tools 测试。

## Result

P0 suggestion surface 的一个真实可见错位已收口：作者不会再看到“清语境”却没有任何主体处于 `语境中` 的状态。

剩余产品问题仍是更大的 P1：建议面只生成可复制文本，不自动 commit 到六文件。若作者仍卡在“打开文件后如何真正落地”，下一步应讨论显式 commit / 追加六文件设计，而不是继续堆更多提示文案。
