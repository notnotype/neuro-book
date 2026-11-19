# Task 146 - nb-ui shadcn-vue 重构与 NeuroBook UI 底座迁移

> 本任务的代码改动主体在 sibling 仓 `nb-ui`，NeuroBook 主仓在阶段 4 之前不改业务代码。任务文档留在主仓，沿用 [Task 113](../113-memory-system/README.md) 的 sibling spike 记法。

## Relative documents refs

- [Task 85：Fullstack Template / UI Library](../85-fullstack-template-ui-library/README.md) —— nb-ui 的起源任务，sibling 仓形态与首批抽取清单。
- [Task 89：主题系统 v2](../89-theme-system-v2/README.md) —— 36 变量主题合同的设计来源。
- [docs/drafts/ui-editorial-refactor.md](../../drafts/ui-editorial-refactor.md) —— 编辑室工作台方向草案（2026-08-10 拍板），D10 / D11 / D13 的来源：主题砍到 5 套、双区制、5 组新 token。
- [app/utils/theme/README.md](../../../app/utils/theme/README.md) —— Novel IDE 主题变量规范 v2.1，变量总表的事实源。
- [AGENTS.md](../../../AGENTS.md) —— 仓库级 Agent 约定，含 sibling 仓边界。
- `C:\Users\<user>\Documents\CodeRepository\GithubProjects\nb-ui` —— 本任务的主要工作仓。
  其中 `docs/authoring-themes.md` 是主题格式的规范（怎么写、怎么装、装不上看哪里），
  `docs/design-language.md` 是产品默认主题的设计语言与踩坑清单（第四轮产出，写给要动界面的人和 agent）。
- `C:\Users\<user>\Documents\CodeRepository\GithubProjects\neuro-book-ui-framework-exploration` —— UI 框架选型实验仓，`reports/decision-matrix.md`、`reports/interaction-qa.md`、`reports/engineering-cost.md` 为选型证据。

## User Request / Topic

用户决定 NeuroBook 的 UI 底座采用 shadcn-vue，并给出执行顺序：

1. 先在 nb-ui 全面重构、替换框架，不动 NeuroBook 主仓。
2. 在 nb-ui 里用该框架定制一套 NeuroBook 风格的组件，确定 UI 风格与设计语言。
3. 把 NeuroBook 仓库中的领域无关组件搬进 nb-ui 重写。
4. nb-ui 稳定后再考虑接入 NeuroBook。
5. nb-ui 后续承担 UI playground 职责，用于 UI / UX 设计。

用户已拍板：nb-ui **不**并入主仓 `packages/`，保持独立发布形态（`neuro-book-site` 仍依赖它）；nb-ui **直接全面重构**，不做保守试探。

## Goal

在 sibling 仓 `nb-ui` 上完成 UI 底座的框架替换与 NeuroBook 设计语言定制，产出一套可被 NeuroBook 主仓直接消费的组件库；验收面是 nb-ui 自身的 typecheck / vitest / playground 画廊，加上 NeuroBook 主仓一个真实 `.preview.vue` 页面的反向验收。过程中保持 `neuro-book-site` 的现有依赖不被打断，保持 NeuroBook 主仓在阶段 4 之前零业务改动。

边界限定在 `nb-ui` 仓、`neuro-book-ui-framework-exploration` 的证据文件，以及 NeuroBook 主仓的只读参考与单个 preview 样机。每一轮迭代记录：本轮换了什么、playground 与测试给出什么结果、下一步最值得验的是什么。若某阶段被上游能力缺口或主题合同冲突堵住，停下并报告已尝试路径、已取得证据、堵点，以及需要什么输入才能解锁——不通过 hack 绕过类型系统或伪造能力覆盖。

成功必须同时满足：

- nb-ui 的基础控件由 Reka UI 承载交互内核，暴露真实 ARIA 语义，键盘与焦点行为有测试证据。
- nb-ui 的颜色只来自主题变量合同，5 套 NeuroBook 内置主题（D10 新阵容）能在 playground 里逐套切换且无漏色。
- 从 NeuroBook 搬入的领域无关组件，功能不低于主仓现有版本（以主仓那份为功能基准，不是以 nb-ui 早期抽取版为准）。
- 图标方案在阶段 0 有实测结论，能覆盖运行时动态图标名，不是推演。
- nb-ui 与 NeuroBook 的差异、未验证项和已知缺口逐条记录，不用 playground 通过替代主仓接入验收。

## Non-goals

- 不在阶段 4 之前修改 NeuroBook 主仓的业务组件、样式引擎或主题实现。
- 不把 nb-ui 并入 `packages/`（用户已拍板）。
- 不把 World Engine 的 `--we-*` 皮肤变量迁入 nb-ui。
- 不在本任务内重做 NeuroBook 的领域组件（Plot / World Engine / Agent / Markdown Studio）。
- 不承诺 `nb-fullstack-template` 与 `neuro-book-site` 在迁移期同步跟进。

## Current State

以下均为 2026-08-10 静态核查结果，命令可复跑。**未跑构建，未实测 UnoCSS 与 Tailwind v4 的类名差异清单。**

### NeuroBook 主仓

| 项目 | 数字 | 位置 |
| --- | --- | --- |
| Vue 组件 | 250 个文件 / 75,103 行 | `app/` |
| 通用组件 | 41 个 | `app/components/common/` |
| 领域组件 | novel-ide 158（plot 45 / agent 38 / world-engine 25 / settings 21 / workspace 11 / 其他 18）、markdown-studio 10、profile-template-editor 14、workflow-preview 6、dnd-test 2 | `app/components/` |
| preview 页面 | 13 个 `.preview.vue` | `app/pages/` |
| 主题变量类写法 | 8,213 处 `[var(--x)]`，跨 229 个文件，涉及 88 个不同变量 | `app/**/*.vue` |
| 图标类 | 1,342 处 `i-lucide-*`，309 个不同图标，跨 168 个文件 | `app/**/*.vue` |
| 动态图标名 | 3 处运行时拼接 | `app/utils/lucide-icons.ts:21`、`app/pages/index.vue:789`、`app/utils/workspace-reference-menu.ts:31` |

样式引擎为 UnoCSS 66.6.2，`uno.config.ts` 使用 `presetUno()` + `presetIcons()`，并把 `@iconify-json/lucide` 的全部图标名加入 safelist。`nuxt.config.ts` 为 `ssr: false`（纯 SPA，无 hydration 风险）。

无障碍现状：全仓 `role="dialog"` 与 `aria-modal` 出现 **0 次**；`aria-label` 38 处，`role="menuitem"` 10 处、`role="status"` 9 处、`role="alert"` 7 处、`role="button"` 5 处、`role="menu"` 4 处、`role="switch"` 1 处。

前端验证面：`vitest.config.ts` 为 `environment: "node"`，注释写明"避免前端测试依赖和 Nuxt 浏览器运行时混进来"；`app/` 下 88 个 `.test.ts` 全部是纯逻辑投影，**没有 DOM 渲染测试**。全仓无 e2e 目录，浏览器证据来自 `scripts/deploy/desktop-workbench-browser-smoke.ts` 与 `scripts/deploy/product-browser-smoke.ts` 两个 Playwright 脚本。

