# t35 nb-layout 去掉 nb-ui 依赖与 CSS 变量迁移：实施计划（第 2 稿）

第 2 稿按第一轮设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，10 条）改，逐条处理见 Task README。最大的改动：根上不再声明缺省值（第一轮第 1 条：库里不分层的声明会压过 nb-ui 放在 `layer(base)` 里的桥接），层级改成浮层的属性（第 9 条）。

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 3 项（“去掉 nb-ui 依赖”“CSS 变量迁移”两节）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout 要能单独装（MIT、第二档发 npm），今天它的 Vue 层导入 nb-ui、读 nb-ui 的 CSS 变量与样式类，不装 nb-ui 时过渡与分隔线都不对。

开发者已确认的：t31（2026-11-18）“都按推荐”，第一档现在做。本 Task 不改布局行为与外观：装了 nb-ui 的宿主（应用、Lab）看到的和今天一样；不装 nb-ui 时默认外观可用。

现状（盘点见 `.local/agent/works/w00026-layout-package/tasks/t35-drop-nb-ui/reports/inventory/report.txt`，第一轮审查核过、补了几处）：

- 导入 nb-ui 的 3 个文件：`vue/text.ts`（文案端口与目录登记）、`DropSectorsOverlay.vue`、`DropFeedbackOverlay.vue`（层级常数）。另有不经 import 的依赖：`SortableList.vue:89`、`FloatWindowHandles.vue:120,130` 用 nb-ui 的样式类 `nb-ui-focus-ring`；`boundary.test.ts:15` 的 Vue 层规则仍放行 nb-ui。
- Vue 层读 46 个 `var(--…)` 名字，另有 JS 读 `--sash-line-size`、`--motion-layout`、`--motion-move`，JS 写 `--nb-grid-inset`、`--nb-sash-core-*`。其中主题角色变量 14 个（`--sash-line-*` 5、`--drop-area-*` 2、`--layout-scrim` 与 `--layout-sector-*` 5 中读了 4、`--layout-card-*` 2；`theme/system.md:46` 第 2 层），动效 6 个（`--motion-fast`、`--motion-base`、`--motion-move`、`--motion-layout`、`--ease-layout`、`--ease-dialog-leave`），其余是 nb-ui 通用令牌（面、文字、圆角、字体）与配色；宿主旋钮 5 个（`--layout-sector-radius`、`--sortable-held-shadow`、`--sortable-first-line`、`--nb-splitter-seam`、`--nb-splitter-seam-inset`）。`--radius-sm`（`FloatWindowHandles.vue:229`）在哪都没定义、没有回退，今天等于圆角 0。
- nb-ui 的令牌（含桥接要放的 `tokens.css`）经 `@import "./tokens.css" layer(base)` 进应用；主题、用户主题、配色、Lab 覆盖都把变量声明在根元素上（`:root[data-nb-theme=…]`、`theme-loader.ts:262`、`colorway-store.ts:88`、`use-lab-overrides.ts:28`）。在子树上设旧名的：应用 `WorkbenchDragFeedback.vue:82` 的 `--layout-sector-radius`、`WorkbenchSurface.vue:672` 的 `--sash-line-inset`；e2e `lab-grid-structure.e2e.ts:184`；nb-layout 自己的 dom 测试 6 处（`NestedGrid.dom.test.ts` 1212、1248、1386、1425，`useGridMotion.dom.test.ts` 263、377）。
- e2e 有 18 个文件按这些名字设或读样式，约 20 处在根上调 `--motion-layout` 等过渡时长（`addStyleTag(":root{…}")`、`setProperty`）。
- 文字端口：应用的窗口引擎已在 `text-engine.ts:166` 登记 nb-layout 的目录；提供 nb-ui 文字端口（`TEXT_PORT_KEY`）的地方除 `mount.ts` 的三个根外，还有 `boot.ts` 的两个根、`shared/testing/text-port.ts` 与约 17 个 Lab 夹具。

工作方式：autonomous-delivery。代码在 worktree `w00026-t35-drop-nb-ui`（分支 `refactor/w00026-t35-drop-nb-ui`，从 master 开）；Spec 与 Task 记录在 master 上改。

## 技术选型

无通用问题：CSS 自定义属性、`provide`/`inject` 都是平台与框架自带的。`@property` 注册不用：它的初始值不能随 `prefers-reduced-motion` 变，happy-dom 也不认，解决不了 JS 读不到回退的问题。

## 关键设计

### 变量改名：`--nb-layout-*`，带回退；根上不声明缺省值

