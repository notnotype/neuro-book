# 主题系统 v2.1 重构 + 自定义主题（调色盘）实施计划

> 本计划由 2026-07-05/06 与用户的设计讨论定稿，设计决策见同目录 [README.md](README.md)。执行按批次 B1→B10，每批独立可验证、补丁 <800 行。

## Context

用户需求：设置界面主题目前只能选 8 套预设，需要支持自定义调色盘（查看当前主题变量、实时调整预览、保存自定义预设、JSON 导入导出），存储进 global config。

调研结论（三区审计 + 全仓统计已完成）：现有 39 个主题变量中 5 个已死、多个冗余；真正的破损是全 app/ 约 491 处 Tailwind 硬编码调色板类（amber/rose/emerald/sky…）和 58 处 `dark:` 变体——它们不跟随 8 套主题切换，自定义调色盘调不动这些区域。因此分两个 Phase：先落地变量体系 v2.1 并清理硬编码（修地基），再做自定义主题功能。

## 变量体系 v2.1 速查

| 类别 | 变量 |
|---|---|
| 背景 6 | `--bg-main` `--bg-panel` `--bg-sidebar` `--bg-subtle`⭐ `--bg-input` `--bg-hover` |
| 文字 4 | `--text-main` `--text-secondary` `--text-muted` `--text-inverse` |
| 边框 3 | `--border-color` `--border-strong`（原 `--border-color-hover` 改名）`--border-accent`⭐ |
| 强调 3 | `--accent-main` `--accent-bg` `--accent-text` |
| 状态 12 | `--status-{info,success,warning,danger}` × `{主色, -bg, -border}` |
| 编辑器 4 | `--editor-bg`（合并原 canvas/preview）`--source-bg` `--source-text` `--source-muted` |
| 效果 2⭐ | `--shadow-color` `--selection-bg` |
| 组件层 2 | `--toolbar-bg` `--chat-ai-bg`（原 `--agent-bg` 改名） |

删除：`--bg-active` `--prompt-bg` `--prompt-border` `--editor-shell-bg` `--editor-head-bg` `--editor-gutter-bg`

核心 13 色（快速调色盘）：bg-main/panel/sidebar/input、text-main/secondary/muted、border-color、accent-main、4 个 status 主色。其余 23 个有派生默认规则、逐个可覆盖。

---

## Phase 1：变量体系落地 + 硬编码清理

### B1 变量表 v2 重写（约 700 行）

- `app/utils/theme/theme-tokens.ts` 重写：
  - 8 套预设 × 36 变量（改名/合并/新增按上表；`bg-subtle`/`border-accent`/`shadow-color`/`selection-bg` 每主题手调，允许 color-mix 字面串）
  - 新增 `themeMeta: Record<IdeTheme, {appearance: "light"|"dark"; label: string}>`（label 从 `NovelIdeSettingsDialog.vue:143` themeOptions 收编）
  - **本批 `IdeTheme` 8 值联合保持不变**（类型开放化放 B7，避免一批改两件事）
- 消费点机械替换（精确清单已核实）：
  - `--border-color-hover` 25 处 → `--border-strong`
  - `--agent-bg` 3 处（AgentToolNode.vue:46、AgentTextBubble.vue:493、AgentExitPlanModeBubble.vue:172）→ `--chat-ai-bg`
  - `--prompt-bg/--prompt-border` 3 处（NovelPromptBar.vue:241,248,415）→ `--bg-panel`/`--border-color`
  - `--bg-active` 1 处（WorldEngineSubjectStateViewerRow.vue:85）→ `--bg-hover`
  - `--editor-canvas-bg/--editor-preview-bg/--editor-shell-bg` 约 14 处（MarkdownStudioWorkbench.vue:94,113、MarkdownStudio.vue:79,82、MarkdownStudioWelcome.vue:237、MarkdownStudioToolbar.vue:199,240、TipTapMarkdownEditor.vue:1511,1634,1765、MarkdownCommentFlowPanel.vue:44,75、MarkdownSelectionMenu.vue:533、pages/index.vue:2136）→ `--editor-bg`；shell 半透明场景用 `color-mix(in srgb, var(--bg-panel) 88%, transparent)` 内联
- `--we-*` 桥更新（WorldEngineWorkbenchDialog.vue:2194-2224）：`--we-border-strong→var(--border-strong)`、`--we-bg-muted/--we-bg-data→var(--bg-subtle)`（两者合并，设计已定）、`--we-accent-border→var(--border-accent)`、`--we-bg-active→var(--bg-hover)`；同步改 `app/utils/world-engine-ide-entry.test.ts:787-806` 断言
- `app/styles/theme-vars.css` 重写为 36 变量 sepia 副本 + 追加 `.novel-ide-theme ::selection { background: var(--selection-bg); }`；在 `app/utils/theme/theme-tokens.test.ts` 加一条同步锁测试（读该 css 文件，断言与 `themeTokens.sepia` 键值一致）——消灭双源漂移
- 更新 `theme-tokens.test.ts` 既有断言

