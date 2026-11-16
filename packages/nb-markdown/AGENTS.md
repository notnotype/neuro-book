# nb-markdown 包入口

本包位于 `packages/nb-markdown`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-markdown` 是 Markdown 的语言、编解码器与组件：只读显示、行内小块、提示词编辑器，以及编辑器控件用的 TipTap 扩展。行为合同是 [`ui/markdown-display`](../../docs/specs/ui/markdown-display.md)、[`ui/prompt-editor`](../../docs/specs/ui/prompt-editor.md)、[`workspace/markdown-dialect`](../../docs/specs/workspace/markdown-dialect.md)；宿主怎么接入见 [README](README.md)。neuro-book 的插件 `nbook.markdown` 是它的一个宿主，方言的贡献、作品文件的目标解析与字数留在插件里。

## 边界

- 纯 TS 入口（`.`，`src/` 根上的文件）只引 `entities` 与 `@notnotype/nb-ui/text`（文字值的纯数据层，没有外部依赖、不引 Vue），对编辑内核只许 `import type`：后端的字数也用它，不能带进 DOM 与编辑内核。纯 TS 子路径 `./prompt-text`（`src/prompt/text.ts` 与它引到的 `prompt-text.ts`、`prompt-selection.ts`、`prompt-editor.types.ts`）守同样的规则，宿主服务端认 `$` 标签用它；这几份文件里不能引组件与编辑内核。
- 全包不引宿主的源码（`nbook/…`、跨包相对路径）与插件内核 `@notnotype/nb-runtime`；源码里 import 的第三方包都在 `package.json` 里声明。`src/boundary.test.ts` 读源码核对，新增文件同样受约束。
- 不认任何作品的文件方案：链接目标怎样归类由宿主给（`MarkdownTargets`），包里只有认外部链接的缺省规则。
- 界面文字在本包的目录（`src/locales/`，命名空间 `nb-markdown`），组件经 nb-ui 的翻译端口取（`src/host/text.ts`，取法见 [README](README.md#界面文字)）；纯 TS 入口不翻译 `TextRef`。改文字时同步改 `src/locales.test.ts` 的迁移对照表。

## 编辑器实例

一个编辑器实例换 `EditorState` 时插件视图会重建（`plugins` 数组换了，prosemirror-view 按数组身份判断），组件重挂时也一样，所以界面状态不放在插件视图里，也不在扩展配置里捕获组件的 DOM 或回调。

## ProseMirror 的几个坑

- `Mapping.appendMapping(mapping)` 把传入映射底下的全部 `maps` 追加进来，不管 `mapping.slice(from, to)` 切出的范围。想要“某一步之后的映射”，对切出的映射逐段 `map(pos, assoc)`，不要拼成一个新的 `Mapping`（w00025 t22：替换批注文字时补标记的位置被映射进了自己的替换范围，补的标记长度为零，继承悄悄没做，只有测试里的一个用例看得出来）。
- `Mark.isInSet(set)` 在集合里没有这个标记时返回的不是 `undefined`，与类型声明对不上，`!== undefined` 对空集合也成立。判断“在不在”用 `set.some((other) => mark.eq(other))`（同上：整句被换掉时该不该继承判反了）。

## 验证

```text
bun run typecheck   # 纯 TS 入口用不含 DOM 的 tsc，其余用 vue-tsc
bun run test        # bun test，加 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的显示、编辑与按键在应用 Component Lab 的场景与 `packages/neuro-book/e2e/` 的 Playwright 用例里。