- Vue 层读的每个变量改成 `--nb-layout-<名>`：`var(--nb-layout-sash-line-color, <回退>)`。旧名到新名一一对应（`--sash-line-color` → `--nb-layout-sash-line-color`，`--motion-layout` → `--nb-layout-motion-layout`……）；完整对照表实施时生成，进 `docs/specs/theme/system.md`。
- **回退值**（第一轮第 7 条）：
  - 尺寸、时长、圆角、阴影：取 nb-ui `tokens.css` 在 `:root` 上的缺省值；缺省值是 `var()` 或 `color-mix` 链的，在新名里重写这条链（必要时补新名，例如 `--nb-layout-bg-main`），不抄旧名；
  - 颜色与配色（`--accent-*`、`--text-*`、`--bg-*`、面）：用中性的系统色或 `currentColor`（`Canvas`、`CanvasText`、`Highlight` 这类），不装 nb-ui 的暗色宿主也不会错得离谱；
  - 一致性：neuro-book 里加一条测试，把尺寸、时长、圆角这类非颜色回退与 `tokens.css` 的缺省比对（两个包都看得到的地方）。
- **根上不声明缺省值**（第一轮第 1 条）：库里任何不分层的 `:root` 声明都会压过 nb-ui 放在 `layer(base)` 里的桥接，装了 nb-ui 的外观就变了。所以缺省值只靠每处的 `var(--x, 回退)`；唯一的例外是减少动效（见下）。
- **JS 读变量的三处**（`layoutMotionMs`、`useSortable.ts:166`、`SashHandle.vue:233`）改读新名，读到空串时用模块里的常量（与 CSS 回退同值）：`layoutMotionMs` 今天把空串当 0，改成“空串当缺省时长”，过渡默认是“有”（提案体验 4）。常量与各处 CSS 回退同值，由变量扫描测试核对（见“机检”）。
- **减少动效**：nb-layout 带一份很小的 `vue/reduced-motion.css`：`@media (prefers-reduced-motion: reduce) { :root { --nb-layout-motion-fast: 0ms; …（nb-layout 读的四个时长）} }`。它不分层，会压过桥接，但这时 nb-ui 也把旧名归零（`tokens.css:278` 带 `!important`），两边一致；不装 nb-ui 的宿主也得到归零。JS 读到 `0ms` 当 0。由 `vue/index.ts` 导入（`import "./reduced-motion.css"`），第一步先核这种副作用导入能过 nb-layout 的类型检查（nb-markdown 有先例）。
- **宿主旋钮与 JS 写的变量**同样改名为 `--nb-layout-*`，不经桥接：应用设它们的地方（`WorkbenchDragFeedback.vue`、`WorkbenchSurface.vue` 的 `--sash-line-inset` 子树覆盖与 seam 两个）直接改设新名；`SortableList.md`、`NestedGrid.md` 的说明同改。JS 写在行内的（`--nb-layout-grid-inset`、`--nb-layout-sash-core-*`）读时不要求回退（行内一定先写）。
- `--radius-sm`：今天是无效值、圆角 0；改成不写这一句（同样是 0），外观不变，记进 Task README。
- 自己的样式类 `nb-ui-drop-indicator*`（`DropIndicator.vue`、`DropIndicatorLabel.vue`）改名 `nb-layout-drop-indicator*`；先搜测试、e2e 与应用里的选择器一起改。

### 桥接：nb-ui 的 `src/tokens.css`

- 在 `:root` 上把旧名映射到新名，只写变量名、不导入 nb-layout：`--nb-layout-sash-line-color: var(--sash-line-color);`……一行一个。它和 `tokens.css` 其余内容一起在 `layer(base)` 里；nb-layout 不在根上声明同名变量（上一节），所以桥接是唯一的声明。
- 主题作者照旧写旧名（`--layout-card-radius` 等），经桥接生效；主题合同（`theme/system.md` 第 2 层）的名字不变。
- 桥接在根元素上计算：旧名只在根元素上声明时才跟得过去。主题、用户主题、配色、Lab 覆盖都满足；应用与测试里在子树设旧名的几处改设新名（见 Context）。配色放进子树（例如开发者面板的终端）里的 nb-layout 拿到的是根的颜色，写成已知限制。
- **一致性测试**（第一轮第 2 条，放 neuro-book）：枚举 nb-layout 读的每个 `--nb-layout-*`，要求它在桥接里有一行，或在“只读宿主旋钮”的显式清单里；反向要求桥接每一行引用的旧名在 nb-ui 里有定义。
- **真实浏览器探针**：一条 e2e（Lab 的 NestedGrid 场景），在 nbook 亮色、nbook 暗色、macos 与减少动效下，逐个比较旧名与新名的计算值相等。

### 层级：浮层的 `zIndex` 属性（第一轮第 9 条）

