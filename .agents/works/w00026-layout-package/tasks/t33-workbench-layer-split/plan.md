# t33 计划：拆出工作台层，新包 `@notnotype/nb-workbench-layout`

第 1 稿（2026-11-18）。

## Context

提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md)，开发者 2026-11-18 接受，见 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。它的第一档第 1 项是：把工作台的领域模型拆出 nb-layout，放进一个不发布的工作区包。拆包有两条硬理由：

- 许可证：nb-layout 以后发 MIT，工作台层留在 AGPL；
- 依赖方向由包边界守住。

本 Task 只搬家、改依赖与导入，不改行为。失败形状、去 nb-ui、显式入口各是后面的 Task（t34、t35、t36）。

## 技术选型

无新依赖。改导入用一次性脚本：按“名字到包”的表改，先 dry run，再统一写入。

## 关键设计

### 新包 `packages/nb-workbench-layout`

- `package.json`：
  - `name` 是 `@notnotype/nb-workbench-layout`，`private: true`，许可证同仓库；
  - `exports`：`.` 指向纯 TS 的 `src/index.ts`，`./vue` 指向 `src/vue/index.ts`（放 `TabStrip`）；
  - 依赖：`@notnotype/nb-layout` 与 `@notnotype/nb-ui`（`TabStrip` 要用），都是 `workspace:^`；
  - 脚本：`test`、`typecheck` 照 nb-layout 的写法。
- 从 nb-layout 用 `git mv` 搬过来的（保留历史）：
  - `layout-doc.ts`、`layout-project.ts`、`layout-drop.ts`、`presented-ids.ts`、`layout-doc-fixtures.ts` 及它们的测试；
  - `vue/TabStrip.vue`、`TabStrip.md`、`TabStrip.dom.test.ts`、`tab-strip-geometry.ts`、`tab-strip-geometry.dom.test.ts`。
  - 搬过来的文件改用 `@notnotype/nb-layout` 的公开入口导入，不用相对路径深入 nb-layout。
- `live-drop.ts` 留在 nb-layout：它的候选只用不透明的键，与领域无关。
- `AGENTS.md`：
  - 分界判据：文件里出现活动栏、状态栏、区域名、容器、编辑组这些词的，属于本包；
  - 本包许可证同仓库；
  - 只经公开入口用 nb-layout。
- `README.md` 一段，说明它是工作台的布局模型，不发布。

### nb-layout 留下的部分

- `package.json` 加 `"private": true`：发布路径建好之前，不能从包目录直接发出去。
- `src/index.ts`：去掉对搬走文件的 `export *`。
- L2 要用、今天不在 `.` 入口里的名字（`placeGrid`、`GridPlacement`、`GridLeafPlacement` 一类），加进公开入口。清单从 L2 文件的实际导入里抽：搬完跑类型检查，缺什么补什么，补的都记进 Task README。
- 提案“L1 里带 L2 概念的文件”那张表，逐个处理：
  - `resizeFloatRect`、`LayoutFloatResize` 下沉到 `grid-rects.ts`，与 `GridFloatInput` 放一起；nb-layout 的 `FloatWindowHandles.vue` 与 L2 都从 L0 取。
  - `DropSectorsOverlay.vue` 改成泛型：`sectors: {id: string; points}[]`、`active: string | null`、`labels: Record<string, string>`，不再导入 L2 的类型。工作台把 `LayoutDropSector` 映射过去，这层映射放在应用里调用它的地方。
  - `DropFeedbackOverlay.vue` 的 `entryRect` 改成可选，注明由宿主扩展。
  - 用到 L2 夹具的 L1 测试（`DropSectorsOverlay.dom.test.ts` 等）换成 nb-layout 自己的小夹具，或者随被测的东西搬走。
  - `lab-sources.ts` 只登记留在 L1 的组件；`TabStrip` 的 Lab 来源搬到 L2。
- `boundary.test.ts` 改成三条规则：
  - L0 只导入 L0；
  - L1 只导入 `vue`、`tabbable`、nb-ui（t35 才去掉）与 L0；
  - nb-layout 里不出现 `@notnotype/nb-workbench-layout`。
