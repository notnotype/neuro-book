# t14 nb-story、开发者面板的分栏改用 nb-layout：实施计划（第 2 稿）

第 2 稿按设计审查（Claude Sonnet，7 条，[`evidences/design-review.txt`](evidences/design-review.txt)）修订，逐条处理见 Task README。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档第 7 项（开发者 2026-11-18 对 t31“都按推荐”）；2026-11-19 的推进顺序把它排在第一档最后。
- 目标：nb-story 与开发者面板不再用 nb-ui 里 t04 冻结的那一份 `Splitter`，改用 nb-layout 的；然后删掉 nb-ui 的那一份。
- 开工前核实（Task README“当前状态”）：
  - 不用发布 nb-layout、不用新 ADR：nb-story 只给网页用的包都在 devDependencies，发布清单检查允许 devDependencies 引用不发布的工作区包；发出去的 nb-story 只带打包好的 `dist/web`，源码里没有别处导入 nb-layout（审查核过）。
  - 文字与样式不用补接：两个宿主都没给 nb-ui 注入文字，nb-layout 没有注入时用自带的同一份中文；nb-layout 的组件样式自带，`--nb-layout-*` 由 nb-ui 的 `tokens.css` 接上。
  - 两份 `Splitter` 的逐项差异：[`evidences/drift.txt`](evidences/drift.txt)。三处使用方的模板与逻辑不用改；看得见的只有一侧收到 0 时不画静止接缝。
- **删除放回本 Task**（审查第 5 条改了判断）：
  - 旧应用的 Lab 夹具还导入 nb-ui 的 `Splitter`，但旧应用对 nb-ui 早有 39 个文件导入已经不存在的 `@notnotype/nb-ui/layout`，本来就编不过。
  - 删 nb-ui 里的文件不改旧应用的任何文件，不违反“旧应用只读”。
  - 夹具那一处随之失效，与那 39 处同类。记进待确认清单。
- 工作方式：前两片（迁移）主会话写；第 3 片（删除，照清单的机械活）派一个编码子代理（Claude Sonnet），Task 记录里开发者同意过；主会话审 diff、自己跑验证。

## 技术选型

无。

## 关键设计

### 开发者面板：`packages/dev-panel/`

- `package.json` 的 `dependencies` 加 `"@notnotype/nb-layout": "workspace:*"`，`bun install` 更新 `bun.lock`。
- `src/web/App.vue`、`src/web/pages/ArtifactPage.vue`：
  - 导入拆开：`Splitter` 与 `SplitterPanelConfig` 从 `@notnotype/nb-layout/vue`，`SplitterGestureState` 从 `@notnotype/nb-layout`；
  - 注释里的“nb-ui 的 Splitter”改掉；模板与手势处理不改。
- **重建与“代码已更新”的判据**（审查第 1 条）：
  - `src/server/build.ts` 的 `computeBuildHash` 输入加 `packages/nb-layout`（整棵走，跳过 `node_modules`），改它头上的注释；
  - `src/server/state.ts` 的 `CODE_PATHS` 加 `packages/nb-layout`；
  - `tests/panel-server.test.ts` 补断言：改 nb-layout 里的一个文件，构建哈希与代码键都变。
- `docs/panel.md`：第 381 行的构建输入清单、第 396 行（产物页）与第 406 行（外壳左栏）的“nb-ui `Splitter`”、“代码已更新”一节比较的路径。

### nb-story：`packages/nb-story/`

- `package.json` 的 `devDependencies` 加 `"@notnotype/nb-layout": "workspace:*"`：nb-layout 不发布，写法同测试支持包；以后 nb-layout 发布时发布检查会要求改成 `workspace:^`。
- `src/web/shell/BookFrame.vue`：导入换到 `@notnotype/nb-layout/vue`；第 111 行注释里的变量名写成 `--nb-layout-motion-move`。`motionMs()` 仍读 `--motion-move`：经 nb-ui 的桥接是同一个值。

### 删掉 nb-ui 冻结的那一份：`packages/nb-ui/`

清单（审查第 6 条补全；子代理先 `grep` 核对没有漏，再删）：

- 组件与核心：`src/components/layout/` 下 `Splitter.vue`、`Splitter.md`、`splitter-*.ts`、`grid-splitter.ts`、`grid-geometry.ts`（含测试）、`grid-types.ts`、`sash-*.ts`、`splitter.test.ts`；`src/composables/useSashGesture.ts`。删之前确认 `layout/` 里没有别的组件还用它们。
- 导出：`src/components/index.ts` 里 `Splitter` 与 `SplitterGesture*` 等类型。
- 测试与夹具：`e2e/splitter.spec.ts`；`playground/app/acceptance/SplitterFixture.vue` 与 `definitions.ts` 的那一项；`default-text.test.ts`、`locales.test.ts`、`token-consumption.test.ts`、`components.test.ts` 里与分隔线有关的用例；`src/lab/sources.ts` 里排除 Splitter 的那一条。
- 文案：`src/locales/` 里的 `splitter.*` 键。
- 样式：`tokens.css` 里只给冻结那一份用的 `--nb-splitter-seam*`；**保留** `--sash-line-*`、`--divider` 与给 `--nb-layout-*` 的桥接（nb-layout 靠它们拿主题值）。
- 文档：`README.md` 的那一行；`docs/` 下加一段迁移说明（`Splitter` 与它的类型移到 nb-layout，导入怎么改），写进现有的 `docs/migration-0.4.md` 或新开下一版的，按 nb-ui 文档的惯例。
- nb-ui 是已发布的包（0.4.0）：拿掉公开导出是破坏性变化，下次发布要升小版本。版本号不在本 Task 改（发布由开发者做），记进待确认清单。

