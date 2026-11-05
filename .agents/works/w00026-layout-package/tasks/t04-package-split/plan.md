# t04 计划：拆包 nb-layout（不改行为）

## Context

依据 [布局提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 10 节与 [ADR 0044](../../../../../docs/adr/0044-workbench-single-layout-tree.md)。开发者已定：布局工具全部进 `nb-layout`，包括 Splitter 与分隔线核心；nb-story、dev-panel 不急着迁（t14），迁移前 nb-ui 暂留一份冻结的；nb-ui 不重导出。这一步只搬家，不改行为，不做 `branchId`、`sashLineEnds` 的清理（t06）。

代码在 `.worktree/w00026-t04-layout-package`（分支 `feat/w00026-t04-layout-package`）。

## 技术选型

无。包结构照 `nb-form`：核心 `bun test`，Vue 层 Vitest（`*.dom.test.ts`），`boundary.test.ts` 核对导入，文字走 nb-ui 的翻译端口，样式用 scoped CSS 不用原子类。

## 关键设计

### `packages/nb-layout/`

入口：`.`（`src/index.ts`）、`./vue`（`src/vue/index.ts`）、`./locales`、`./lab-sources`。依赖 `@notnotype/nb-ui`，peer `vue`、`typescript`。

| 去向 | 文件（来自 `nb-ui/src/components/layout/`，另有 `composables/`） |
|---|---|
| `src/`（核心，无 Vue、无 DOM） | `grid-types`、`grid-geometry`、`grid-snapshot`、`grid`、`grid-gesture`、`grid-drop`、`sash-drag`、`sash-hit-area`、`sash-gesture`、`splitter-gesture`、`splitter-session`，及它们的测试 |
| `src/vue/` | `Splitter`、`NestedGrid`、`GridBranchRenderer`、`DropFeedbackOverlay`、`DropIndicator`、`DropIndicatorLabel`、`grid-splitter`、`sash-feedback`、`sash-scope`、`useSashGesture`、`useGridLayout`、`useLayoutExtent`，及同名 `.md`、测试 |

要守住的：

- **原子类换 scoped CSS**：`Splitter`、`NestedGrid`、`GridBranchRenderer` 的原子类逐条换成等价的 scoped 规则。`.nb-ui-drop-indicator*` 从 nb-ui 的 `styles.css` 搬进组件。令牌名不变（`--drop-area-*`、`--sash-line-*`、`--nb-splitter-*`）。
- **文字**：`splitter.*` 的键复制到 `nb-layout` 的目录，命名空间 `nb-layout`，宿主在 `text-engine.ts` 登记。
- **边界测试**：核心只导入自己的文件；Vue 层只导入 `vue`、`@notnotype/nb-ui` 与本包。

### `packages/nb-ui/`

- **删除**：`grid`、`grid-snapshot`、`grid-gesture`、`grid-drop`、`NestedGrid`、`GridBranchRenderer`、`DropFeedbackOverlay`、`DropIndicator*`、`useGridLayout`，`layout/index.ts`，入口 `./layout`、`./grid`，`e2e/nested-grid.spec.ts` 与它的验收页。
- **冻结留下**（t14 删）：`Splitter` 及它依赖的 `splitter-*`、`sash-*`、`grid-geometry`、`grid-types`、`grid-splitter`、`useSashGesture`、`useLayoutExtent`，`e2e/splitter.spec.ts`。文件头注明冻结与 t14。`lab-sources` 排除这份 Splitter，避免 Lab 里同名两个。

### `packages/neuro-book/`

- 用脚本改 import（先 dry run）：`@notnotype/nb-ui/layout`、`/grid`、`/components`、`/composables` 里属于布局的名字，分别改到 `@notnotype/nb-layout` 或 `/vue`。`src/sdk/components.ts` 手改，SDK 导出的名字不变。
- Lab：`component-index.ts` 加 `nb-layout` 来源；`fixtures/nb-ui/layout.ts` 里 `DropFeedbackOverlay`、`DropIndicatorLabel`、`Splitter`、`NestedGrid` 的登记移到 `fixtures/nb-layout/`。
- e2e：`nested-grid.spec.ts` 与验收页并进 Lab（`lab-nested-grid.e2e.ts`），断言不变。

### 登记

根 `package.json` 的 workspaces、`bun.lock`；`scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS`；`scripts/ci/component-inject-tags.ts`；`plugin-sdk/pack.ts`（SDK 依赖它）；`docs/modules/monorepo-boundaries.md`、`packages/AGENTS.md`、根 `AGENTS.md` 的地图。`scripts/release/packages.ts` 与 `pack-smoke.ts` 等 t14。

## Spec 与文档改动

合入时在 master 上改：`ui/nested-grid.md`、`ui/workbench-shell.md` 里的路径与入口名；`packages/nb-ui/docs/`。行为不变，不改条目。

## 切片

1. 新包骨架与搬文件（核心、Vue 层、文字、样式），新包自己的测试与类型检查通过。
2. neuro-book 改 import、Lab 来源与场景、SDK；nb-ui 删除与冻结；登记。
3. nested-grid 的 e2e 并进 Lab。

## 验收映射

行为不变：现有测试原样通过就是验收。`ui.nested-grid` 的验收由 `nb-layout` 的测试与 `lab-nested-grid.e2e.ts` 覆盖；工作台与编辑器的由 `workbench-shell`、`workbench-dnd`、`workbench-views`、`editor-area`、`files-explorer` 五组 e2e 覆盖。

## 验证

- `nb-layout`、`nb-ui`、`neuro-book`、`nb-story`、`dev-panel` 的 typecheck 与单元测试。
- `bun run governance:check`、`docs:check`。
- 上面的 e2e，跑前停掉多余服务。
- Lab 打开 `DropFeedbackOverlay`、`Splitter`、`NestedGrid` 的场景，核对外观与搬之前一致。

## 不做与风险

- 不做行为改动、`branchId` 清理、手势抽取（t05、t06）。
- 风险：原子类换 scoped 后外观有细微差别。靠 `lab-layout-baseline` 与 e2e 的几何断言，再人工看 Lab。
- 风险：冻结期间同样的代码有两份。只修不加，t14 删。
