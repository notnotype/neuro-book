# t15 计划：可覆盖图标目录

## Context

主题编辑器的“图标”分区让作者按名字覆盖产品里的 lucide 图标，但名字是自由输入的：写错、写成产品里没用到的图标，保存不会报错，也看不到效果（t12 设计审查第 4 条，[处理](../t12-theme-editor-assets/evidences/design-review-disposition.txt)，当时只在界面写了一句“保存不等于产品里有这个图标”）。开发者 2026-11-06 要求做掉。

需要的是一份“产品里能画的 lucide 图标名”目录，用来：名字输入补全；名字不在目录里时给提示（不阻止保存：第三方插件的图标、以后新加的图标不在目录里也要能写）；每个已覆盖的图标旁边显示它原来的样子，作者能看出换的是哪个。

依据：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 16、[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 21。

## 关键设计

### 数据源：运行中的样式表，不做构建期扫描

产品的 lucide 图标都是 `[class*="i-lucide-"]` 垫片加每个图标类自己的 `--svg` 规则（`nb-ui` 的 `styles.css`；图标类规则由 Tailwind 加 `@iconify/tailwind4` 按源码里出现的类生成，插件用到的图标由 `build-plugin.ts` 补 `.i-lucide-<名> { --svg: … }`）。**样式表里有 `.i-lucide-<名>` 规则，就是产品此刻能画这个图标**；没有规则的类画不出来，覆盖它也没有意义。所以目录就取样式表里的规则，不另扫源码：

- 比源码扫描准：动态拼出来的类名没有规则就画不出来，扫源码会漏报或误报；第三方插件带来的图标（`build-plugin.ts` 生成的规则）自动在内。
- 不用新增构建步骤、虚拟模块或生成文件。注意：开发服务与 e2e 外壳用完整样式入口（`vite.config.ts` 的 `FULL_STYLE_ENTRY`），生产入口排除了 `src/plugins/lab` 与 `src/web/testing`，所以**开发服务、Lab 与 e2e 里的目录是产品目录的超集**（多出只在 Lab 夹具里出现的图标；粗算产品 129 个名字，源码里 171 个）。因此未知名提示的文案不夸大，写“当前页面没有这个图标的样式”，e2e 的“未知名”用例用一个 lucide 里有、仓库源码里确实没出现的名字，并在测试里先断言它不在扫描结果里；候选断言只断言包含 `folder`，不断言条数（设计审查第二段第 2 条）。
- 代价：只有页面里已加载的样式表算数；插件的样式表在窗口登记插件时就挂上，不是懒加载；产品的图标规则只在入口那一张样式表里（实测约 1069 条规则，一次扫描不构成成本，不需要缓存或首次输入再扫的退路）。

### `packages/neuro-book/src/plugins/workbench/web/icon-catalog.ts`（新增）

- `scanIconCatalog(sheets: Iterable<CSSStyleSheet>)`（DOM 部分，放在带 DOM 的叶子文件）：递归遍历 `cssRules`（`@layer`、`@media`、`@supports` 里的嵌套规则都要进），只认**带 `--svg` 声明**的规则；`selectorText` 按逗号拆开（产物里别名是 `.i-lucide-loader-2,.i-lucide-loader-circle{…}` 这种分组），只收整段恰好是 `.i-lucide-<名>` 的那几段（后代选择器之类不收）。去重排序。**同名多条规则时取第一条**：宿主的图标规则在入口样式表的 `@layer utilities`，插件为自己用到的图标也会生成同名规则但在 `@layer components`（`build-plugin.ts`），层序上 utilities 赢，而插件的 `<link>` 在 `head` 末尾排在宿主样式表之后，所以“最后一条”取到的是层叠里输的那条（设计审查第二段第 15 条）。跳过无法读取的表（跨域样式表读 `cssRules` 抛 `SecurityError`：不抛出，记一条诊断）和 `ownerNode` 带 `data-nb-skin-icons` 的表（那是主题自己的覆盖表，`document-theme.ts` 写的，里面的名字不是“产品能画的”）。
- 返回 `ReadonlyArray<{name: string; svg: string}>`：名字加这个图标**默认**的 `--svg` 值（取自样式规则的 `style.getPropertyValue("--svg")`；同名多条取第一条，见上，跳过的覆盖表不算）。节点侧 tsc 没有 DOM 库，所以读样式表的部分放在带 DOM 的叶子文件，纯数据处理（`parseIconSelector(selectorText): string[]`：按逗号拆、只收整段是 `.i-lucide-<名>` 的、去重）单独导出成纯函数，bun 单测直接喂 `selectorText` 字符串。**DOM 部分不在 `*.dom.test.ts` 里测**：那是 vitest 加 happy-dom，不是浏览器，实测 happy-dom 20.11.2 解析样式表时整块丢掉 `@layer`，而产品的图标规则全在 `@layer utilities`（插件的在 `@layer components`），测出来的目录恒为空（设计审查第二段第 3 条）；跨域 `SecurityError`、计算后的 `mask-image` 在 happy-dom 里也没有对应行为。DOM 部分的证据只认 Chromium e2e（见验收映射）。
- **不缓存**：每次打开“图标”分区时扫一次（组件挂载时），输入框获得焦点时再扫一次。Vite 开发服务会在同一个 `<style>` 元素上原地改 `textContent`、样式表实例被替换而集合长度与 `ownerNode` 不变（设计审查第一段第 1 条，Chromium 实验），按数量或节点身份失效的缓存会漏掉这类更新；约 1069 条规则，一次扫描很便宜，不为省它引入失效规则。

### `packages/neuro-book/src/plugins/workbench/web/components/theme-editor/ThemeEditorIcons.vue`（+ `.md`）

- 名字输入加补全：`Input` 加 nb-ui 的 `SuggestionMenu`（输入处旁的候选列表，不抢焦点，上下键与回车由宿主处理，同对话输入框的写法）。候选是目录里前缀或子串匹配的前 8 项，点选或上下键加回车填入。nb-ui 里没有 `Combobox`、`Autocomplete`；`SearchSelect` 只能选已有项、不能输入目录外的名字；`datalist` 画不了图标、外观也与弹出列表不一致，都不用。**候选里不画预览**：`SuggestionMenu` 的图标只能经 `iconClass` 给类名（没有行内样式或逐项插槽），直接给 `i-lucide-<名>` 会被正在编辑的主题覆盖表盖掉，要画就得改 nb-ui 的公开接口，不值得；候选只显示名字（设计审查第二段第 1 条）。
- 目录读取失败或为空时（样式表读不到）整块退回现在的行为，只留一句现有提示。
- 输入的名字合规但不在目录里：行内一条非阻断的提示“当前页面没有这个图标的样式，保存后可能看不到效果”（`role="status"`，不是 alert），仍可添加。
- 每个已覆盖的行，预览旁加“原图标”的小预览：**不能直接挂 `i-lucide-<名>` 类**，实时预览会注入不分层的 `.i-lucide-<名>{--svg:…}` 去覆盖产品里的同名图标（`document-theme.ts` 的 `iconRules`，Spec 输出 16 要求它压过分层的原规则），编辑器里同名元素也会被盖成用户的 SVG（设计审查第 2 条，Chromium 实验）。原图标的预览元素用一个能命中 `i-lucide-` 垫片、但没有任何覆盖规则的类名（例如 `i-lucide-nbook-default-preview`，它不是任何真实图标名），`--svg` 用目录里取到的默认值直接写在元素的行内样式上（行内声明压过任何样式表规则）。目录里没有时不画。
- 文案：`themeEditor.icons.unknownName`、补全列表的可访问名，两份语言包；`locales.test.ts` 的表要登记。

## Spec 与文档改动

- `theme/editor.md` 输出 21：现有那句“保存一个产品里没有用到的名字不报错，也看不到效果，说明里写明这一点”改成：名字输入有补全（取自页面里已加载的图标样式）；名字不在其中时给非阻断的提示（措辞写“当前页面没有这个图标的样式”）；已覆盖的行并排显示原图标；验收 16–20 里的图标项加一条。（边界一节没有“不做图标目录”这句，不用改。）
- `theme/skins.md` 输出 16 不改（行为合同不变）。
- 组件文档 `ThemeEditorIcons.md` 同步。
- `docs/testing/README.md`：不改。

## 切片

1. `icon-catalog.ts`：纯数据部分的 bun 单测（逗号分组、整段匹配、后代选择器不收、去重）。验证 `bun test src/plugins/workbench/icon-catalog.test.ts`（看用例数）。
2. 编辑器图标分区接入（补全、未知名提示、原图标预览）、Spec、组件文档、两份语言包、Lab 夹具 `icons` 场景加一个“名字不在目录里”的态。验证：类型检查、`locales.test.ts`、`lab:shot`。
3. e2e：`theme-editor.e2e.ts` 新用例（输入 `fol` 出现 `folder*` 候选，选一个并上传；输入产品里没有的名字出现提示仍可添加；原图标预览可见）；390px 不溢出。

## 验收映射

- `theme.editor` 输出 21（补全、未知名提示、原图标预览）：切片 3 的 e2e 与切片 1 的 dom 测试。
- 目录来源正确（真实 `@layer` 里的规则、别名分组选择器、自己的覆盖表被跳过、同名取宿主的、默认 `--svg` 取值）：Chromium e2e 对产品页面断言（`folder` 在目录里、`loader-2` 与 `loader-circle` 两个别名都在、覆盖表里的名字不因此多出）；原地改 `<style>` 的再扫能力用 Playwright `page.setContent` 的小页面测。纯数据部分：切片 1 的 bun 单测。
- 窄屏：同 e2e 的 390px 断言。
- 默认图与覆盖图互不污染：e2e 里上传一个形状明显不同的 SVG 覆盖 `folder`，断言行内“原图标”预览元素与覆盖图预览的计算后 `mask-image` 不同（原图标仍是产品默认的），候选预览同理。

## 验证

`bun run build`、`bun run build:e2e`；只跑 `theme-editor.e2e` 的图标用例与 `icon-catalog.test.ts`。UI 取证：亮色 `nbdev shot` 图标分区（补全展开、未知名提示）。

## 不做与风险

- 不做构建期目录，不做“全量 lucide 图标浏览器”（全量有一千多个，大部分产品里没用）。
- 不阻止保存未知名字。
- 风险：开发服务与 e2e 外壳的目录是产品的超集（见上），Lab 与 e2e 里“当前页面没有”不等于产品里没有；以后若有组件样式写 `.x .i-lucide-foo{…}` 这类后代选择器，因为只收整段是 `.i-lucide-<名>` 的选择器所以不会被误收。
