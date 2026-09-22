---
schema: nbook.task/v2
taskId: t07-component-lab-uiux-polish
role: tasker
---

# 精修 Component Lab 响应与动效

## 目标

补齐 Component Lab 已暴露的运行中窄屏响应与基础转场，使 Lab 在不改变组件选择、fixture、数据和受控侧栏 API 的前提下，在桌面与窄屏之间切换仍可用，场景切换与侧栏收起有稳定且可取消的视觉反馈。

## 范围

- `LabShell` 在运行中从宽屏进入 `<=700px` 时自动收起左右侧栏。
- 从窄屏回到宽屏不自动展开，保留用户最后一次展开/收起决定。
- 侧栏宽度切换和场景动态组件切换提供主题变量驱动的转场。
- `prefers-reduced-motion: reduce` 下关闭新增转场，不改变交互结果。
- 更新 Component Lab Spec、smoke 与 walkthrough，记录实际验证和未授权人工验收。

## 不做

不新增第三方依赖，不改变 `CollapsibleSidePanel` 的 props/emits，不修改 fixture 数据、组件索引、正式产品页面或产品状态，不把 Component Lab 变成正式功能。

## 验收

1. 运行中的 Lab 从宽屏缩到 `<=700px` 后，两侧栏均收起，画布仍可用；恢复宽屏不自动展开。
2. 侧栏宽度和场景切换有转场；`prefers-reduced-motion: reduce` 下转场时长为零或不产生动画。
3. `390×844` 页面无页面级横向滚动，侧栏展开按钮、场景选择和画布核心操作可继续使用。
4. 相关 typecheck、聚焦 smoke 与差异检查通过；walkthrough 区分自动浏览器证据与未获授权的人工视觉验收。

## 开发者参与

浏览器人工视觉验收仍需开发者单独授权；未授权时不得将自动 smoke 或静态检查写成完整人工验收结论。

## 验证命令

- `bun run --cwd=packages/neuro-book typecheck`
- `bun run --cwd=packages/neuro-book smoke:component-lab -- --url <dev-url> --browser-executable <chromium>`
- `bun run docs:check`
- `git diff HEAD --check`

## 固定依据

- [`docs/specs/ui/component-lab.md`](../../../../../../docs/specs/ui/component-lab.md)
- [`docs/standards/code/frontend.md`](../../../../../../docs/standards/code/frontend.md)
- [`docs/standards/code/components.md`](../../../../../../docs/standards/code/components.md)

## 执行记录（2026-09-21 组件树区分度与画布工具条不滚动）

- **背景**：开发者反馈两点——左侧组件树一百多项只有文字可辨，同形状图标同色，扫读困难；中栏
  `div.lab-bar.lab-bar--tight` 带 `overflow-x: auto`，控件被推到可视区外，「后面重要的控件需要滚动才能展示」。
- **树行分类着色**：`LabShell.vue` 的 `KIND_ICONS` 在原有七类图形上按**大类**补颜色（`view`/`list` → `--status-info`，
  `dialog`/`panel` → `--accent-text`，`section` → `--status-success`，`field` → `--status-warning`，`part` → `--text-secondary`），
  目录行 folder 与不可挂载的锁取 `--text-muted`。颜色只管把大堆分开，形状仍负责七类互不重复。
- **工具条不滚动**：`overflow-x: auto` → `overflow: hidden`，`height` → `min-height`（保留与两侧栏标题栏对齐的 40px，
  空间不足时允许换行增高），加 `flex-wrap` 与 `container-type: inline-size`；左半边（名字、别名、场景下拉）收进
  `lab-bar__lead` 可收缩容器，右半边四个画布旋钮收进 `lab-bar__controls`（允许自身收缩并在内部换行）。
  收缩顺序由容器查询按**这一条自己的宽度**决定：≤1160px 隐藏别名，≤1000px 场景下拉收窄到 190px 且隐藏「画布底/缩放」文字标签，
  ≤820px 场景下拉 150px。媒体查询在这里是错的尺子——中栏被拖窄时窗口可能还很宽。