### nb-ui 现状

`@notnotype/nb-ui` 0.1.0，`private: true`，PolyForm-Noncommercial-1.0.0，最后提交 `291b2d6`（2026-07-28）。28 个组件分 6 类（controls 7 / display 5 / feedback 6 / form 8 / layout 1 / navigation 1）。样式引擎同为 UnoCSS 66.6.2；已有 `happy-dom` + `@vue/test-utils` + `vitest 4.1.2` 测试基座——**这正是主仓缺的东西**。

`exports` 有 8 个入口：`.`、`./nuxt`、`./components`、`./composables`、`./theme`、`./uno`、`./utils`、`./styles.css`。其中 `./uno` 导出 `NB_UI_ICON_SAFELIST`，是 UnoCSS 专属契约，框架替换后会成为**破坏性变更**。`src/utils/focus-trap.ts` 是手写焦点陷阱，属于 Reka 接管后应删除的实现。

消费方依赖形态：

- `neuro-book-site`：`github:notnotype/nb-ui#291b2d6b49c4e92557eb305a1ffa38370644a5ce` —— **钉死在具体 commit**，nb-ui 改动不会波及它，直到它自己 bump。
- `nb-fullstack-template`：`link:@notnotype/nb-ui` —— 本地链接，会立刻受影响。
- NeuroBook 主仓：**当前完全不依赖 nb-ui**（`package.json` 无此依赖）。

### 主题合同对齐度（关键利好）

NeuroBook 登记 36 个主题变量，nb-ui 有 20 个：

| 分类 | 数量 | 内容 |
| --- | ---: | --- |
| 两边逐字同名 | 17 | `--bg-main`、`--bg-panel`、`--bg-subtle`、`--bg-hover`、`--bg-input`、`--text-main`、`--text-secondary`、`--text-muted`、`--text-inverse`、`--border-color`、`--border-strong`、`--accent-main`、`--accent-bg`、`--accent-text`、`--status-success`、`--status-warning`、`--status-danger` |
| 只在 NeuroBook | 19 | `--bg-sidebar`、`--border-accent`、`--status-info` 及 info/success/warning/danger 的 `-bg`/`-border` 共 10 个、`--editor-bg`、`--source-bg`、`--source-text`、`--source-muted`、`--shadow-color`、`--selection-bg`、`--toolbar-bg`、`--chat-ai-bg` |
| 只在 nb-ui | 3 | `--color-scheme`、`--shadow-panel`、`--overlay-bg`（NeuroBook 对应的是 `--shadow-color`） |
| World Engine 皮肤 | 30 | `--we-*`，只在 `.world-engine-workbench-theme` 映射，**不进 nb-ui** |

结论：主题合同对齐是**登记十几个变量**的工作，不是重新设计。

### 组件重叠度

nb-ui 28 个与 NeuroBook `common/` 41 个按文件名比对：

- **两边重名、已分叉 15 个**：`ContextMenu`、`Dialog`、`DialogWindow`、`Dropdown`、`IconButton`、`NotificationViewport`、`Combobox`、`FormCheckbox`、`FormField`、`FormInput`、`FormNumberInput`、`FormSelect`、`FormTextarea`、`SegmentedControl`、`TagInput`
- **只在 nb-ui 13 个**：`Button`、`Pagination`、`SwitchField`、`Tabs`、`Badge`、`EmptyState`、`Skeleton`、`Spinner`、`Table`、`Notification`、`Tooltip`、`Panel`、`FileTree`
- **只在 NeuroBook 26 个**：`DesktopTitleBar`、`JsonViewer`、`LucideIconPickerDialog`、`OriginalImagePreviewDialog`、`ReferenceChip`、`SideDetailPanel`、`SkillChip`、`diff/`（4）、`FormColorField`、`ReferencePlainTextEditor`、`ReferenceSelectorPopover`、`StructuredTextEditor`、`low-code-form/`（11）

比对口径为文件名，**未逐个比对 props 合同**。

### 选型证据

来自 `neuro-book-ui-framework-exploration`，2026-08-09 生成，最终 Playwright 汇总 `96 expected / 0 skipped / 0 unexpected / 0 flaky`。

加权总分：Reka UI 99、shadcn-vue 91、Nuxt UI unstyled 89、Nuxt UI styled 78、Ark UI 72、Headless UI 71。

shadcn-vue fixture 的真实形态：`tailwindcss 4.3.3` + `@tailwindcss/vite 4.3.3` + `reka-ui 2.10.1` + `class-variance-authority 0.7.1` + `clsx 2.1.1` + `tailwind-merge 3.6.0` + `@lucide/vue 1.30.0`；`components.json` 为 `style: "nova"`、`baseColor: "neutral"`、`cssVariables: true`。复制源码计量为 53 个文件 / 1,120 行；12 个 direct dependencies、735 个 resolved unique names；生产 build `62,806 ms`（本次五个 package 中最慢）；output `800,560 bytes`，output CSS `36,269 bytes`。

shadcn-vue 在本次 fixture 的已知缺口（原文记录，不外推为框架能力缺失）：Combobox 空结果没有取得可见证据，keyboard selection 为 `false`，多选留作记录项。

### 2026-08-15 接手收口补充

本段追加当前状态，不改写上面的 2026-08-10 静态基线。sibling `nb-ui` 仍在 `refactor/t146-reka-tailwind-base`，已将产品主题、浮层玻璃、浮层项同心圆角以及本轮三项收口提交为 `a8ae8fe`（21 个文件，包含 `dist/nb-ui.css`）。

本轮实际门禁为：`bun run test` 11 files / 173 tests 全过；`bun run typecheck` 无诊断；`bun run build:css` 成功；`git diff --check` 无错误。playground 真实页面在 `http://localhost:3001/` 验收：FormSelect、Dropdown、ContextMenu 的 20px / 13px 同心圆角、内层滚动与昼夜 alpha 0.12 高亮均通过，真实 `SegmentedControl` 为 10px 外框 / 7px 段。3000 端口当时已有服务，因此使用临时 3001 服务和系统临时目录探针；截图与脚本未进入仓库。

正式阶段 1.5 已收口；正式阶段 2 尚未开始，但 FormSelect、TimePicker、浮层基座以及本轮控件圆角和滚动下沉等原定后续债务已在获批的观感走查轮提前完成。主仓仍不依赖 `nb-ui`，本轮未运行主仓业务测试或文档构建；Task 146 目录仍是主仓现有的未跟踪迁移内容，本次不提交主仓。

## ADR / Decisions / Discussion

### D1 交互内核 = Reka UI（已定，勿重议）

shadcn-vue 不是 Reka UI 的竞品——`fixtures/shadcn-vue/components/ui/dialog/DialogContent.vue` 里的 `RekaDialogContent`、`DialogPortal`、`useForwardPropsEmits` 全部 import 自 `reka-ui`。选型报告里 99 / 91 的差距衡量的是**样式层代价**，不是内核优劣。因此"用 shadcn-vue"= Reka 内核 + 复制进来的 Tailwind 样式源码。

