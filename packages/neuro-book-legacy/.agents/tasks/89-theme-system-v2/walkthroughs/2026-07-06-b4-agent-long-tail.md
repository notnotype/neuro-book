# B4 agent 区 + 全仓长尾清理

## 范围

- `app/components/novel-ide/agent/**`
- `app/components/markdown-studio/**`
- `app/components/novel-ide/settings/**`
- `app/components/novel-ide/workspace/**`
- `app/components/novel-ide/rag/**`
- `app/components/common/**`
- `app/pages/login.vue`
- `app/pages/admin/users.vue`
- `app/composables/useDialog.ts`

## 变更

- agent 区会话状态、工具状态、任务状态、trace 状态点改为主题状态变量：运行中/引用走 `--status-info*`，进行中走 `--status-warning*`，完成走 `--status-success*`，错误/危险走 `--status-danger*`。
- 通用多动作 Dialog 的 primary/danger 按钮改为 `--accent-*` / `--status-danger*`，实底文字改为 `--text-inverse`。
- 长尾组件中的 Tailwind 调色板类、`dark:` 分支、`text-white` 实底反色文字、硬编码深色阴影已按 PLAN 的映射表迁移到主题变量。
- 保留约定例外：`NotificationViewport.vue` 玻璃拟态、`app/components/dnd-test/**`、`app/pages/dnd.preview.vue`、plot/workspace 分类色板定义文件。

## 验证

- 全 app 扫描通过，排除项为 B4 计划列明的测试页、通知玻璃拟态、分类色板定义、测试断言与规范文档：
  - `rg "(amber|yellow|rose|red|emerald|green|sky|blue|cyan|orange|slate|gray|zinc|stone)-[0-9]|dark:|rgba\(15,23,42|color-mix\([^)]*#000|#5f3300|text-white|green-500|red-500" app ...`
  - 剩余可解释项：`theme-tokens.ts` 中内置主题 id `dark`；分类色板文件里的固定 tone class（按契约不迁移）。
- `bun run typecheck` 未通过，失败不在 B4 样式范围：
  - agent Plan Mode / Agent Mode 契约不一致：`planModeActive` 不存在、`"plan"` 不在 command kind union、`AGENT_PLAN_MODE_STATE_KEY` 缺失、`enterPlanMode/exitPlanMode` 工具缺失。
  - profile / writer 测试夹具仍缺 `customTopSystemPrompt`。
  - `server/low-code-form/index.ts(798,13)` 仍是 `LowCodeJsonValue | undefined` 赋给 `LowCodeJsonValue`。
- `bun run test` 未通过，失败不在 B4 样式范围：
  - 汇总：20 failed files，85 failed tests，5 unhandled errors。
  - 代表性失败：agent harness / profile compile / profile catalog / Plan Mode 相关用例、workspace-files hook timeout、sqlite-vec smoke、auth timeout、web_fetch timeout、plot API timeout、writer `customTopSystemPrompt.trim()`。

## 与计划出入

- B4 扫描补漏发现 `useDialog.ts`、`agent-message.ts`、`task-list.ts`、`trace-view-model.ts` 仍有真实硬编码消费点，已纳入本批完成。
- 未做浏览器验证，遵守“浏览器验证先征求用户同意”的约束。
- 未修复 agent/profile/low-code-form 等既有失败，避免把无关基线修复混入主题批次。

## 下一步

- 进入 B5：全文重写 `app/utils/theme/README.md`，把 v2.1 变量体系、状态语义、例外与禁止事项固化为规范。