- nb-ui 的规范要求层级“用 `:style` 绑定登记表里的值，不在 CSS 里写同一个数”（`ui-development-spec.md` 2.1），`z-index.ts` 写明层级不进 CSS 变量合同。所以不改成变量：`DropSectorsOverlay`、`DropFeedbackOverlay` 各加一个 `zIndex` 属性，缺省 59、60（今天的值），应用与 Lab 的调用点显式传 `NB_Z_INDEX.dropSectors`、`dropFeedback`。
- 插件经 SDK 用这两个组件不传时得到同样的 59、60，和今天一样。`NestedGrid.vue` 里的字面量层级是组件内部的叠放，不动。

### 焦点环：nb-layout 自己的样式（第一轮第 5 条）

- `SortableList.vue`、`FloatWindowHandles.vue` 的三处按钮不再用 nb-ui 的 `nb-ui-focus-ring`，改用 nb-layout 自己的 `nb-layout-focus-ring`：规则照抄 nb-ui `styles.css:56-62`（`:focus-visible` 时 `outline: none`、边框色与外圈阴影、过渡），读 `--nb-layout-focus-ring`、`--nb-layout-focus-outline`、`--nb-layout-motion-base`、`--nb-layout-ease-layout`，带回退；桥接加 `--focus-ring`、`--focus-outline` 两行。装了 nb-ui 时外观不变；不装时有一圈系统色的焦点环。`FloatWindowHandles.md:37` 同改。

### 文案：库自己的注入点（第一轮第 4 条）

- `vue/text.ts` 不再导入 nb-ui：
  ```ts
  export type LayoutTextParams = Readonly<Record<string, string | number>>;
  export type LayoutTranslate = (key: LayoutTextKey, params?: LayoutTextParams) => string;
  /** `Symbol.for`：两份模块并存时仍是同一个键（同 nb-ui 的 TEXT_PORT_KEY）。 */
  export const LAYOUT_TEXT_KEY: InjectionKey<LayoutTranslate> = Symbol.for("nb-layout.text");
  /** 在 setup 里调用：有宿主注入就用它，没有就用库自带的源语言目录（`./locales` 的 zh-CN）。 */
  export function useLayoutText(): LayoutTranslate;
  ```
  缺省实现把目录里的 `{{名字}}` 换成参数，不处理复数。键、目录、`./locales` 子路径都不变；`text.ts` 不再在导入时 `registerDefaultCatalog`（应用的窗口引擎已在 `text-engine.ts:166` 自己登记）。
- 应用侧一个帮手 `provideHostText(provide, port)`（放 `packages/neuro-book/src/web/host/`）：同时提供 `TEXT_PORT_KEY` 与 `LAYOUT_TEXT_KEY`（把 nb-layout 的键交给 nb-ui 端口，命名空间 `nb-layout`，每次调用都读端口的当前语言）。所有今天 `provide(TEXT_PORT_KEY, …)` 的地方改用它：`mount.ts` 三个根、`boot.ts` 两个根、`shared/testing/text-port.ts`、Lab 夹具。加一条测试：源码里除这个帮手外没有直接 `provide(TEXT_PORT_KEY` 的地方。
- `docs/specs/ui/i18n.md` 输出 8（共享包在导入时登记进 nb-ui）写明 nb-layout 是例外与理由。
- 别的共享包（nb-form、nb-agent-ui、nb-markdown）各有 `provideDefaultText(locale)`；nb-layout 第一档不加对应的入口，放进它们的子树而宿主没提供适配器时文字是 zh-CN，写成已知限制（第二档换默认英文时一起定）。

### 机检（第一轮第 6 条）

- **导入**：收紧 `boundary.test.ts` 的 Vue 层规则，去掉对 `@notnotype/nb-ui` 的放行；`package.json` 的 `dependencies` 去掉它。这条检查本身就是“不读 nb-ui”，不另建临时项目。
- **样式类**：模板里出现的 `nb-ui-*` 类名一律不许（同一条测试扫 `.vue`）。
- **变量扫描**（nb-layout 的 Bun 测试）：非测试源码里所有 `--[a-z]` 开头的自定义属性名（含字符串里的、JS 读写的）要么以 `--nb-layout-` 开头，要么在显式白名单里（白名单为空最好）；`var(--` 里的使用要带回退，JS 写在行内的那几个除外；JS 读的三处的常量与 CSS 回退同值。

## Spec 与文档改动

在 master 上、设计审查处理完之后：

