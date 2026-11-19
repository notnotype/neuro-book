# t35 nb-layout 去掉 nb-ui 依赖与 CSS 变量迁移：实施计划（第 1 稿）

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 3 项（“去掉 nb-ui 依赖”“CSS 变量迁移”两节）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout 要能单独装（MIT、第二档发 npm），今天它的 Vue 层导入 nb-ui、读约 47 个 nb-ui 的 CSS 变量，不装 nb-ui 时过渡与分隔线都不对。

开发者已确认的：t31（2026-11-18）“都按推荐”，第一档现在做。本 Task 不改布局行为与外观：装了 nb-ui 的宿主（应用、Lab）看到的和今天一样；不装 nb-ui 时默认外观可用。

现状（盘点见 `.local/agent/works/w00026-layout-package/tasks/t35-drop-nb-ui/reports/inventory/report.txt`，要点）：

- 导入 nb-ui 的只剩 3 个文件：`vue/text.ts`（文案端口与目录登记）、`DropSectorsOverlay.vue`、`DropFeedbackOverlay.vue`（层级常数 `NB_Z_INDEX.dropSectors` 59、`dropFeedback` 60）。`TabStrip` 已在 t33 移到 nb-workbench-layout。
- Vue 层读 46 个 `var(--…)` 名字，另有 JS 读 `--sash-line-size`（`SashHandle.vue:233`）、`--motion-layout`（`layout-motion.ts:6`）、`--motion-move`（`useSortable.ts:166`）。其中 17 个是主题角色变量（`docs/specs/theme/system.md:46` 列的第 2 层：`--sash-line-*`、`--drop-area-*`、`--layout-*`），motion 与 ease 令牌 7 个，其余是 nb-ui 通用令牌（面、文字、圆角、字体）与配色（`--accent-*`、`--text-*`、`--bg-*`）；另有宿主旋钮 `--layout-sector-radius`、`--sortable-held-shadow`、`--sortable-first-line`、`--nb-splitter-seam`、`--nb-splitter-seam-inset`，与 JS 写在行内的 `--nb-grid-inset`、`--nb-sash-core-*`。`--radius-sm`（`FloatWindowHandles.vue:229`）在哪都没定义、没有回退，今天就是无效值。
- 主题与用户主题都把变量声明在根元素上（`:root[data-nb-theme=…]`，theme-loader 同样）；应用在子树里覆盖旧名的只有两处：`WorkbenchDragFeedback.vue:82` 的 `--layout-sector-radius`、`WorkbenchSurface.vue:672` 的 `--sash-line-inset`。
- e2e 有 18 个文件按这些名字设或读样式，多数是在 `documentElement` 上 `setProperty("--motion-layout", …)` 调过渡时长。

工作方式：autonomous-delivery。代码在 worktree `w00026-t35-drop-nb-ui`（分支 `refactor/w00026-t35-drop-nb-ui`，从 master 开）；Spec 与 Task 记录在 master 上改。

## 技术选型

无通用问题：CSS 自定义属性与 Vue 的 `provide`/`inject` 都是平台与框架自带的。

## 关键设计

### 变量改名：`--nb-layout-*`，带回退

- Vue 层（`.vue` 的 `<style>`、`.ts` 里写进样式的字符串）读的每个变量都改成 `--nb-layout-<名>`，每处带回退值：`var(--nb-layout-sash-line-color, #3b82f6)`。旧名到新名一一对应（`--sash-line-color` → `--nb-layout-sash-line-color`，`--motion-layout` → `--nb-layout-motion-layout`，`--panel-surface` → `--nb-layout-panel-surface`……），完整对照表实施时生成，随 Task 进 `docs/specs/theme/system.md`。
- 回退值取 nb-ui `src/tokens.css` 今天在 `:root` 上的缺省值（不是某个主题的值）；配色变量（`--accent-*`、`--text-*`、`--bg-*`）取 nb-ui 缺省配色的亮色值。
- 宿主旋钮（`--layout-sector-radius`、`--sortable-held-shadow`、`--sortable-first-line`、`--nb-splitter-seam`、`--nb-splitter-seam-inset`）与 JS 写在行内的（`--nb-grid-inset`、`--nb-sash-core-start`、`--nb-sash-core-size`）同样改成 `--nb-layout-*`，不经桥接：应用里设它们的地方（`WorkbenchDragFeedback.vue`、`WorkbenchSurface.vue`）直接改设新名；`SortableList.md`、`NestedGrid.md` 的说明同改。
- `--radius-sm` 改成 `--nb-layout-radius-control`（同别处的控件圆角）并带回退，修掉无效值。
- JS 读变量的三处改读新名：`layoutMotionMs`（`layout-motion.ts`）、`useSortable.ts:166`、`SashHandle.vue:233`。

