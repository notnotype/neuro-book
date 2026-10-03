# Round 234: preferred subject 空时间线不回落旧 slice

继续检查“创建 / 同步 subject 后马上继续写 slice”的路径。此前 Workbench 会通过 `preferredSubjectIds` 尝试定位到刚创建或同步的 subject；如果该 subject 有 schema default，通常会生成或追加 init slice，当前逻辑能定位到该初始化切片。

但第一版契约允许没有 default 的 subject 只注册身份、不创建空切面。这时 `latestSliceTouchingSubjects()` 找不到任何切片，旧 `applyDefaults()` 会继续回落到最近的普通 slice，并用旧 slice 触及的 subject 改写 `focusedSubjectId`。结果作者刚同步 / 创建的 subject 虽然已经注册成功，但右侧 Inspector 和“新建 Slice”默认目标都可能串回旧上下文。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `applyDefaults()` 现在会先把 `preferredSubjectIds` 过滤成当前 Project 已知 subject。
  - 如果存在 preferred subject，但没有 `preferredSlice`，也没有触及这些 subject 的 slice，则进入空 subject 视角：
    - `selectedSliceId` 清空。
    - `focusedSubjectId` 保持为最后一个 preferred subject。
    - 不再回落到任意旧 slice。
  - 普通加载、明确指定 `preferredSliceId`、以及 preferred subject 有命中 slice 的路径不变。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 `keepEmptyPreferredSubjectView` 与 preferred subject focus 恢复逻辑存在。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续补齐 subject 接入后的真实作者路径。实际改动没有改变 `createSubject` 行为，也没有强行给无 default subject 创建空 slice；只是让 Workbench 对“注册成功但时间线为空”的状态保持诚实，不再把用户带回旧 slice。
