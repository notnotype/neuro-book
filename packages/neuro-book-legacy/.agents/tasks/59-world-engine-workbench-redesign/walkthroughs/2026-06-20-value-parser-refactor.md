# 2026-06-20 Value Parser Refactor

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 编辑底座，不接真实 API，不改后端 DTO。重点把 Mutation Editor 内部的 value parser 抽到 preview util，并补行为测试。

## Finding

Mutation Editor 已经支持 value 草稿编辑，但 `parseMutationValue()` 和 `formatValue()` 都写在组件内部。随着后续要补 schema-aware 控件，这会让组件继续膨胀，也不利于独立测试 JSON-like 输入边界。

需要稳定的解析边界包括：

- 普通文本按原文本保留。
- 裸数字解析为 number。
- `true / false / null` 解析为对应 JSON 值。
- 带引号的 JSON 字符串解析为 string。
- object / array 输入必须是合法 JSON。
- 非法 JSON-like 输入显示局部错误，不写入 mock 数据。

## Changes

- 新增 `app/utils/world-engine-workbench-preview-value.ts`。
- 抽出 `parseWorkbenchPreviewMutationValue()`。
- 抽出 `formatWorkbenchPreviewValue()`。
- `WorldEngineWorkbenchPreviewMutationEditor` 改为导入 preview value util，删除本地 parser 类型和函数。
- `app/utils/world-engine-workbench-preview.test.ts` 增加 value parser 行为测试。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed
- `bun run typecheck`

## Browser Check

本轮没有改变 UI 渲染结构，只抽出 parser 和 formatter，并补行为测试。由于前一轮浏览器自动化仍有 HMR / tab 上下文噪声，本轮不重复做点击链路验证，避免把非 UI 改动误记为浏览器结论。

## Plan Deviation

- 原流程包含浏览器验证；本轮偏移为命令验证优先，因为改动是纯 value parser 抽取，真实风险在解析边界而不是视觉布局。

## Next Notes

- 后续可以把 value 输入从单一文本框进化为 schema-aware 控件：
  - number stepper
  - bool toggle
  - ref subject picker
  - object JSON textarea
  - collection item picker
