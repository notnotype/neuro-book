# Round 201：Timeline slice 操作按钮可见化

## 背景

Round 198 的 P0 真实驾驶测试发现：同 instant 禁止后，“编辑已有 slice”已经是作者合并同一时间点事件的主路径，但 Preview 和主 Workbench 的 Timeline 操作按钮仍是纯图标。作者不悬停时，很难知道哪个按钮是编辑、哪个按钮是删除。

本轮只修这个真实驾驶暴露的发现性问题，不改后端契约，不做新校验，不启动分叉迁移。

## 变更

- `app/components/novel-ide/world-engine/WorldEnginePreviewStatePanel.vue`
  - Preview Timeline 的“载入编辑”和“删除 slice”按钮从纯图标改为 icon + 可见文字。
  - 增加 `aria-label="载入编辑 slice"` 与 `aria-label="删除 slice"`。

- `app/components/novel-ide/world-engine/WorldEngineTimeline.vue`
  - 主 Workbench Timeline 的“编辑 slice”按钮从纯图标改为 icon + “编辑”文字。
  - 增加 `aria-label="编辑 slice"`。

- `app/components/novel-ide/world-engine/WorldEngineSliceInspector.vue`
  - Selected Slice 检查器的“删除 slice”按钮从纯图标改为 icon + “删除”文字。
  - 增加 `aria-label="删除 slice"`。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，防止这些关键动作退回纯图标。

## 验证

已通过：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：1 个测试文件通过，1 条测试通过。

未通过：

```powershell
bun run typecheck
```

失败位置不在本轮修改文件：

```text
app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue(1090,99):
Property 'mutationContextBeforeValue' does not exist

app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue(1094,94):
Property 'mutationContextAfterValue' does not exist
```

本轮没有顺手修该 mock workbench preview 类型错误，因为它不属于 round-198 P0 清单里“真实 Preview / Workbench 首轮写作”的阻塞问题，也不在本轮改动面内。

## 与计划出入

- 原计划修 Preview Timeline 的编辑 / 删除发现性；实现时一并修了主 Workbench Timeline 编辑按钮和 Selected Slice 删除按钮，因为它们属于同一作者路径。
- 没有做浏览器自动验收。按项目约束，浏览器验证需要用户明确允许。

## 后续

P1 剩余主要问题：

- Project 列表污染 / 加载慢。
- 若用户允许，可复跑浏览器真实链路，确认 round-199 / 200 / 201 的交互实际可见。
