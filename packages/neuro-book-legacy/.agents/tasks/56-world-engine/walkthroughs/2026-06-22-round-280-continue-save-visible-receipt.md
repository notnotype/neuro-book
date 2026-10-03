# Round 280: Continue Save Visible Receipt

## Context

继续检查连续推演路径。`写入并继续下一步` 成功后，父层会设置顶部 notice，提示“已写入 slice，已准备下一步草稿”。但 Composer overlay 仍然打开，且 overlay 是绝对定位在 Workbench 之上；作者实际工作视线仍在 Composer 内，可能看不到父层顶部 notice。

这会造成一个很微妙的停顿：下一条草稿已经准备好了，但作者不确定上一条是否真的写入成功。

## Changes

- `WorldEngineMutationEditor.vue`
  - 新增 `lastContinueSaveNotice`。
  - `写入并继续下一步` 成功后，在 Composer 内显示 `上一条已写入 <sliceId>...已准备下一步草稿。`
  - 如果保存返回 issues，会在同一条 Composer 内回执里显示 issue 数量。
  - 载入已有 slice 或切回新建模式时清空这条回执，避免旧保存结果干扰当前编辑上下文。

- `world-engine-ide-entry.test.ts`
  - 补充连续写入后 Composer 内保存回执的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：点击 `写入并继续下一步` 后，Composer 仍打开并显示上一条 slice 已写入的回执；下一条草稿可继续编辑。

## Result

实际结果与本轮目标一致：不改变写入 API、不改变父层 notice，只在 Composer overlay 内补充连续推演时作者可见的保存确认。
