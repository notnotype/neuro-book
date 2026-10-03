# Round 279: Slice Time Required Validation

## Context

继续检查连续推演时的普通表单路径。后端 API 已明确 `writeSlice` / `editSlice` 的 `time` 是必填字段；但主 IDE Workbench 的 Slice Composer 只用 `mutationValidation` 控制提交按钮。作者如果误删 time，按钮仍然可点，最后会等后端返回 `time 不能为空`。

这不是新的后端边界问题，而是常用写入表单的前端拼接问题：必填时间应该在 Composer 内直接暴露，避免作者以为请求或世界引擎坏了。

## Changes

- `WorldEngineMutationEditor.vue`
  - 新增 `sliceValidation`：先检查 `sliceForm.time.trim()`，为空时返回 `time 不能为空`，否则沿用原有 mutations JSON 校验。
  - `canSubmit` 改为依赖 `sliceValidation.ok`。
  - `submitSlice()` 先读取 `sliceValidation`，前端直接提示 time 缺失，不再把空 time 请求发到 API。
  - `WorldEngineSliceDraftForm` 的 `validation-ok / validation-message` 改为使用 `sliceValidation`，复用现有表单错误展示。

- `world-engine-ide-entry.test.ts`
  - 补充 Slice Composer time 必填校验的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：打开 Slice Composer，清空 time 后，写入按钮应禁用并显示 `time 不能为空`。

## Result

实际结果与本轮目标一致：只把后端已有的必填契约前移到主 Workbench Composer，不改变 API、Calendar 或 mutation 校验策略。
