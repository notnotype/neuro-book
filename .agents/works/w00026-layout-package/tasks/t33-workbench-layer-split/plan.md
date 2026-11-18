# t33 计划：拆出工作台层，新包 `@notnotype/nb-workbench-layout`

第 2 稿（2026-11-18）：按设计审查（[`evidences/plan-review.txt`](evidences/plan-review.txt)，9 条，处理在 Task README）改：

- 新包的配置列全（第 1 条）；
- SDK 打包与比对产物（第 2 条）；
- 浮动窗矩形下沉的类型（第 3 条）；
- `DropSectorsOverlay` 只放宽、不改接口（第 4 条）；
- `entryRect` 与分界判据（第 5 条）；
- 导入按 AST 改（第 6 条）；
- 登记的漏项与多余项（第 7 条）；
- e2e 清单（第 8 条）；
- 切片 1 的闸与 L2 的边界（第 9 条）。

## Context

提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md)，开发者 2026-11-18 接受，见 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。它的第一档第 1 项：把工作台的领域模型拆出 nb-layout，放进一个不发布的工作区包。拆包有两条硬理由：

- 许可证：nb-layout 以后发 MIT，工作台层留在 AGPL；
- 依赖方向由包边界守住。

本 Task 只搬家、改依赖与导入，不改行为、不改接口。失败形状、去 nb-ui、显式入口与改名各是 t34、t35、t36。

## 技术选型

无新依赖。改导入写一个一次性脚本：

- 用 TypeScript 的编译器 API 解析导入，`.vue` 先用 `@vue/compiler-sfc` 取出 `<script>` 块；
- 按说明符改写，保留每个说明符自己的 `type` 修饰；
- 两样都在仓库已有的依赖里。

## 关键设计

### 切片 1 的闸：先把要搬的文件挪进 `src/workbench/`

- 先在 nb-layout 里把要搬的文件 `git mv` 到 `src/workbench/` 子目录：`layout-doc`、`layout-project`、`layout-drop`、`presented-ids`、`layout-doc-fixtures` 及测试，`vue/TabStrip.*` 与 `vue/tab-strip-geometry*` 到 `src/workbench/vue/`。
- `boundary.test.ts` 加 `excluding: ["workbench"]`：L0、L1 不得导入 `src/workbench/`。现在会失败，切片 1 做完转绿。
- 切片 2 再把整个子目录搬进新包。
- 审查核实过：L0、L1 反向导入这些文件的只有 `FloatWindowHandles.vue`、`DropSectorsOverlay.vue` 两处，以及 `DropSectorsOverlay.dom.test.ts` 用的夹具。

### L1 里带 L2 概念的三处（切片 1）

- **浮动窗矩形下沉到 L0**：
  - `grid-rects.ts` 新增 `GridFloatRect`（`{x, y, width, height}`）；
  - `resizeFloatRect`、`clampFloatRect`、`LayoutFloatResize` 随它下沉：两个函数共用一个矩形，不分居两包；
  - L2 的 `LayoutFloatRect` 写成 `GridFloatRect` 的别名，结构兼容，应用不用改；
  - 公开入口补这几个值与类型的导出。
- **`DropSectorsOverlay`**：
  - 只把 `sectors` 的 `id` 放宽成 `string`：`sectors: ReadonlyArray<{readonly id: string; readonly points: ReadonlyArray<readonly [number, number]>}>`、`active: string | null`；
  - `labels` 保持可选：`labels?: Readonly<Record<string, string | undefined>>`；
  - 应用照原样把 `layoutDropSectors` 的输出传进来，不加映射；
  - L1 的 DOM 测试换成手写的小夹具；
  - 原来那条用真实 `layoutDropSectors` 输出挂组件的用例，搬进 L2 包，保住“判定算出来的形状组件画得出来”的覆盖；
  - 组件 `.md` 的数据一节与 `data-drop-sector` 的取值补上 `whole`。
- **`DropFeedbackOverlay` 的 `entryRect`**：
  - 元素与分支都留在 L1，类型改成可选；
  - 注释与 `.md` 改成“宿主给的次级高亮盒”，不再写“活动栏入口”“切换器”；
  - 不拆、不改名（t36）。
  - 工作台照旧经 `entryRect` 给入口条的高亮。
