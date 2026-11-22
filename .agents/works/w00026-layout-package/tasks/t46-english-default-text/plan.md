# t46 计划：nb-layout 默认英文文案（第 2 稿）

第 2 稿按设计审查（Claude Sonnet，9 条，[证据](evidences/design-review.txt)）改，差别见末尾“修订记录”。

## Context

- **为什么做**：ADR 0054 第 7 条第二档第 5 项与提案 [nb-layout 做成通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 的“去掉 nb-ui 依赖”一节：第二档默认英文、源语言从 `zh-CN` 变成 `en-US`。提案说 `message-catalogs` 的检查要跟着改，这个前提不成立：它只查 JSON 目录，nb-layout 的 `.ts` 目录今天没有任何地方核对（审查第 1 条），本 Task 补包内测试。发到 npm 之后，没有注入文字的第三方宿主不该看到中文读屏名称。
- **依据**：`docs/specs/ui/i18n.md` 输出 8（缺省端口与 nb-layout 的例外）、`docs/specs/ui/nested-grid.md` 输出 143（组件取文字）。
- **影响到的宿主**：
  - 应用（neuro-book）每个根经 `host-text.ts` 注入、按端口的当前语言取，不受影响；只有登记目录时写死的源语言 `"zh-CN"`（`text-engine.ts:166`）要改成读常量。
  - nb-story 与开发者面板今天都不注入（t14 实现审查第 2 条），缺省一改就会静默变成英文：同一 Task 里给它们注入中文。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t46-english-text`（分支 `w00026/t46-english-text`）。

## 技术选型

无。

## 关键设计

### `packages/nb-layout/src/locales/` 与 `src/vue/text.ts`

- `NB_LAYOUT_SOURCE_LOCALE` 改成 `"en-US"`；`NB_LAYOUT_CATALOGS` 仍含 `zh-CN` 与 `en-US` 两份（提案写的是“不必成为库的公开子路径”，不是必须拿掉；nb-story 与开发者面板要用它）。`zh-CN.ts`、`en-US.ts` 的头注释对调“源语言”的说法。
- 新增 `layoutCatalogTranslate(locale)`，放在 `./text`（`src/vue/text.ts`），不放 `./locales`：返回类型 `LayoutTranslate` 定义在 `text.ts`，核心（`src/` 下除 `vue/` 以外）不能依赖它（审查第 2 条）；宿主取注入键也是从 `./text`，两个名字出自同一个子路径。`text.ts` 头注释“只放注入键与类型”改成“注入键、类型与按自带目录翻译的函数”。
  - 签名：`layoutCatalogTranslate(locale: keyof typeof NB_LAYOUT_CATALOGS): LayoutTranslate`。参数只收目录里有的两种语言，拼错（`"zh"`、`"zh_CN"`）编译不过，不做前缀匹配与规范化（审查第 3 条 c）。
  - 取键：先取这种语言，缺键回源语言，再缺返回键名；取语言用 `Object.hasOwn`（审查第 3 条 a、b）。
  - 参数代入只认 `{{name}}`，缺的参数保留占位；目录不用 `{{name, number}}`，由目录测试拦（审查第 4 条）。
  - 返回的函数固定一种语言，不能运行时换语言：给只有一种语言、没有翻译引擎的宿主用；要跟着语言变的宿主仍按 README 接自己的端口（审查第 3 条 d）。README 的“文字”一节写明。
  - `src/vue/layout-text.ts` 的缺省翻译改用 `layoutCatalogTranslate(NB_LAYOUT_SOURCE_LOCALE)`，取文字的实现只有一份；它的头注释里“由 `LayoutTextKey` 与消息目录检查守着”改成指向新的目录测试。
- README 的“我要做 X 用哪个导出”加一行；新写的文字不引 Spec 的输出编号（`readme.test.ts`）。

### 宿主

- `packages/neuro-book/src/web/host/text-engine.ts`：登记 nb-layout 时源语言改用 `NB_LAYOUT_SOURCE_LOCALE`。回退链变成“当前语言 → en-US → 键名”，中文窗口里 zh-CN 目录本来就全，显示不变。
- `packages/nb-story/src/web/main.ts`、`packages/dev-panel/src/web/main.ts`：`createApp(App).provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN"))`，各加注释写明这两个应用只有中文界面。

### 测试

- `src/locales/locales.test.ts`（新，Bun）：`const KEYS = {...} satisfies Record<LayoutTextKey, true>` 让键的联合类型与表双向穷尽；两份目录的叶子恰好是这 14 个键；同一个键在两份目录里的占位符集合相同；占位符只有 `{{name}}`（用 `scripts/ci/message-catalogs.ts` 认的同一种写法核对，遇到 `, number` 报错）（审查第 1、4 条）。
- `layoutCatalogTranslate` 的单测：两种语言各取一个键；14 个键在缺省（en-US）与 zh-CN 下都不等于键名、占位符都被代入（表驱动）；缺参数保留占位；`Object.hasOwn` 那条用类型绕过传 `"constructor"` 回到源语言（审查第 3、5 条）。
- dom 测试（审查第 5 条）：
  - `SortableList.dom.test.ts` 的 `mountList` 缺省注入 `layoutCatalogTranslate("zh-CN")`，原有中文断言不动；“没有注入时用源语言目录”那条改成断言英文。
  - `splitter.dom.test.ts` 那两处 `aria-valuetext`（“2 像素”“已收起”）改成注入中文后断言，另加一条没有注入时是英文。
  - 新增：`Splitter` 与 `NestedGrid` 各一条，没有注入时分隔线的 `aria-label` 是 `Resize width between a and b`；`FloatWindowHandles` 两个把手的 `aria-label` 是英文。
- 宿主守卫（审查第 6 条）：
  - nb-story 与开发者面板各加一条源码扫描的单测：网页入口 `src/web/main.ts` 提供了 `LAYOUT_TEXT_KEY`（仿应用的 `host-text.test.ts`）。
  - nb-story 的 `viewer.e2e.ts` 在宽屏断言 `getByRole("separator", {name: "调整 nav 与 main 的宽度"})`；写完删掉注入跑一次确认变红（不放进 t44 新建的 `frame.e2e.ts`，免得两个分支改同一个文件）。

## Spec 与文档改动

- `docs/specs/ui/i18n.md` 输出 8：nb-layout 没有注入时用自带的 `en-US` 目录（源语言 `en-US`）；只有一种语言的宿主用 `layoutCatalogTranslate` 注入；已知限制改写成：没有宿主时 nb-ui 系列是 `zh-CN`、nb-layout 是 `en-US`，同屏会中英混排，要一致就注入；共享包的根组件按自己的 `locale` 建缺省端口时，里面的 nb-layout 仍是 `en-US`（今天没有共享包嵌 nb-layout）（审查第 8 条）。
- `docs/specs/ui/nested-grid.md` 输出 143（第 228 行一带）：加 `layoutCatalogTranslate` 一句，与新测试对应。
- nb-layout：`README.md` 两处（入口注释“自带的 zh-CN、en-US”、“文字”一节）与表里新增一行；`src/vue/Splitter.md` 的“文字”一句；`src/vue/SortableList.md` 把“拖到这里”写成定值的两处（第 12、51 行）；`AGENTS.md` 的文字一句；`src/locales/index.ts`、`layout-text.ts`、`text.ts` 的头注释。
- `packages/nb-ui/docs/migration-0.4.md` 第 77 行“没有注入时用它自带的中文目录”。
- `packages/neuro-book/src/web/host/text-engine.ts`：第 158 行一带的块注释“源语言都是 `zh-CN`”加 nb-layout 的例外，免得以后被统一回去。
- 提案 `docs/proposals/nb-layout-general-library.md`：追加一条决策记录：`message-catalogs` 不查 `.ts` 目录，nb-layout 的目录由包内测试核对。
- t47 的输入：在 t47 的 README 记一条“建 nb-layout 变更记录时，‘不兼容的改动’写没有注入时的缺省语言从 zh-CN 改成 en-US，以及新增 `layoutCatalogTranslate`”（审查第 7 条）。
- 已知限制：英文的 `{{size}} pixels` 在 1 时读成 “1 pixels”，库不处理复数，写进 README 的“文字”一节；分隔线读屏名称用面板 id，记进 t44 的接入记录（审查第 9 条）。

## 切片

1. 全部改动一个提交。验证：nb-layout `bun run test`、`typecheck`；neuro-book `host/text-engine`、`host/host-text` 相关测试与 `typecheck`；nb-story `typecheck`、`build:web`、`viewer.e2e.ts`；开发者面板 `typecheck`、`bun run test`；`docs:check`。
2. 实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `ui/i18n` 输出 8（nb-layout 缺省 en-US、宿主注入时照宿主） | nb-layout 的 dom 测试（Splitter、NestedGrid、FloatWindowHandles、SortableList 没有注入是英文，注入中文是中文）；`layoutCatalogTranslate` 单测；`locales.test.ts` |
| `ui/nested-grid` 输出 143 | 同上 |
| nb-story、开发者面板仍是中文 | 两个包的源码扫描单测；nb-story `viewer.e2e.ts` 新断言（变异过） |

## 验证

见切片 1。未验证边界：应用的英文窗口（本来就注入，不受影响，不另测）。

## 不做与风险

- 不做：把中文目录搬出 nb-layout；变更记录（t47）。
- 风险：第三方以前没注入、靠缺省中文的不存在（nb-layout 还没发布）；仓库里没注入的宿主只有 nb-story 与开发者面板，`rg "nb-layout/vue"` 再查一遍有没有第三个。

## 修订记录

- 第 2 稿（设计审查 9 条，都成立）：
  - 第 1 条：目录一致性今天没人核对，补 `locales.test.ts`，修 `layout-text.ts` 的注释，提案追加决策记录。
  - 第 2 条：`layoutCatalogTranslate` 放 `./text`，不放 `./locales`。
  - 第 3 条：参数只收两种语言；缺键回源语言再回键名；`Object.hasOwn`；写明不能换语言。
  - 第 4 条：目录测试拦 `{{name, number}}`。
  - 第 5 条：测试迁移按实数改，`mountList` 缺省注入中文；补分隔线与浮动窗把手的英文读屏名称用例。
  - 第 6 条：两个宿主各一条源码扫描单测，e2e 断言做变异。
  - 第 7 条：文档清单补全；`exports.test.ts` 没有按入口列名字，改的是 README 表；t47 的输入写进 t47 的 README。
  - 第 8 条：Spec 写明没有宿主时同屏中英混排。
  - 第 9 条：读屏名称用面板 id、“1 pixels”记为已知限制。
