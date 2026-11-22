# t46 计划：nb-layout 默认英文文案

## Context

- **为什么做**：ADR 0054 第 7 条第二档第 5 项与提案 [nb-layout 做成通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 的“去掉 nb-ui 依赖”一节：第二档“默认英文，源语言从 `zh-CN` 变成 `en-US`，`message-catalogs` 的检查与 `docs/specs/ui/i18n.md` 的 `state:inject` 声明要跟着改”。发到 npm 之后，没有注入文字的第三方宿主不该看到中文读屏名称。
- **依据**：`docs/specs/ui/i18n.md` 输出 8（缺省端口与 nb-layout 的例外）、`docs/specs/ui/nested-grid.md` 输出 143（组件取文字）。
- **影响到的宿主**：
  - 应用（neuro-book）每个根经 `host-text.ts` 注入、按端口的当前语言取，不受影响；只有登记目录时写死的源语言 `"zh-CN"`（`text-engine.ts:166`）要改成读常量。
  - nb-story 与开发者面板今天都不注入（t14 实现审查第 2 条），缺省一改就会静默变成英文：同一 Task 里给它们注入中文。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t46-english-text`（分支 `w00026/t46-english-text`）。

## 技术选型

无。

## 关键设计

### `packages/nb-layout/src/locales/index.ts`

- `NB_LAYOUT_SOURCE_LOCALE` 改成 `"en-US"`；`NB_LAYOUT_CATALOGS` 仍含 `zh-CN` 与 `en-US` 两份（提案写“中文目录不必成为库的公开子路径”，不是必须拿掉；nb-story 与开发者面板要用它，留在库里比搬进不发布的 nb-workbench-layout 少一个依赖）。
- 新增 `layoutCatalogTranslate(locale)`：按自带目录里某一种语言翻译，返回 `LayoutTranslate`。给只有一种语言、没有翻译引擎的宿主用（nb-story、开发者面板，以及第三方的常见情形）：`app.provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"))`。`locale` 不是目录里的语言时按源语言。缺的参数保留占位。
  - 放在 `./locales`：它只依赖目录与 `./text` 的类型，不依赖 Vue 运行时；根入口与 `./vue` 不变。
  - `src/vue/layout-text.ts` 的 `sourceTranslate` 改用它（`layoutCatalogTranslate(NB_LAYOUT_SOURCE_LOCALE)`），取文字的实现只有一份。
- 导出名清单：`exports.test.ts` 的 `./locales` 一项多一个名字；README 的“我要做 X 用哪个导出”加一行。

### 宿主

- `packages/neuro-book/src/web/host/text-engine.ts`：登记 nb-layout 时源语言改用 `NB_LAYOUT_SOURCE_LOCALE`。回退链变成“当前语言 → en-US → 键名”，中文窗口里 zh-CN 目录本来就全，显示不变。
- `packages/nb-story/src/web/main.ts`、`packages/dev-panel/src/web/main.ts`：`createApp(App).provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"))`，各加注释写明这两个应用只有中文界面。

### 测试

- nb-layout：现有断言缺省中文的 dom 测试（`splitter.dom.test.ts` 的 `aria-valuetext` “2 像素”“已收起”，`SortableList.dom.test.ts` 的“拖到这里”与“没有注入时用源语言目录”那条）改成英文；另加一条：注入 `layoutCatalogTranslate("zh-CN")` 时是中文。
- `layoutCatalogTranslate` 的单测（Bun）：两种语言、未知语言按源语言、参数代入、缺参数保留占位。
- 目录一致性：先查现在哪里核对 nb-layout 两份目录的键与占位符（`LayoutTextKey` 与目录的对应、应用的 `text-engine` 测试）；改源语言后照它的规则以 en-US 为准。没有核对的，在 `src/locales/` 补一个不依赖 nb-ui 的测试：两份目录的键相同、每个键的占位符集合相同。
- nb-story、开发者面板：一条测试守着“根上注入了中文”：开发者面板有 `tests/web-build.test.ts` 真构建，nb-story 有 `viewer.e2e.ts`；在 nb-story 的 e2e 里断言抽屉分隔线的读屏名称是中文（“调整 … 的宽度”），开发者面板在它现有的组件或构建测试里找最近的位置，没有就记为未验证边界。

## Spec 与文档改动

- `docs/specs/ui/i18n.md` 输出 8：nb-layout 没有注入时用自带的 `en-US` 目录（源语言 `en-US`）；补一句只有一种语言的宿主用 `layoutCatalogTranslate` 注入。“已知限制”那句（放进别的共享包的子树、上面又没有宿主时）改成 `en-US`。
- `docs/specs/ui/nested-grid.md` 输出 143 若写了缺省语言，跟着改。
- nb-layout：`README.md` 两处（入口注释“自带的 zh-CN、en-US”、“文字”一节的“没有注入时用自带的 zh-CN 目录”）、`src/vue/Splitter.md` 的“文字”一句、`src/locales/index.ts` 与 `layout-text.ts`、`text.ts` 的模块头注释。
- `CHANGELOG`：nb-layout 还没有变更记录（第一次提版时建，ADR 0053 第 4 条），这里不建；“不兼容的改动”在 t47 建变更记录时补一条“没有注入时的缺省语言从 zh-CN 改成 en-US”。记进 t47 的输入。

## 切片

1. 全部改动一个提交。验证：nb-layout `bun run test`、`typecheck`；neuro-book `host/text-engine`、`host/host-text` 相关测试与 `typecheck`；nb-story `typecheck`、`build:web`、`viewer.e2e.ts`；开发者面板 `typecheck`、`bun run test`；`docs:check`。
2. 实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `ui/i18n` 输出 8（nb-layout 缺省 en-US、宿主注入时照宿主） | nb-layout 的 dom 测试（没有注入是英文、注入中文是中文）；`layoutCatalogTranslate` 单测 |
| `ui/nested-grid` 输出 143 | 同上 |
| nb-story、开发者面板仍是中文 | nb-story `viewer.e2e.ts` 新断言；开发者面板见上 |

## 验证

见切片 1。未验证边界：应用的英文窗口（本来就注入，不受影响，不另测）。

## 不做与风险

- 不做：把中文目录搬出 nb-layout；变更记录（t47）。
- 风险：第三方以前没注入、靠缺省中文的不存在（nb-layout 还没发布）；仓库里没注入的宿主只有 nb-story 与开发者面板，`rg "nb-layout/vue"` 再查一遍有没有第三个。
