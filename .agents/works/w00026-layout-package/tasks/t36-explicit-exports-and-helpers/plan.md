# t36 显式入口清单与导出名测试：实施计划（第 2 稿）

第 2 稿按设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，10 条，阻断 0、重要 3、建议 7）改，逐条处理见 Task README。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 4 项“公开入口”与“导出清单的去向”表；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。开发者 2026-11-18 对 t31“都按推荐”，第一档现在做。2026-11-19 t36 拆成两个，第 5 项（小组合函数与起步材料）另建 t39（[待确认清单](../../pending-confirmations.md)）。
- 要解决的问题：nb-layout 的根入口 158 个导出、Vue 入口 41 个，大半是 `export *` 带出来的：仓库里经包名导入的只有根入口 55 个、Vue 入口 18 个，其余是求解器的内部件与写在签名里的类型。将来发布后入口里的每个名字都受版本承诺约束，内部件一旦被第三方用上就改不动。另外两个描述 `NestedGrid` 手势的类型叫 `Splitter*`，`gesture-start`、`gesture-cancel` 的载荷是内联对象、没有名字。
- 带进来的事：t33 实现审查第 7 条，“导出名、数据属性、类型名里不出现工作台概念”只写在 `AGENTS.md`、没有机检。
- 基于 t35（还在实现审查，未合入）：t35 加了 `NB_LAYOUT_THEME_VARS`、`./text` 子路径。t36 的 worktree 从 t35 合入后的 master 开。
- 盘点：[`evidences/exports-inventory.txt`](evidences/exports-inventory.txt)，由脚本（同目录 `inventory-exports.ts.txt`、`inventory-reach.ts.txt`，`bun` 运行时把扩展名改回 `.ts`）按 TypeScript 的导出表与各包源码里经包名的导入（含 `export … from`）算出，排除旧应用。盘点基于 t35 分支 `52a97a76a`；实施第一步在 t35 合入后的 master 上重跑一遍，并把“文档”判据收紧为名字是整个行内代码或代码块里导入的名字（第一稿按词边界匹配，`not-finite` 让 `finite` 误判成“文档”）。

## 技术选型

- 测试里读入口的导出名：用 TypeScript 的语法树（`ts.createSourceFile`，仓库已有依赖），只解析两个入口文件，不建程序、不做类型检查，毫秒级。否决：建完整程序取导出表（慢，且入口改成显式清单后没有间接导出，结果相同）；正则（`export type {…}` 的多行与 `as` 改名易漏）。

## 关键设计

### 两个入口：`src/index.ts`、`src/vue/index.ts`

- 不用 `export *`，每个名字写出来，按家族分组（网格与快照、求解与约束、手势、落点几何、可排序、实时落点、主题变量；Vue 层的组件、组合式函数、拖动会话与落点登记、文字、动效），每组一行注释说明是什么。
- 每个入口一行一个名字（评审与合并时一眼看得出加了哪个）。
- 留下的：盘点里（a）仓库里有人经包名导入的；（b）写在 nb-layout 的文档（`grid.md`、组件 `.md`、README）或 `ui/nested-grid`、`ui/layout-drag`、`ui/sortable-list` 里、作为公开接口介绍的；（c）出现在（a）（b）的签名里的类型，使用方要写得出类型名。提案说基线是“实际导入清单”（55 + 18），（b）（c）多留的 57 个是偏离，记待确认清单：（c）都是类型，形状已经被暴露它们的函数签名锁住，不导出只是让使用方写不出类型名；（b）是文档里教人用的接口。根入口留 112 个（有人用 55、文档 24、签名可达 33），Vue 入口留 32 个（18、9、5）；逐个名字见盘点文件，实施时按它照抄，第一片先把清单落成入口文件，再跑类型检查确认没有漏。
- 不再从入口导出的 55 个（盘点里标“内部”，根入口 46、Vue 入口 9）：求解器件（`allocateAxis`、`clampAxis`、`axisOf`、`EPSILON`、`round`、`norm*` 等）、命中区（`hitTestSashBand`、`sashDistance` 等）、拖动解算（`solveSashDrag`、`sashEdgeDelta` 等）、独立 Splitter 的会话（`createSplitterSession`、`SplitterGestureChange`、`SplitterGestureSession`）、光标与作用域（`acquireSashCursor`、`sashCursorFor`、`SASH_GESTURE_SCOPE_KEY`、`useSashScope`）、`EMPTY_GRID_LAYOUT`、`GRID_LEGACY_SNAPSHOT_VERSION` 等。它们照旧从所在文件导出，库内（Vue 层、测试）用相对路径导入；今天库内测试已经都走相对路径。
- 几处判断：
  - `createGridGestureSession` 只有 nb-workbench-layout 的测试在用，属于（a），留下。
  - `useSashGesture` 写在 `ui/nested-grid` 实现合同的公开入口里，但它返回的作用域以 `分支 id:序号` 为键、算键的 `sashKey` 与渲染分隔线的 `SashHandle` 都不公开，第三方只靠入口搭不出分隔条（审查第 5 条）；现在也没人经包名用它。降为内部，连带 `SashGestureOptions`、`SashGestureScope`、`SashRegistration`；Spec 实现合同的公开入口里删掉它。
  - `useSortable` 写在 `SortableList.md` 里、配套的 L0 可排序函数也在文档里，留下。
  - `finite` 是内部件（盘点误判）。

