# B3 world-engine 硬编码清理

## 范围

- `app/components/novel-ide/world-engine/*`
- `app/components/novel-ide/world-engine/workbench-preview/*`
- `app/pages/world-engine.workbench-preview.vue`

## 变更

- 主目录组件中的 issue / draft / subject 已存在提示从 amber/red/rose/emerald 字面色改为 `--status-warning*`、`--status-danger*`、`--status-success*`。
- workbench-preview 保留 `--we-*` 别名层，所有 warning 边框从 `border-amber-*` 改为 `border-[var(--we-warning-border)]`。
- `world-engine.workbench-preview.vue` header 阴影从 `rgba(15,23,42,0.04)` 改为 `color-mix(in_srgb,var(--shadow-color)_4%,transparent)`。
- 删除 `WorldEnginePreviewActions.vue` 里的 `dark:` 分支，交给主题变量负责深浅色。

## 验证

- world-engine 范围残留扫描通过：
  - `rg "(amber|yellow|rose|red|emerald|green|sky|blue|slate|gray|zinc|stone)-[0-9]|dark:|rgba\(15,23,42|#5f3300" app/components/novel-ide/world-engine app/pages/world-engine.workbench-preview.vue -g "*.vue"` 无输出。
- `text-white` 横切项仍剩 1 处：
  - `WorldEngineWorkbenchPreviewInspector.vue` 的 accent 实底按钮，按 PLAN 留到 B4 统一替换为 `text-[var(--text-inverse)]` 或等价别名。
- `bun run typecheck` 未通过，失败不在 B3 样式范围：
  - 新增大量 agent `planModeActive` / `agentMode` / `AGENT_PLAN_MODE_STATE_KEY` 类型不一致错误。
  - 仍有 `server/agent/profiles/writer-profile-contract.test.ts` 缺 `customTopSystemPrompt`。
  - 仍有 `server/low-code-form/index.ts(798,13)` `LowCodeJsonValue | undefined` 赋值错误。
- `bun run test` 未通过，失败不在 B3 样式范围：
  - 汇总：34 failed files，69 failed tests。
  - 代表性失败：`PlanModeSchema is not defined`、`AGENT_PLAN_MODE_STATE_KEY` 缺失导致 profile 编译失败、profile/catalog 多处不可运行、RAG/SQLite smoke、auth timeout、writer `customTopSystemPrompt.trim()`。

## 与计划出入

- B3 按计划保留 `--we-*` 层，只替换 hardcoded Tailwind 色板类与旧阴影。
- workbench-preview 中实际 warning 边框残留比计划估算更多，但都属于同一机械替换规则，未迁移任何分类色板或拆除别名层。

## 下一步

- 进入 B4：agent 区 + 全仓长尾清理，并统一处理 accent/status 实底上的 `text-white`。
