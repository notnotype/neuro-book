# Round 274: Composer Saving Form Guard

## Context

继续从“作者连续推演几步 slice”的正门审查 Slice Composer。`写入并继续下一步` 的下一条默认 mutation 已经会按刚保存 slice 的最后一个 subject 重新生成，不会原样复写上一条 mutations。

真正的高概率卡点在保存请求飞行中：表单字段、mutations textarea 和右侧 Mutation Builder 仍可继续编辑。慢请求下，作者可能在请求尚未返回时输入下一步内容；请求成功后组件会重置/标记 clean，这些输入可能被覆盖或被误认为已同步。

## Changes

- `WorldEngineSliceDraftForm.vue`
  - 保存中禁用 `time / title / kind / summary / mutations` 输入，避免请求飞行中继续改当前提交表单。

- `WorldEngineMutationBuilder.vue`
  - 新增 `disabled?: boolean`。
  - 用原生 `fieldset disabled` 包住 Builder 控件、mutation 载入/移动按钮、object value 编辑器和 mutation 动作按钮。

- `WorldEngineMutationEditor.vue`
  - 保存中向 Builder 传 `:disabled="saving"`。
  - `addBuilderMutation()`、`insertAfterSelectedBuilderMutation()`、`duplicateSelectedBuilderMutation()`、`replaceSelectedBuilderMutation()`、`deleteSelectedBuilderMutation()`、`moveSelectedBuilderMutation()`、`loadMutationToBuilder()`、`updateBuilderField()`、`updateMutationLoadIndex()`、`addObjectBuilderRow()`、`removeObjectBuilderRow()`、`updateObjectBuilderRow()` 在 `saving` 时直接返回。

- `world-engine-ide-entry.test.ts`
  - 补充保存中表单禁用、Builder disabled、Builder 事件 guard 的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续人工或授权验收可覆盖：点击 `写入 Slice` 或 `写入并继续下一步` 后，在请求未完成时表单和 Builder 不可继续编辑；请求成功并进入下一条草稿后恢复输入。

## Result

本轮原计划是审查连续推演链路。实际确认默认下一步 mutation 逻辑已存在，因此没有改默认生成策略；只修复保存请求飞行中仍可编辑旧表单/Builder 的问题。