- **分界判据**写成“导出的标识符、数据属性、类型名里有活动栏、状态栏、区域、容器、编辑组这些概念的，属于 L2”，不含注释与测试里的场景描述。
- L1 里仍残留的工作台说法列成清单记进 Task README，例如 `grid-motion.ts:280` 的“视图被活动栏吸收”、`grid-drop.ts:24` 的“工作台边缘并入”；它们是注释，不改。

### 新包 `packages/nb-workbench-layout`（切片 2）

- 从 nb-layout 复制后改 include 与入口：`package.json`、`bunfig.toml`（`pathIgnorePatterns` 排除 `*.dom.test.ts`）、`vitest.config.ts`、`tsconfig.json`（排除 `src/vue`）、`tsconfig.vue.json`。
- `package.json`：
  - 名字 `@notnotype/nb-workbench-layout`，`private: true`，许可证同仓库；
  - `exports`：`.`（纯 TS，`src/index.ts`）、`./vue`（`TabStrip`）、`./lab-sources`；
  - 依赖：`@notnotype/nb-layout`、`@notnotype/nb-ui`，都是 `workspace:^`；
  - 开发依赖照 nb-layout：`@notnotype/neuro-book-test-support`、`@vitejs/plugin-vue`、`@vue/test-utils`、`happy-dom`、`vitest`、`vue`、`vue-tsc`、`typescript`、`@types/bun`；
  - peer 依赖 `vue`；
  - 脚本：`test` 与 `typecheck`，写法同 nb-layout。
- `src/workbench/` 整个 `git mv` 进新包的 `src/`。搬过来的文件改用 `@notnotype/nb-layout` 与 `/vue` 的公开入口，不用相对路径深入 nb-layout。
- 新包的 `src/vue/lab-sources.ts`，用 `import.meta.glob`，照 nb-layout 的写法。
- `AGENTS.md`：
  - 写分界判据、许可证同仓库、只经公开入口用 nb-layout；
  - 要含 `../../AGENTS.md`，否则 `governance:check` 报错。
- `README.md` 一段。
- 边界测试分两层：
  - `src/` 顶层只许导入 `@notnotype/nb-layout`；
  - `src/vue/` 许 `vue`、nb-ui（含 `/components`、`/utils`）、`@notnotype/nb-layout` 与 `/vue`。
  - 服务端经 `workbench/shared/` 导入 `.`，`.` 里混进 Vue 代码时这条会拦。

### nb-layout 留下的部分（切片 2）

- `package.json` 加 `"private": true`。
- `src/index.ts`：去掉对搬走文件的 `export *`；补 `placeGrid`（L2 的 `layout-drop.ts` 用它）。补什么以类型检查为准，审查核过今天只缺这一个；不预先公开 `GridPlacement` 一类没人按名字导入的类型。
- `boundary.test.ts` 的 `excluding` 随子目录搬走后拿掉。

### 应用的导入（切片 2）

- 名字到包的表，按**新位置的公开入口**实际导出的名字建：L2 的 `.` 与 `./vue`、L0 的 `.`、L1 的 `./vue`。脚本对每个说明符断言新入口里确有这个名字。
- 覆盖的写法：
  - 单行与多行的 `import`、`import type`；
  - 行内 `type` 修饰；
  - `export ... from` 的重导出，例如 `sdk/components.ts`；
  - `.vue` 的 `<script>` 块；
  - 动态 `import()`：Lab 的 `fixtures/nb-layout/index.ts`。
- 范围：`packages/neuro-book` 的 `src`、`e2e`、`scripts`、`plugin-sdk`。审查数过，有 56 个文件、108 处。
- 先 dry run，输出“文件：旧导入 → 新导入”，核对后统一写入。写完以全仓类型检查兜底。
- `packages/neuro-book/package.json` 的 `devDependencies` 加 `@notnotype/nb-workbench-layout: workspace:*`。nb-layout 也在 `devDependencies`：应用是构建产物，运行时不装。

### 插件 SDK（切片 2）

- `pack.ts`：
  - `typePaths()` 加新包 `.` 与 `/vue` 的源码映射，不然发布的 d.ts 里会留下作者项目装不到的导入；
  - `componentsDoc()` 把新包的 `vue` 目录也读进来，`TabStrip` 仍归“布局”组。
