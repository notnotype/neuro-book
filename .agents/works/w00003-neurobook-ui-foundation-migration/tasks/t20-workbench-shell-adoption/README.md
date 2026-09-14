---
schema: nbook.task/v2
taskId: t20-workbench-shell-adoption
role: tasker
---

# Workbench 外壳接入（阶段 1）

> **状态：尚未开工（pending）**。本 Task 只登记目标、范围、批次与验收，正文不含任何已实施的改动；开工前由 Leader 指派执行者，执行时先读本文链接的 `planned` Spec 与已批准提案。

## 目标

把已在 `/workbench-spike` 验证过的 view 模型接入主应用外壳：标题栏、图标栏（活动栏）、主侧栏、右侧栏、编辑器区、面板与状态栏按已批准的 [`workbench-view-host.md`](../../../../../packages/neuro-book/docs/proposals/workbench-view-host.md) 渲染；**保留现有固定槽位与旧入口，不删任何东西**——提案阶段 1 的原文口径是「外壳接入但**保留现有槽位**，不删任何固定入口」。

主题与组件接入沿用现有 nb-ui 通道（已实现）：宿主上的角色变量桥接（`app/styles/theme-vars.css`）与浮层的显式 portal 宿主，不新增第二套通道。

## 已批准决策（引用，不重新发明）

- 提案 2026-09-13 获批（`accepted`）：13 条开放问题与遗留设计项已逐条定夺（`titleKey` 由宿主解析、`when` 用枚举数组、descriptor 级错误进 view 级 issue、状态栏固定底部、面板对齐默认 `justify`、`layout(sizes)` 后反算逻辑尺寸；`containerPlacements`、`defaultRevision`、`deserializeLayout`、`hiddenViews`、`ViewRenderModel` 全做；「分支 sash 不可拖」与「移动单向性」为第一版已知限制）。
- 阶段 1 定义（提案「迁移顺序与删除门禁」）：原语 + 测试矩阵 + 新 Lab 验证台；外壳接入但保留现有槽位。**前半已闭合**：原语 `packages/nb-ui/src/components/layout/grid.ts` 单测 13/13；验证台 `app/pages/workbench-spike.vue` + `app/components/workbench-spike/` 四条验收全绿。本 Task 做后半。
- #192 门禁「Proposal 获批并登记唯一 `planned` capability Spec 后，才创建实现 Task」：提案已获批，Spec 已登记为 [`docs/specs/ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（`capability: ui.workbench-shell`），本 Task 引用它。

## 范围与不做的

**做**：

- 外壳结构（标题栏、图标栏、主侧栏、右侧栏、编辑器区、面板、状态栏）按提案的位置模型落到主页面；
- 图标栏容器切换与选中态、侧栏收起/展开、面板呈现、状态栏摘要；
- 外壳几何与可见性进版本化布局快照，恢复语义与尺寸夹取一致；
- 现有入口（文件树、角色、情节、设置、Agent、历史、World Engine 等）**以今天的实现形态**挂在新外壳里。

**不做**（本 Task 明确排除）：

- 阶段 2–5 的消费者迁移：`files` / `characters` / `plot` 逐个切 descriptor、L1 内置插件注册路径、命令与只读描述快照桥接；
- 不删固定槽位、不删旧组件（`app/components/common/Dialog.vue` 等）、不删旧状态字段；
- 不改数据 authority：Project 文件、Session、Job、Trace、dirty/save 仍归原 owner；
- 编辑器分屏、L3 可执行第三方、跨窗口浮动、状态栏换位；
- 第二套 resize 边界或第二套布局存储。

## 批次拆分建议（每批可在两周内闭合）

