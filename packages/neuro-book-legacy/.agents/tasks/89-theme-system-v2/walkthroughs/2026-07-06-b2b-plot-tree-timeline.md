# B2b plot tree / timeline / preview 清理

## 范围

- 继续清理 `app/components/novel-ide/plot/tree/*`、plot 顶层组件、timeline 与章节编辑对话框中的非分类色板硬编码。
- `PLOT_TONE_STYLES` / `PLOT_TREE_TONE_STYLES` / `PLOT_THREAD_TONE` 等分类色板定义保持不迁移。
- `app/pages/plot*.vue` 预览页纳入残留扫描，本轮未发现需要修改的硬编码残留。

## 变更

- timeline 主线卡片由 amber 字面色改为 `--border-accent` / `--accent-bg` / `--accent-text`。
- timeline Draft Tail 段由 slate 字面色改为 `--status-warning-bg` / `--status-warning-border`。
- plot 顶层错误提示、章节编辑错误提示由 rose 字面色改为 `--status-danger*`。
- 章节 brief 已填写指示点由 emerald 字面色改为 `--status-success`。
- timeline 阴影从 `rgba(15,23,42,...)` 改为 `color-mix(in_srgb,var(--shadow-color)_N%,transparent)`。

## 验证

- B2b 范围残留扫描通过：
  - `rg "(amber|yellow|rose|red|emerald|green|sky|blue|slate|gray|zinc|stone)-[0-9]|dark:|rgba\(15,23,42|#5f3300" app/components/novel-ide/plot -g "*.vue"` 无输出。
  - 同样扫描 `app/pages/plot.preview.vue` / `plot-workbench.preview.vue` / `plot-tree.preview.vue` / `plot-timeline.preview.vue` / `plot-thread.preview.vue` 无输出。
- `bun run typecheck` 未通过，仍为 B1/B2a 已记录的无关既有错误：
  - `server/agent/profiles/writer-profile-contract.test.ts(61,17)` 缺少 `customTopSystemPrompt`。
  - `server/low-code-form/index.ts(798,13)` `LowCodeJsonValue | undefined` 不能赋给 `LowCodeJsonValue`。
- `bun run test` 未通过，失败集中在既有 server/agent/workspace/llmlint 基线：
  - 汇总：15 failed files，39 failed tests，3 unhandled errors。
  - 代表性失败：`workspace-files.test.ts` hook timeout；`auth.test.ts` timeout；`neuro-agent-harness*.test.ts` timeout / `active_invocation_required` / session `ENOENT`；`llmlint.test.ts` Windows `EBUSY` / `EPERM`；`writer-profile-contract.test.ts` `customTopSystemPrompt.trim()`。

## 与计划出入

- 本轮只做 B2b 计划内的 plot Vue 消费点清理；分类色板类型文件未迁移。
- `text-white` 这类反色文字按 PLAN 横切项留到 B4 统一处理。

## 下一步

- 进入 B3：清理 `world-engine/*` 与 `workbench-preview/*` 的 amber/red/blue/slate/dark/阴影硬编码。
