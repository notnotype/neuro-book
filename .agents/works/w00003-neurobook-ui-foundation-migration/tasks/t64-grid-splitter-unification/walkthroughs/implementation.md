# t64 实施记录：Grid 与 Splitter 共用整改

日期：2026-09-19。worktree `.worktree/w00003-neurobook-ui-foundation-migration`（branch `refactor/w00003-nb-ui-adoption`）。计划：`local://grid-splitter-unification-plan.md`（开发者批准）。本轮不改 3001、不迁数据、不写远端。

## 1. 改动与理由

### nb-ui：布局原语补齐

| 文件 | 改动 |
|---|---|
| `src/components/layout/grid-types.ts` | 新增 `GridSplitSide` / `GridSplitInput<T>`；拆分只开放 `ratio`，不开放 `size`。 |
| `src/components/layout/grid.ts` | 新增 `splitLeaf`（新分支继承目标的外部分配意图，两子叶按 `ratio` 分目标在新轴上的意图；新轴意图为 0 时取统一正权重）、只读 `find`、结构操作与快照共用的规模守卫（256 节点 / 16 层）。 |
| `src/components/layout/grid-splitter.ts`（新） | `gridBranchSizes` / `buildGridBranchPanels` / `gridBranchGesture`：原 `workbench-branch-layout.ts` 的提升，两个宿主共用。 |
| `src/components/layout/GridRenderer.vue`（新） | 递归渲染：每个分支一个 `Splitter`、叶走 `leaf` 插槽；尺寸经受控 `sizes` 同步，`data-branch` / `data-leaf` 是宿主样式锚点。 |
| `src/components/layout/Splitter.vue` | 新增受控 `sizes`（程序发布：等值忽略、发布前取消失效手势、只发 `layout`）；sash 抬到相邻面板之上（命中区不被后一个面板盖住）。 |
| `src/components/layout/index.ts`（新） | 窄入口 `@notnotype/nb-ui/layout`：只含 grid/Splitter/渲染器与投影，给不做几何的消费者用。 |
| `src/components/index.ts`、`README.md`、`docs/ui-development-spec.md` | 导出与文档同步。 |
| `playground/.../NestedGridFixture.vue`、`e2e/nested-grid.spec.ts` | 夹具改用 `GridRenderer` + 公共换算（删掉自写的面板投影与两层 `Splitter`），e2e 的外层 sash 选择器改为 `[data-branch=root] > * > [role="separator"]`。 |

### neuro-book：两个宿主切换

- 主工作台：`WorkbenchShell.vue` / `WorkbenchSpike.vue` 改用 `GridRenderer`（事件带分支 id）；`layout-session.ts` / `storage-grid-host.ts` 改用公共换算；**尺寸变化不再重挂 Splitter**（删掉 `epoch` 递增），结构变化仍靠 children 集合变化重挂。
- 编辑器：`EditorWorkbench.vue` 重写为受控 `groups + tree + layout + activeGroupId`（事件全部带组 id，单组 = 一个叶）；`EditorGroup.vue` 改吃 `EditorGroupState`；`EditorToolbar` 的 `showSplit` 更名 `allowSplit`；`editor-view.types.ts` 收纳 `EditorGroupState`。
- 新增 `app/utils/editor-workbench/editor-groups.ts`：方向词 → 几何映射、`createEditorGrid` / `splitEditorGroup` / `removeEditorGroup` / `editorGroupIds` / `applyEditorBranchGesture`，页面与 Lab 夹具共用。
- 删除：`WorkbenchBranch.vue`、`workbench-branch-layout.ts`（含测试）、`EditorLayoutRenderer.vue`、`editor-layout.ts`（含测试）。全仓无残留引用（grep 验证）。
- 主页：组合函数持有单叶树与呈现，页面把显示态折成一个编辑组交给外壳。

## 2. 关键判定与实测

- **拆分不能混用 px 与意图**：目标在新轴意图为 0 时，按测得的 px 分配会把目标压成 0（内存探针复现），实现改为统一正权重，`grid.test.ts` 新增「目标在新轴没有分配时两端取同一权重均分」等 6 条用例。
- **Reka 的 `defaultSize` 不是受控值**：源码确认面板只在约束变化时重评估，因此新增 `sizes` 通道；`splitter.test.ts` 新增 5 条（挂载后发布、等值不重放、手势中发布先取消、越界以夹取事实为准、发布不重挂叶内容）。
- **意图守恒**：真实浏览器里 `resizeBranch` 的守恒在两次拖拽中逐像素验证（见 §4）。
- **窄入口的必要性**：引入公共层后 `useEditorWorkbench.test.ts` 单测从「通过」变成 5s 超时——根因是 `editor-groups.ts` 经组件桶拉入全部组件；改走 `@notnotype/nb-ui/layout` 后 42 文件 / 376 用例全绿。这是本轮唯一一次「测试先红后绿」的改动，红因已定位到模块图而非逻辑。

