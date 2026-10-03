# Round 394 - Proposal Landing Hints

## Context

Round 390 已经补了 `复制并打开`，Round 393 又避免 `[验收]` 内部标记污染 `events.jsonl` 候选。继续从作者视角看，新的卡点不在 proposal 是否生成，而在作者打开目标文件后是否知道“这段文本应该怎么落地”：

- `events.jsonl` 候选应该确认后追加到文件末尾。
- `memory.jsonl` 候选应该确认是追加新行，还是按 `topic` 改写已有行。
- `state.md` 是审查提示，不应该把提示文本原样塞进正文，而是按提示检查对应区块。

## Scope

- 只调整 `Subject file proposals` 的可见提示、按钮 title 和复制成功提示。
- 不新增自动写 `simulation/subjects`。
- 不改 Project SQLite，不改 `simulation/subjects` 六文件。
- 不扩大内部标记清理范围。

## Implementation

- `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue`
  - `events.jsonl` 的 `复制并打开` title / 成功提示改为“确认后追加到文件末尾”。
  - `events.jsonl` 的 review 提示改为“确认后追加到 events.jsonl 末尾”。
  - `memory.jsonl` 的 `复制并打开` title / 成功提示改为“追加新行或按 topic 改写”。
  - `memory.jsonl` 的 review 提示改为“确认追加新行，还是按 topic 改写已有行”。
  - `state.md` 的 `复制并打开` title / 成功提示改为“打开后检查对应区块”。
- `app/utils/world-engine-ide-entry.test.ts`
  - 更新真实 Workbench 入口契约断言。
- `app/utils/world-engine-workbench-preview.test.ts`
  - 更新 mock Workbench Inspector 契约断言。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件，9 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

浏览器步骤：

1. 启动临时 `bunx nuxt dev --port 3001`。
2. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
3. 打开顶部 `World`。
4. 点击 `薇洛丝` 的 `语境`。
5. 确认三条 `[验收]` event slice 显示 `files 1`。
6. 点击第一条 `files 1`，读取右侧 `Subject file proposals`。

实际结果：

- `events.jsonl draft` 可见，JSONL 文本不含 `[验收]`。
- `events.jsonl` review 提示包含：`确认后追加到 events.jsonl 末尾`。
- `复制 events.jsonl 行并打开文件` 按钮 title 包含：`确认后追加到文件末尾`。
- `state.md review` 可见。
- `复制 state.md 审查提示并打开文件` 按钮 title 包含：`打开后检查对应区块`。
- 当前真实 slice 没有 memory 候选，因此 `memory.jsonl` 的浏览器可见路径未触发；该部分由静态契约测试覆盖。
- 本轮没有保存、删除或写 Project SQLite，也没有修改 `simulation/subjects` 六文件。
- 临时 dev server 已关闭，确认 `port 3001 free`。

## Actual vs Plan

- 计划：从“打开目标文件后如何落地”这个作者流卡点补最小提示，不做自动写入。
- 实际：静态测试覆盖三类目标文件提示；真实浏览器确认 event / state 两条常见路径可见。
- 与计划出入：真实 Project 当前没有命中 memory proposal 的可见切片，因此 memory 路径没有做浏览器实测，只保留静态契约证据。

## Follow-up

- 继续观察作者是否还需要更强的编辑器内落位能力，例如“追加到文件末尾”的显式 commit。进入那一步前需要重新决策 P1，不要在 P0 suggestion surface 里偷偷自动写六文件。