### D2 nb-ui 保持 sibling 仓，不并入 `packages/`（用户拍板）

理由：nb-ui 本就应独立发布，且 `neuro-book-site` 正依赖它。代价是迁移期跨仓改动摩擦——按 AGENTS.md，nb-ui 的改动必须进 nb-ui 仓执行，主仓不做该仓的 Git 操作。接受这个成本。

### D3 nb-ui 内部换 Tailwind v4，NeuroBook 主仓维持 UnoCSS（用户已确认）

"直接全面重构 nb-ui"理解为：nb-ui 无需保护存量，按 shadcn 官方形态走 Tailwind v4。主仓在阶段 4 之前不动 UnoCSS，两套引擎的会合点推迟到接入轮。

阶段 0 的实测（D7）已排掉这条口径最大的不确定性——图标方案在 Tailwind v4 下有零改动路径。

### D4 功能基准以 NeuroBook 那份为准

15 个重名组件是**两份已分叉的实现**，不是"库里已经有了"。nb-ui 那份是 Task 85 时期的早期抽取版；NeuroBook 那份承载真实业务边界（例：`Dialog.vue` 有 6 档尺寸预设、`teleportTarget` 开关、`overlayType` 两态）。合并一律以主仓那份为功能基准，缺失能力逐条登记。

### D5 每批组件必须有主仓真实页面反向验收（已被 D12 修正为阶段 3 起生效）

真空里做到的"稳定"只是 playground 里的稳定。NeuroBook 的真实压力——Monaco 差异合并、TipTap 引用芯片、可拖拽面板、主题热切换、390×844 窄屏——一个都不在 playground 里。因此每批组件都要用主仓一个 `.preview.vue` 通过 `link:` 接上跑通，再回头改 nb-ui。

**修正（D12）**：这条在阶段 2 无处落地（见 O5 的实测），已改为**阶段 3 起生效**。阶段 1–2 主仓零改动。

### D6 playground 的定位修正

主仓 13 个 preview 页里，`plot-*`（5）、`world-engine`、`subject-state-viewer`、`tsx-profile-editor`、`workflow`、`model-settings`、`structured-text-editor`、`diff-workbench`、`dnd` 全是领域页面，**搬不走**。nb-ui playground 的价值在于**新增基础组件画廊**，不在于替换现有 preview。

补充实测（2026-08-10）：13 个 preview 页里，直接渲染 `common/` 组件的只有 2 个，各 1 个——
`structured-text-editor.preview.vue` 用 `StructuredTextEditor`、`diff-workbench.preview.vue` 用 `DiffWorkbench`，
而这两个恰好都是阶段 4 判为「留主仓」或「重依赖 monaco 待定」的。**15 个重名基础控件没有任何 preview 页覆盖。** 这直接导致 O5。

### D7 图标方案 = Tailwind v4 + `@iconify/tailwind4` 预生成（阶段 0 实测后定）

实测报告：[reports/icon-strategy.md](reports/icon-strategy.md)。选定形态为
`prefixes: lucide` 预生成 + `iconSelector: ".i-{prefix}-{name}"` + `@source inline(...)` 全量登记
+ 9 行公共遮罩垫片。

三条决定性证据：**类名与现有 `i-lucide-*` 逐字相同**（主仓 1,342 处零改动）；
**运行时拼接的类名已在 Chromium 里验证渲染**，与静态用例逐项相同；非法图标名静默降级不报错。
产物 832,446 字节 / 97,848 gzip，与今天的 UnoCSS 全量 safelist（1,102,646 / 88,817）同量级。

已排除：`@lucide/vue` 按名取图标必须整桶引入，171,180 gzip，为三者最差；
`unplugin-icons` 的虚拟模块在构建期解析，语言层面不支持运行时名字。
`@iconify/vue` 保留为后续优化选项——它是唯一能代码分割的路线，能把常驻成本压到 ~15 KB gzip，
但要改写 168 个文件，**不与本次框架替换捆绑**。

### D8 `./uno` 导出直接删，不留兼容壳（用户拍板）

`NB_UI_ICON_SAFELIST` 是 UnoCSS 专属契约，换 Tailwind 后失效。删除后 nb-ui 自己产出
编译好的 `styles.css`，消费方不再需要登记任何图标类——这个能力由 D7 的预生成模式提供。
属破坏性变更，在迁移说明里逐条写清楚。

### D9 迁移期切 `0.2.0-alpha` 预发布线（用户拍板）

`neuro-book-site` 明确停在 `291b2d6`，不跟随迁移。`nb-fullstack-template` 走 `link:`
会立刻受影响，迁移期内它的破坏由本任务记录、不承诺同步跟进（见 Non-goals）。

### D10 主题按编辑室新 5 套做，不建已判死刑的 3 套（用户拍板）

[docs/drafts/ui-editorial-refactor.md](../../drafts/ui-editorial-refactor.md)（2026-08-10 拍板）要把主题从 8 套砍到 5 套：
新阵容为 `sepia` / `light` / `dark` / `midnight` / `slate`；`catppuccin` / `dracula` / `monokai` /
`one-dark-pro` / `tokyo-night` 全部下线。

nb-ui 现有 5 套预设里有 3 套（`catppuccin` / `dracula` / `tokyo-night`）在下线名单上。因此 nb-ui
直接建新阵容，**本 README 原「8 套主题可切换」的出口标准作废，改为 5 套**。

`sepia` / `light` / `dark` 的色值从主仓 `app/utils/theme/theme-tokens.ts` 取；`midnight` / `slate`
是新主题，草案只给了定位描述没给色值（见 D13）。

`NbThemePresetId` 的类型变更属破坏性变更，写进迁移说明。

### D11 编辑室 token 层先在 nb-ui 落地，主仓阶段 4 采纳（用户拍板）

草案 §4 新增 5 组非颜色 token（排版 / 间距 / 圆角 / 层级 / 动效），原文说事实源放主仓
`app/utils/theme/`。但本任务的 Non-goals 禁止阶段 4 之前改主仓主题实现。

结论：**nb-ui 按草案 §4 的具体取值实现 token 层并在组件上验证，主仓保持零改动。** 这正好落实
用户原始需求第 5 条「nb-ui 承担 UI playground 职责」。代价是事实源暂时在 nb-ui，阶段 4 要合流回
[app/utils/theme/README.md](../../../app/utils/theme/README.md) 的变量总表。

副作用：**O4（设计语言方向）基本已由草案回答**，不再需要额外的审美输入。阶段 3 的工作从
「问用户要方向」变成「把草案 §3 双区制和 §4 token 落到组件上」。

### D12 反向验收推迟到阶段 3，阶段 2 主仓零改动（用户拍板，关闭 O5）

D5 原文要求每批组件用主仓一个 `.preview.vue` 通过 `link:` 反向验收，但 2026-08-10 实测证明
两个前提都不成立：主仓 `package.json` 完全没有 nb-ui 依赖，13 个 preview 页也没有一个渲染
那 15 个重名基础控件。

