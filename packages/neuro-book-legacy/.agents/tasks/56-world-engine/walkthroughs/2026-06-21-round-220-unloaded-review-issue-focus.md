# Round 220 - Unloaded Review Issue Focus

## 背景

继续检查 Review Queue 点击 issue 的作者路径。Round 217 已经避免目标 slice 未加载时把 `selectedSliceId` 指向不存在的 slice，但当时仍会设置 `highlightedMutationFocus`。这会让底部审查工作台在当前 slice 上生成一个 `manual-focus` 上下文。

对作者来说，这很容易误读成“当前 slice 正在审查这个 issue”，但实际目标 slice 并没有加载到 timeline。

## 本轮调整

- 目标 slice 未加载时，继续显示 `Issue 所属 slice ... 当前未加载，无法定位到时间线。`。
- 该分支不再设置 `highlightedMutationFocus`，而是明确清空 issue focus。
- 底部审查工作台仍会展开，方便作者看到提示后的当前上下文，但不会伪造当前 slice 的 Review Focus。
- 静态契约增加位置断言：未加载提示之后必须清空 `highlightedMutationFocus`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证。

## 后续

- 如果真实项目经常出现未加载 issue，应该补 API 级定位能力，例如按 `sliceId` 补取单个 slice 或扩大 `GET /slices` 的定位参数，而不是继续靠前端最近 200 条猜测。