验证：`bun run typecheck && bun run test`；切 8 主题目测无明显破色。

### B2 plot 区硬编码清理（约 250 处，拆 2 子批）

- 2a：`plot/workbench/*` + `plot/thread-panel/*`（不含 *.types.ts 色板定义）
- 2b：`plot/tree/*`、plot preview 相关、timeline、plot 顶层组件
- 重点角色判断：**Sidebar/卡片「选中」的 amber → accent 系**（`border-amber-500/35→border-[var(--border-accent)]`、`bg-amber-500/8→bg-[var(--accent-bg)]`），状态徽标的 amber → warning 系；见下方映射表
- 清掉 `PlotWorkbenchSceneList.vue:408-431` 等 color-mix 中的硬编码回退 `#5f3300` → `var(--accent-text)`
- 该区 36 处 `dark:` 全删

### B3 world-engine 区清理（约 85 处）

- `world-engine/*` 主目录（约 45 处：草稿/待审 amber 徽标→warning，删除按钮 red→danger）+ `workbench-preview/*`（约 35 处，含 WorldEngineWorkbenchPreviewMutationEditor.vue 21 处、WorldEnginePreviewStatePanel.vue 14 处）

### B4 agent 区 + 全仓长尾清理（约 155 处）

- agent 区：AgentChatSurface.vue:446-464 / AgentSessionDialog.vue:145-149 会话状态标签（blue/amber/rose/emerald → status 四色三件套）、AgentTextBubble.vue:384 / AgentToolNode.vue:94 错误块（rose → danger）、AgentEditFileBubble、AgentSessionTreeDialog
- 长尾：settings 面板（NovelIdeModelSettingsPanel 13 处、NovelIdeAgentProfileModelSettingsPanel 10 处）、workspace（WorkspaceCharacterDetailPanel 9 处）、NovelChapterPanel 9 处、rag/NovelRagPanel 8 处、MarkdownCommentFlowPanel 8 处等
- 横切项：约 20 处 accent/status 实底上的 `text-white` → `text-[var(--text-inverse)]`（遮罩类 `bg-black/50`、毛玻璃 `bg-white/10` 保留）；style 块约 15 处 `rgba(15,23,42,…)`/`color-mix(#000…)` 阴影 → `color-mix(in srgb, var(--shadow-color) N%, transparent)`；剩余 `dark:` 全删
- 排除不动：`app/components/dnd-test/`、`app/pages/dnd.preview.vue`（测试页）、4 个分类色板定义文件（plot-thread-panel.types.ts / plot-tree.types.ts / plot-preview.types.ts / workspace-entry-meta.ts）、`NotificationViewport.vue` 玻璃拟态

### B5 Phase 1 规范文档

- `app/utils/theme/README.md` 全文重写为 v2.1 规范：36 变量表与角色说明、核心/派生两层、状态语义映射、组件层变量登记规则、分类色板例外条款、阴影/选区用法、禁止事项（调色板类、`dark:`、透明度叠加脏色）
- 更新任务 walkthrough

---

## Phase 2：自定义主题功能

### B6 shared + 服务端（约 300 行）

- 新建 `shared/theme/theme-vars.ts`：36 个变量键名 union（**不带 `--` 前缀**，JSON 干净、避免 CSS 语法泄进 DTO）、`ThemeAppearance` 类型、`CustomThemeDto` 类型——server 不 import `app/`，这是 DTO 与前端共用的唯一事实源；`app/utils/theme/theme-tokens.ts` 改为从这里取键类型
- `shared/dto/config.dto.ts`：
  - `CustomThemeDtoSchema = z.object({id: /^custom-[a-z0-9-]+$/, name: 1-50 字, appearance: z.enum(["light","dark"]), vars: z.record(键白名单, z.string())})`
  - `UiConfigDtoSchema.theme` → `z.string().default("sepia")`；新增 `customThemes: z.array(CustomThemeDtoSchema).max(50).default([])`
  - `ConfigBootstrapDtoSchema`（:418）加 `theme` + `customThemes`
- `server/config/normalizer.ts`：`normalizeTheme`（:497）放宽为「内置 8 id ∪ customThemes 现存 id，否则 fallback sepia」；新增 `normalizeCustomThemes`（id 去重、vars 非法键过滤，**不补齐缺键**——前端 resolve 时兜底）；`:161` 接线
- `server/config/registry.ts:79`：更新 `ui.theme` 描述；新增 `ui.customThemes` 条目 `{scope: global, effect: hot, merge: replace}`
- `server/api/config/bootstrap.get.ts` 返回补字段；`scripts/deploy/config-render.mjs:69` 透传 `customThemes ?? []`
- 跑 `bun run generate:openapi` 同步 route meta；config normalizer 测试补 case（新 theme 校验、customThemes 过滤）

