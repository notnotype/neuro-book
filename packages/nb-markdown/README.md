# @notnotype/nb-markdown

Markdown 的语言、编解码器与组件。行为合同见 [`ui/markdown-display`](../../docs/specs/ui/markdown-display.md)、[`ui/prompt-editor`](../../docs/specs/ui/prompt-editor.md)、[`workspace/markdown-dialect`](../../docs/specs/workspace/markdown-dialect.md)，包的约定见 [AGENTS.md](AGENTS.md)。

| 入口 | 内容 |
|---|---|
| `@notnotype/nb-markdown` | 纯 TS，后端也能用：方言常量、链接词法、链接目标的分类接口与缺省规则（`classifyScheme`）、一种语法占用的名字（`namesOf`）、界面语言 |
| `./language` | Markdown 语言与编解码器：`createMarkdownLanguage`、内置语法模块（`builtinSyntaxes`、`coreSyntax`）、`defaultMarkdownLanguage`、`codecFor`；贡献方言要按着写的 `MarkdownSyntax` 与标签扫描工具 |
| `./language/types` | 只有 `MarkdownSyntax` 等类型，不带 DOM：后端类型检查也会读到的代码按类型引这里 |
| `./host` | 宿主接口 `MarkdownHost`、`provideMarkdownHost`、`useMarkdownHost`；取界面文字的 `useMarkdownText`、`provideMarkdownText` 与给 `render()` 挂载用的 `markdownViewContext` |
| `./display` | 只读显示 `MarkdownDisplay`、图片 `MarkdownImage` |
| `./chip` | 行内小块 `InlineChip` 与它的外观判断 |
| `./prompt` | 写给 Agent 的编辑组件 `PromptEditor`、已发送文字的显示 `PromptTextView`，以及拼引用写法的 `promptReferenceText`（目标分类必填） |
| `./prompt-text` | 纯 TS，不引 DOM：`promptSkillTokens` 按编辑器的规则取出提示词里的技能标签，给宿主服务端用 |
| `./editor` | 富文本编辑器的扩展组（编辑器实例与文档绑定归宿主） |
| `./markdown.css` | 正文与方言元素的样式（展示器自己带上；宿主的编辑器控件导入它） |
| `./locales` | 本包的消息目录（命名空间 `nb-markdown`，中英两份）：宿主把它登记进自己的翻译引擎 |
| `./lab-sources` | 只给应用的 Component Lab 建组件索引 |
| `./tailwind.css` | 让宿主的 Tailwind 扫到本包的图标类名 |

## 界面文字

组件的文字在本包的目录里（`@notnotype/nb-markdown/locales`，命名空间 `nb-markdown`，源语言 zh-CN），经 nb-ui 的翻译端口（`TEXT_PORT_KEY`，[`ui/i18n`](../../docs/specs/ui/i18n.md)）取：

1. **宿主注入了端口**：语言以端口为准，根组件（`MarkdownDisplay`、`PromptEditor`、`PromptTextView`）的 `locale` 属性不起作用。宿主要把本包的目录登记进端口背后的翻译引擎，否则显示键名：

   ```ts
   import {NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE} from "@notnotype/nb-markdown/locales";

   engine.register(NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_CATALOGS, "zh-CN");
   ```

2. **没有注入**：根组件按自己的 `locale`（缺省 zh-CN）建 nb-ui 的缺省端口（所有已导入共享包登记的目录，最小实现），提供给子组件与嵌套的 nb-ui 控件。本包的组件嵌在别的共享包的根组件下面时（对话视图里的展示器），读到外层建的缺省端口，同样翻得出本包的键。
3. **零件单独挂载、上面也没有注入**（`InlineChip`、`MarkdownImage`、附件条、粘贴块外框）：用缺省端口，语言 zh-CN。

展示器的静态视图与编辑器的节点视图用 Vue 的 `render()` 把图片挂到普通 DOM 上，挂上的组件没有父组件。建视图的组件在 `setup` 里用 `markdownViewContext()` 取一个带着端口的应用上下文交给视图，端口换语言时图片不重挂就换文字。宿主自己建编辑器时同样在控件的 `setup` 里取，经 `MarkdownViewHost.context` 给扩展组；不给时用缺省端口。普通 DOM 上画的文字（小块的悬停提示、HTML 卡片的按钮）是画的时候取的字符串：换语言时展示器整篇重画一次，编辑器里的引用小块要宿主的控件发一次 `REFRESH_REFERENCE_LINKS`（neuro-book 的 `MarkdownControl` 这样做）。