结论：**阶段 2 的出口只认 nb-ui 自己的 happy-dom 测试与 playground 画廊，主仓保持零改动**；
反向验收整体推迟到阶段 3，届时再决定接入形态。

代价写在明处：**阶段 2 的「能用」只是画廊里的能用。** 两套样式引擎共存的问题（Tailwind v4 产物
进 UnoCSS 工程）在阶段 3 才第一次暴露，不在阶段 2。因此阶段 2 的结论一律标注「未经主仓验证」，
不得用画廊通过替代接入验收。这条随时可以升级——想提前验时，在主仓加一个基础控件 preview 页即可。

### D13 `midnight` / `slate` 在阶段 1 出第一版色值（用户拍板）

草案只给了定位（`midnight` = 更低亮度、长时间夜间写作；`slate` = 中性偏冷、承接原程序员暗色
主题使用者），没给色值。阶段 1 按定位先做一版，在 playground 里逐套切给用户看，不满意再调。
好处是阶段 1 就能验完整的 5 套切换，代价是可能返工调色。

### D14 阶段顺序重排：设计语言先于组件重写，新增阶段 1.5（用户拍板）

原计划是阶段 2 重写 28 个组件、阶段 3 才定设计语言。用户本轮要求反过来：**先试几种 UI 设计风格、
选定后做成设计语言，再重写组件**。

新顺序更省。阶段 2 要逐个重写 28 个组件，设计语言没定就重写等于注定返工。因此在阶段 1 与阶段 2
之间插入**阶段 1.5：设计语言探索**，只做探索与决策，不动任何 nb-ui 组件。

同轮附带决定：Tabs 标签栏那条 1px 纵向滚动条**不单独修**（根因见下），留到阶段 2 第 3 批重写时处理。

> Tabs 滚动条的根因已实测定案，留档备用：`Tabs.vue:86` 的 `overflow-x-auto` 会让 CSS 把
> `overflow-y` 从 `visible` 强制算成 `auto`，而 `Tabs.vue:96` 每个按钮的 `-mb-px` 把 flex 行高
> 压到 `clientHeight=31` 而按钮 border-box 仍是 `scrollHeight=32`，多出的 1px 触发纵向滚动条。
> 非本次框架替换引入：Tabs.vue 自 `e57c6b6`（2026-07-21 初始提交）未改过，且 UnoCSS 对这三个类
> 生成的声明与 Tailwind 逐字相同（`margin-bottom:-1px` / `overflow-x:auto` / `border-bottom-width:1px`）。
> 实测可行的修法是把容器 `border-b` 换成 `inset` 阴影并去掉 `-mb-px`：溢出归零，而分隔线（31..32）
> 与指示线（30..32）的绘制位置与现状逐项相同。

### D15 换肤机制 = 变量层，不是 class 表（本轮实测后定；**第三层已被 D17 推翻**）

> **2026-08-11 修正**：下表第三层「结构：不做，等真实需求」已被 **D17** 推翻——用户给出了真实需求
> （主题市场 + 组件级自定义）。前两层的结论不变，「排除 class 表」的结论也不变。

「支持自定义 UI 风格」拆成三层，按需要停在哪层：

| 层 | 表达什么 | 代价 | 现状 |
| --- | --- | --- | --- |
| 颜色 | 33 个主题变量 | 已具备 | 阶段 1 完成，自定义配色现在就能做 |
| **风格** | 形状 / 节奏 / 装饰 / **角色映射** | 一块 CSS 变量覆盖 | 阶段 1.5 建立契约，约 30 个变量 |
| 结构 | 组件解剖差异（红绿灯按钮、不同 Dialog 布局） | 变体或第二套组件集 | **不做**，等真实需求 |

**「角色映射」是本轮最重要的发现**：控件的面用哪个主题色、描边用不用色、分隔靠线还是靠底色——
这些是风格决策不是颜色决策。没有这一层，「低 chrome」这类风格根本表达不出来，只能靠改组件。

排除了「skin = 每个组件一张 class 字符串表」（类似 `app.config.ui`）：变量层已经能表达 5 套差异
很大的风格，class 表要为每个组件维护一份，成本按组件数线性增长。

代价说在明处：**同时维护多套风格不是一次性成本，是每加一个组件付多遍。** D10 刚把主题从 8 套砍到
5 套，理由正是维护面。所以内置只保留最终选定的一套，风格层的价值是让**别人**能换，不是我们自己维护多套。

### D16 `macos` 候选 = Apple Liquid Glass，且它突破了纯变量层（2026-08-11 用户指正后定）

第一版 `macos` 做成了 Big Sur 那代的 vibrancy（磨砂 + 微渐变），用户指出要的是 **Liquid Glass**
（WWDC 2025 / iOS 26 / macOS 26 Tahoe）。查证走 `codex exec -c tools.web_search=true` 外部检索。

两者不是程度差别：旧式 vibrancy 把背景**均匀散焦**，Liquid Glass 在边缘**弯曲、挤压并集中光线**
（lensing），轮廓由折射和镜面高光画出来。第一版正好踩中 Apple「常见错误」清单的头两条——
只做 `blur + 白色半透明`，以及把内容层也玻璃化。

**这条候选的特殊之处：它是 5 套里唯一突破「风格 = 一块 CSS 变量」的。** 另外三样东西是变量表达不了的：

| 需要什么 | 放在哪 | 是否影响 D15 结论 |
| --- | --- | --- |
| 镜面高光的独立绘制层 | showcase.css 的 `.sc-glass::after` | 否——机制常驻，风格只决定变量是不是 `none` |
| 折射用的 SVG 滤镜 | `app.vue` 里的隐藏 `<svg>` | 否——它是**资源**不是样式 |
| 窗口分层（导航层 / 内容层分开） | 对照页结构 | **是**——组件解剖要变，属 D15 的第三层 |

前两项仍然是「变量决定开关」，D15 不动摇。第三项要记账：Liquid Glass 要求工具栏和侧栏是浮在
内容之上的独立层，如果最终选它，阶段 2 重写组件时**布局结构本身要按这个分层来**，不是加几个变量。

三处硬边界：`backdrop-filter: url(#...)` **只有 Chromium 支持**（WebKit bug 245510 / Firefox 不支持），
折射是 `@supports` 渐进增强；**backdrop-filter 糊不到操作系统桌面**，要糊真桌面得由桌面壳开窗体级
vibrancy（`shared/desktop-contract.ts:10` 的 envelope 是 `["electron", "tauri"]`，两者都支持，
但那是阶段 4 之后的事）；**Apple 没有公开 blur 半径、圆角、折射率的数值**，实现取值是视觉近似。

### D17 方向升级为主题系统，目标是主题市场（2026-08-11 用户拍板）

用户把方向从「换肤」抬到「**主题系统**」，并给出两条要求和一个前提：主题开发者能做**组件级**自定义
（例：时间选择器在不同主题里是不同控件）；主题插件提供组件 + CSS 变量声明 + 几套 CSS 变量定义；
**打算做主题市场**，先用这个方案做两套主题试水。