### 改名：`SashGesture*` 与 `GridGesture*`

- 提案写“描述 `NestedGrid` 手势的 `Splitter*` 类型改成 `GridGesture*`”。核对代码，四个 `SplitterGesture*` 里只有两个是 `NestedGrid` 也用的，而且独立 `Splitter` 同样用，是分隔线手势的通用词汇：
  - `SplitterGestureSource` → `SashGestureSource`（`"pointer" | "keyboard"`）；
  - `SplitterGestureCancelReason` → `SashGestureCancelReason`。
  - 前缀用 `Sash` 而不是提案写的 `Grid`（审查第 4 条）：它们挪进 `sash-gesture.ts`（`NestedGrid` 与独立 `Splitter` 共用的核心），那里的类型都是 `Sash*`（`SashGestureCommit`、`SashGestureHost`）；叫 `Grid*` 会让独立 `Splitter` 的载荷带上 `Grid`。提案的意思是“`NestedGrid` 的类型不叫 `Splitter`”，这样也做到了（偏离命名，记决策记录）。同文件里内联的三处 `"pointer" | "keyboard"` 换成这个别名。
  - 另外两个 `SplitterGestureState`、`SplitterGestureCancellation` 是独立 `Splitter` 事件的载荷（带 `sizesPx`、面板 id），名字是对的，不改。
- 给 `NestedGrid` 的两个内联载荷起名，放 `grid-gesture.ts`、从根入口导出：
  - `GridGestureStart`：`{sessionId, contextKey, source: SashGestureSource, revision, sashes: readonly GridSashRef[]}`（`gesture-start`）；
  - `GridGestureCancellation`：`{reason: SashGestureCancelReason, sashes: readonly GridSashRef[]}`（`gesture-cancel`；与 `sash-gesture.ts` 里 `onCancel` 的入参同形，那里改用它）。
- nb-layout 自己不留旧名（不发布，仓库里的调用方一起改：Lab 的 `NestedGridAcceptanceFixture.vue`、SDK 的 `components.ts`）。
- 插件 SDK（`src/sdk/components.ts`）：导出新名；`SplitterGestureSource`、`SplitterGestureCancelReason` 留作弃用别名（提案“SDK 里保留旧名作别名，给一个弃用期”；提案写 4 个，实际改名的是 2 个）。写成声明式别名才挂得上 `@deprecated`：`import type {SashGestureSource} from "@notnotype/nb-layout"` 加 `/** @deprecated 改用 SashGestureSource */ export type SplitterGestureSource = SashGestureSource;`。两处 SDK 测试按 `export {…}` 取名单，认不出这种写法（审查第 1 条），一起改：`pack.test.ts` 的“类型导出的名字”改成读语法树、认 `export type X =`；`sdk.test.ts` 比对布局类型时，弃用别名列在一张带理由的表里、不要求在入口里。第 1 片核对生成的 `components.d.ts` 保留了 `@deprecated`。弃用期长度第二档前后再定，变更记录写“改动”。

### 导出名测试：`src/exports.test.ts`（Bun）

- 覆盖 `package.json` 的 `exports` 里每个入口（`lab-sources` 除外，它不进发布包）：`.`、`./vue`、`./text`、`./locales`，不写死两个文件（审查第 2 条）。
- 入口文件里没有 `export *`、没有默认导出，每个具名导出一行一个名字。这样入口文件本身就是提交进仓库的清单：新增导出必须改它，评审时看得见。提案写的是“拿导出名与提交进仓库的清单比对”；入口改成显式清单后另放一份名单只是同一份内容写两遍，不另放（偏离，记待确认清单）。
- 文档里教人导入的名字都在入口里：读 nb-layout 的 `.md`、README 与 `ui/nested-grid`、`ui/layout-drag`、`ui/sortable-list` 代码块里 `from "@notnotype/nb-layout…"` 的导入名，逐个要在对应入口的导出里（审查第 9 条，补上判据（b）没人编译的那一半）。
- 导出名里没有工作台概念：按词切开（驼峰与连字符），禁用词与 `AGENTS.md` 规则的对应写在测试头注释：活动栏 `activity`、状态栏 `statusbar`（含 `status` 后接 `bar`）、区域 `region`、容器 `container`、编辑组 `editor`、具名面板 `explorer`、`terminal`、`sidebar`，外加 `workbench`。只扫导出名与 `data-*`、`dataset.*`，不扫成员名（`containerRect`、键盘配置里的 `region` 是通用意义，留着）；`AGENTS.md` 的规则措辞同样限定为“导出名与数据属性”。`entry`、`float`、`panel`、`section` 是通用的布局词，不禁（t33 README 列的 `entryRect`、`data-drop-feedback-entry`、`FloatWindowHandles`、`LayoutFloatResize` 都按此保留）。
- 同一份禁用词也扫源码里的 `data-*` 属性名与 `dataset.*`（`src/` 非测试文件）。
- 自检：几条写违规的样例字符串必须被拦下。
- 读入口导出名的语法树代码今天在 `packages/neuro-book/src/sdk/sdk.test.ts`（`exportedValues`、`exportedTypes`），抽到 `@notnotype/neuro-book-test-support` 的新子路径 `./module-exports`，两边共用（审查第 10 条）。