### `:root` 上的缺省值：`packages/nb-layout/src/vue/defaults.css`

- 只靠回退不够：`getPropertyValue("--nb-layout-motion-layout")` 读不到 `var(--x, 回退)` 里的回退，宿主没设时 JS 读到空串当 0，过渡按 CSS 回退走、JS 以为没有过渡，“外壳放下后的收尾”提前结束（提案“CSS 变量迁移”）。所以库带一份在根上声明缺省值的样式：
  - 选择器用 `:where(:root)`（优先级 0）：桥接与宿主写在 `:root`（0,1,0）上的值总是赢，不靠样式的加载顺序；
  - 声明 JS 要读的那几个（motion 时长、`sash-line-size`）与层级（见下），以及主题级的一小批（颜色、圆角、阴影）；其余只靠每处的回退；
  - `@media (prefers-reduced-motion: reduce)` 里把 motion 时长归零（今天由 nb-ui 令牌做）。
- 由 `vue/index.ts` 导入（`import "./defaults.css"`），用到 Vue 层的宿主自动带上；核心入口（纯 TS）不导入 CSS。
- 单元测试：不加桥接、不设变量时，`layoutMotionMs` 读到的毫秒数等于 `defaults.css` 里声明的时长（vitest 的 happy-dom 能否算出 `:root` 的自定义属性，实施时先核；不能就改成解析 `defaults.css` 文本与常量对照，并写明）。

### 层级：CSS 变量

- `DropSectorsOverlay.vue`、`DropFeedbackOverlay.vue` 都 `<Teleport to="body">`，层级改成 `z-index: var(--nb-layout-z-drop-sectors, 59)`、`var(--nb-layout-z-drop-feedback, 60)`，缺省值也写进 `defaults.css`。
- 桥接（见下）把它们写成 nb-ui 的层级：nb-ui 的 `z-index.test.ts` 加一条：`tokens.css` 里这两个变量的值等于 `NB_Z_INDEX.dropSectors`、`dropFeedback`（相对次序的断言原样留着）。
- `NestedGrid.vue` 里的字面量层级（1、2、3、4、900、1000）是组件内部的叠放，不动。

### 桥接：nb-ui 的 `src/tokens.css`

- 在 `:root` 上把旧名映射到新名，只写变量名、不导入 nb-layout：`--nb-layout-sash-line-color: var(--sash-line-color);`……一行一个，层级两行写数值。
- 主题作者照旧写旧名（`--layout-card-radius` 等），经桥接生效；主题合同（`theme/system.md` 第 2 层）的名字不变。
- 桥接在根元素上计算，所以旧名只在根元素上声明时才跟得过去：主题、用户主题、配色都满足（见 Context）；应用在子树里覆盖旧名的两处改设新名（见上）。这条约束写进 `theme/system.md`。
- nb-ui 自己的 Lab token 登记（`lab/web/lab-tokens.ts`）与主题编辑器不读这些新名，不改。

### 文案：库自己的注入点

- `vue/text.ts` 不再导入 nb-ui：
  ```ts
  export type LayoutTextParams = Readonly<Record<string, string | number>>;
  export type LayoutTranslate = (key: LayoutTextKey, params?: LayoutTextParams) => string;
  export const LAYOUT_TEXT_KEY: InjectionKey<LayoutTranslate>;
  /** 在 setup 里调用：有宿主注入就用它，没有就用库自带的源语言目录（`./locales` 的 zh-CN）。 */
  export function useLayoutText(): LayoutTranslate;
  ```
  缺省实现把目录里的 `{{名字}}` 换成参数，不处理复数（提案“去掉 nb-ui 依赖”）。键、目录、`./locales` 子路径都不变。
- 适配器在应用：`packages/neuro-book/src/web/mount.ts` 在 `app.provide(TEXT_PORT_KEY, port)` 旁边 `app.provide(LAYOUT_TEXT_KEY, …)`，把 nb-layout 的键交给 nb-ui 端口（命名空间 `nb-layout`），并在那里 `registerDefaultCatalog` nb-layout 的目录（原来在 `text.ts` 导入时登记）。换语言照旧跟着 nb-ui 端口走：返回的函数每次调用都读端口的当前语言。
- Lab 里自己 `provide(TEXT_PORT_KEY, …)` 的场景，nb-layout 的组件仍取应用根上的适配器：语言跟着应用走、不跟场景自己的端口。盘点这类场景里有没有 nb-layout 组件、有没有按语言断言的 e2e，有就在场景里同样 `provide` 适配器。
- 组件同名 `.md` 的 `state:inject` 声明改成注入 `LAYOUT_TEXT_KEY`（`Splitter.md:94` 等）。

### 机检

