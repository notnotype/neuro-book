# Round 390 - Copy And Open Subject File Proposal

## Context

Round 382 已确认主体文件建议可以复制 JSONL 行，也可以打开 `events.jsonl / state.md`。继续从作者真实流程看，仍有一个顺序坑：

- 如果作者先点 `打开 events.jsonl`，Workbench 会离开当前 proposal 上下文。
- 如果这时还没有复制 JSONL 行，作者需要重新打开 World Engine、重新定位 slice、重新找到 proposal。

这不是异常输入，而是作者很容易踩到的操作顺序问题。本轮补一个最小闭环：在 proposal 里增加“复制并打开”，先把待粘贴内容放进剪贴板，再打开目标文件。

## Scope

- 主体文件建议的 `events.jsonl draft` 增加 `复制并打开`。
- `memory facts` 存在时增加 `复制并打开`。
- `state.md review` 增加 `复制并打开`。
- 复制失败时不打开目标文件，避免作者进入文件页后发现没有可粘贴内容。
- Workbench 打开目标文件的事件顺序改为先关闭 Workbench，再请求父层打开 Project Workspace 文件，避免底层文件已打开但 Workbench 仍挡在前面。

## Implementation

- `WorldEngineWorkbenchPreviewInspector.vue`
  - `copySubjectFileProposalText()` 改为返回 `Promise<boolean>`。
  - 新增 `copySubjectFileProposalTextAndOpen()`。
  - 组合动作在 `busy` 或目标 path 为空时会直接提示并停止，不复制、不打开。
  - 三个建议区块新增 `复制并打开` 按钮。
- `WorldEngineWorkbenchDialog.vue`
  - `openWorkspacePathFromWorkbench()` 改为：
    - `emit("update:modelValue", false)`
    - `await nextTick()`
    - `emit("openWorkspacePath", targetPath)`
- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 固定组合动作、复制失败不继续打开的结构，以及关闭 Workbench 后再 open path 的顺序。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件，9 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

浏览器步骤：

1. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
2. 打开顶部 `World`。
3. 关闭上轮残留的 Slice Composer，避免挡住 timeline。
4. 点击 init slice 的 `files 6`。
5. 确认右侧 Inspector 的 `Subject file proposals` 内出现：
   - `events.jsonl draft`
   - `复制行`
   - `复制并打开`
   - `state.md review`
   - `复制提示`
   - `复制并打开`

实际结果：

- 新按钮在真实页面中可见。
- 使用 in-app browser 自动化点击 `复制并打开` 时，页面的 `navigator.clipboard.writeText()` 被当前自动化环境拒绝，出现复制失败反馈。
- 复制失败时没有打开目标文件，Workbench 仍留在当前 proposal 上下文；这符合本轮保护策略。
- 成功复制后打开文件的完整路径未能在当前自动化环境中证明；该路径由静态测试约束为“复制成功才 open”，并且 Workbench 子组件会先关闭再 emit `openWorkspacePath`。

本轮没有保存、删除或写入 Project SQLite，也没有修改 `simulation/subjects` 六文件。

## Actual vs Plan

- 计划：补一个“复制并打开”动作，让作者不用记住先复制后打开。
- 实际：组合动作已实现并用静态测试固定；真实页面可见按钮，且复制失败时不会打开文件。
- 与计划出入：当前 in-app browser 自动化无法给页面 `navigator.clipboard.writeText()` 提供可用剪贴板权限，因此无法完整验收成功路径。这个限制来自浏览器自动化环境，不是业务代码直接报错。

## Follow-up

- 后续若要完整验收成功路径，可以用可见浏览器人工点击一次 `复制并打开`，或在浏览器工具支持剪贴板权限后重跑。
- 继续观察六文件人工处理链路：复制并打开后，作者是否还需要更明确的“粘贴到末尾 / 审查 state.md 区块”指导。
