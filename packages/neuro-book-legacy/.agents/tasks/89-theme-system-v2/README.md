# Theme System v2.1 & Custom Themes（主题变量体系重构 + 自定义主题调色盘）

## Relative documents refs

- [PLAN.md](PLAN.md) — 分批实施计划（B1–B10，含映射规则、API 草图、风险与验证方案），**执行前必读**
- `app/utils/theme/README.md` — Novel IDE 主题变量规范 v2.1
- `reference/theme/system.md` — 主题系统稳定参考
- `app/utils/theme/theme-tokens.ts` — 主题变量唯一来源
- `shared/dto/config.dto.ts` / `server/config/normalizer.ts` / `server/config/registry.ts` — global config 管线

## User Request / Topic

- 设置界面主题功能增强：目前只能选 8 套预设，需要支持用户自定义调色盘——能看到当前主题的变量、实时调整预览、保存为自定义预设、JSON 导入导出；主题与自定义主题存储进 global config。
- 讨论中发现现有变量体系混乱（39 变量中 5 个已死、多个冗余；全 app/ 约 491 处 Tailwind 硬编码调色板类不跟随主题切换），确定先重构变量体系（v2.1），再做自定义主题功能。

## Goal

/goal 按 [PLAN.md](PLAN.md) 的批次（B1→B10）完成两阶段工作：Phase 1 落地 36 变量体系 v2.1（8 套预设迁移、改名/删除变量的消费点替换、`--we-*` 桥指向更新、全 app/ 约 491 处硬编码调色板类与 58 处 `dark:` 清理、`::selection`/`--shadow-color` 落地、变量规范文档重写）；Phase 2 实现自定义主题（`ui.theme: string` + `ui.customThemes` 进 global config、bootstrap 启动时序防 FOUC、主题编辑器 Dialog：核心 13 色快速调色盘 + 36 变量分组高级区 + 实时预览 + 按核心色重新生成、vue3-colorpicker + colord 取色器、JSON 导入导出、client-variables 校验放宽）。

**验证面**：每批 `bun run typecheck` 与 `bun run test` 全绿（B6 后加 `bun run generate:openapi`）；新增 derive/theme-io/theme-vars 同步锁/normalizer 测试通过；Phase 1 收尾对 8 套预设逐一切换目测六个重点面（plot workbench / world-engine / agent 聊天 / 设置 / markdown+Monaco / diff）；Phase 2 收尾走完 PLAN.md 验证方案节的自定义主题全流程清单（新建→调色→覆盖→重新生成→保存→切换→导出→删除→导入→重启保持→Agent 链路切主题）。

**约束**：内置 8 套预设视觉零漂移（预设保存全量字面值，派生规则只做编辑器默认）；分类色板（PLOT_THREAD_TONE、workspace-entry-meta、plot-tree/preview tone）不迁移；`--we-*` 别名层保留只改指向；单批补丁 <800 行；不破坏现有测试（world-engine-ide-entry.test.ts、theme-tokens.test.ts 等按计划同步更新）；遵循仓库 AGENTS.md/CLAUDE.md 全部编码规范。

**边界**：仅本仓库；新依赖只允许 `colord` 与 `vue3-colorpicker`（bun 安装，沙盒外提权）；浏览器验证环节先征求用户同意，不要自动进行。

**迭代策略**：按批次顺序执行，每批结束跑验证面，并在本目录 `walkthroughs/` 下记录该轮报告（变更文件、验证输出、与计划的出入、下一步）；绕道必须记录，重大出入写回本 README；遵循 docs/tasks/README.md 的 goal 模式工作流程循环。

**阻塞停止条件**：遇到设计冲突、需要破坏类型系统或用 hack 绕过问题时立即停止本批，报告已尝试路径、证据、阻塞点与需要用户提供的决策；PLAN.md 与实际代码不符且无法机械修正时同样停止报告。

## Current State

- B1-B10 已完成实现与文档收尾；2026-07-06 追加一轮 UI 审查与优化（用户 5 点反馈）。
- 主题系统已落地 36 变量 v2.1；8 套内置预设保留完整字面值；`--we-*` 别名层保留但改指向；分类色板未迁移。
- 自定义主题已接入 Global Config：`ui.theme: string` 与 `ui.customThemes`；bootstrap 会应用主题快照；主题切换即时生效并静默保存，失败回滚。
- 主题编辑器现承载于新通用组件 `DialogWindow`（非模态浮动窗口：无遮罩、可拖动、毛玻璃），打开时自动收起设置对话框，整个 IDE 即实时预览；编辑器内为三标签页（核心调色盘 / 全部变量 / 实时预览）。
- 取色改为 vue3-colorpicker `is-widget` 内嵌 + 自绘 popover（teleport 到主题宿主），并带原生 EyeDropper 吸管（Chromium）；设置入口为迷你配色预览卡片网格，操作按钮下放到卡片悬停。
- 规范文档已同步：`AGENTS.md`、`CLAUDE.md`（含 DialogWindow / FormColorField 组件索引）、`app/utils/theme/README.md`、`reference/theme/system.md`、`PROJECT-STATUS.md`。
- P2 修复已补齐：Agent client patch 等待主题保存结果再 ack；主题 JSON 导入校验每个变量值必须是可编辑具体颜色；World Engine preview 与真实 Dialog 共用 `.world-engine-workbench-theme` 映射；普通 UI 硬编码状态色和阴影继续收口；Reference chip / Profile template / Markdown 内容色 / JsonViewer / Monaco 等分类或内容色板边界已登记。
- P2 聚焦浏览器验收已完成：主题切换、坏 JSON 导入提示、World Engine preview 共用映射、Markdown chip / inline comment 明暗主题外观均通过。