| 批次 | 内容 | 验收 | 回退点 |
|---|---|---|---|
| 1 标题栏与图标栏 | 写死的图标栏列表换成 descriptor 驱动的图标项（容器项 / 命令项分类）；标题栏拥有自绘 chrome 的布局 | 点击容器项切换并落选中态；命令项仍打开原入口；外观与现状等价 | 撤下接入层，恢复写死列表（旧槽位未删） |
| 2 侧栏容器 | 主侧栏 / 右侧栏按容器渲染视图行，现有视图原样承载 | 左右栏容器切换与收起/展开；现有入口行为不变 | 同批撤下容器层，回到现有左右栏模板 |
| 3 面板与状态栏 | 面板 Part（位置/对齐按提案，第一版默认 `justify`）与状态栏两段 | 面板显示/隐藏与现状等价；状态栏信息与现状等价 | 面板回到现有模板 |
| 4 外壳接线保持槽位 | 前三个批次接进主页面根；布局快照读写收敛到唯一入口（安全解析 + 宿主 load/save 适配） | 全量回归（见验收条件） | 整批 revert 回当前页面根（旧槽位完整保留） |

- 每批独立提交、独立验证；批次之间不互相引用未落地的中间态；
- 任何一批出现回归都只撤该批；「旧槽位未删」就是各批的天然回退路径。

## 验收条件

- **布局等价**：外壳渲染出与现状等价的布局（区域顺序、相对位置；无双重边框 / 双重标题条 / 双重标签条）。
- **现有入口全部仍在且可用**：文件树、角色、情节、设置、Agent 面板与侧栏、历史、World Engine 等入口的打开、切换、关闭与接入前一致；没有任何入口被移除或降级为占位。
- **主题跟随**（含浅/深色对照）：外壳与其中浮层的颜色来自主题宿主；非 sepia 主题下不出现 sepia 兜底底色（对照 `acdc627b` 的实测口径）。
- **原语与验证台的既有验收不回退**：`bun run --cwd packages/nb-ui test` 通过（最近基线 279）；验证台浏览器验收不回退（最近实测 34 条断言全部通过，2026-09-14）；`/workbench-spike` 四条交互验收逐条复核。
- **窄屏与桌面两种 surface**：`390 × 844` 与桌面宽度下核心操作可完成，无页面级横向滚动。
- **布局恢复**：改尺寸 / 收起 → 重新进入恢复；快照版本不符 / 未知引用 / 非法尺寸 → 按 Spec 的失败合同回落并逐条给诊断。

## 依赖与前置

- 提案 `packages/neuro-book/docs/proposals/workbench-view-host.md` 已 `accepted`（2026-09-13）；
- `planned` Spec `docs/specs/ui/workbench-shell.md` 已登记（本次创建，`capability: ui.workbench-shell`）；
- 原语与验证台已就绪（`packages/nb-ui/src/components/layout/grid.ts`，13/13；`app/pages/workbench-spike.vue`，Source Dev only）；
- **#191 剩余项的关系**：旧弹窗清零（`app/components/common/Dialog.vue` 的 10 个冻结窗口 + `useDialog.ts` 命令式服务，见 t19 的 D5/D6/D7）与主题 authority 任务属 #191 的迁移线，**不阻塞本 Task**——阶段 1 不删任何入口，两者可并行；但阶段 2+ 的删除门禁（入口闭环、行为等价证据）依赖 #191 那条线继续收敛，本 Task 不得提前删除任何将被 #191 处置的入口。
- 未决但不阻塞：浮层默认宿主是否改为「宿主上下文」（提案 `docs/proposals/nb-ui-overlay-portal-host.md`，`draft`）。若获批并落地，本阶段新接入的工厂与浮动容器直接受益；未获批时按现有「显式宿主」纪律执行，不阻塞开工。

## 事实基准

- 阶段 1 前半（已闭合）：原语单测 13/13；验证台四条验收（观感像工作台、sash 可发现可拖、视图跨容器拖拽、活动栏切换与侧栏收起）实测通过；相关提交 `9806c7bb`…`c0b5b316`。
- 基线数字：nb-ui 单测 279；验证台浏览器断言 34/34（最近一轮实测）。
- 外壳现状（写死槽位与散落的布局状态）：见提案「问题」节——`app/utils/workbench-chrome.ts:12-26` 的写死 activity 列表、`app/stores/novel-ide.ts` 的 `novel.ide.local` / `novel.ide.session`、`app/pages/index.vue` 的页面级 ref 与 `nbook.settingsDialog.size`。
- 主题通道现状：`app/styles/theme-vars.css` 的角色变量桥接（14 个角色变量在宿主上重声明）+ 24 处模板调用点显式传 `.novel-ide-theme`（`995e5e4f`）。