实施计划见 [PLAN-stage-1_5-theme-system.md](PLAN-stage-1_5-theme-system.md)。外部调研（`codex exec` 联网，
每条带来源 URL）落在 `.agent/tmp/theme-plugin-research-7c41e9d2/answer.md`。

**术语重定义为三层**，原「风格 / skin」一词消失、被主题吸收：

| 词 | 是什么 | 原来叫什么 |
| --- | --- | --- |
| **配色**（colorway） | 一组颜色变量取值 | 「主题」（33 变量、5 套预设） |
| **主题**（theme） | 一个包：变量声明 + 取值 + 若干配色 + 资源 + **可选**的组件覆盖 | 「风格 / skin」 |
| **插件**（plugin） | 主题 + 任意 JS，单独安装与授权 | 无 |

**三档能力**，取自调研的推荐边界，与 VS Code（theme / extension 分离）、WordPress（theme / plugin 分离）同构：
①声明式主题（无门槛、运行期加载）②组件实现包（须声明 `hostVersion` + `contractVersion`、构建期加载）
③插件（任意 JS、须单独授权）。**市场第一版只开放第一档**，因为调研的结论是「在同一个 Vue/Nuxt app
context 中安全执行第三方 Vue 组件，未查到可被视为强安全沙箱的成熟方案」。

三条对设计有硬约束的调研结论（勿凭直觉推翻）：

- **没有主流 Web 组件库支持「主题包提供组件实现」。** PrimeVue / Vuetify 3 / Ant Design 5 / Nuxt UI v3 /
  Chakra v3 / Radix Themes / Material Web 全部把主题限定在 token + variant + slot class。
  Ant Design 的 `components: {Button: …}` 覆盖的是 token 不是组件。**我们是在开路，不是在抄。**
- **手机主题引擎也不换控件实现**——用它类比时要小心。Android RRO 明确禁止代码（manifest 必须
  `android:hasCode="false"`，不能含 DEX）；三星 Galaxy Themes Studio 官方定位是 "without coding"；
  MIUI `.mtz` / EMUI `.hwt` 均未查到官方支持携带可执行代码。
- **产品级先例只有 WordPress classic theme 与 Discourse theme components**，两者都伴随一条硬规则：
  主题可以替换渲染，**但切换主题不应让用户丢失核心功能**（WordPress 官方原话）。

本轮拍板的四件事：

1. **探针组件 = 时间选择器**（用户自己举的例子）。nb-ui 与主仓**都没有**日期/时间选择器（已查证），
   所以为探针写的实现不是一次性投入——阶段 2 本来就要新建它。换成覆盖已有组件的话，那份实现会在
   阶段 2 重写时全丢。
2. **试水范围 = 第一档完整 + 第二档一个探针，第三档不做。** 不冻结可覆盖白名单（组件还没重写）。
3. **两套主题先放 `playground/themes/` 目录内**，只证明格式，不建分发管道。
4. **manifest 必须是纯数据**（与运行期 entry 分离）——市场要能在不执行代码的前提下索引和校验主题。
   这是 VS Code 的做法（`package.json` contributions 与 extension entry 分离）。

**副作用：「从 5 套候选里选一套」这个卡点消失。** `editorial` 当默认主题，其余四套改名后自动成为
示范主题，零成本。D15 里那句「风格层的价值是让别人能换，不是我们自己维护多套」在这里被推到逻辑终点。

代价写在明处：**市场做起来之后，可覆盖组件的 API 就再也不能随便改了。** 这是这个方向真正的长期成本。
缓解手段是白名单极小起步——本轮只登记 1 个。

### D18 产品默认主题 = macOS 衍生的 `nbook`，阵容收到四套（2026-08-13 用户拍板）

D17 的副作用里写的是「`editorial` 当默认主题」。用户看过对照页后改了：

> 算了，还是基于 MacOS 这个主题改吧。我觉得目前 主题对照 这里的 MacOS 系列组合比较好看。
> NeuroBook 在这个基础上改吧。
> 你这个其实不能算是 MacOS 主题了。应该只能算是衍生。
> 建议新建一个主题在目前这个 MacOS 主题上进行微调。这样 UI 设计规范也可以一定程度上复用 MacOS 的。

第二句是对**命名诚实度**的判断，不是要求做得更像——`macos` 留在仓库里当格式参照（它复用 HIG 里
能查到出处的取值），产品主题另起一个 `nbook` 从它衍生。

三处拍板（AskUserQuestion，均取推荐项）：

1. **主题阵容删到 4 套**：`nbook` + `macos` + `editorial` + `aurora`，删 `lamplight`。
   `editorial` / `aurora` 是 `docs/authoring-themes.md` 里被引用的格式示范，不能删。
2. **改动允许改到真组件层**：主题变量 + 对照页 + 被点名的三处组件（下拉、时间选择器、浮层基座）。
   其余组件的硬编码刻度仍留给阶段 2。
3. **设计语言文档放 `nb-ui/docs/design-language.md`**，与 `authoring-themes.md` 并列。

`nbook` 的论点是「**玻璃是器械，纸不是玻璃**」：Apple 的规矩是玻璃只属导航 / 控件层，
写作工具把这条推到底——内容层不只实心，还是纸。身份落在**角色映射层**（器械从 `--bg-sidebar` 派生、
稿面从 `--bg-panel` 派生），不是全局色偏；实测证明后者在低亮度下根本看不出来。

实现与验证见 [walkthroughs/stage-1_5-product-theme.md](walkthroughs/stage-1_5-product-theme.md)。

**未冻结**：`nbook` 的强调色仍是 System Blue，即产品主题在颜色上暂时和 macOS 一模一样。
是否换成 NeuroBook 自己的强调色，留给用户走查时判断。

### D19 第 13 轮三项观感收口（2026-08-15 用户批准）

用户批准上一轮报告列出的三项代码改动，范围保持在 `nb-ui` sibling 仓：

1. 浮层当前项 / 悬停项新增 `--overlay-item-active` 角色；NeuroBook 主题从 `--text-main` 派生 12% 半透明高亮，无障碍降级档写回不透明 `--bg-hover`。
2. 控件外框圆角统一消费 `--radius-control`；贴外框角的分段控件段按 `max(2px, calc(var(--radius-control) - var(--border-w) - 2px))` 推导同心圆角。
3. Dropdown / Combobox 将滚动交给内层，外框只负责玻璃面与裁切，避免滚动条进入圆角和列表首尾被弧线削掉。

三项均已通过 nb-ui 测试、typecheck、CSS 构建和真实 playground 探针，并收口为 `a8ae8fe`。亚克力 blur / tint / brightness 经过 A/B 后保持现状，不再做观感调整；`themes/macos/` 不在本轮修改范围，产品侧“减少透明度”开关和主仓接入仍按既有 TODO 处理。

### 待拍板

