# 2026-06-20 Inspector Review Issues

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 review 检查闭环，不接真实 API，不改后端 DTO。重点让用户在 Slice List 筛出 `review` 切片后，右侧 Inspector 能直接解释为什么需要 review，并能定位到相关 subject / attr。

## Finding

上一轮 Slice List 已支持 `review` 状态过滤，但用户点进 issue slice 后，右侧 Inspector 仍主要展示 metadata、touched subjects、State Snapshot 和 Schema excerpt。issue 的原因只在 slice card badge 上有数量提示，不足以回答：

- 哪个 issue code？
- 是 A 级确认还是 E 级错误？
- 影响哪个 subject / attr？
- 为什么需要 review？
- 如何跳到对应 subject 检查 mutation 和 before / after？

因此需要把 review issue 纳入 Inspector，而不是只让它留在列表 badge 上。

## Changes

- `WorldEngineWorkbenchPreviewInspector` 引入 `WorldIssueDto` 类型。
- 新增 `reviewIssueRows` computed，将 `props.slice.issues` 投影为 Inspector 可展示行：
  - `code`
  - `level`
  - `subjectLabel`
  - `subjectType`
  - `attr`
  - `message`
- 新增 `issueLevel()`：
  - `base-shifted` / `masked` 映射为 `A`。
  - `broken-relative` / `dangling-ref` 映射为 `E`。
- 新增 `Review Issues` 区块：
  - 仅在当前 slice 有 issues 时显示。
  - 用 warning 背景和 alert 图标与普通 metadata 区分。
  - 每条 issue 是可点击按钮，点击后触发 `focusSubject`，让 Mutation Editor 聚焦到相关 subject。
- 目标测试补充静态契约，覆盖 `Review Issues`、`reviewIssueRows`、`issueLevel` 和 `base-shifted / masked` 映射。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 点击 `review 1` 后，列表显示 `1 / 6 slices`。
  - 选中的 `东塔地下层被打开` Inspector 显示 `REVIEW ISSUES` 区块。
  - issue 明细显示：
    - `A`
    - `base-shifted`
    - subject `旧剑 · old-sword / item`
    - attr `durability`
    - message `旧剑耐久被提前消耗，后续相对变更需要确认。`
  - 点击 issue 后，Mutation Editor 自动展开并聚焦 `旧剑`。
  - Mutation Editor 显示 `durability add -15`，并显示 `切片前 95 / 切片后 80`。
  - 页面没有横向溢出。
- dev logs 仍可读到 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没有发现阻断当前页面挂载和 review issue 交互的新错误。

## Plan Deviation

- 本轮没有做 issue 的“解决 / 忽略 / 标记已确认”动作，因为当前 preview 不接真实业务逻辑，mock 阶段只做检查闭环。
- 本轮没有把 issue attr 高亮到具体 mutation 行，只通过 subject 聚焦进入 Mutation Editor；后续可以继续推进 attr 级定位。

## Next Notes

- 后续可以给 Mutation Editor 增加 `highlightedAttr` / `highlightedIssue` 输入，让 issue 点击后直接高亮对应 mutation 行。
- 真实 API 接入时，Inspector issue 区块可直接复用 `WorldIssueDto[]`，只需要把 action issue / slice issue 的来源统一进 selected slice context。