## 待办：后续主题收口

> 来源：外壳底子主题审计（提交 `4bb4a16b`，阶段 1 步骤 5）。外壳骨架（标题栏 / 活动栏 /
> 四个叶的演示占位块）已改成只消费 nb-ui 主题变量；下面是这次**没有**一并做掉、
> 以后重做主题时会返工的点。按「与谁一起做」分组，改之前先读对应那一段的理由。

### ① World Engine：`--we-*` 别名层连同该子系统组件一起改直连

- 现状：`app/styles/theme-vars.css` 里 `.world-engine-workbench-theme` 声明了 28 个 `--we-*`，
  逐个映射到配色变量（`--we-bg-canvas: var(--bg-main)` 这一套），World Engine 的组件引用别名。
- 目标：该子系统重建时删掉别名层，组件直接引用 nb-ui 的配色 / 角色变量（`--bg-main`、
  `--panel-surface`、`--divider`、`--status-*` …），与外壳、与 Lab 走同一套名字。
- 口径（开发者已定，2026-09-14）：**不单独做这一项**，与 World Engine 组件的那一轮一起做，
  在那之前别名层保持原样——半迁移状态（别名层删了、组件没改）会让整个子系统失色。
- 注意 `--we-code-bg` / `--we-code-text` 这两个别名今天取的是 `--panel-surface` / `--text-main`，
  不是配色变量；改直连时顺带确认代码面是否该有独立角色（现在没有）。

### ② 业务组件仍引用已下线的旧变量

- 用户口径（2026-09-14）：允许现有业务组件继续引用**已不存在**的旧变量，产品侧只负责提供
  新主题变量，不逐个补映射、不做兼容层。各子系统重建时随那一轮替换。
- 已完成的一轮：主应用的主题与配色 authority（`269ba90a`）与本次外壳收口（`4bb4a16b`）。
- 尚未迁移的消费面（重建时逐处替换成 nb-ui 名字）：
  - `markdown-studio/*`（`--page-surface` 等主题扩展变量已在用；`--panel-surface` / `--toolbar-surface` 与 `--bg-*` 混用，需要一次统一）；
  - `novel-ide/agent/*`、`novel-ide/plot/*`、`common/low-code-form/*`、`common/diff/*`；
  - `app/components/common/Dropdown.vue`、`Tooltip.vue`：两处仍各自复制了浮层外观
    （`rounded-md border-[var(--border-color)] bg-[var(--bg-panel)] shadow-xl`），
    未消费 nb-ui 的 `.nb-ui-popover-surface` / `.nb-ui-popover-item`。**这两个是公共件，
    改一次能覆盖全仓的菜单与提示**，优先级高于其它零散组件。

### ③ 修不掉的返工点（本次只报告，未改）

1. **外壳面层未切主题层 glass 档。** 活动栏 / 标题栏 / 叶面今天取配色变量
   （`--bg-sidebar` / `--bg-panel`），没有取主题层角色 `--sidebar-surface` / `--toolbar-surface`
   （本产品装的两套主题里它们是 26% / 30% 的半透明玻璃）。
   理由：那三档只在「窗体底纹 `--window-backdrop` + 自身 `backdrop-filter: var(--glass-blur)`」
   之上才成立，主页面根今天两样都没有；单切面层只会得到一层洗淡的色——Lab 已实测三档 chrome
   面低于可读性下限（`app/component-lab/LabShell.vue` 顶部那段）。
   这是一次**材质层迁移**，且 nb-ui 侧的表面模型提案（`packages/nb-ui/docs/proposals/nb-ui-surface-model.md`）
   尚未落地，等它到了再和窗体底纹一起做。相关：`.nb-ui-popover-surface` 那一档已经在用（见下）。