- **O4 设计语言方向**：**基本已由编辑室草案回答**（见 D11）。阶段 3 若草案未覆盖的地方需要审美输入，届时再问。
- ~~**O5 D5 与 D3 冲突，反向验收在阶段 2 无处落地**~~ —— **已关闭**，结论为 D12（推迟到阶段 3，阶段 2 主仓零改动）。
  实测依据保留：主仓 `package.json` 完全没有 nb-ui 依赖，也没有任何文件 `import "@notnotype/nb-ui"`；
  13 个 preview 页没有一个渲染那 15 个重名基础控件。

## 目标架构

```text
领域 UI（novel-ide / plot / world-engine / markdown-studio，约 200 个组件）
    │  只消费下面两层，禁止直接 import reka-ui
    ▼
NeuroBook 组件层
    ├─ nb-ui：基础控件 + 领域无关组件（本任务的产出）
    └─ app/components/common：留在主仓的领域组件（ReferenceChip / StructuredTextEditor / DesktopTitleBar …）
    ▼
交互内核  reka-ui（无样式：焦点、键盘、ARIA、浮层定位）
    ▼
样式引擎（nb-ui 侧 Tailwind v4 / 主仓侧 UnoCSS，阶段 4 会合）
    +  主题变量层（17 共有 + 19 待补；--we-* 不进 nb-ui）
```

三条应写死的规则：

1. **业务组件永不 `import ... from "reka-ui"`**，一律经过组件层。以后换内核只改一层——这是本次重构唯一能留下的长期资产。
2. **主题变量层是颜色的唯一真相源。** shadcn 的 `--color-background` 之类只能是现有变量的**别名**，不允许有自己的字面值，否则 5 套主题会出现"有些地方不跟着换"。
3. **外观差异用 `variant` 表达**（cva），不在业务组件里再写颜色类补丁。

## 阶段划分

### 阶段 0：图标与样式引擎实测（先于一切代码改动）—— 已完成

产出：[reports/icon-strategy.md](reports/icon-strategy.md)。覆盖静态图标、运行时动态图标名、
按需提取是否可靠、产物体积，含 Chromium 渲染验证与失败原文。

出口达成：O1 定案为 D7，D3 口径经用户确认。

实测同时修正了两处 README 原有描述：

- 硬约束不止「3 处运行时拼接」。成本主因是 `LucideIconPickerDialog.vue` 一次渲染整个图标集
  （`app/utils/lucide-icons.ts:10` 全量展开 `lucideIconOptions`），这才是全量 safelist 的真正原因。
- **nb-ui 自身的图标面只有 15 个**（`src/` 39 处 / 15 个不同图标，与 `NB_UI_ICON_SAFELIST` 比对无缺口；
  另 25 个在不发布的 `playground/`）。全量 1,805 图标的成本属于主仓，**阶段 1–3 碰不到它**，
  只在阶段 4 接入时付账。


### 阶段 1：nb-ui 框架替换

换入 `reka-ui` + Tailwind v4 + `cva` / `clsx` / `tailwind-merge`；按 D7 接入图标方案；补齐主题合同（17 共有 + 从 19 个 NeuroBook 独有里筛出应公开的部分 + 草案 §4 的 5 组新 token，见 D11）；预设阵容按 D10 换成新 5 套，`midnight` / `slate` 按 D13 出第一版色值；按 D8 删除 `./uno` 导出并写迁移说明；按 D9 切 `0.2.0-alpha`。

**这一步刻意不动任何组件的交互行为**——地基和行为混在一轮改，出问题分不清是谁的锅。原文写在阶段 1 的「删除 `src/utils/focus-trap.ts`」**已移到阶段 2 第 2 批**，因为删它必须同时把 `Dialog.vue` 换成 Reka 内核，那属于行为改动。

**新增交付物：库 CSS 构建。** D8 要求消费方零登记，这就要求 nb-ui 产出编译后的 CSS；而 nb-ui 目前没有库构建（`build` 脚本是 `nuxt build playground`），`exports["./styles.css"]` 直接指向源码。阶段 1 需新增 `build:css` 产出 `dist/nb-ui.css`，并把 `exports["./styles.css"]` 与 `src/module.ts` 的 CSS 注入同步改指产物。

出口：nb-ui typecheck + vitest 全绿，playground 能跑，5 套主题可切换，组件行为与替换前一致。

### 阶段 1.5：设计语言探索 →（D17 后）主题系统（本阶段不重写 28 个组件）

**第一、二轮（已完成）**：playground 重写为「设计实验室」，风格 × 主题两轴独立切换，同一份界面切片在
5 套风格下逐套对照。5 套候选为 `editorial`（编辑室）/ `macos`（Apple Liquid Glass）/ `quiet`（低 chrome）/
`terminal`（高密度 IDE）/ `aurora`（现代精致）。对照页用**手写标记**而不是 nb-ui 组件——现有组件把尺寸
刻度硬编码在模板里，不消费 token，五套风格里有四套会被裸值顶回去。所以这两轮证明的是**风格契约够用**，
不是组件已经能换肤。

**第三轮（已实施，D17）**：方向升级为主题系统，出口随之改写。计划见
[PLAN-stage-1_5-theme-system.md](PLAN-stage-1_5-theme-system.md)，实现报告见
[walkthroughs/stage-1_5-theme-system.md](walkthroughs/stage-1_5-theme-system.md)。批 0–5 全部落地：
⓪提交现存改动 ①术语重命名 + 目录拆分 + `data-nb-appearance` ②manifest 契约 + 加载器 + 校验
③**五套**主题包（不是两套）④覆盖机制 + 契约登记表 + TimePicker ⑤macOS 滚轮 + 覆盖/回退实测 + 主题开发者文档。

出口：~~用户选定一套风格~~ → **主题包格式定稿 + 五套主题跑通 + 组件覆盖机制有实测证据** → 已达成。
149 passed、typecheck 无输出、Chromium 探针 5 主题 × 亮暗共 10 组全过（含覆盖生效与逐组件回退两条）。
第 5–13 轮的用户走查与工程收口已完成：`nb-ui` 当前提交为 `a8ae8fe`，本阶段的正式出口已达成。正式阶段 1.5 已收口，正式阶段 2 尚未开始；本轮提前完成的组件债务不代表整个阶段 2 已启动。

### 阶段 2：基础控件重写

15 个重名组件按 D4 以主仓那份为功能基准重写；nb-ui 独有 13 个同步换内核。每批配 playground 画廊页 + happy-dom 测试（键盘、焦点、ARIA 角色）。

出口：每批有测试证据 + 画廊页。**按 D12，本阶段不做主仓反向验收，主仓零改动**；每批结论标注「未经主仓验证」。

### 阶段 3：设计语言落地 + 反向验收

O4 已基本由编辑室草案回答（D11），工作从「问方向」变成「把草案 §3 双区制和 §4 token 落到组件上」。

阶段 2 欠下的反向验收在这里一次性还：主仓通过 `link:` 接 nb-ui 跑通一个真实页面（D5 + D12）。此时才第一次面对 Tailwind v4 产物进 UnoCSS 工程的会合问题——这是被推迟但没有被消除的最大风险，进入阶段 3 前先确认它仍可接受。接入形态（用现有 preview 页还是新增一个基础控件页）到阶段 3 开工时再定。

