# Round 242: Composer 在过滤视角下参考已知全局时间

继续检查“选中 subject timeline 后推演下一条切片”的写入路径。World Engine 的 `instant` 是全局唯一，但主 Workbench 在 subject 过滤后会把 `slices` 替换成该 subject 的局部 timeline。此前 Slice Composer 的 `usedTimes` 直接来自当前 `slices`，因此在 subject 视角下默认下一时间只会避开当前 subject 的切片时间，可能忽略整体世界最近窗口中其它 subject 已占用的时间。

后端仍会用唯一 instant 拦住冲突，但作者会在提交后才看到 409。这个默认值体验不够像“推演整体世界下一步”。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `knownSliceTimes` 会话态缓存。
  - 完整 `loadWorld()` 后用完整 timeline 窗口重置 `knownSliceTimes`。
  - subject 过滤刷新 timeline 后，把局部切片时间并入 `knownSliceTimes`。
  - Review Queue 懒加载单个 issue slice 后，把该切片时间并入 `knownSliceTimes`。
  - Slice Composer 的 `usedTimes` 改为 `knownSliceTimes + 当前可见 slices` 的去重并集。
  - Project 切换、加载失败和关闭 Dialog 时清空缓存。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认完整加载 replace、局部加载 merge、懒加载 merge，以及 Composer 使用并集。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是检查 Composer 时间默认值和重复时间提示。实际没有改后端唯一 instant 规则，也没有额外请求全量 timeline；只在前端会话态保留“已知切片时间窗口”，让过滤视角下的默认下一时间更接近整体世界。
