# Round 248: Slice Composer Save And Continue

## Context

继续从作者真实推演路径看主 Workbench。前几轮已经补齐 Slice Composer 的关闭 / 切换 dirty guard，但连续写几步 slice 时仍有明显摩擦：

- 写入一条新 slice 后 Composer 会关闭。
- 作者要继续推演下一步，需要重新点 `新建 Slice`。
- 下一步草稿虽然已经能根据已知 timeline 推导时间，但入口动作仍打断连续写作节奏。

这不是后端边界问题，也不是需要大改的工作流；更像第一版“让作者真的拿它写世界”的操作节奏问题。

## Changes

- `WorldEngineSliceDraftForm.vue`
  - 新建模式下增加 `写入并继续下一步` 按钮。
  - 编辑已有 slice 时不显示该按钮，避免把“保存编辑”和“继续新建”混在一起。

- `WorldEngineMutationEditor.vue`
  - `submitSlice()` 增加 `continueAfterSave` 选项。
  - 新建 slice 才允许继续模式；编辑 slice 即使传入该选项也会按普通保存处理。
  - 保存成功后把 `continueAfterSave` 传给父层。

- `WorldEngineWorkbenchDialog.vue`
  - 保存成功后仍会刷新真实 timeline、定位新 slice、记录返回 issues。
  - 普通写入 / 编辑保持原行为：关闭 Composer。
  - `写入并继续下一步` 成功后保持 Composer 打开，并重挂编辑器；下一条草稿会使用刷新后的 `usedTimes` 推导下一 instant。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，覆盖继续按钮、继续事件、父层保持 Composer 打开以及继续提示文案。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 打开 `ming-ding-zhi-shi-2` 的主 Workbench。
- 点击 `新建 Slice`，使用 `写入并继续下一步` 连续写两条 slice。
- 确认第一条写入后 Composer 保持打开，第二条草稿时间推进到下一 instant。
- 确认普通 `写入 Slice` 和编辑已有 slice 仍按原行为关闭 Composer。

## Result

实际结果与计划一致：只优化连续新建 slice 的作者节奏，不改后端、不引入持久草稿、不扩大测试面。
