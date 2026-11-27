---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workspace.markdown-syntaxes
owners:
  - nbook.markdown
---

# Markdown 方言的贡献

## 目标与非目标

让一种 Markdown 方言连同它的读写与显示由插件贡献，编辑器、展示器与字数共用同一组生效的方言。方言的读写规则本身由 [workspace.markdown-dialect](markdown-dialect.md) 规定，本 Spec 规定方言怎样加入、什么时候生效、不生效时怎样。

不承诺：

- 第三方插件贡献方言。现在没有安装第三方插件的途径，装配清单里的插件都是内置的（输出 12）。
- 运行中改变已打开视图的方言：视图在建立时取定语言（输出 7），运行中停用、启用插件归 [runtime.plugin-hot-plug](../runtime/plugin-hot-plug.md)。
- 非标签写法的方言参与字数规则：提示块、可渲染 HTML 的字数规则是核心扫描的一部分（输出 9）。
- Composer 的编辑组件不用本 Spec 的方言（[ui.prompt-editor](../ui/prompt-editor.md) 有自己的文字写法）。

## 术语与参与者

- **方言声明**：一种方言的静态信息（顺序、标签名、字数规则），投到贡献点 `markdown.dialects`。
- **方言实现**：一种方言的语法模块（schema、读法、写法、编辑视图），投到贡献点 `markdown.syntaxes`。
- **内置方言**：批注、注音、双语、对齐、文字标记、可渲染 HTML、提示块、表情（写法与显示见 [agent.stickers](../agent/stickers.md)）。它们的声明投到 `markdown.dialects`，实现由 `nbook.markdown` 直接持有，不经贡献点交付。
- **核心语法**：CommonMark 与 GFM 的部分与原样保留，由 `nbook.markdown` 直接持有，不是方言。
- **语言**：核心语法加上全部生效的方言组成的一份读写规则，有自己的 schema。
- **生效**：一种方言进入语言（输出 3）。没生效的方言，它的写法按 [workspace.markdown-dialect](markdown-dialect.md) 输出 9 原样保留。
- **视图**：用某份语言读写或显示 Markdown 的一个实例：编辑器里的一个 Markdown 编辑器实例、展示器里一条消息的显示。

## 输入与前置条件

两个贡献点都由 `nbook.markdown` 拥有，合同在 `nbook/plugins/markdown/shared/contracts.ts`：

| 贡献点 | 实现 | 位置 | 贡献 id | 内容 |
|---|---|---|---|---|
| `markdown.dialects` | 无（只有声明） | 插件描述的顶层贡献，浏览器与项目两个位置都登记 | `<插件 id>.<名字>` | 声明，见下表 |
| `markdown.syntaxes` | 必需 | 浏览器入口 | 与它的声明相同 | `{load(): Promise<MarkdownSyntax>}` |

声明的字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `order` | 整数 | 同一种词法单元有几种方言认领时，小的先试 |
| `blockTags` | 标签名数组，可省略 | 本方言的块级标签 |
| `inlineTags` | 标签名数组，可省略 | 本方言的行内标签 |
| `tagWords` | `{tag, content: "count" \| "skip"}` 数组，可省略 | 标签里的字计不计；标签必须出现在 `blockTags` 或 `inlineTags` 里；没列出的声明标签计入 |