- **变量扫描**（nb-layout 的 Bun 测试）：扫 `src/vue` 下所有 `.vue` 与 `.ts`，每个 `var(--` 的名字以 `--nb-layout-` 开头且带回退；`defaults.css` 声明的名字也都是 `--nb-layout-*`。
- **不读 nb-ui**：`package.json` 的 `dependencies` 去掉 `@notnotype/nb-ui`；在仓库外建一个只有 `vue` 与 `tabbable` 的临时项目，用 `tsc --listFiles` 类型检查 nb-layout 的两个公开入口，列出的文件里没有 nb-ui 的（提案“去掉 nb-ui 依赖”）。做成 nb-layout 的一条测试或 `scripts/` 下的一个检查，实施时看哪种不用联网装依赖；做不成就记为手工验证。
- 现有 `boundary.test.ts` 的导入检查照旧。

## Spec 与文档改动

在 master 上、设计审查处理完之后：

- `docs/specs/theme/system.md`：第 2 层写明“布局变量经 nb-ui 的桥接给 nb-layout，nb-layout 读 `--nb-layout-*`”、旧名到新名的对照表、桥接在根元素上计算（旧名只在根元素上声明才生效）。
- `docs/specs/ui/nested-grid.md`、`ui/layout-drag.md` 里提到这些变量名的地方（实施时搜）改成新名或注明经桥接。
- nb-layout 的 README：主题级的一小批变量表（颜色、圆角、阴影、motion、层级），其余标内部；`defaults.css` 与 `:where(:root)`；不装 nb-ui 时的用法。
- 组件 `.md`：`state:inject` 声明、宿主旋钮的新名。
- 变更记录：插件 SDK 的组件（`NestedGrid`、`Splitter`、`SortableList`、落点组件）读的变量名变了，插件里自己设旧名旋钮（`--layout-sector-radius`、`--sortable-*`、`--nb-splitter-seam*`）的要改设新名；主题照旧（经桥接）。归“不兼容的改动”还是“改动”按已构建插件会不会坏判：设旧名旋钮的插件外观会回到缺省，归不兼容。

## 切片

1. **文案**：`text.ts` 的注入点与缺省实现、应用的适配器、Lab 场景的盘点与适配、`.md` 声明。验证：三个包的类型检查、nb-layout 测试、Splitter 与 SortableList 的 dom 测试。
2. **变量与缺省值**：改名、回退、`defaults.css`、层级、JS 读的三处、应用的两处子树覆盖与旋钮、nb-ui 的桥接与 `z-index.test.ts`、变量扫描测试。验证：nb-layout、nb-ui 的测试与类型检查；Lab 里截两三个场景对照改前改后（亮色）。
3. **依赖与机检**：`package.json` 去掉 nb-ui，“不读 nb-ui”的检查；文档、Spec、变更记录。
4. **收口**：并 master、e2e、实现审查、合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 装了 nb-ui 的宿主外观与过渡不变 | Lab 截图对照（改前改后同一批场景）；e2e 18 个读变量的文件里与布局相关的几个（见“验证”） |
| 不装 nb-ui 时默认外观可用、过渡是“有” | `defaults.css` 的缺省值；`layoutMotionMs` 的单元测试 |
| Vue 层只读 `--nb-layout-*` 且带回退 | 变量扫描测试 |
| 公开入口不读 nb-ui | `package.json`；“不读 nb-ui”的检查 |
| 文案照旧跟语言走 | Splitter、SortableList 的 dom 测试（无注入时用源语言目录；注入时用注入的） |
| 层级与 nb-ui 一致 | nb-ui `z-index.test.ts` 新加的一条 |

## 验证

- 每片三个包（nb-layout、nb-ui、应用）的类型检查与受影响的测试。
- e2e：`workbench-dnd`、`workbench-live-drag`、`workbench-containers`、`editor-area`、`lab-grid-swap`、`lab-grid-panels`、`lab-drop-sectors`、`workbench-views`，8 个文件；开跑前看负载。
- Lab 截图对照：`NestedGrid` 的交换与落点、`Splitter`、`SortableList`、落点浮层，亮色。

## 不做与风险

- 不做：默认英文与中文目录随 L2 走（第二档）；编译产物与发布（第二档）；nb-ui 里冻结的 Splitter（t14 删）；主题合同的变量名本身。
- 风险：
  - 桥接只在根元素上计算：将来有人在子树里覆盖旧名，nb-layout 看不到。写进 `theme/system.md`，并在变量扫描之外不另加机制。
  - 回退值与 nb-ui 缺省值要一致，否则不装 nb-ui 时外观偏；实施时由脚本从 `tokens.css` 取值生成对照，不手抄。
  - e2e 里在 `documentElement` 上设旧名的，经桥接照旧生效；在子树元素上设旧名的不再生效，开大范围前先搜一遍。
