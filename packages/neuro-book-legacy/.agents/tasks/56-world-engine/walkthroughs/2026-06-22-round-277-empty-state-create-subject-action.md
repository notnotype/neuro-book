# Round 277: Empty State Create Subject Action

## Context

继续从空 Project 的作者正流程检查。上一轮修了手动创建 subject 的连续录入，但入口本身仍藏在左栏 `创建 Subject` 折叠面板里。中间空状态文案写着“可以先创建 subject，或写入示例世界”，实际却只提供 `一键示例世界` 按钮。

这会让作者第一次打开没有 slice 的 Project 时，看到“创建 subject”这条路却找不到对应动作，只能去左栏找一个折叠的 details。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `subjectCreatorOpen` 状态，控制左栏 `创建 Subject` details 展开。
  - 新增 `openSubjectCreatorPanel()`：从空状态按钮展开左栏、取消侧栏折叠，不写世界、不切换 slice。
  - 新增 `updateSubjectCreatorOpen()`：同步用户手动展开 / 折叠 details 的原生状态。
  - 切换 Project / 关闭 Workbench 时重置 `subjectCreatorOpen`。
  - `seed-demo` 空状态改为两个并列动作：`创建 Subject` 和 `一键示例世界`。前者把作者带到左栏创建面板，后者保留原示例世界路径。

- `world-engine-ide-entry.test.ts`
  - 补充空状态创建 subject 入口、details 受控展开和侧栏展开行为的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：打开没有 slice 且没有待接入主体的 Project，中间空状态应同时显示 `创建 Subject` 和 `一键示例世界`；点击 `创建 Subject` 后左侧创建面板展开。

## Result

实际结果与本轮目标一致：没有改后端、schema 或 slice 写入逻辑，只把空 Project 第一屏文案里已经承诺的“创建 subject”补成可点击入口。