`MarkdownSyntax` 是语法模块的形状（浏览器一侧的 `web/contracts.ts` 导出类型）：schema 扩展、各词法单元的读法、各节点与标记的写法、标签名与编辑视图；可选的原子：模块在原文上从左到右认出的、互不重叠的一段段文字，分词之前换成等长的占位、分完逐字换回，所以 Markdown 的规则（表格的 `|`、行首的 HTML 块）不会切开或改读它们；模块自己的分词规则在分词期间能按占位查回是哪一段原文，几次分词（包括一次分词进行中另起的分词）各查各的；写回文字时，文字里会被认成原子开头的写法照转义规则转义；读法对一部分文字另分词时照样遮罩（只在那次分词结束之后；分词规则里要另分词用新的词法器）；原文里同一个私用区的字作同一个原子（引用式链接的标签按字比较）；表格里原子中的 `|` 不切单元格，数单元格与写出时都不当分隔符、不转义；不带编辑器的词法另交回每个原子落在哪个词法单元与字段（正文里被模块认领、代码里、链接地址里，或被 Markdown 的规则丢掉），原子多于上限时不遮罩并交回个数；模块给的原子范围重叠或跨行时分词失败，不读错。没有原子的模块读写不变。外来方言在展示器里按 schema 的 `renderHTML` 显示，没有专门的静态视图（[ui.markdown-display](../ui/markdown-display.md) 输出 2）。

`nbook.markdown` 的浏览器入口提供服务 `markdownKey`，交出用 Markdown 的组件；语言与编解码器只在这些组件里用，不经服务交出：

```ts
interface MarkdownService {
    readonly components: {
        /** Markdown 富文本控件，按编辑器区的控件合同收属性、交句柄（workbench.editor 输出 19）。 */
        readonly MarkdownControl: Component;
        readonly MarkdownDisplay: Component;   // ui.markdown-display
        readonly PromptEditor: Component;      // ui.prompt-editor
        readonly PromptTextView: Component;
        readonly InlineChip: Component;
        readonly MarkdownImage: Component;
    };
}
```

字数在两个位置都用同一组纯函数：`dialectTable(declarations)` 由已接受的 `markdown.dialects` 声明算出声明表，`countWords(text, table)` 计数。

## 输出与可观察行为

1. **第一份语言**：由核心语法与内置方言组成，不等任何别的插件。`nbook.markdown` 的激活不等任何贡献。
2. **按需加载**：语法模块、Markdown 解析器与编辑内核在第一次挂上用 Markdown 的组件时才加载；没有用到 Markdown 的窗口不加载它们，首屏的脚本里没有它们。
3. **生效的条件**：一种外来方言同时满足以下几条时生效：声明已被接受；同一插件交付了同 id 的实现，且 `load()` 成功；实现交出的块级标签与行内标签分别与声明的 `blockTags`、`inlineTags` 相同；与别的生效方言没有冲突（输出 4）。少了任何一条，这种方言不生效，记诊断（“失败与恢复”），贡献方的其它贡献照常。
4. **冲突**：两种方言声明了同一个标签名，或者实现交出了同名的节点、标记（组合扩展展开后的也算）、同一种节点的写法或同名的语法模块，两种都不生效，与登记、交付的先后无关；核心语法（含原样保留）与内置方言不参与这条比较，外来方言与它们同名时只有外来的那种不生效。按名字判不出、组成语言时仍出错的，外来方言都不生效，视图照常用内置方言建立。
5. **顺序**：生效的方言按 `order` 从小到大试，相同时按 id 的码元顺序；核心语法排在最后。同一份方言集合在任何窗口里组成的语言都相同。
6. **晚到与撤回**：外来方言的实现交付或撤回后，`nbook.markdown` 组成一份新的语言，之后建立的视图用它。
7. **视图在建立时取定语言**：已有的视图继续用它建立时的语言读写与显示，直到视图结束；之后建立的视图用当时的语言。编辑器里一个 Markdown 编辑器实例的寿命见 [workbench.editor](../workbench/editor.md) 输出 19；展示器见 [ui.markdown-display](../ui/markdown-display.md) 输出 1。
8. **不生效时不损坏文件**：一种方言不生效时，它的写法读成原样块或原样片段，不编辑写回字节不变；编辑了别处写回，它们的字节仍不变（[workspace.markdown-dialect](markdown-dialect.md) 输出 1、9）。
9. **字数**：字数只按已接受的声明计，与浏览器里实现是否加载成功无关。`tagWords` 为 `skip` 的标签里的字不计，为 `count` 的计；属性一律不计；没有任何声明认领的标签按普通 HTML 处理（原样内容不计）。提示块的类型标记与可渲染 HTML 块由核心扫描处理，不随方言变化。其余规则见 [workspace.markdown-dialect](markdown-dialect.md) 的“副作用与数据”。
10. **声明表在一个进程里固定**：同一个运行实例的寿命内，`markdown.dialects` 的已接受声明不变；浏览器与项目进程装配同一份清单，声明表相同。声明表的指纹用于书架统计判断口径是否变了（[runtime.projects](../runtime/projects.md) 输出 16）。
11. **id 与形状**：两个点的贡献 id 都要以贡献方的插件 id 加 `.` 开头；声明不合上表的规则时按 [runtime.plugins](../runtime/plugins.md) 的单条校验为 `invalid-declaration`。
12. **不按来源区分**：方言的贡献不判断贡献方是内置插件还是第三方插件，一律按贡献点的规则接受（[ADR 0027](../../adr/0027-builtin-and-third-party-plugins-are-equal.md)）。

