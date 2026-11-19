# t36 显式入口清单与导出名测试：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 4 项“公开入口”与“导出清单的去向”表；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。开发者 2026-11-18 对 t31“都按推荐”，第一档现在做。2026-11-19 t36 拆成两个，第 5 项（小组合函数与起步材料）另建 t39（[待确认清单](../../pending-confirmations.md)）。
- 要解决的问题：nb-layout 的根入口 158 个导出、Vue 入口 41 个，大半是 `export *` 带出来的：仓库里经包名导入的只有根入口 55 个、Vue 入口 18 个，其余是求解器的内部件与写在签名里的类型。将来发布后入口里的每个名字都受版本承诺约束，内部件一旦被第三方用上就改不动。另外两个描述 `NestedGrid` 手势的类型叫 `Splitter*`，`gesture-start`、`gesture-cancel` 的载荷是内联对象、没有名字。
- 带进来的事：t33 实现审查第 7 条，“导出名、数据属性、类型名里不出现工作台概念”只写在 `AGENTS.md`、没有机检。
- 基于 t35（还在实现审查，未合入）：t35 加了 `NB_LAYOUT_THEME_VARS`、`./text` 子路径。t36 的 worktree 从 t35 合入后的 master 开。
- 盘点：[`evidences/exports-inventory.txt`](evidences/exports-inventory.txt)，由脚本按 TypeScript 的导出表与各包源码里经包名的导入（含 `export … from`）算出，排除旧应用。

## 技术选型

- 测试里读入口的导出名：用 TypeScript 的语法树（`ts.createSourceFile`，仓库已有依赖），只解析两个入口文件，不建程序、不做类型检查，毫秒级。否决：建完整程序取导出表（慢，且入口改成显式清单后没有间接导出，结果相同）；正则（`export type {…}` 的多行与 `as` 改名易漏）。

## 关键设计

### 两个入口：`src/index.ts`、`src/vue/index.ts`

- 不用 `export *`，每个名字写出来，按家族分组（网格与快照、求解与约束、手势、落点几何、可排序、实时落点、主题变量；Vue 层的组件、组合式函数、拖动会话与落点登记、文字、动效），每组一行注释说明是什么。
- 留下的：盘点里（a）仓库里有人经包名导入的；（b）写在 nb-layout 的文档（`grid.md`、组件 `.md`、README）或 `ui/nested-grid`、`ui/layout-drag`、`ui/sortable-list` 的代码片段里的；（c）出现在（a）（b）的签名里的类型，使用方要写得出类型名。根入口留 112 个（有人用 55、文档 24、签名可达 33），Vue 入口留 32 个（18、9、5）；逐个名字见盘点文件，实施时按它照抄，第一片先把清单落成入口文件，再跑类型检查确认没有漏。
- 不再从入口导出的 55 个（盘点里标“内部”，根入口 46、Vue 入口 9）：求解器件（`allocateAxis`、`clampAxis`、`axisOf`、`EPSILON`、`round`、`norm*` 等）、命中区（`hitTestSashBand`、`sashDistance` 等）、拖动解算（`solveSashDrag`、`sashEdgeDelta` 等）、独立 Splitter 的会话（`createSplitterSession`、`SplitterGestureChange`、`SplitterGestureSession`）、光标与作用域（`acquireSashCursor`、`sashCursorFor`、`SASH_GESTURE_SCOPE_KEY`、`useSashScope`）、`EMPTY_GRID_LAYOUT`、`GRID_LEGACY_SNAPSHOT_VERSION` 等。它们照旧从所在文件导出，库内（Vue 层、测试）用相对路径导入；今天库内测试已经都走相对路径。
- 有一处要判断：`createGridGestureSession` 只有 nb-workbench-layout 的测试在用，属于（a），留下；`useSashGesture`、`useSortable` 没人导入但写在文档里，属于（b），留下。

### 改名：`GridGesture*`

- 提案写“描述 `NestedGrid` 手势的 `Splitter*` 类型改成 `GridGesture*`”。核对代码，四个 `SplitterGesture*` 里只有两个是 `NestedGrid` 也用的（`useSashGesture`、`grid-gesture.ts` 与 `NestedGrid.vue` 的事件里都有）：
  - `SplitterGestureSource` → `GridGestureSource`（`"pointer" | "keyboard"`）；
  - `SplitterGestureCancelReason` → `GridGestureCancelReason`。
  - 另外两个 `SplitterGestureState`、`SplitterGestureCancellation` 是独立 `Splitter` 事件的载荷（带 `sizesPx`、面板 id），名字是对的，不改。
- 两个改名的类型从 `splitter-gesture.ts` 挪到 `sash-gesture.ts`（分隔线手势的通用核心，`NestedGrid` 与独立 `Splitter` 都建在它上面），`splitter-gesture.ts` 从那里导入。
- 给 `NestedGrid` 的两个内联载荷起名，放 `grid-gesture.ts`、从根入口导出：
  - `GridGestureStart`：`{sessionId, contextKey, source: GridGestureSource, revision, sashes: readonly GridSashRef[]}`（`gesture-start`）；
  - `GridGestureCancellation`：`{reason: GridGestureCancelReason, sashes: readonly GridSashRef[]}`（`gesture-cancel`）。