- L2 包另有一个 `boundary.test.ts`：只经 `@notnotype/nb-layout` 与 `@notnotype/nb-layout/vue` 导入，不导入 `@notnotype/nb-layout/src/…`。

### 应用与插件 SDK 的导入

- 一次性脚本：
  - 列出搬走文件导出的全部名字，得到名字到包的表；
  - 扫 `packages/neuro-book` 的 `src`、`e2e`、`scripts`、`plugin-sdk` 里从 `@notnotype/nb-layout` 或 `/vue` 导入的语句；
  - 把属于 L2 的名字拆到 `@notnotype/nb-workbench-layout` 或 `/vue` 的导入里，`import type` 与值导入分开保留。
  - 先 dry run 列出改动，核对后统一写入。
- `packages/neuro-book/package.json` 加 `@notnotype/nb-workbench-layout: workspace:*`。
- 插件 SDK（`src/sdk/components.ts`、`pack.ts`、`sdk.test.ts`）：`TabStrip` 改从新包重导出，名字不变。`Splitter*` 类型本 Task 不改名（t36 的事）。搬前搬后各导出一份 SDK 的名字清单，要求一致。

### 登记

- 根 `package.json` 的 `workspaces`；
- `docs/modules/monorepo-boundaries.md` 的布局工具一行，以及新包一行；
- `scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS`：`TabStrip.md` 换到新包的入口；
- Lab 的 `component-index.ts` 与 `plugins/lab/web/fixtures/nb-layout/` 里按 L2 概念写的夹具；
- 根 `README.md` 的包表与 `docs/` 里现有的包数；
- 根 `AGENTS.md` 仓库结构里加一行，由主会话在主工作区改；
- `bun install` 让新的工作区链接生效。

## Spec 与文档改动

- `ui/workbench-layout`、`ui/nested-grid` 的实现合同与证据：公开入口与实现入口的路径改到新包。
- nb-layout 的 `README.md`、`AGENTS.md`：写清包里不再有工作台模型，并链接新包。
- 包内的 `.md`（`grid.md` 的“布局文档”一节）挪进新包的说明，`grid.md` 只留一句指过去。

## 切片

1. **L1 去掉 L2 概念**，还在一个包里做：
   - `resizeFloatRect` 下沉；
   - `DropSectorsOverlay` 改泛型，应用里接上映射；
   - `entryRect` 改可选；
   - 测试换夹具。

   验证：nb-layout `bun test`、vitest、类型检查；neuro-book 类型检查与工作台单元测试。
2. **新包与搬家**：
   - `git mv`，新包的 `package.json`、入口、AGENTS、README；
   - nb-layout 的入口与 `private`、两个 `boundary.test`；
   - 应用的导入脚本；
   - SDK 名字清单的对照；
   - 登记。

   验证：
   - 两个包与应用的类型检查和单元测试；
   - `docs:check`、`governance:check`；
   - e2e 七个文件：`workbench-shell`、`workbench-views`、`workbench-containers`、`workbench-dnd`、`lab-workbench-surface`、`lab-drop-sectors`、`lab-nested-grid`，加 `TabStrip` 的 Lab 场景。导入变了，开发服务与 Vite 的解析也要跑一遍。
3. **文档**：Spec 的实现合同与证据、包说明。

## 验收映射

不改行为，没有新的输出条目。判据：

- 搬前搬后的 SDK 名字清单一致；
- 两条 `boundary.test` 通过；
- 上面的 e2e 与单元测试照过。

## 不做与风险

- 不改失败形状、不去 nb-ui、不收窄入口、不改名：各自是 t34、t35、t36。
- 风险：Vite 与 Bun 对新工作区包的解析，开发服务里要重启才认（记忆“改 exports 后重启开发服务”）。e2e 自己起服务不受影响，交开发者看之前重启。
- 风险：主工作区的暂存区几个会话共用，根 `package.json`、`bun.lock` 别的会话也可能在改，提交时按路径限定。