### 文档

- `packages/nb-layout/src/vue/Splitter.md`：删掉已经不存在的 `sashLineEnds`。
- `packages/nb-layout/AGENTS.md:21`、`docs/modules/monorepo-boundaries.md:18`：去掉“nb-story、dev-panel 还在用 nb-ui 冻结的 Splitter”的说法。
- Task README 的“目标与范围”已在第 1 稿时改过。

## Spec 与文档改动

- Spec：没有 Spec 写两个宿主用哪个包的分栏，行为合同不变。
- 待确认清单（第 1 稿的两行按第 2 稿改，另加两行）：
  - 删除：照做，旧应用夹具那一处导入随之失效（与已失效的 39 处同类）；
  - 接缝：补上“收起态没有看过图（开发者面板起不了第二份实例）”“接缝按目标尺寸判断，动画第一帧就消失或出现”，改回的办法写成“nb-layout 加一个主题变量”；
  - nb-ui 拿掉公开导出，下次发布升小版本；
  - 发布门禁（`releaseDirectories()`）不盯 nb-layout 的目录，应用包早就如此，nb-story 现在也是：第二档发布 nb-layout 时一并处理（审查第 7 条）。

## 切片

1. **开发者面板**：依赖、两处导入与注释、构建哈希与代码键、测试、`panel.md`。
2. **nb-story**：依赖、`BookFrame.vue`。
3. **删 nb-ui 的那一份**（编码子代理）：上面的清单与迁移说明。
4. **文档**：nb-layout 的 `Splitter.md`、`AGENTS.md`，`monorepo-boundaries.md`。

## 验证

- **基线**（起点上，已在跑）：开发者面板的类型检查、全部测试、网页构建与产物大小；nb-story 的类型检查、单元测试、全部 e2e、网页产物大小；`release:check`。打包安装冒烟只在改完后跑（它要从 registry 装依赖、起服务，很重）：挂了再回起点对照。
- **nb-story 的真操作探针**（审查第 2 条；一次性 Playwright 文件，不提交，改前改后各跑一遍对照）：
  - 宽屏抽屉开着与关上、导航收起，平板与手机各截一张（亮色），存每条分隔线的读屏属性与每块面板宽度；
  - 鼠标把抽屉分隔线拖窄一点、拖到 0（抽屉关上）、再从 0 拖开（抽屉重开），读偏好里记下的抽屉宽度；
  - 导航分隔线按 Home、End、Enter，读 `aria-label`、`aria-valuenow`、`aria-valuetext`；
  - 系统减少动效时收起抽屉，面板宽度不过渡。
  - 判据：除了收到 0 的一侧没有接缝，两次的截图、属性与宽度一致。
- 每片的命令：
  - 第 1 片：开发者面板的类型检查与全部测试（单独跑：真实 herdr 的用例和别的 worktree 并行会撞），含 `web-build.test.ts` 的构建；
  - 第 2 片：nb-story 的类型检查、单元测试、全部 e2e、探针、`release:check`、`release:smoke`；
  - 第 3 片：nb-ui 的类型检查与单元测试；应用、nb-story、开发者面板、nb-agent-ui、nb-form、nb-markdown 的类型检查（它们都依赖 nb-ui）；
  - 收口：上面三个包各跑一遍；应用里用到 nb-ui 的 Lab 场景不跑（应用的分栏早已用 nb-layout）。
- **留下的未验证边界**：开发者面板在浏览器里的样子与手感（起不了第二份实例；只有构建、类型检查与比对）。合入后要开发者重启面板服务才生效。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 开发者面板的分栏照旧 | 类型检查、`web-build.test.ts` 的构建；组件行为由 nb-layout 自己的测试（`src/vue/splitter.dom.test.ts`、`grid-splitter.dom.test.ts`、`useSashGesture.dom.test.ts`）与比对守着 |
| 开发者面板改了 nb-layout 会重建、会提示代码已更新 | `tests/panel-server.test.ts` 的新断言 |
| nb-story 的分栏照旧：拖、收起与重开、键盘、读屏、减少动效 | 真操作探针改前改后对照，`e2e/viewer.e2e.ts` 与其余 4 个 e2e 文件 |
| 发布：nb-layout 不在发布清单里，nb-story 照样打包、安装、能用 | `release:check`、`release:smoke` |
| nb-ui 删干净、依赖它的包都照常编译 | 第 3 片的类型检查与单元测试；`grep` 没有残留 |

## 不做与风险

- 不发布任何包，不改 nb-ui 的版本号。
- 不修发布门禁的盲区（审查第 7 条，记进待确认清单）。
- 风险：`@notnotype/nb-layout/vue` 入口带进整套 Vue 层与 `global.css`，nb-layout 没有声明 `sideEffects`，体积没量过。第 1、2 片记下构建产物的大小（改前改后），差得多时在汇报里写明。
