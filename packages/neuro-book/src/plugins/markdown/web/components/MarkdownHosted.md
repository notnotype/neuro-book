---
标签: [state:inject]
验证入口: MarkdownDisplay
---

# MarkdownHosted

`nbook.markdown` 交出 nb-markdown 组件时套的一层（服务 `markdownKey` 的 `MarkdownDisplay`、`MarkdownImage`、`InlineChip`、`PromptEditor`、`PromptTextView`）。它不画任何东西：给子树提供 nbook 的宿主（`provideMarkdownHost`），再按 `component` 挂对应的组件，其余属性、事件与插槽原样转过去，外露方法也转出去（对话视图的输入框在交出的 PromptEditor 上调 `focus`、`insertText`）。

## 宿主

- 链接目标按作品文件分类：作品里的文件与用户资产是文件小块（`data-reference-link` 为 `work`、`user`），`session://attachments/` 是附件（[`workspace/markdown-dialect`](../../../../../../../docs/specs/workspace/markdown-dialect.md) 输出 27）；文件图标按文件名取。
- 展示器的语言由方言目录组成（[`workspace/markdown-syntaxes`](../../../../../../../docs/specs/workspace/markdown-syntaxes.md) 输出 7）；别的组件不用语言。
- 诊断落到插件交给它的诊断出口；图片不显示时写明“不在作品里”。
- `InlineChip` 与 `MarkdownImage` 的宿主信息只收属性：小块的分类与图标经 `env` 给，图片的“不在作品里”经 `missing` 给（`nbook.markdown` 目录里的键），不读 `provideMarkdownHost`。界面文字所有组件都经窗口注入的翻译端口取（[`ui/i18n`](../../../../../../../docs/specs/ui/i18n.md)），窗口登记了 nb-markdown 与 `nbook.markdown` 的目录。

## 数据

```ts
props: {component: "MarkdownDisplay" | "MarkdownImage" | "InlineChip" | "PromptEditor" | "PromptTextView"}
// 其余属性、事件与插槽转给 component 指定的组件
```

从祖先 inject 插件交的方言目录（`syntaxCatalogKey`）与诊断出口（`markdownReportKey`），都可以没有（Lab 与测试）：没有方言目录时语言是内置方言加核心语法，没有诊断出口时诊断丢掉。

包组件的异步包装在模块里建一次，所有实例共用；代码加载失败时记 `markdown.component.load-failed`，展示器按纯文字显示原文。

插件入口只按 `.vue` 引它，宿主接线与包都在按需加载的 chunk 里：插件入口的引用链要让后端的类型检查看得懂、首屏不带编辑内核与解析器（[`workspace/markdown-syntaxes`](../../../../../../../docs/specs/workspace/markdown-syntaxes.md) 输出 2）。
