# 2026-06-20 Issue Target Highlight

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 review 检查闭环，不接真实 API，不改后端 DTO。重点把 Inspector 的 issue 点击从 subject 级聚焦推进到 attr 级 mutation 行定位，让用户能直接看到需要 review 的具体变更。

## Finding

上一轮 Inspector 已新增 `Review Issues`，点击 issue 后能聚焦相关 subject，并让 Mutation Editor 展开到该 subject 视图。但在 subject 下面仍可能有多条 mutation，用户还需要自己用 issue 的 `attr` 去列表里找对应行。

这对 review 工作台不够直接。issue 已经带有 `subjectId` / `attr` 时，预览页应该把这个定位信息一路传到 Mutation Editor，并在命中的 mutation 行上给出稳定视觉标记。

## Changes

- 新增 `WorldWorkbenchPreviewMutationFocus` 类型，表示 `{ subjectId, attr }` 的 attr 级定位目标。
- route 页面新增 `highlightedMutationFocus` 状态和 `focusMutation()` 编排：
  - Inspector issue 点击时设置高亮目标。
  - 普通 slice 切换、subject 聚焦、subject 过滤变化时清空高亮，避免旧定位误留。
- `WorldEngineWorkbenchPreviewInspector` 的 issue 行点击现在同时触发：
  - subject 聚焦。
  - mutation attr 定位。
- `WorldEngineWorkbenchPreviewMutationEditor` 新增 `highlightedMutationFocus` prop，并在 subject 视图和总视图中识别命中 mutation。
- 命中行会显示 warning 背景、左侧强调边和 `issue target` 标签；before / after 仍保留在同一行附近。
- 目标测试补充静态契约，覆盖 `focusMutation`、`highlightedMutationFocus`、`WorldWorkbenchPreviewMutationFocus`、`isHighlightedMutation` 和 `issue target`，避免交互链路被误删。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 刷新页面后点击 `review 1`。
  - 点击 Inspector issue `base-shifted / old-sword / durability`。
  - Mutation Editor 自动展开并聚焦 `旧剑`。
  - 命中的 `durability add` 行显示 `issue target`。
  - 同一行显示 `切片前 95 / 切片后 80`。
  - number input 的值确认为 `-15`。
  - 页面没有横向溢出。
- dev logs 仍可读到 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没有发现阻断当前页面挂载和 issue target 高亮的新错误。

## Plan Deviation

- 原计划只要求 Inspector issue 能联动 Mutation Editor 查看 mutation 与切片前后状态；本轮额外补齐了 attr 级行高亮，属于 review 检查闭环的自然延伸。
- 本轮仍不实现 issue 的确认 / 忽略 / 修复写回，因为当前页面保持 mock UI/UX 预览定位。

## Next Notes

- 后续如果增加 issue 处理动作，可以复用当前 `WorldWorkbenchPreviewMutationFocus` 作为定位输入，把“定位问题”和“解决问题”的 UI 分开。
- 真实 API 接入时，issue target 高亮仍只依赖 slice issues 中的 `subjectId / attr`，不要求修改后端 DTO。