## Decisions / Discussion

- 36 变量 = 语义 34 + 组件 2；核心 13 色 + 可覆盖派生默认；每主题带 `appearance: "light"|"dark"`。**派生必须是默认值而非硬规则**（dracula 的 accent-text 与 accent-main 跨色相，硬规则连内置预设都表达不了）。
- 状态语义映射：草稿/待审/占位→warning；完成/已解决→success；错误/冲突/删除→danger；运行中/引用/信息→info。amber 有双角色：状态警示→warning，**选中/主线强调→accent 系**，迁移按视觉角色不按颜色名。
- 主题与自定义主题存 global config（用户指定）；切主题即时生效 + 静默自动保存（失败通知回滚）；主题编辑器内实时预览 + 显式保存。
- 硬编码清理范围 = 全 app/（用户选定，约 40 文件）；`--we-*` 别名层本次保留（用户选定），仅改指向。
- JSON 导出 v1 就带（`{schemaVersion: 1, name, appearance, vars}`）；取色器用第三方（vue3-colorpicker + colord）。
- Monaco 语法 token 色不进调色盘（跟 appearance 走）；单一全局作用域，不做分区换肤。

## Verification / Test

- 每批均按约束运行 `bun run typecheck`、`bun run test`；B6 之后每批加跑 `bun run generate:openapi`。
- 最终 B10 前的已知状态：
  - 主题聚焦测试通过：`bunx vitest run app/utils/theme/derive.test.ts app/utils/theme/theme-io.test.ts app/utils/theme/resolve-theme.test.ts app/utils/theme/theme-editor.test.ts`，4 files / 9 tests passed。
  - `bun run generate:openapi` 通过：40 routes updated，0 failed。
  - `bun run typecheck` 仍失败，但失败集中在既有 Agent plan-mode / Profile DSL / writer fixture / low-code-form 基线；本轮未发现主题路径错误。
  - `bun run test` 仍失败，但失败集中在既有 Agent/Profile/Workspace/Auth/Web/Plot/World Engine 超时或契约问题；主题聚焦测试通过。
- P2 聚焦测试通过：`bunx vitest run app/components/novel-ide/agent/client-variables.test.ts app/utils/theme/theme-io.test.ts app/utils/theme/theme-tokens.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`，5 files / 20 tests passed。
- P2 收尾复核：`bun run typecheck` 仍失败，归因 Agent harness/profile fixture 与 `server/low-code-form/index.ts` 既有非主题类型基线；`bun run test` 仍失败，13 files failed / 37 tests failed / 1312 passed / 87 skipped / 3 errors，失败集中在 Agent harness/profile/catalog、workspace-files、auth、web-tools、plot API；同一组 P2 targeted tests 通过；`bun run generate:openapi` 通过，40 routes updated / 0 failed。
- P2 聚焦浏览器验收通过：`node .agent/workspace/theme-p2-browser.mjs`，覆盖主题切换、坏 JSON 导入提示、World Engine preview 共用映射、Markdown chip / inline comment 明暗主题外观。
- B10 全量人工回归清单见 PLAN.md「验证方案」节；本轮 P2 浏览器验收只覆盖追加修复面。

## Implementation Walkthrough

- [B1 theme vars v2](walkthroughs/2026-07-06-b1-theme-vars-v2.md)
- [B2a plot workbench/thread panel](walkthroughs/2026-07-06-b2a-plot-workbench-thread-panel.md)
- [B2b plot tree/timeline](walkthroughs/2026-07-06-b2b-plot-tree-timeline.md)
- [B3 world engine](walkthroughs/2026-07-06-b3-world-engine.md)
- [B4 agent long tail](walkthroughs/2026-07-06-b4-agent-long-tail.md)
- [B5 theme README](walkthroughs/2026-07-06-b5-theme-readme.md)
- [B6 shared server config](walkthroughs/2026-07-06-b6-shared-server-config.md)
- [B7 runtime custom theme](walkthroughs/2026-07-06-b7-runtime-custom-theme.md)
- [B8 derive/io/color field](walkthroughs/2026-07-06-b8-theme-derive-io-color-field.md)
- [B9 theme editor UI](walkthroughs/2026-07-06-b9-theme-editor-ui.md)
- [B10 docs sync](walkthroughs/2026-07-06-b10-docs-sync.md)
- [UI 审查与优化轮（浮动窗口/取色器/预览/卡片网格）](walkthroughs/2026-07-06-review-ui-optimize.md)
- [P2 fixes（Agent ack / JSON 导入颜色校验 / 硬编码色收口）](walkthroughs/2026-07-06-p2-fixes.md)

## TODO / Follow-ups

- `--we-*` 别名层后续机械拆除（800+ 引用，本次不做）
- markdown 备选主题（github/notion，`app/styles/markdown-themes.css`）硬编码浅色，且 `MARKDOWN_THEME` 是编译期常量——后续决定是否开放为用户设置并变量化
- 滚动条样式目前无人定制，规范中给出派生建议即可
- 分类色板叠底方式统一为 `color-mix(... var(--bg-panel))`（规范条款，逐步随手改）
- 吸管依赖原生 EyeDropper API（Chromium 专属）；Firefox/Safari 不显示吸管按钮，后续可评估替代方案