### B7 前端主题运行时开放化（约 500 行）

- 新建 `app/utils/theme/resolve-theme.ts`：`resolveTheme(themeId: string, customThemes) → {vars: ThemeVars; appearance; label}`——内置查 `themeTokens`+`themeMeta`；自定义按 id 查列表，缺键以同 appearance 内置预设（dark→dark、light→sepia）合并兜底；未知 id → sepia。唯一解析入口
- `app/stores/novel-ide.ts`：`theme: Ref<IdeTheme>` → `activeThemeId: Ref<string>`；新增 `customThemes` ref；pinia persist 改存 `{activeThemeId, appearance, varsSnapshot}` 首屏缓存
- 启动时序（防 FOUC）：mount 时先 `applyThemeVars(持久化快照)` → `configApi.bootstrap()` → 与快照 reconcile（不同则重应用并更新快照）；bootstrap 现仅 AgentChatSurface.vue:648,670 调用，boot 接线放 `pages/index.vue` 主题挂载处
- 新建 `app/composables/useThemeManager.ts`：切主题（应用 + 静默 PUT global config，沿用 NovelIdeCostSettingsPanel.vue 的 `editorSnapshot → spread base → saveGlobal` payload 模式，失败 `useNotification` + 回滚）、自定义主题 CRUD 持久化、导入导出编排
- `useIdeTheme.ts` 改为消费 resolved `{vars, appearance}`；`monaco-theme.ts` 的 `buildMonacoTheme(theme, vars)` 改为按 `appearance` 分支选 preset（内置 sepia id 特例仍走 Solarized preset）；`MarkdownSourceEditor.vue`、`monaco-diff-theme.ts` 调用点跟改，`defineTheme` 名称用 themeId slug 化避免重名冲突
- `client-variables.ts:105`：Agent 切主题校验放宽为「内置 ∪ 自定义 id 集合」
- `NovelIdeSettingsDialog.vue`：themeOptions 改 computed（内置 themeMeta + customThemes 分组）；`updateTheme` → `themeManager.setTheme`
- 各 `*.preview.vue` 引用 `IdeTheme` 处按 typecheck 逐个修

### B8 派生规则 + 取色器基建（约 400 行）

- 提权安装：`bun add colord vue3-colorpicker`
- 新建 `app/utils/theme/derive.ts`：`CORE_VAR_KEYS`（13）、`deriveDefaults(coreVars, appearance) → 23 个派生值`（colord 实现；系数：accent-bg=15% 透明、status-bg/border=14%/32%、border-accent=accent 46% mix border、toolbar-bg=panel 92%、text-inverse 按 appearance 取黑/白、bg-subtle=panel↔main mix 等）。写 `derive.test.ts`（8 套内置核心色跑派生，断言输出合法颜色、深浅方向正确——不要求等于手调值）
- 新建 `app/utils/theme/theme-io.ts`：`exportThemeJson`（`{schemaVersion: 1, name, appearance, vars}`，下载复用 store 内 `triggerBrowserDownload`）+ `parseThemeJson`（zod 校验复用 shared schema，带版本检查）；单测
- 新建 `app/components/common/form/FormColorField.vue`：封装 vue3-colorpicker（色块按钮 + 弹层取色器 + hex/rgba 文本互同步，支持 alpha，非法输入局部红边提示）；登记到 CLAUDE.md 通用组件索引

### B9 主题编辑器 UI（约 700 行，拆 4 组件防大文件）

- `app/components/novel-ide/settings/theme/ThemeEditorDialog.vue`：编辑状态机（draft 主题、名称/appearance、实时 `applyThemeVars` 到宿主 = 全 IDE 即预览、取消恢复当前主题、保存走 themeManager）、「按核心色重新生成」按钮（明确提示会覆写派生位手改值）
- `.../ThemeCorePaletteSection.vue`：核心 13 色网格（FormColorField），改动即重算派生位并刷新预览
- `.../ThemeAdvancedVarsSection.vue`：36 变量按 8 分组折叠列表，显示变量名 + 当前值（可复制）+ FormColorField
- `.../ThemePreviewCard.vue`：小预览卡（面板/按钮/输入框/四状态徽标/编辑器色块）
- 设置对话框 frontend 区改造：主题列表（内置/自定义分组）+ 新建（复制当前选中为起点；含 color-mix 值时用离屏元素 `getComputedStyle` 解析为具体色）/编辑（仅自定义）/复制/删除（确认对话）/导出/导入
- i18n：`zh-CN.ts`/`en-US.ts` 补 `settings.frontend.theme*` 与变量分组/标签约 60 key × 2
- 错误出口遵循规范：Dialog 内表单错误走局部 error state，保存/导入失败走 `useNotification`