## 安装

```bash
bun add @notnotype/nb-markdown
```

只支持 Bun。包里是 TypeScript 与 `.vue` 源码，不带编译产物，由宿主的 Vite 与 Tailwind v4 编译（[ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)、[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。peer 依赖 `vue` 与 `typescript`（编译单文件组件时解析导入的 props 类型要用），Bun 安装时会自动装上；宿主另装 `vite`、`@vitejs/plugin-vue`、`tailwindcss` 与 `@tailwindcss/vite`。许可证 AGPL-3.0-only。

## 宿主接入

1. **依赖**：`vue` 是 peer 依赖，其余随包安装。
2. **样式**：宿主自己编译 Tailwind，在 nb-ui 之后导入本包的入口，图标类名才会生成：

   ```css
   @import "@notnotype/nb-ui/tailwind.css";
   @import "@notnotype/nb-markdown/tailwind.css";
   ```

3. **宿主**：组件从祖先拿语言、链接目标的分类、文件图标与诊断出口。什么都不提供也能用：内置方言加核心语法；只认 `http`、`https`、`mailto` 为外部链接，别的方案（例如 `paragraph://41.20`）显示成引用小块，点击发出 `{kind: "reference", target}`。要换的时候在组件的祖先上提供：

   ```ts
   import {provideMarkdownHost} from "@notnotype/nb-markdown/host";

   // 没给的项用缺省值；嵌套提供时里层不继承外层，是在缺省值上覆盖。
   provideMarkdownHost({
       chips: {targets: myTargets, fileIcon: (name) => ({className: "i-lucide-file"})},   // 目标分类与文件图标
       report: (event, message, error) => console.warn(event, message, error),
   });
   ```

   - `targets.classify(target, base)` 把链接目标分成 `file`、`attachment`、`external`、`other`，可带细分 `variant`（写进 `data-reference-link` 与色调类）；`encodeFile(target)` 对任何目标调用，属于文件的把 `%`、`#`、`?` 百分号编码，别的原样返回。
   - `language()` 在组件挂上时取一次，之后不换；宿主有自己的方言时给它（`createMarkdownLanguage([...方言, ...builtinSyntaxes().map((entry) => entry.syntax), coreSyntax])`，方言按 `order` 插在内置之间）。
   - `InlineChip` 不读宿主，分类与图标经它的 `env` 属性给；`MarkdownImage` 也不读宿主（它会被挂到普通 DOM 上，挂的时候只带着翻译端口），不显示时的说明经 `missing` 给，可以是宿主目录里的键（`TextRef`，组件补上 `name` 参数）。两者的界面文字照样读翻译端口，见下面的“界面文字”。

4. **接到 nb-agent-ui**：对话视图的 `renderers` 直接给本包的组件，组件满足 nb-agent-ui 的端口（`src/prompt/agent-ports.typecheck.ts` 核对）：

   ```ts
   import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
   import {PromptEditor, PromptTextView} from "@notnotype/nb-markdown/prompt";

   const renderers = {markdown: MarkdownDisplay, promptEditor: PromptEditor, promptTextView: PromptTextView};
   ```

   宿主提供宿主接口的那个祖先要包住对话视图。对话视图上面没有注入翻译端口时，它按自己的 `locale` 建 nb-agent-ui 的缺省端口给子树，那里没有本包的目录，里面的输入框会显示键名；所以宿主要在对话视图之上注入一个登记了本包目录的端口（见下面的“界面文字”）。

5. **只认链接**：正文里的“41.20”这类出处要宿主先改写成链接（`[41.20](paragraph://41.20)`），本包不认纯文字的出处。
6. **Vite**：本包的第三方依赖（marked、TipTap、entities）都是 ES 模块，关掉依赖自动发现（`optimizeDeps.noDiscovery`）的宿主不必把它们列进预构建清单，按源码提供即可（neuro-book 就是这样，它清单里的 `marked` 是给别的组件的）。
7. **按需加载**：编辑内核与解析器较大，宿主按组件 `import()` 入口（`./display`、`./prompt`），不放进首屏。neuro-book 的做法见 `packages/neuro-book/src/plugins/markdown/web/components/MarkdownHosted.vue`。