- `docs/specs/theme/system.md`：第 2 层写明“布局变量经 nb-ui 的桥接给 nb-layout，nb-layout 读 `--nb-layout-*`”、旧名到新名的对照表、桥接在根元素上计算（旧名只在根元素上声明才生效）、桥接与令牌同在 `layer(base)`。
- `docs/specs/ui/i18n.md` 输出 8：nb-layout 例外。
- `docs/specs/ui/nested-grid.md`、`ui/layout-drag.md` 里提到这些变量名的地方（实施时搜）改成新名或注明经桥接；落点浮层的 `zIndex` 属性写进 nested-grid 的公开面（若有对应条目）。
- `docs/modules/monorepo-boundaries.md:18`、nb-layout 的 `README.md`（第 7 行“依赖 nb-ui”、主题级的一小批变量表：颜色、圆角、阴影、motion、焦点；其余标内部；减少动效；不装 nb-ui 时的用法）、`package.json` 的 `description`、`vue/index.ts` 头注释、nb-layout 的 `AGENTS.md`、`boundary.test.ts` 的注释。
- 组件 `.md`：`state:inject` 声明改成注入 `LAYOUT_TEXT_KEY`（`Splitter.md:94` 等）、宿主旋钮的新名、落点浮层的 `zIndex`、焦点环。
- 变更记录：插件 SDK 的组件读的变量名变了，插件里自己设旧名旋钮（`--layout-sector-radius`、`--sortable-*`、`--nb-splitter-seam*`）的外观会回到缺省，要改设新名（不兼容的改动）；主题照旧（经桥接）；落点浮层新增 `zIndex` 属性（新增）。

## 切片

1. **文案**：`text.ts` 的注入点与缺省实现、应用的 `provideHostText` 与全部调用点、`TEXT_PORT_KEY` 直接提供的检查、`.md` 声明。验证：三个包的类型检查，nb-layout 测试，应用里受影响的测试。
2. **层级与焦点环**：两个浮层的 `zIndex` 属性与调用点；`nb-layout-focus-ring`；`nb-ui-drop-indicator*` 改名。验证同上。
3. **变量**：改名、回退、JS 读的三处与常量、`reduced-motion.css`、宿主旋钮与子树覆盖、nb-ui 的桥接；nb-layout 的 6 处 dom 测试与 `lab-grid-structure.e2e.ts:184` 改设新名；变量扫描、桥接一致性与回退一致性测试；真实浏览器探针。验证：nb-layout、nb-ui、应用的测试与类型检查；Lab 截图对照改前改后（亮色）。
4. **依赖与机检**：`package.json`、收紧 `boundary.test.ts`；文档、Spec、变更记录。
5. **收口**：并 master、e2e、实现审查、合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 装了 nb-ui 的宿主外观与过渡不变 | 真实浏览器探针（四种主题与减少动效下旧名、新名计算值相等）；Lab 截图对照；e2e |
| 不装 nb-ui 时默认外观可用、过渡是“有” | 回退值；JS 读空串用常量的单元测试 |
| Vue 层只读 `--nb-layout-*` 且带回退、不用 nb-ui 的类 | 变量扫描与样式类扫描 |
| 公开入口不读 nb-ui | `package.json`；收紧后的 `boundary.test.ts` |
| 桥接与回退和 nb-ui 一致 | 桥接一致性测试；回退一致性测试 |
| 文案照旧跟语言走 | Splitter、SortableList 的 dom 测试（无注入时用源语言目录；注入时用注入的）；`TEXT_PORT_KEY` 直接提供的检查 |
| 层级与 nb-ui 一致 | 调用点传 `NB_Z_INDEX`；浮层的 dom 测试读 `zIndex` |

## 验证

- 每片三个包（nb-layout、nb-ui、应用）的类型检查与受影响的测试。
- e2e：`workbench-dnd`、`workbench-live-drag`、`workbench-containers`、`editor-area`、`lab-grid-swap`、`lab-grid-panels`、`lab-grid-structure`、`lab-drop-sectors`、`workbench-views`，加新写的探针，共 10 个文件；超过 8 个，`NB_E2E_WIDE` 写明“改了 nb-layout 读的全部变量名，按旧名调样式的文件都要证明经桥接还生效”。开跑前看负载。
- Lab 截图对照：`NestedGrid` 的交换与落点、`Splitter`、`SortableList`、落点浮层、浮动窗把手的键盘焦点，亮色。

## 不做与风险

- 不做：默认英文与中文目录随 L2 走（第二档）；编译产物与发布（第二档）；nb-ui 里冻结的 Splitter（t14 删）；主题合同的变量名本身。
- 风险：
  - 桥接只在根元素上计算：将来有人在子树里覆盖旧名，nb-layout 看不到。写进 `theme/system.md`。
  - 不装 nb-ui 的宿主拿到系统色的回退，和 nb-ui 的配色不同：这是“可用”，不是“一样”。
  - e2e 在子树设旧名的，改名后不再生效：开大范围前再搜一遍 `setProperty(`、`addStyleTag` 与 `style=`。