- **实测**（`/lab`，1440 视口）：工具条 710×40，`scrollWidth == clientWidth`，四个旋钮与场景控件全部在可视区内；
  1180 视口（中栏 450）仍单行无溢出；980 视口（中栏 250）换行成 4 行、控件齐全且无横向滚动；
  `macos + nbook-light` 下五类图标实测取到 `#0a7ea4` / `#0060df` / `#9a5b00` / `#57534b` 等对应 token 值。
- **测试**：`app/component-lab` 13 文件 / 65 例通过。
- **边界**：中栏窄到 250px 以下时，换行到极限后仍会超出（被 `overflow: hidden` 裁切）——这条栏上的
  `ToggleGroup`（画布宽度预设）最小宽约 180px。根治要「中栏不足时自动收起侧栏」，属行为变更
  （现行规范只按视口 `<=700px` 收起），本轮未做。顶栏 `.lab-bar` 仍保留 `overflow-x: auto`，未在本轮范围内改动。
- **真实浏览器 smoke**：`bun run smoke:component-lab:core -- --url http://127.0.0.1:3001 --browser-executable <chromium>`
  → `Component Lab smoke passed`（10.4s）。四主题中只实测了 `nbook-dark`（截图）与 `macos + nbook-light`（token 取值），
  `editorial` / `aurora` 未逐主题看过图标配色。
- **typecheck**：`bun run --cwd=packages/neuro-book typecheck` 报错全部落在既有 Agent fixture 测试
  （`AgentSystemPromptPanelFixture.test.ts` 30、`AgentLinkedAgentPanelFixture.test.ts` 24、`AgentSidebarViewFixture.test.ts` 20、
  `AgentSessionHeaderFixture.test.ts` 18）、`AgentChatFlow.vue` 1、`NovelIdeActivityBarFixture.vue` 1；
  本轮改动的 `LabShell.vue` / `component-index.ts` / `WorkbenchShellLayoutFixture.vue` / `fixtures/index.ts` 零错误。
- **顶栏同步改造（同日第二轮）**：`header.lab-bar` 原来也是 `overflow-x: auto`，按同一策略改为不滚动——`overflow: hidden` +
  `min-height: calc(var(--control-h-lg) + var(--space-4))` + `align-content: center` + `container-type: inline-size`；
  模板分成 `lab-bar__lead`（标题 + 计数）与 `lab-bar__controls`（主题 / 配色 / 桌面 / 壁纸 / 恢复默认），
  收缩顺序：≤1180px 藏计数 → ≤1020px 三个下拉收窄 → ≤880px 再收一档。实测 1440 / 1180 / 1020 / 900 / 800 视口
  顶栏高度恒为 48px、`scrollWidth == clientWidth`、控件全在栏内；600 / 520 视口仍单行无溢出。
- **`:deep` 的必要性**：三个整页下拉与中栏的场景下拉都是 `NbFormSelect`，它的根节点由组件自己 `$attrs` 绑定，
  不带父组件 scope id，普通 scoped 选择器落不到它身上，宽度会被组件自带的 `w-full` 撑满（实测主题下拉变成 393px）。
  因此宽度规则一律写成 `.lab-bar__controls :deep(.lab-bar__theme)` 形式；顶栏三个下拉恢复 170 / 150 / 150，
  窄档 140 / 124 与 120 / 108，中栏场景下拉在窄档精确取 190 / 150。
- **集成入口图形（同日第三轮）**：索引新增派生字段 `integrationEntry`（= 被别的条目声明为 `验证入口` 的组件），
  导航给这类组件单独图形（`i-lucide-layers` + `--accent-main`）。起因是开发者追问「`WorkbenchShellLayout` 是否特殊、
  能否单独图标」：它文档标签为空、按命名规则兜底成 `part`，因此与一百个普通零件同形；而它真正的身份是
  workbench 容器宿主链 5 个零件的验证入口。图形按派生关系给而不是手写名单，第二条宿主链出现时自动生效。
  实测：`WorkbenchShellLayout` 取到 `i-lucide-layers` + `rgb(10, 132, 255)`；`WorkbenchPartHost` / `WorkbenchContainerTab` /
  `WorkbenchShell` 仍是锁 + `--text-muted`。
