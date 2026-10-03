# 2026-06-20 Segmented Control Refactor

## Context

用户指出 Workbench Preview 中多处 UI 控件逻辑重复：Slice List 的 subject mode、kind/status 选择，Sidebar 的 subject 状态筛选，Mutation Editor 的模式切换 / Review Queue mode / subject navigation scope，以及 `LowCodeRadioField` 都是同一类 segmented 控件。

本轮按用户计划抽一个无业务依赖的 common 组件，只承载互斥选项渲染、选中态、禁用态、计数、tone 和 `update:modelValue`。业务 filter toolbar、Draft Queue、Subject Card、Issue Row 暂不抽象。

## Changes

- 新增 `app/components/common/form/SegmentedControl.vue`：
  - 支持 `modelValue`、`options`、`size`、`tone`、`wrap`。
  - option 支持 `value`、`label`、`count`、`title`、`disabled`、`tone`、`iconClass`、`testId`。
  - 保留 `aria-pressed`，禁用项不会触发更新。
- `LowCodeRadioField.vue` 改为复用 `SegmentedControl`，保留原 low-code DTO 输入输出。
- Workbench Preview 复用：
  - Slice List 的 subject mode、kind filter、status filter 改用 `SegmentedControl`。
  - 删除 Slice List 上方独立 `open / done / clean / draft` status 统计快捷卡，status 只保留 filter toolbar 这一处；计数并入 status options。
  - Sidebar 的 `active / open / done / value` 左栏筛选改成紧凑 segmented。
  - Mutation Editor 的 `问题处理 / Subject 视图 / 总变更`、Review Queue `只看 open / 全部 issue`、subject navigation `subject 轨迹 / 过滤组合` 改用 `SegmentedControl`。
- 测试契约同步：
  - 新增 common component / LowCodeRadioField 的静态断言。
  - Workbench 静态测试改为断言 `SegmentedControl` 与 options / update handler。
  - 断言旧独立 status 统计按钮不再存在。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。

## Notes

- 本轮没有抽 `FilterToolbar`，因为 toolbar 还包含业务分组、清空动作和 filter chip。
- 本轮额外对齐了 Mutation Editor 静态测试中过期的 issue explanation / before-after helper 名称；这是测试契约追上当前实现，不是新的产品行为变更。
- 本轮未做浏览器视觉验收，遵守项目约束；后续可人工检查 segmented 在 World Engine 局部主题和普通 low-code form 中的视觉一致性。
