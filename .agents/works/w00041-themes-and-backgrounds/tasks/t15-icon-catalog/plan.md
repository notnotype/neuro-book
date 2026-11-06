# t15 计划：可覆盖图标目录

## Context

主题编辑器的“图标”分区让作者按名字覆盖产品里的 lucide 图标，但名字是自由输入的：写错、写成产品里没用到的图标，保存不会报错，也看不到效果（t12 设计审查第 4 条，[处理](../t12-theme-editor-assets/evidences/design-review-disposition.txt)，当时只在界面写了一句“保存不等于产品里有这个图标”）。开发者 2026-11-06 要求做掉。

需要的是一份“产品里能画的 lucide 图标名”目录，用来：名字输入补全；名字不在目录里时给提示（不阻止保存：第三方插件的图标、以后新加的图标不在目录里也要能写）；每个已覆盖的图标旁边显示它原来的样子，作者能看出换的是哪个。

依据：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 16、[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 21。

## 关键设计

### 数据源：运行中的样式表，不做构建期扫描

产品的 lucide 图标都是 `[class*="i-lucide-"]` 垫片加每个图标类自己的 `--svg` 规则（`nb-ui` 的 `styles.css`；图标类规则由 Tailwind 加 `@iconify/tailwind4` 按源码里出现的类生成，插件用到的图标由 `build-plugin.ts` 补 `.i-lucide-<名> { --svg: … }`）。**样式表里有 `.i-lucide-<名>` 规则，就是产品此刻能画这个图标**；没有规则的类画不出来，覆盖它也没有意义。所以目录就取样式表里的规则，不另扫源码：

- 比源码扫描准：动态拼出来的类名没有规则就画不出来，扫源码会漏报或误报；第三方插件带来的图标（`build-plugin.ts` 生成的规则）自动在内。
- 不用新增构建步骤、虚拟模块或生成文件，开发服务与产物行为一致。
- 代价：只有页面里已加载的样式表算数（懒加载的插件样式没加载时不在内）；扫描一次要遍历规则（量级万条，目标一次 < 50 ms，打开分区与输入框获得焦点时各扫一次，不缓存）。

### `packages/neuro-book/src/plugins/workbench/web/icon-catalog.ts`（新增）

- `scanIconNames(sheets: Iterable<CSSStyleSheet>): string[]`：递归遍历 `cssRules`（`@layer`、`@media`、`@supports` 里的嵌套规则都要进），对每条样式规则的 `selectorText` 匹配 `\.i-lucide-([a-z0-9-]+)`，收名字去重排序。跳过无法读取的表（跨域样式表读 `cssRules` 抛 `SecurityError`：不抛出，记一条诊断）和 `ownerNode` 带 `data-nb-skin-icons` 的表（那是主题自己的覆盖表，`document-theme.ts` 写的，里面的名字不是“产品能画的”）。
- 返回 `ReadonlyArray<{name: string; svg: string}>`：名字加这个图标**默认**的 `--svg` 值（取自样式规则的 `style.getPropertyValue("--svg")`；同名有多条规则时取最后一条，跳过的覆盖表不算）。读样式表只依赖 DOM 的 `CSSStyleSheet`，类型检查要兼顾节点侧 tsc 没有 DOM 库：同 `scene-providers.ts` 的做法，把读样式表的部分放在带 DOM 的叶子文件，纯数据处理（正则、排序）单独导出，单测传最小形状的假规则对象会违反“依赖用真的”，所以单测放 `*.dom.test.ts`（vitest 浏览器环境）用真实的 `CSSStyleSheet`。
- **不缓存**：每次打开“图标”分区时扫一次（组件挂载时），输入框获得焦点时再扫一次。Vite 开发服务会在同一个 `<style>` 元素上原地改 `textContent`、样式表实例被替换而集合长度与 `ownerNode` 不变（设计审查第 1 条，Chromium 实验），按数量或节点身份失效的缓存会漏掉这类更新；扫一次的成本要实测，不为省它引入失效规则。

### `packages/neuro-book/src/plugins/workbench/web/components/theme-editor/ThemeEditorIcons.vue`（+ `.md`）

- 名字输入加补全：输入框下的候选列表（目录里前缀或子串匹配的前 8 项，每项带该图标的默认预览），点选或键盘上下加回车填入。用 nb-ui 现有的下拉或组合框控件；没有合适的就用输入框加 `datalist`（原生，零新增控件），实现前在 nb-ui 里找一遍（`Combobox`、`Autocomplete`）。
- 目录读取失败或为空时（样式表读不到）整块退回现在的行为，只留一句现有提示。
- 输入的名字合规但不在目录里：行内一条非阻断的提示“产品里没有用到这个图标，保存后看不到效果”（`role="status"`，不是 alert），仍可添加。
- 每个已覆盖的行，预览旁加“原图标”的小预览：**不能直接挂 `i-lucide-<名>` 类**，实时预览会注入不分层的 `.i-lucide-<名>{--svg:…}` 去覆盖产品里的同名图标（`document-theme.ts` 的 `iconRules`，Spec 输出 16 要求它压过分层的原规则），编辑器里同名元素也会被盖成用户的 SVG（设计审查第 2 条，Chromium 实验）。原图标的预览元素用 `i-lucide-` 垫片的蒙版写法，但 `--svg` 用目录里取到的默认值直接写在元素的行内样式上（行内声明压过任何样式表规则），补全候选的预览同理。目录里没有时不画。
- 文案：`themeEditor.icons.unknownName`、补全列表的可访问名，两份语言包；`locales.test.ts` 的表要登记。

## Spec 与文档改动

- `theme/editor.md` 输出 21：加“名字输入有补全（取自页面里已加载的图标样式）；名字不在其中时给非阻断的提示；已覆盖的行并排显示原图标”；验收 16–20 里的图标项加一条；边界里去掉“不做图标目录”。
- `theme/skins.md` 输出 16 不改（行为合同不变）。
- 组件文档 `ThemeEditorIcons.md` 同步。
- `docs/testing/README.md`：不改。

## 切片

1. `icon-catalog.ts` 与 `*.dom.test.ts`（真实样式表：嵌套 `@layer`、`@media`、跨域样式表、主题覆盖表被跳过、默认 `--svg` 取值、原地改 `textContent` 后再扫能看到新规则）。验证 `bun run test:affected` 里的 dom 测试。
2. 编辑器图标分区接入（补全、未知名提示、原图标预览）、Spec、组件文档、两份语言包、Lab 夹具 `icons` 场景加一个“名字不在目录里”的态。验证：类型检查、`locales.test.ts`、`lab:shot`。
3. e2e：`theme-editor.e2e.ts` 新用例（输入 `fol` 出现 `folder*` 候选，选一个并上传；输入产品里没有的名字出现提示仍可添加；原图标预览可见）；390px 不溢出。

## 验收映射

- `theme.editor` 输出 21（补全、未知名提示、原图标预览）：切片 3 的 e2e 与切片 1 的 dom 测试。
- 目录来源正确（嵌套层、跳过自己的覆盖表）：`icon-catalog.dom.test.ts`。
- 窄屏：同 e2e 的 390px 断言。
- 默认图与覆盖图互不污染：e2e 里上传一个形状明显不同的 SVG 覆盖 `folder`，断言行内“原图标”预览元素与覆盖图预览的计算后 `mask-image` 不同（原图标仍是产品默认的），候选预览同理。

## 验证

`bun run build`、`bun run build:e2e`；只跑 `theme-editor.e2e` 的图标用例与 `icon-catalog.dom.test.ts`。UI 取证：亮色 `nbdev shot` 图标分区（补全展开、未知名提示）。

## 不做与风险

- 不做构建期目录，不做“全量 lucide 图标浏览器”（全量有一千多个，大部分产品里没用）。
- 不阻止保存未知名字。
- 风险：`CSSStyleSheet.cssRules` 在产物里是 Tailwind 编译后的单个大样式表，遍历耗时要实测（目标 < 50 ms，超了就改成只在首次输入时扫一次、之后在输入框获得焦点时重扫）；`@layer` 里的规则选择器写法可能是 `.i-lucide-foo` 也可能带伪类或嵌套（`&`），匹配用子串正则而不是整串比较。