## 状态与转换

语言按代次组成：第一份是第 1 代，每次方言集合变化加一代。旧代次的语言对象在仍有视图使用它时照常可用。

时序与寿命：

- `markdownKey` 在 `nbook.markdown` 的浏览器入口激活后可用；组件第一次挂上时开始加载语言，同时挂上的几个组件等同一次加载。
- 外来方言的声明与实现分开到达：声明随清单在实例登记时就有；实现在贡献方入口激活后交付。实现交付之前，这种方言不生效。
- 实现的 `load()` 在交付后由 `nbook.markdown` 调用一次；失败的方言不生效，直到同一插件下一次交付。
- 贡献方入口停止时，它的实现撤回，按输出 6 组成新语言；已有视图不受影响（输出 7）。

## 副作用与数据

不写文件。不生效的原因写进诊断（事件 `markdown.dialect.inactive`，带方言 id 与失败码）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `missing-declaration` | 实现没有同 id 的已接受声明 | 在插件描述里补声明 |
| `load-failed` | 实现的 `load()` 失败或抛错 | 修正实现；下一次交付重试 |
| `tag-mismatch` | 实现交出的标签名与声明不同 | 让两边一致 |
| `conflict` | 与另一种方言撞名（输出 4） | 改名；两种都不生效直到冲突消失 |

## 边界与兼容

- 公开接口：两个贡献点、`MarkdownSyntax` 类型、`markdownKey` 交出的组件、`dialectTable` 与 `countWords`。`MarkdownSyntax` 直接用到 Markdown 解析器与编辑内核的类型，任何插件都可以使用（[ADR 0027](../../adr/0027-builtin-and-third-party-plugins-are-equal.md)）；这些类型随解析器与编辑内核升级可能不兼容，按 [`runtime.plugin-api`](../runtime/plugin-api.md) 的产品版本规则体现。
- 方言的写法属于作品文件的格式，兼容规则见 [workspace.markdown-dialect](markdown-dialect.md) 的“边界与兼容”。

## 验收与 Smoke

1. Given 测试插件 `test.markdown-dialect` 声明了 `<kbd>` 方言、实现要经测试命令才交付，When 打开一份含 `<kbd>Ctrl</kbd>` 的文件，Then 它是原样片段；When 执行测试命令后在另一组打开同一文件，Then 新的编辑器把它读成方言，原来那组仍是原样片段，两边不编辑保存字节都不变。
2. Given 两个测试方言声明了同一个标签名，When 两者都交付，Then 两种都不生效、诊断各一条、两个插件的其它贡献照常；交换登记顺序结果相同。
3. Given 内置方言逐个缺席，When 组成语言，Then 都能组成，缺席方言的写法读成原样。
4. Given `<kbd>` 方言的声明为 `skip`，When 它的实现加载失败，Then 编辑器里它是原样片段，状态栏与书架的字数都不计其中的字。

