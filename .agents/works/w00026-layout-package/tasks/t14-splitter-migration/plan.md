# t14 nb-story、开发者面板的分栏改用 nb-layout：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 7 项（开发者 2026-11-18 对 t31“都按推荐”）；2026-11-19 的推进顺序把它排在第一档最后。
- 目标：nb-story 与开发者面板不再用 nb-ui 里 t04 冻结的那一份 `Splitter`，改用 nb-layout 的；之后删掉 nb-ui 的那一份。
- 开工前核实的三件（Task README“当前状态”）：
  - 不用发布 nb-layout、不用新 ADR：nb-story 只给网页用的包都在 devDependencies，发布清单检查允许 devDependencies 引用不发布的工作区包；
  - 删 nb-ui 的那一份被旧应用挡住：旧应用的 Lab 夹具 `WorkbenchPanelSurfaceFixture.vue` 还在导入它，旧应用只读；
  - 文字与样式不用补接：两个宿主都没给 nb-ui 注入文字，nb-layout 没有注入时用自带的同一份中文；nb-layout 的组件样式自带，`--nb-layout-*` 由 nb-ui 的 `tokens.css` 接上。
- 两份 `Splitter` 的逐项差异：[`evidences/drift.txt`](evidences/drift.txt)（Claude Sonnet 只读调研，读源码加一次求解器实测）。结论：
  - 三处使用方的模板与逻辑不用改，只改导入、依赖声明与注释；
  - 看得见的变化只有一处：一侧收到 0 时，静止接缝不再画（nb-layout 的 `data-beside-zero`）。
- 工作方式：按包分两片，每片单独提交、单独验证。

## 技术选型

无。

## 关键设计

### 开发者面板：`packages/dev-panel/`

- `package.json` 的 `dependencies` 加 `"@notnotype/nb-layout": "workspace:*"`（开发者面板不发布，写法同它对 nb-ui 的依赖），`bun install` 更新 `bun.lock`。
- `src/web/App.vue`、`src/web/pages/ArtifactPage.vue`：
  - 导入拆开：`Splitter` 与 `SplitterPanelConfig` 从 `@notnotype/nb-layout/vue`，`SplitterGestureState` 从 `@notnotype/nb-layout`；其余组件照旧从 nb-ui。
  - 注释里“nb-ui 的 Splitter”改成 nb-layout。
  - 模板与手势处理不改：props、事件、载荷两边相同（比对第 1、2 节）。
- `docs/panel.md` 产物页一行的“nb-ui `Splitter`”改成 nb-layout。

### nb-story：`packages/nb-story/`

- `package.json` 的 `devDependencies` 加 `"@notnotype/nb-layout": "workspace:*"`：网页打包时构建进 `dist/web`，发布出去不装它；nb-layout 不发布，写法同测试支持包。
- `src/web/shell/BookFrame.vue`：导入换到 `@notnotype/nb-layout/vue`；第 111 行注释里的变量名写成 `--nb-layout-motion-move`。`motionMs()` 仍读 `--motion-move`：两者经 nb-ui 的桥接是同一个值，`layoutMotionMs` 读的是另一个变量（470ms），不用它。

### nb-layout 的文档：`packages/nb-layout/src/vue/Splitter.md`

还写着已经删掉的 `sashLineEnds` 属性（比对第 1 节）：删掉这一条。

### 删掉 nb-ui 的那一份：不做，交开发者定

- 挡着的是旧应用的 `app/component-lab/fixtures/WorkbenchPanelSurfaceFixture.vue`；旧应用只读。
- 两条路，交开发者选：
  - 准许改旧应用那一处导入（旧应用没有 nb-layout 依赖，要连 `package.json` 一起改），然后删 nb-ui 的组件、分隔线核心、导出、Lab 源、测试与文档；
  - 等旧应用退役再删。
- 记进待确认清单；本 Task 只做迁移，nb-ui 的入口这次不动。

## Spec 与文档改动

- Spec：没有 Spec 写到两个宿主用哪个包的分栏，行为合同不变。看得见的那一处（接缝）记进待确认清单。
- Task README 的“目标与范围”：去掉“发布依赖从 8 个变 9 个、要新 ADR”，写明核实结果。
- `docs/modules/monorepo-boundaries.md`：本 Task 不删 nb-ui 的那一份，不改。

## 切片

1. **开发者面板**：依赖、两处导入与注释、`panel.md`。验证：开发者面板的类型检查与全部测试（单独跑，不和别的 worktree 并行：真实 herdr 的用例会撞），其中 `web-build.test.ts` 真跑 `vite build`。
2. **nb-story**：依赖、`BookFrame.vue`。验证：nb-story 的类型检查、单元测试、e2e（全部 5 个文件，页面都在 `BookFrame` 里）、`release:check`、`release:smoke`（打包安装冒烟）。
3. **nb-layout 文档**：`Splitter.md` 删掉 `sashLineEnds`。

基线（改之前，在 worktree 的起点上）：第 1、2 片列的每条验证各跑一遍；外加 nb-story 的截图（下文“验证”）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 开发者面板的分栏照旧：拖宽、收起、窄屏收成 0 | 类型检查、`web-build.test.ts` 的构建；行为由比对的逐项对照与 nb-layout 自己的测试守着（`src/vue/splitter.dom.test.ts`、`grid-splitter.dom.test.ts`、`useSashGesture.dom.test.ts`） |
| nb-story 的各档与抽屉照旧 | `nb-story/e2e/viewer.e2e.ts`（含“收起抽屉后重画”）与其余 4 个 e2e 文件 |
| 发布不受影响 | `release:check`、`release:smoke` 通过，nb-layout 不在发布清单里 |

## 验证

- 基线与改后各跑一遍上表的命令，对照结果。
- nb-story 截图：写一个一次性的 Playwright 探针（放 `.local/`，不提交），借 nb-story e2e 的夹具起服务，按亮色截宽屏、窄屏、抽屉开与关、导航收起几张，改前改后各一组，逐张对比；只允许“收到 0 的一侧没有接缝”这一处不同。
- 开发者面板不截图：它的网页由开发者的面板服务提供，不重启（汇报里写明合入后要开发者重启面板服务才生效）。外观变化只有接缝一处，由比对第 3 节写明。
- 留下的未验证边界：开发者面板在浏览器里的渲染与手感（只有构建与类型检查）。

## 不做与风险

- 不发布任何包，不动 nb-ui 的入口（删除交开发者定）。
- 风险：`@notnotype/nb-layout/vue` 的入口会把整套 Vue 层与它的全局样式带进两个宿主的构建，体积没量过。第 1、2 片各记下构建产物的大小（改前改后），差得多时在汇报里写明。
