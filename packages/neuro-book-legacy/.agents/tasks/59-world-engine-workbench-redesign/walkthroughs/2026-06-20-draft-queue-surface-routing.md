# 2026-06-20 Draft Queue Surface Routing

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮 `Draft Queue` 已能定位草稿 slice，但处理草稿的实际入口仍可能藏在右侧 Inspector 或底部 Mutation Editor 中。
- 本轮让 `Draft Queue` 在点击草稿项时同时打开对应处理面板：metadata draft 打开 Inspector，value draft 展开 Mutation Editor。

## Changes

- `WorldEngineWorkbenchPreviewSliceList`
  - 新增 command props：
    - `openDraftInspector`
    - `expandDraftEditor`
  - `focusDraftQueueItem()` 保持原有行为：清空会遮挡目标的局部过滤、切到 `status=draft`、选中 slice。
  - 当队列项有 metadata draft 时调用 `openDraftInspector()`。
  - 当队列项有 value draft 时调用 `expandDraftEditor()`。
- `world-engine.workbench-preview`
  - 新增 `openInspectorPanel()` 与 `expandMutationEditorPanel()`。
  - 将两个命令函数传给 Slice List。
  - 保留 `openDraftSurfacesForSlice()` 作为 draft filter 下选择草稿 slice 的补充编排点。
- `world-engine-workbench-preview.test.ts`
  - 补充 Draft Queue 到处理面板的静态契约断言。

## Implementation Note

- 初版尝试用 `open-inspector` / `expand-mutation-editor` 自定义事件从 Slice List 通知页面。
- 浏览器验证时，队列项点击能切到 `status=draft`，但 Inspector 没有稳定打开；为避免把事件名匹配问题留成隐性风险，本轮改为 command props。
- 这是一次实现偏移，但目标没有变化：让 Draft Queue 从“只定位草稿”变成“定位并打开处理面板”。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - value draft 路径已验证：
    - 展开 Mutation Editor，修改当前 slice 的 value 生成 value draft。
    - 收起 Mutation Editor。
    - 点击 Draft Queue 中的 `value 1` 队列项。
    - 页面进入 `status drafts`，Mutation Editor 自动展开，dirty 状态保留。
    - 浏览器日志无 warning / error。
    - 验证后执行 `重置 mock`，队列清空。
  - metadata draft 路径的隐藏 Inspector 自动打开未能完整自动验证：
    - 自动化中 `关闭检查器` / 顶部 `Inspector` 控件没有稳定切换右栏隐藏状态。
    - 已验证 metadata 队列项能进入 `status drafts`，并且 metadata diff 在 Inspector 中可用。
    - 该路径的打开行为由 command prop、typecheck 和静态契约测试覆盖；后续可在人工浏览器验收或更稳定的浏览器控制下复验。

## UI/UX Notes

- Draft Queue 现在更接近“任务入口”：点草稿不只把用户带到 slice，也把处理该草稿的面板打开。
- metadata 和 value 同时存在时，队列项会同时打开右侧 Inspector 与底部 Mutation Editor，让两个处理点都可见。
- 保留主画布 `status=draft` 过滤，是为了让用户处理完一个草稿后仍停留在草稿队列上下文中。