Smoke：场景 1 由 `web/components/late-dialect.dom.test.ts` 运行（真实内核的浏览器实例、真实编辑器区与文档模型，happy-dom）；场景 2、3 由 `web/syntaxes.test.ts`（真实插件宿主）运行；场景 4 由 `web/syntaxes.test.ts` 的加载失败一例与 `shared/word-count.test.ts` 的按声明计数一例共同覆盖。运行中晚到的方言只有测试插件会产生，不另做浏览器 e2e。

## 实现合同

- 公开入口：`nbook/plugins/markdown/shared/contracts` 的两个贡献点 id、声明的校验、`dialectTable`、`countWords` 与服务键 `markdownKey`；浏览器一侧 `web/contracts.ts` 的 `MarkdownSyntax` 类型（它是 nb-markdown 的 `@notnotype/nb-markdown/language/types`，语言、内置语法模块与编解码器也在 nb-markdown）。
- owner 与依赖方向：`nbook.markdown` 拥有两个贡献点、方言目录与组语言（`language-registry.ts` 用 nb-markdown 的 `createMarkdownLanguage`、内置语法模块与保留名字）。编辑器区经 `markdownKey` 拿 Markdown 控件，书架统计只用 `shared/` 的纯函数与声明表，都不依赖语言与编解码器。插件定义与贡献的接收不碰 DOM 与编辑内核（服务端的类型检查不带 DOM）；语言只在组件一侧组成。
- 不变量：
  - 撞名按组合扩展展开后的名字、原样语法的写法与语法模块名比较；按名字判不出、组成语言仍出错时外来方言都不生效，语言照常用内置方言组成（`syntaxes.test.ts` 的输出 4 两例）；
  - 生效的方言集合没变时不换数组，组成的语言还是同一份（`syntaxes.test.ts` 输出 6、7 的第二例）；
  - Markdown 控件在建实例时取定语言，之后的写出都用它（`late-dialect.dom.test.ts`）；
  - 内置方言逐个缺席都能组成语言：核心语法只按标记组排斥，不按名字依赖方言（`syntaxes.test.ts` 的验收 3）；
  - 首屏的入口脚本与预加载的 chunk 里没有 ProseMirror 与 `marked`（`check:dist`）。

## 证据

- 批准依据：开发者 2026-10-16 的决定，记录在主工作区 master 的 `.agents/works/w00025-editor/tasks/t07-markdown-plugins/README.md`（“开发者的决定”1、5、7、8）与同目录的 `plan.md`。
- 实现入口：[`plugin.ts`](../../../packages/neuro-book/src/plugins/markdown/plugin.ts)（插件描述与内置方言的声明）、[`shared/contracts.ts`](../../../packages/neuro-book/src/plugins/markdown/shared/contracts.ts)、[`shared/dialects.ts`](../../../packages/neuro-book/src/plugins/markdown/shared/dialects.ts) 与 [`shared/word-count.ts`](../../../packages/neuro-book/src/plugins/markdown/shared/word-count.ts)（声明表与字数）、[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/markdown/web/plugin.ts)（浏览器入口与服务）、[`web/syntax-catalog.ts`](../../../packages/neuro-book/src/plugins/markdown/web/syntax-catalog.ts)（配对、核对与不生效）、[`web/language-registry.ts`](../../../packages/neuro-book/src/plugins/markdown/web/language-registry.ts)（组成语言与撞名）
- 合同测试：[`web/syntaxes.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/syntaxes.test.ts)（真实插件宿主，输出 1、3–8 与验收 2、3）、[`web/components/late-dialect.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/late-dialect.dom.test.ts)（验收 1）、[`shared/word-count.test.ts`](../../../packages/neuro-book/src/plugins/markdown/shared/word-count.test.ts)（输出 9 与验收 4）
- Smoke：[`scripts/check-dist.ts`](../../../packages/neuro-book/scripts/check-dist.ts)（输出 2：生产构建的首屏检查）；运行中晚到的方言只有测试插件会产生，验收 1 由真实内核浏览器实例的组件测试运行，见“验收与 Smoke”