### 阶段 4：领域无关组件搬迁 + 主仓接入

从主仓 26 个独有组件里筛出领域无关的搬入 nb-ui 重写；然后才是主仓接入——**8,213 处类名和 1,342 处图标在这里付账**。此阶段需要单独立任务或单独立 GOAL，不在本 README 内冻结方案。

第一版搬迁候选（**待逐个确认，不是定案**）：

| 组件 | 初判 | 备注 |
| --- | --- | --- |
| `JsonViewer` | 领域无关 | 477 行 |
| `FormColorField` | 领域无关 | 276 行 |
| `SideDetailPanel` | 领域无关 | 布局件 |
| `OriginalImagePreviewDialog` | 领域无关 | 图片预览 |
| `LucideIconPickerDialog` | 领域无关 | 与 O1 图标方案强耦合 |
| `diff/`（4 个） | 领域无关但重依赖 | 依赖 monaco-editor，是否入库需单独判断 |
| `low-code-form/`（11 个） | 多数领域无关 | `LowCodeResourcePresetField` 依赖 workspace 资源，应留主仓 |
| `DesktopTitleBar` | 领域相关 | 桌面壳，留主仓 |
| `ReferenceChip` / `SkillChip` | 领域相关 | 留主仓 |
| `StructuredTextEditor` / `ReferencePlainTextEditor` / `ReferenceSelectorPopover` | 领域相关 | 依赖 workspace 引用补全，留主仓 |

composables 侧同样待筛：主仓 `useResizablePanel`、`useNotification`、`useDialog`、`useCollapsible`、`useFloatingPanelLayout` 是候选；nb-ui 已有 `useNotification`、`useResizablePanel` 两个早期版本，同样按 D4 处理。

此阶段还要做三件前面阶段埋下的合流：

1. nb-ui 的 token 事实源合流回主仓 [app/utils/theme/README.md](../../../app/utils/theme/README.md) 变量总表（D11 的代价）。
2. 主仓主题阵容按草案 §5 从 8 套改 5 套，**必须先加 ID 别名层再删**——`app/utils/theme/resolve-theme.ts:44` 对未知 ID 静默回退 `sepia`，直接删会让 Dracula 用户某天打开变成米黄纸。牵连 `shared/theme/theme-vars.ts:6` 的 `builtInThemeIds`、`app/styles/theme-vars.css`、`server/config/normalizer.test.ts`、`docs/guide/theme.md`。
3. 决定 `LucideIconPickerDialog` 是否搬进 nb-ui——搬迁会把全量 1,805 图标成本带进库。

## Verification / Test

- nb-ui：`bun run typecheck`、`bun run test`（vitest + happy-dom）、`bun run build:css`，每批组件补键盘 / 焦点 / ARIA 断言。
- nb-ui playground：`bun run dev`，画廊页覆盖每个控件的常态、禁用、错误、密度和 5 套主题切换。
- 反向验收：主仓 `link:` 接 nb-ui 后跑通一个真实页面——**按 D12 从阶段 3 起生效**，阶段 1–2 不做。
- 阶段 0 的图标实测单独出报告，含命令、版本、产物体积和失败原文。
- **主仓 focused test、typecheck、浏览器验收分别记录，不互相替代**；nb-ui 全绿不等于主仓接入通过。

## Implementation Walkthrough

每轮实现报告放同目录 `walkthroughs/`；开工前的实施计划放同目录 `PLAN-*.md`。

- [PLAN 阶段 1.5 第三轮：主题系统与主题包契约](PLAN-stage-1_5-theme-system.md)（2026-08-11，**已实施**）——
  D17 的实施计划。三档能力、术语重命名表、manifest 契约、组件覆盖机制、时间选择器契约 v1、
  两套主题的分工、5 个批次与验证判据（含三个「坏主题必须被拒绝」的负例）。
- [阶段 1：nb-ui 框架替换](walkthroughs/stage-1-framework-swap.md)（2026-08-10）—— 出口全部达成（typecheck 绿、62 passed、playground 可跑、5 套主题实测可切）。含 UnoCSS → Tailwind v4 的实测差异清单（249 个类里 222 个计算样式完全一致）、与计划的三处出入，以及一处需用户过目的刻意改动（`text-sm` 14px → 13px）。报告撰写时改动未提交，后续已随 Task 146 累计收口。
- [阶段 1.5 第三轮：主题系统与主题包契约](walkthroughs/stage-1_5-theme-system.md)（2026-08-11）—— 批 0–5 全部实施，7 个 commit 落在 `refactor/t146-reka-tailwind-base`（149 passed / typecheck 无输出 / 探针 10 组全过）。与计划三处出入（五套主题而非两套、九条校验而非四条、契约套件抽进 `src/testing/` 由主题调用）。含三个实测发现：只测「覆盖生效」不够、镜面高光在 `::after` 上要读伪元素、两处断言被自己的注释绊倒。历史报告当时等待浏览器走查；当前收口见下方第 5–13 轮报告。
- [阶段 1.5：设计语言实验室](walkthroughs/stage-1_5-design-language-lab.md)（2026-08-10 / 08-11 第二轮）—— playground 重写为风格 × 主题双轴对照工具，5 套候选风格实测可切（63 passed）。含风格契约与三个实测发现：`tokens.css` 按主题宿主重复声明 token 导致根级覆盖失效（已修 + 加测试）、`--accent-text` 不是「填充面上的文字色」（主题合同缺这个角色）、第一版 macOS 是旧式 vibrancy 不是 Liquid Glass（已重做，含边缘折射的像素对比验证）。风格选择出口随后由 D17/D18 改为主题系统与 `nbook` 产品主题。
- [阶段 1.5 第 5–13 轮收口](walkthroughs/05-leader-2026-08-15_23-02-stage-1_5-rounds-5-13-closeout.md)（2026-08-15）—— 按可核验提交与行为归档 `156bca8`、`2a528c3`、`136e488` 和 `a8ae8fe`；记录浮层玻璃、同心圆角、半透明高亮、控件圆角 token、内层滚动的实测结果。第 5–12 轮没有独立持久交接，报告不虚构“一轮一个提交”的映射。

## TODO / Follow-ups

- [x] 确认 D3 口径（nb-ui 换 Tailwind v4，主仓维持 UnoCSS）—— 用户已确认。
- [x] 阶段 0：图标方案实测，出 O1 定案 → [reports/icon-strategy.md](reports/icon-strategy.md)，结论为 D7。
- [x] O2：`./uno` 导出的处置方式 → D8，直接删。
- [x] O3：nb-ui 迁移期版本线 → D9，切 `0.2.0-alpha`，`neuro-book-site` 停在 `291b2d6`。
- [x] O4：设计语言方向 → 基本由 [编辑室草案](../../drafts/ui-editorial-refactor.md) 回答，见 D11。
- [x] O5：阶段 2 反向验收无处落地 → D12，推迟到阶段 3，阶段 2 主仓零改动。
- [x] 主题阵容 → D10，改为 `sepia` / `light` / `dark` / `midnight` / `slate` 5 套。
- [ ] `midnight` / `slate` 的具体色值：阶段 1 已出第一版（D13），**待用户在 playground 里过目**。
- [ ] `text-sm` 由 token 层改为 13px（原 14px），影响 nb-ui 22 处：属设计语言改动提前发生在阶段 1，**待用户确认是否接受**，否则退路是把 token 改成不与 Tailwind 刻度重名的名字。
  **注意与第四轮冲突**：产品主题 `nbook` 明确选了 14px 并写了理由（汉字字面几乎占满 em 框，13px 的 SF 换成汉字明显更挤），要推进这条得先解决冲突。