2. **窗口几何双份维护。** 标题栏 36px、活动栏 48px 同时写在组件里
   （`DesktopTitleBar.vue` 的 `.desktop-title-bar`、`NovelIdeActivityBar.vue` 的 `w-12`）
   与 `app/utils/workbench/layout.ts`（`SHELL_TITLEBAR_HEIGHT` / `SHELL_ACTIVITY_WIDTH`）。
   按 nb-ui playground `workbench.css` 的既定口径，「窗口几何属产品 IA，主题不该动」，
   所以**不新增主题 token**是对的；但两处数字得手改两遍，改一处漏一处会表现为
   「树里的尺寸与 CSS 差几像素」。要收口只能让 JS 侧读 DOM（引入测量时机问题）或反过来由 JS 主导，
   两条都不便宜，留待窗口 chrome 那一轮统一决定。
3. **标题栏下拉菜单被外壳叶裁掉（既有缺陷，非本次引入）。** `titlebar` 叶的包装
   （`WorkbenchBranch.vue` 的 `overflow-hidden`）与 nb-ui `Splitter` 面板（`overflow-auto`）
   都带裁剪，而下拉（`position: absolute; top: 30px`）必然伸到 36px 高的叶之外，于是
   File / Edit / View / Help 与 Project 菜单**打开后看不见**（DOM 在、`z-index: 1001` 在、
   命中区也在，只是被裁）。实测：把祖先链的 `overflow` 临时放开，菜单立刻正常显示（外观正确）。
   与主题无关（改前改后的定位与祖先链完全一致），但它是桌面壳的可用性缺陷。
   修法需要菜单逃出裁剪：要么把下拉 `Teleport` 到主题宿主（会牵动 `onClickOutside` 的判定），
   要么改成 `position: fixed` + 按钮 `getBoundingClientRect()` 定位；两条都要在真桌面壳上验证，
   所以不在本次做。**建议开独立 Task**。
4. **Monaco 的语法色不随主题。** `app/components/markdown-studio/monaco-theme.ts` 的
   token 颜色按明暗写死（`#0F766E` / `#1D4ED8` …），只有背景 / 前景 / 选中 / 强调走变量；
   换主题（甚至换配色）时源码模式的语法高亮不变。要修得先由 nb-ui 给出「语法色」角色
   （新契约，和 `--status-*` 同级），属 nb-ui 侧设计，本次只登记。
5. **JS 侧读变量的兜底值各自一份。** `monaco-theme.ts` / `monaco-diff-theme.ts` /
   `MarkdownSourceEditor.vue` / `tiptap/HtmlEmbed.ts` 都用 `getPropertyValue("--x").trim() || "#…"`
   自带一个字面色兜底。**没有装主题**时才会用到，属受支持状态（同 `tokens.css` 的口径），
   不算缺陷；但重做主题时别把它们当成第二个事实源。

### 附：验证留痕（本次）

- 浏览器实测（Node + Playwright，1440×900，桌面 bridge 桩）：四个组合
  （nbook / macos × light / dark）下，外壳 33 项取值（活动栏面与线、图标项圆角、内分隔线、
  三个演示占位块的面 / 线 / 字号 / 字重 / 间距、标题栏面与线 / 控件高度圆角字号 / 搜索框描边、
  nb-ui Splitter 的 sash、标题栏下拉的浮层六项）**逐项等于**同组合下该主题变量的解析值。
- 控制台：初次加载 0 条；打开 Project 与四个组合切换后仅两条
  `[nuxt-app] page:loading:* already exists`——来源是 `@nuxt/devtools` 的计时器包裹
  （与本次改动无关，非 error）。
- `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` 无输出；
  `bun run --cwd packages/neuro-book test app/utils/workbench app/utils/theme` 6 文件 52 测试全过。