- nb-layout 自己不留旧名（不发布，仓库里的调用方一起改：Lab 的 `NestedGridAcceptanceFixture.vue`、SDK 的 `components.ts`）。
- 插件 SDK：导出新名；`SplitterGestureSource`、`SplitterGestureCancelReason` 留作 `@deprecated` 别名，指向新名（提案“SDK 里保留旧名作别名，给一个弃用期”；提案写 4 个，实际改名的是 2 个）。弃用期长度第二档前后再定，变更记录写“改动”。

### 导出名测试：`src/exports.test.ts`（Bun）

- 两个入口文件里没有 `export *`、没有默认导出。这样入口文件本身就是提交进仓库的清单：新增导出必须改它，评审时看得见。提案写的是“拿导出名与提交进仓库的清单比对”；入口改成显式清单后另放一份名单只是同一份内容写两遍，不另放（偏离，记待确认清单）。
- 导出名里没有工作台概念：按词切开（驼峰与连字符），禁用词 `workbench`、`activity`、`statusbar`（含 `status` 后接 `bar`）、`region`、`container`、`editor`、`sidebar`、`explorer`、`terminal`。`entry`、`float`、`panel`、`section` 是通用的布局词，不禁（t33 README 列的 `entryRect`、`data-drop-feedback-entry`、`FloatWindowHandles`、`LayoutFloatResize` 都按此保留）。
- 同一份禁用词也扫源码里的 `data-*` 属性名与 `dataset.*`（`src/` 非测试文件）。
- 自检：几条写违规的样例字符串必须被拦下。

### 子路径

- 现在的：`.`、`./vue`、`./text`（t35）、`./locales`、`./lab-sources`。不变。提案列的 `./style.css` 是第二档发编译产物时才有（今天组件样式随源码由宿主编译，全局样式由 `./vue` 导入），t36 不加。`./lab-sources` 不进发布包是第二档 `files` 的事。

### 稳定性标注

- 提案“第一档只对已有使用方的符号标注”。不做：包不发布、没有工具读这些标注，`@stable` 的含义（改名、改签名要走弃用期）还没有映射规则，标了也约束不了谁。等第二档 API 报告时与映射规则一起做（偏离，记待确认清单）。

## Spec 与文档改动

- `docs/specs/ui/nested-grid.md`：实现合同的“公开入口”写成“两个入口是显式清单，入口里的名字是公开面”；`gesture-start`、`gesture-cancel` 的载荷类型名写进对应的输出条目或“边界与兼容”（master，实施前）。
- `docs/specs/ui/layout-drag.md`：提到 `SplitterGesture*` 的地方改新名（实施时搜）。
- 包内（随代码）：`AGENTS.md`（入口是显式清单、加导出要改入口、禁用词由测试守）、`grid.md`、`NestedGrid.md` 里的类型名；插件 SDK `components.ts` 与它的文档；`CHANGELOG.md` 的 `[Unreleased]`。
- 提案：追加决策记录（不另放名单、不做稳定性标注、改名 2 个而不是 4 个），记待确认清单。

## 切片

1. **改名**：两个类型挪到 `sash-gesture.ts` 改名，两个载荷起名；nb-layout 内部、Lab 夹具、SDK（新名加弃用别名）跟着改。验证：nb-layout、nb-workbench-layout、应用的类型检查，nb-layout 测试，SDK 的 `sdk.test.ts`、`pack.test.ts`。
2. **显式入口与测试**：两个入口改显式清单；`exports.test.ts`。验证：同上，加 `test:affected`。
3. **文档与变更记录**：包内文档、SDK 文档、变更记录。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 入口不再带出内部件 | 入口文件是显式清单（`exports.test.ts` 拦 `export *`）；三个包的类型检查（漏了有人用的名字会报错） |
| 有人用、有文档、在签名里的名字都还在 | 类型检查；盘点文件逐项对照 |
| 不出现工作台概念 | `exports.test.ts` 的禁用词（导出名、`data-*`、`dataset.*`）与自检 |
| 改名不破坏插件 | SDK 的弃用别名；`pack.test.ts` 的作者项目类型检查 |

## 验证

- 每片：nb-layout、nb-workbench-layout、应用的类型检查与受影响的测试；收口跑 `test:affected`。
- 不改行为，不跑 e2e；改名只动类型，运行时没有变化（第 1 片的 diff 里没有值的改动，审查时核对）。

## 不做与风险

- 不做：稳定性标注（见上）；API 报告与“签名里用到但没导出的类型”的机检（第二档，api-extractor 的 forgotten-export 一类）；`./style.css`。
- 风险：入口删掉的内部件里，有第三方插件经 SDK 以外的路径用到的：插件只经 SDK 用 nb-layout（`components.ts` 列名），SDK 的导出面不变（改名有别名），不受影响。