- [x] ~~**阶段 1.5 出口：从 5 套候选里选定一套风格**~~ —— **已被 D17 取消**。主题系统成立后不需要二选一。
  第四轮定下产品默认主题是 `nbook`（macOS 衍生），其余三套（`macos` / `editorial` / `aurora`）是示范主题。
- [x] **阶段 1.5 第三轮（D17）**：按 [PLAN-stage-1_5-theme-system.md](PLAN-stage-1_5-theme-system.md) 分批实施完毕
  （实际 6 批，含批 0 提交现存改动）→ [实现报告](walkthroughs/stage-1_5-theme-system.md)。历史实施时代码尚未提交；当前 sibling 仓整体已由后续提交收口，最新验证见第 5–13 轮报告。
- [x] **阶段 1.5 第四轮：产品主题定稿**（2026-08-13 用户改向）→ [实现报告](walkthroughs/stage-1_5-product-theme.md)。
  产品默认主题从 `lamplight` 改为 macOS 衍生的 `nbook`，`lamplight` 删除，阵容收到四套；
  用户点名的五处缺陷各有可复现判据；设计语言文档落在 `nb-ui/docs/design-language.md`。
  当前产品主题代码与第 13 轮收口已在 `a8ae8fe` 提交；nb-ui 测试、typecheck、CSS 构建和 playground 探针均已通过，未 push / 未开 PR。
- [x] **阶段 1.5 第 5–13 轮收口**（2026-08-15）→ [实现报告](walkthroughs/05-leader-2026-08-15_23-02-stage-1_5-rounds-5-13-closeout.md)。`a8ae8fe` 包含 21 个 nb-ui 文件；实际门禁为 11 files / 173 tests、typecheck 无诊断、CSS 构建成功、真实 playground 几何与昼夜高亮探针通过。正式阶段 2 尚未开始。
- [ ] **`--window-backdrop` 应上升为配色契约的一个角色**：`macos` / `aurora` / `nbook` 各 `declare` 了一次，
  按 `NbThemeVarDeclaration` 上写的判据，两套以上主题都要用的变量说明配色契约漏了一角。阶段 2 收口。
- [ ] 主题市场的**分发形态**未定：nb-workshop 的包分发（zip + 平台生成 manifest，Task 88 已建成）
  适合第一档，npm 适合第二档，可能两条并存。不在 PLAN 内冻结。
- [ ] 主题市场的**审核与签名**：第二、三档上市场前必须解决。调研结论是「在同一个 Vue/Nuxt app context
  中安全执行第三方 Vue 组件，未查到可被视为强安全沙箱的成熟方案」，VS Code 靠 publisher trust +
  marketplace 扫描 + 签名 + block list 那一整套运营。不在 PLAN 内。
- [ ] **可覆盖组件白名单**：等阶段 2 组件重写完再定，本轮只登记 `time-picker` 一个。初判适合覆盖的是
  数据契约清晰的那批（FormSelect / Combobox / TagInput / Pagination / SegmentedControl / SwitchField /
  FormNumberInput + 未来的 DatePicker / ColorPicker）；Dialog / Panel / Tabs / ContextMenu / Table
  这类契约是 slots 和布局的不适合；Button / Badge / Spinner 太薄，变量层就够。
- [ ] 默认主题是 macOS 衍生的 `nbook`（第四轮定），所以 D16 那四件事**已经生效**，逐条状态：
  窗口分层写进组件结构 —— 未做，对照页里成立、真组件仍是阶段 2 的事；Clear 变体 —— 不做；
  实测 `backdrop-filter` 在 Monaco / TipTap 页面上的滚动帧率 —— **未做**，这是接入主仓前的硬前置；
  产品设置里自带「减少透明度」开关 —— 未做，CSS 侧的 media query 已就位，缺产品侧开关。
- [x] 风格契约里有 12 个变量是 `tokens.css` 目前没有的（`--font-display` / `--tracking-ui` / `--control-h-*` / `--control-px` / `--border-w` / `--surface-raise` / `--inset-shadow` / `--elevation-raised` / 7 个角色映射变量 / `--focus-ring` / `--focus-outline`）—— 第三轮批 3 已作为「主题层基线」补进 `src/tokens.css` 的裸 `:root`，并加测试守住（「一个主题都没装」是受支持的状态，基线不能挂在 `[data-nb-theme]` 下）。
- [ ] 补「填充面上的文字色」角色（暂用 `--text-inverse` 顶着）：`--accent-text` 是强调色的文字版本，不是反白文字，用在填充按钮上会深压深。阶段 4 回写主仓变量总表时一并处理。
- [x] `src/tokens.css` 按主题宿主重复声明 token 导致任何根级覆盖失效 —— 已修（选择器改为只用 `:root`）并加测试守住。
- [ ] Tabs 标签栏 1px 纵向滚动条：按 D14 不单独修，留到阶段 2 第 3 批重写时处理（根因与修法已实测，记在 D14 下）。
- [ ] 逐个比对 15 个重名组件的 props 合同差异（当前只按文件名比对）—— 留在阶段 2 每批开工时做。
- [x] 在真实 Nuxt 4 + `@tailwindcss/vite` 工程里复验 D7 的 `@source inline`（阶段 0 只用 `@tailwindcss/cli` 独立构建）—— 阶段 1 playground 已验；同时实测发现 nb-ui 侧根本不需要 `@source inline`，源码扫描即可。
- [x] 实测 UnoCSS 与 Tailwind v4 在**图标以外**的类名差异清单 —— nb-ui 侧已完成（249 个类，222 个计算样式一致，逐条判读见阶段 1 报告）。主仓侧 8,213 处仍未测，是阶段 3 反向验收与阶段 4 的输入。
- [ ] 阶段 4 接入方案单独立任务；主仓 8,213 处类名与 1,342 处图标的迁移策略不在本 README 冻结。
- [ ] 阶段 4 决定 `LucideIconPickerDialog` 是否搬进 nb-ui——它与 D7 强耦合，搬迁会把全量图标成本带进库。
- [ ] 阶段 4 主仓主题从 8 套改 5 套时，先加 ID 别名层再删（`resolve-theme.ts:44` 对未知 ID 静默回退 `sepia`）。
- [ ] 若阶段 3 产出稳定设计语言，考虑是否需要在主仓开 Issue 跟踪接入排期。
