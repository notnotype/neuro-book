# Round 256: Save Edit Keeps Slice Visible

## Context

继续按作者真实使用路径检查主 IDE Workbench 后，发现一个常用编辑卡点：

- Slice Composer 写入新 slice 后，已有逻辑会判断本次 mutations 是否命中当前 subject 过滤；不命中时自动回到整体世界视角。
- 但 Inspector metadata 保存、底部 mutation value 保存都走 `editSlice`，保存后会刷新 timeline。
- 如果用户当时开着 `kind / status / search / subject` 过滤，而保存后的 slice 不再命中过滤，`SliceList` watcher 会自动选择第一个可见 slice。
- 结果是作者刚保存当前 slice，就被主画布跳到别的 slice，容易误以为保存丢失或上下文串线。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 引入现有 `world-engine-workbench-preview-filter.ts` 的 subject / kind / keyword 匹配 helper。
  - 新增 `clearFiltersIfSavedEditWouldBeHidden(editedSlice)`。
  - `saveSliceEdit()` 成功后、刷新 timeline 前，先用保存后的 slice 形态检查当前过滤：
    - 如果 subject 过滤会挡住保存后的 slice，清空 subject 过滤并复位为“任一 subject”。
    - 如果 kind 过滤会挡住保存后的 slice，复位 kind 为 `all`。
    - 如果 search 会挡住保存后的 slice，清空 search。
    - 如果 status / draft 过滤不是 `all`，复位为 `all`，避免保存后 draft 消失或 issue 状态变化导致当前 slice 被挡走。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，覆盖保存 edit 后会调用 filter helper 保持当前 slice 可见。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 在 `kind=event` 或 `status=draft` 视角下编辑当前 slice metadata / value。
- 保存后当前 slice 应仍被选中且可见；必要过滤会被清空，而不是跳到第一条可见 slice。

## Result

实际结果与计划一致：只修复真实 Workbench 保存 metadata / value 后当前 slice 被过滤挡走的问题，不改后端、不引入持久化草稿、不扩大测试范围。