## 3. 验证命令与结果

| 命令（cwd） | 结果 |
|---|---|
| `bun run test src/components/layout`（packages/nb-ui） | 5 文件 / 103 用例通过 |
| `bun run test`（packages/nb-ui，全量） | 21 文件 / 377 用例通过 |
| `bun run typecheck`（packages/nb-ui） | exit 0，`error TS` 0 条 |
| `NB_UI_E2E_REUSE_SERVER=1 NB_UI_E2E_PORT=3100 bun run test:e2e e2e/splitter.spec.ts e2e/nested-grid.spec.ts` | **30 passed (52.6s)**，exit 0 |
| `bun run test app/utils/editor-workbench app/components/editor-workbench app/components/workbench app/utils/workbench app/component-lab app/composables/useEditorWorkbench.test.ts`（packages/neuro-book） | 42 文件 / 376 用例通过 |
| `bun run typecheck`（packages/neuro-book） | exit 0，`error TS` 0 条 |
| `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:44777 --browser-executable <chrome> --suite core`（packages/neuro-book） | exit 0：`Component Lab smoke passed` |

## 4. 真实浏览器证据（隔离环境）

隔离服务：`bun run dev`（`NUXT_PORT=44777`）＋ 独立 State/Cache 根 `%LOCALAPPDATA%/Temp/neuro-book/acceptance/w00003-grid-splitter/{state,cache}`（空根，先跑 `migrate:deploy` 与 `migrate:application-state -- --apply`，仅写该临时根）。3001 与开发者真实根未参与、未写入。

编辑器 Lab（`/lab` → EditorWorkbench）：

| 动作 | 观测 |
|---|---|
| 初始 | 1 组，宽 958；标签与正文正常；控制台无错误 |
| 分屏一次 | 2 组 479 / 479（面板空间 957 守恒），组高一致 |
| 指针拖拽 −120px | 359 / 598（−120 / +119，1px sash）；右侧组的正文节点身份保持（未重挂） |
| 键盘 ArrowLeft（sash 聚焦） | 263 / 694；一次手势一次提交 |
| 再分屏两次 | 3 组：左列 390×536 + 右列上下各 694×268；4 组：2×2，列宽 263 / 694，行高 268 / 268 |
| 拖左列内层 sash | 左列 208 / 327，右列仍 268 / 268、列宽不变（内层不影响外层） |
| 拓扑变更后 | 四个组各自的标签与正文仍在（`architecture.md` 等），控制台无错误 |
| 手机画布与真实 390×844 | 被测体 386×818 / 386，页面无横向滚动，4 组内部滚动为 0 |
| 本次改动的最终复核 | 分屏 2 组、拖拽 −70px → 123 / 262（1px 取整差），无控制台错误 |

主页（`/?project=workspace%2F.nbook`，用户资产工作面）：

| 动作 | 观测 |
|---|---|
| 加载 | 外壳与 `EditorWorkbench` 同屏（叶：titlebar / activity / left / editor / main / right），无诊断、无控制台错误 |
| 拖左栏分界线 +90px | 左栏 340 → 430，编辑器 639 → 548（守恒） |
| 视口 1440 → 1100 | 编辑器 DOM 节点保持（未重挂），左栏稳定在 341，编辑器吸收余量，页面无横向滚动 |

## 5. 未运行与偏差

1. **e2e 自带 webServer 起不来**：`bun run test:e2e`（不设 `NB_UI_E2E_REUSE_SERVER`）在本 worktree 会因 playground dev server 报 `Failed to resolve import "#app-manifest"`（Vite/Nuxt 解析问题）让全部用例失败；手工启动同一命令 `node ../../node_modules/nuxt/bin/nuxt.mjs dev playground --port 3100` 后服务正常、30 条用例全绿。该环境问题未修复，也未改动 e2e 配置。
2. **主题矩阵**：只覆盖默认主题与一次主题下拉开关；未做四主题 × 浅深色全矩阵（几何与主题无关，且本轮未改主题相关代码）。
3. **产品多组**：编辑器仍只在 Lab 与主页单组路径消费公共层；组会话、多组页面接线与编辑器布局恢复属后续切片（README「排除」）。
4. **并行工作**：本轮期间另一路改动同一 worktree（`LabShell.vue` 等，10:09 时间戳）；一次应用 typecheck 曾出现其 `CommandInvocation` 未导入错误，随后自行消失。本轮未触碰该文件，最终 typecheck 为 exit 0 / 0 error。
5. 一次误操作已自清理：隔离根最初用 MSYS 风格路径（`/c/...`）导致迁移把库写到 `C:\c\Users\...`（未触碰开发者真实根），已删除该目录并用 `C:/...` 重做。