### B10 文档同步收尾（用户明确要求）

- **AGENTS.md 与 CLAUDE.md**（两文件内容有差异，分别更新各自 HTML/Vue 规范节）新增条目：颜色一律消费主题变量，禁止 Tailwind 调色板类与 `dark:` 变体；状态语义映射口诀；分类色板例外及叠底规范；新增组件层变量须在 theme README 登记
- `reference/theme/system.md` 全文重写（现内容过时：还写着 3 主题 + localStorage）：v2.1 体系、appearance、global config 存储、自定义主题与派生规则、bootstrap 时序
- `PROJECT-STATUS.md`：模块状态与本次架构决策同步
- `docs/tasks/89-theme-system-v2/README.md`：walkthrough 完整化（批次执行记录、验证结果、与计划的出入、遗留 TODO）

---

## Tailwind → 变量映射规则（迁移机械规则，按角色不按颜色名）

| 源模式 | 角色判断 | 目标 |
|---|---|---|
| `*-amber-*`/`*-yellow-*` 徽标、提示条、加载点 | 草稿/待审/警示 | `--status-warning` / `-bg` / `-border` |
| amber 的选中态（Sidebar 选中、ring、主线强调） | 选中强调 | `--border-accent` / `--accent-bg` / `--accent-main` |
| `*-rose-*`/`*-red-*` | 错误/删除/冲突 | `--status-danger` 三件套 |
| `*-emerald-*`/`*-green-*` | 成功/完成/已解决 | `--status-success` 三件套 |
| `*-sky-*`/`*-blue-*` | 信息/运行中/引用 | `--status-info` 三件套 |
| `*-slate/gray/zinc/stone-*` 文字 | 中性文字 | `--text-secondary`（600-700 档）/ `--text-muted`（400-500 档） |
| slate 系边框/底 | 中性结构 | `--border-color` / `--bg-input` / `--bg-hover` |
| `text-white`（accent/status 实底上） | 反色文字 | `text-[var(--text-inverse)]` |
| `bg-black/50`、`bg-white/10` 遮罩玻璃 | 遮罩 | 保留不动 |
| `dark:*` | — | 删除（变量已按主题适配） |
| 状态色 `/10 /20 /30` 透明度后缀 | 软底/软边 | 直接用对应 `-bg`/`-border` 变量（已含透明度） |
| style 块 `rgba(15,23,42,…)`、`color-mix(#000…)` 阴影 | 阴影 | `color-mix(in srgb, var(--shadow-color) N%, transparent)` |
| 深浅成对写法 `text-x-700 dark:text-x-300` | 状态文字 | 单一 `text-[var(--status-x)]` |

执行原则：替换后保持完整字面类名（UnoCSS 摇树安全，禁止运行时拼接类名）；不确定角色时看上下文交互语义再定，宁可标注 TODO 也不猜。

## 风险与对策

1. **UnoCSS 摇树**：所有 `bg-[var(--x)]` 保持字面量；映射表常量（分类色板）保留完整类名字符串
2. **FOUC**：pinia persist 变量表快照先行上色，bootstrap 后 reconcile
3. **color-mix 无法被 colord 解析**（复制预设为自定义起点时）：离屏元素 setProperty 后 `getComputedStyle` 读回具体色
4. **Monaco 主题重定义冲突**：defineTheme 按 themeId slug 命名，切换时重新 define+set（defineTheme 允许覆盖）
5. **多标签页 config 不同步**：接受；bootstrap reconcile 缓解，walkthrough 记录
6. **迁移视觉回归**：每批只做机械替换不动布局；批后切 8 主题目测；最终建议用户授权浏览器验证（不主动开浏览器）
7. **单批 >800 行**：B1/B2 已预拆；执行中超限继续按文件组拆分
8. **旧 config.json 兼容**：normalizer default + config-render 透传，缺字段自动补默认

## 验证方案

- 每批：`bun run typecheck` && `bun run test`（B6 后加跑 `bun run generate:openapi`）
- Phase 1 收尾：8 套预设逐一切换，目测 plot workbench / world-engine / agent 聊天 / 设置 / markdown+Monaco+diff 六个重点面
- Phase 2 收尾（全流程人工）：新建主题（复制 dracula）→ 调核心色实时预览 → 高级区覆盖单变量 → 按核心色重新生成 → 保存 → 切换内置/自定义 → 导出 JSON → 删除 → 导入恢复 → 重启服务主题保持（config.json 落盘）→ Agent 会话内请求切主题（client-variables 链路）
- 测试新增：derive.test.ts、theme-io.test.ts、theme-vars.css 同步锁、normalizer customThemes case；更新：theme-tokens.test.ts、world-engine-ide-entry.test.ts