- `src/sdk/components.ts`：`TabStrip` 与 `TabStripItem`、`TabStripPartition` 改从新包重导出，名字不变。
- `sdk.test.ts`：两处入口列表加新包的 `.` 与 `/vue`。
- 对照：搬前搬后各跑一次 `build:sdk` 到临时目录，比对 `docs/components.md`、`docs/exports.md` 与三份 `*.d.ts` 的导出名，要一致；`grep -r "nb-workbench-layout\|nb-layout"` 输出目录要零命中。

### 登记与链接（切片 2）

- 根 `package.json` 的 `workspaces`；`bun install` 之后提交 `bun.lock`，只按路径暂存。
- `docs/modules/monorepo-boundaries.md`：改布局工具一行，加新包一行。
- `scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS`：`TabStrip.md` 换到新包的入口。
- Lab：
  - `component-index.ts` 多引一对 `nbWorkbenchLayoutComponentDocs`、`nbWorkbenchLayoutComponentModules`；
  - `fixtures/nb-layout/` 里按 L2 概念写的夹具改导入。
- 链接：
  - `EditorTabBar.md:8` 指向 `TabStrip.md` 的链接；
  - `docs/specs/ui/workbench-layout.md:151` 的链接；
  - `e2e/lab-tab-strip.e2e.ts:2` 的路径注释。
  - 已接受的提案 `workbench-view-containers.md:43` 不改：接受后冻结，那里写的是当时的路径。
- 根 `AGENTS.md` 的仓库结构加一行，主会话在主工作区改。
- 不改根 README 的包表与 `PROJECT-STATUS.md` 的包数：那里只列发布的包，新包 `private`。

## Spec 与文档改动

- `ui/workbench-layout`、`ui/nested-grid` 的实现合同与证据：路径改到新包。
- 组件 `.md`：`DropSectorsOverlay.md`、`DropFeedbackOverlay.md`、`FloatWindowHandles.md`、`TabStrip.md`（随包搬）。
- nb-layout 的 `README.md`、`AGENTS.md`；`grid.md` 的“布局文档”一节挪进新包的说明，原处留一句指过去。

## 切片

1. **L1 去掉 L2 概念**（nb-layout 里，worktree）。
   - 内容：要搬的文件挪进 `src/workbench/`，`boundary.test` 加 `excluding`（先红）；浮动窗矩形下沉；`DropSectorsOverlay` 放宽；`entryRect`；测试换夹具；组件 `.md`。
   - 验证：
     - nb-layout `bun test`、vitest、类型检查，`boundary.test` 转绿；
     - neuro-book 类型检查与工作台单元测试；
     - e2e：`lab-drop-sectors`、`workbench-dnd`、`workbench-float`、`editor-area`。
2. **新包与搬家**。
   - 内容：新包的配置与入口；`git mv src/workbench`；nb-layout 的入口与 `private`；两包的边界测试；导入脚本；SDK；登记与链接。
   - 验证：
     - 两个包与应用的类型检查与单元测试；
     - `docs:check`、`governance:check`；
     - SDK 产物比对；
     - e2e 12 个文件：`workbench-shell`、`workbench-views`、`workbench-containers`、`workbench-dnd`、`lab-workbench-surface`、`lab-drop-sectors`、`lab-nested-grid`、`lab-scenes`、`lab-tab-strip`、`lab-grid-panels`、`workbench-live-drag`、`lab-drag-session`。超过 8 个文件，带 `NB_E2E_WIDE`，理由是导入与解析整体换了一遍。
     - `bun install` 之后单独起一次开发服务，打开 `lab?c=TabStrip`：Vite 会缓存 `exports` 的解析。
3. **文档**：Spec 的实现合同与证据、包说明。

## 验收映射

不改行为，没有新的输出条目。判据：

- 切片 1：`boundary.test` 由红转绿；
- 切片 2：两包的边界测试与类型检查通过，SDK 产物比对一致、零外部引用；
- 上面的 e2e 照过。

## 不做与风险

- 不改失败形状、不去 nb-ui、不收窄入口、不改名：各自是 t34、t35、t36。
- 风险：主工作区的暂存区几个会话共用，根 `package.json`、`bun.lock` 别的会话也可能在改，提交时按路径限定，`bun.lock` 的改动核对只含新包。