- **分类色按色相环重排（同日第四轮）**：开发者要求「颜色要改，区分度更明显」。先量了两套配色（`nbook-light` / `nbook-dark`；
  四主题名只改材质，不改这些 token）下的真实色值，发现旧方案的三档蓝挤在一起：
  `--accent-text` #0060df(214°) / `--accent-main` #007aff(211°) / `--status-info` #0a7ea4(195°)，在 14px 图标上等于同色。
  重排后每类只认一根色相轴或两轴的 `color-mix`，实测色相（浅色 / 深色）：
  `field` 35°/36°、`section`（绿 + 橙 mix）71°/80°、`list` 130°/135°、`view` 195°/197°、
  集成入口 211°/210°、`panel`（蓝 + 红 45%）264°/298°、`dialog`（蓝 + 红 25%）339°/348°，`part` 保持中性灰。
  彩色相邻间隔 36°–88°，仅「view 青」与「集成入口蓝」相隔 13°–16°（靠形状与实心区分）。全部由主题 token 派生，无 hex 硬编码。
- **集成入口实心化**：Tailwind 的 `opacity-100` 工具类压不过树组件的静态 `opacity-70`（同级声明、顺序不定），
  改为在 LabShell 样式区用 `.lab-root :deep(.lab-tree-entry-icon) { opacity: 1; stroke-width: 2.5; }`；
  实测该图标 `opacity: 1`、`stroke-width: 2.5px`（其余行 0.7 / 1px），在选中态与普通态都明显跳出来。
- **已知结构性事实（未处理）**：`deriveKind` 只认 `View / Dialog / Section / Field|Input|Select|Checkbox|Radio|Editor / List|Table|Tree / Panel|Rail|Aside|Bar|Tabs?` 这些后缀，
  其余全部兜底成 `part`（灰盒子）。所以 106 项里灰色盒子占多数——`WorkbenchCommandPalette`、`WorkbenchPanelSurface`、
  `WorkbenchTitleActions`、`Agent*Bubble`、各种 `*Card` / `*Item` / `*Surface` 都与普通零件同形同色。
  再想提高区分度得扩展分类规则（属分类系统改动，会改变这些条目的图形），本轮未做。
- **本轮证据**：`app/component-lab` 13 文件 / 66 例通过；`smoke:component-lab:core` → passed；两套配色下逐类实读 computed color 与色相校验；
  截图核对浅色/深色导航与搜索态（搜索 "Workbench" 过滤后 19 行里 `WorkbenchShellLayout` 为实心蓝 layers）。
- **按域细分分类（同日第五轮）**：开发者选择「按组件名后缀细分类」。先量分布：106 项里 `part` 占 **54**（一半），
  其中 `Agent*` 25、`Workbench*` 11、`Editor*` 6、其余杂项 12——这些全部是灰盒子，颜色再好也无从体现。
  在 `deriveKind` 末尾新增三条**域**规则（`^Agent` / `^Editor` / `^Workbench`，放在所有形状规则之后，
  以免抢走 `AgentSidebarView` 这类真正的 view），并给三族各自的图形与色相：
  `agent` → `i-lucide-message-square` + 青绿（info 45% + success 55%，实测 168°）、
  `editor` → `i-lucide-file-code` + 蓝紫（accent 55% + danger 45%，实测 237°）、
  `workbench` → `i-lucide-panels-top-left` + 与 `part` 同档灰（色相环空档都不到 25°，挤不下第四族，改由形状区分）。
- **新分布**：`agent` 25、`view` 17、`panel` 15、`part` **12**（原 54）、`workbench` 11、`section` 9、`dialog` 7、`editor` 6、`field` 2、`list` 2。
  彩色九档实测色相（浅色）：35 / 71 / 130 / 168 / 195 / 211 / 237 / 264 / 339，相邻最小 16°（`view` 青与集成入口蓝，
  靠形状与实心区分），其余 26°–75°。
- **本轮证据**：`app/component-lab` 13 文件 / 66 例通过；`smoke:component-lab:core` → passed；
  搜索 "Agent" 过滤后截图核对（青绿消息图标一族、`AgentMessageActionBar` 为紫面板、`AgentWorkflowBubble` 为锁）。
