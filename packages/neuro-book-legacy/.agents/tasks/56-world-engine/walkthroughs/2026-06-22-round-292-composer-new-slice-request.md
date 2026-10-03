# Round 292 - Composer New Slice Request

## 背景

继续按作者真实使用路径检查主 IDE Workbench 时，发现一个顶栏动作和 Composer 内部状态不一致的问题：

作者如果已经打开 Slice Composer 并处于“编辑已有 slice”模式，再从顶栏点击 `新建 Slice`，父 Workbench 只会确保 overlay 可见。因为 overlay 已经打开，子编辑器不会收到任何“切回新建模式”的请求，界面仍停在旧 slice 的整块编辑状态。

这会让作者以为要写下一条新 slice，实际还在准备替换旧 slice。

## 实际变更

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `sliceComposerNewKey`。
  - 顶栏 `新建 Slice` 在 Composer 已经打开时递增该 key。
  - 把 `newSliceKey` 传给 `WorldEngineMutationEditor`。
  - 切换 Project / 重置 Workbench 会清空该 key。

- `WorldEngineMutationEditor.vue`
  - 新增 `newSliceKey` prop。
  - 监听该 prop，并复用现有 `clearEditMode()` 切回新建模式。
  - 继续沿用已有未保存草稿确认；如果当前编辑器有草稿，用户取消确认时不会丢内容。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，防止顶栏 `新建 Slice` 再退化为只打开 Composer overlay。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有拆分 Composer shell/composable，也没有重构 Workbench 容器。
- 本轮只修正顶栏新建入口与已打开 Composer 编辑态之间的状态对齐。
