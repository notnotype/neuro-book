# nb-layout 包入口

本包位于 `packages/nb-layout`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-layout` 是布局工具：布局树、尺寸求解、落点与拖动。决策见 [ADR 0044](../../docs/adr/0044-workbench-single-layout-tree.md) 与 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)（做成不认识工作台的通用库，发布之前 `private`），行为合同是 [`ui.nested-grid`](../../docs/specs/ui/nested-grid.md) 与 [`ui.layout-drag`](../../docs/specs/ui/layout-drag.md)。

## 边界

- 导出名与数据属性里不出现工作台概念（活动栏、状态栏、区域、容器、编辑组、具名面板）；有这些概念的放 [`nb-workbench-layout`](../nb-workbench-layout/AGENTS.md)，它只经本包的公开入口用本包，本包不依赖它。`src/exports.test.ts` 按禁用词扫导出名与 `data-*`，成员名不扫。
- 公开面就是 `package.json` 里四个子路径（`.`、`./vue`、`./text`、`./locales`）的入口：一行一个名字的显式清单，不用 `export *`；文件里别的导出是内部的，库内用相对路径导入。加导出就是改入口清单（评审时看得见），文档里教人导入的名字要在入口里（同一个测试核对）。`./lab-sources` 只给应用的 Component Lab，不算公开面。

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）不依赖任何包，不依赖 Vue 与 DOM：插件激活时就要建模型，Bun 里也要能测。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`tabbable` 与核心，不依赖 nb-ui（ADR 0054 第 3 条）。文字经 `./text` 的注入点（`src/vue/text.ts`）取。
- 样式写在组件的 scoped CSS 里，不用原子类：宿主的 Tailwind 不扫描本包，用了宿主也不会生成。只读 `--nb-layout-*`，每处带回退；名字、类别与回退登记在 `src/theme-vars.ts`，`theme-vars.test.ts` 扫源码核对，新变量先登记再用。装了 nb-ui 的宿主由它的 `tokens.css` 桥接主题旧名，桥接要跟着清单改（应用的 `theme-bridge.test.ts` 核对）。
- 例外：`src/vue/global.css` 是全局样式，只放必须作用在根上或跨组件的两样（减少动效时归零时长、焦点环类），由 `vue/index.ts` 导入；别的样式不往里放。根上平时不声明变量：不分层的声明会压过 nb-ui 放在 `layer(base)` 里的桥接。
- nb-ui 不依赖本包，也不重导出本包。
- 入口导出的组件是受管组件，同名 `.md` 必有（`docs:check`）；内部组件写模块头注释。入口加了或删了组件，插件 SDK 的组件清单要跟着改，做法同 nb-ui（[`packages/nb-ui/AGENTS.md`](../nb-ui/AGENTS.md)）。

## 许可与发布

- 本包是 MIT（ADR 0054 第 5 条），仓库其余是 AGPL-3.0-only。MIT 的包不从 AGPL 的代码搬内容：要从 AGPL 的包（nb-ui 等）复制进来的，逐文件复核来历（同一作者写的也写明），复核记在 Task 里。反方向（AGPL 的代码用本包）不受限。
- 发到 npm 的是编译产物：`bun run build:package`（`scripts/pack.ts`）写 `dist/package/`，构建完自查导出名、纯 TS 入口不拉进 Vue、随包文件与 JS 和 CSS 里没有 Spec 编号；`--web` 另写 `dist/web-build/` 给 nb-story 的网页构建读。仓库里的使用方（新应用、工作台、Lab、开发者面板）照旧走源码。改入口、加依赖、加样式文件之后跑一次。
- 示例应用在 `examples/`：MIT（每个目录带一份 `LICENSE`）、不随包发布，只经四个公开入口与 `style.css` 用本包，不搬 AGPL 的代码；`src/examples.test.ts` 核对导入、依赖与许可证，模型层的测试在 `src/examples-<示例>.test.ts`，界面在 `e2e/<示例>.e2e.ts`（`bun run test:e2e`）。示例不是工作区成员，依赖从根 `node_modules` 解析；不在示例目录里装依赖。注释是教学材料（见 `docs/standards/code/common.md` 注释一节的例外）。
- 首发开关是 `package.json` 的 `private`：还在时发布冒烟只验、不发；删它是开发者的发布决定（发布手册的“新包首发”）。

## 稳定性标注与 API 报告

- 每个公开名字带恰好一个 `@experimental` 或 `@stable`（0.x 期间全部 `@experimental`，开发者 2026-11-23 定），写在这个声明自己的 JSDoc 里：紧贴声明、中间没有空行的那一块（文件头注释不算）；函数的每个重载签名都标，实现签名与类型成员不标；不在一个语句里声明几个公开名字。组件写在 `src/vue/index.ts` 那一行的行尾（`// @experimental`），打包时插进声明（`scripts/component-tags.ts`；插件 SDK 的打包读同一行）。
- `@stable` 由本包定，条件写在 README 的“版本承诺”；插件 SDK 转出一个名字不改变它在这里的标注。
- 改了 `src` 之后跑 `bun run api:check`：先构建，再与入库的 `api/*.api.txt` 比；公开面变了确认后 `bun run api:report` 更新报告，与改动同一个提交。`@stable` 名字（新旧任一侧）变了，`CHANGELOG.md` 的 `[Unreleased]` 要有一条写出这个名字。报告的读法见 `scripts/api-report.ts` 的模块头。
- 插件 SDK 转出的名字（及它们引到的名字）变了，应用的 `src/sdk/sdk.test.ts` 的快照会失败：判断是不是不兼容，不兼容就提 `PLUGIN_API_SINCE`，再照提示重写快照。

## 谁还用这里的 Splitter

nb-story 与开发者面板的分栏也用这里的 Splitter（w00026 t14 从 nb-ui 冻结的那一份迁来，那一份已删）。它们没有拖分隔线的 e2e：改 Splitter 的外观、手势或事件载荷时，在 nb-story 里走一遍拖、收起与重开、键盘（t14 的探针做法见它的 `evidences/probe.txt`）。

## 验证

```text
bun run typecheck   # 核心 tsc，Vue 层 vue-tsc
bun run test        # 核心 bun test，Vue 层 Vitest（*.dom.test.ts，happy-dom）
bun run build:package   # 编译产物与自查（约 5 秒）
bun run api:check       # 先构建，再与 api/*.api.txt 比
```

真实浏览器里的指针、布局与可访问名称在应用 Component Lab 的场景与它的 Playwright 用例里。