### `./text` 只导出注入点

- `useLayoutText` 与缺省翻译是组件内部的，挪到 `vue/layout-text.ts`（组件从那里导入）；`text.ts`（`./text` 子路径）只留 `LAYOUT_TEXT_KEY`、`LayoutTranslate`、`LayoutTextParams`、`LayoutTextKey`（审查第 2 条）。

### 子路径

- 现在的：`.`、`./vue`、`./text`（t35）、`./locales`、`./lab-sources`。不变。提案列的 `./style.css` 是第二档发编译产物时才有（今天组件样式随源码由宿主编译，全局样式由 `./vue` 导入），t36 不加。`./lab-sources` 不进发布包是第二档 `files` 的事。

### 稳定性标注

- 提案“第一档只对已有使用方的符号标注”。不做：包不发布、没有工具读这些标注，`@stable` 的含义（改名、改签名要走弃用期）还没有映射规则，标了也约束不了谁。等第二档 API 报告时与映射规则一起做（偏离，记待确认清单）。

## Spec 与文档改动

- `docs/specs/ui/nested-grid.md`（master，实施前，按 writing-specs）：实现合同的“公开入口”写成“入口是显式清单，入口里的名字是公开面”，删掉 `useSashGesture`；“边界与兼容”新写一句：`gesture-start`、`gesture-cancel` 的载荷类型是 `GridGestureStart`、`GridGestureCancellation`（今天 Spec 里没有这两个载荷的条目，这是新内容）。三份 Spec 里没有 `SplitterGesture*`，不用改。
- 包内（随代码）：`AGENTS.md`（入口是显式清单、加导出要改入口、禁用词由测试守）、`grid.md`、`NestedGrid.md` 里的类型名；插件 SDK `components.ts` 与它的文档；`CHANGELOG.md` 的 `[Unreleased]`。
- 提案：追加决策记录（不另放名单、不做稳定性标注、改名 2 个而不是 4 个），记待确认清单。

## 切片

1. **改名**：两个类型挪到 `sash-gesture.ts` 改名，两个载荷起名；nb-layout 内部、Lab 夹具、SDK（新名加弃用别名）跟着改；两处 SDK 测试认弃用别名。验证：nb-layout、nb-workbench-layout、应用的类型检查，nb-layout 测试，SDK 的 `sdk.test.ts`、`pack.test.ts`（含 `components.d.ts` 里的 `@deprecated`）。
2. **显式入口与测试**：在 t35 合入后的 master 上重跑盘点（收紧的判据）；四个入口改显式清单、一行一个；`useLayoutText` 挪内部；`useSashGesture` 降内部；test-support 的 `./module-exports`；`exports.test.ts`。验证：同上，加 `test:affected`。
3. **文档与变更记录**：包内文档、SDK 文档、变更记录。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 入口不再带出内部件 | 入口文件是显式清单（`exports.test.ts` 拦 `export *`）；三个包的类型检查（漏了有人用的名字会报错） |
| 有人用、有文档、在签名里的名字都还在 | 类型检查（有人用的）；`exports.test.ts` 的文档导入名检查（文档里教的）；盘点文件逐项对照（签名里的） |
| 不出现工作台概念 | `exports.test.ts` 的禁用词（导出名、`data-*`、`dataset.*`）与自检 |
| 改名不破坏插件 | SDK 的弃用别名；`pack.test.ts` 的作者项目类型检查 |

## 验证

- 每片：nb-layout、nb-workbench-layout、应用的类型检查与受影响的测试；收口跑 `test:affected`。
- 不改行为，不跑 e2e；改名只动类型，运行时没有变化（第 1 片的 diff 里没有值的改动，审查时核对）。

## 不做与风险

- 不做：稳定性标注（见上）；API 报告与“签名里用到但没导出的类型”的机检（第二档，api-extractor 的 forgotten-export 一类）；`./style.css`。
- 风险：入口删掉的内部件里，有第三方插件经 SDK 以外的路径用到的：插件只经 SDK 用 nb-layout（`components.ts` 列名），SDK 的导出面不变（改名有别名），不受影响。
