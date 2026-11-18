---
标签: [state:local, state:inject]
别名: ["Markdown 展示器", "Markdown Display"]
---

# MarkdownDisplay

把一段 Markdown 显示成只读的排版结果，按 NeuroBook 的方言读，外观与 Markdown 编辑器一致；给 Agent 的流式输出用，长对话里也要快。行为合同是 [ui.markdown-display](../../../../docs/specs/ui/markdown-display.md)，这里只写组件的属性与样子。

## 布局

- 一块正文，没有外框、没有内边距、没有背景；撑满给它的宽度，高度随内容。
- 排版是对话里的正文：13px、行高 1.7、块间距 8px；方言元素（批注、注音、提示块、原样内容、引用小块、图片）与编辑器同一份样式（`markdown.css`）。所在位置可以在根元素上改 `--markdown-font-size`、`--markdown-line-height`、`--markdown-block-gap`。
- 流式时最后一段末尾有一个闪烁的光标；减少动效时不闪。
- 根元素带 `content-visibility: auto`：看不见时不参与排版，记住上一次的高度。
- 390px 窄屏下只是行更短；表格与代码块在自己内部横向滚动。

## 交互

- 文字可以选中复制。
- 点引用小块、外部链接、图片发出 `activate`，不自己跳转。提示块的标题点了折叠或展开；可渲染 HTML 点“渲染”后在沙箱里显示。

## 数据

```ts
interface MarkdownDisplayProps {
    /** 必填：Markdown 原文。 */
    text: string;
    /** 界面语言：只在上面没有注入翻译端口时起作用；缺省 zh-CN。 */
    locale?: MarkdownLocale;
    /** 正在流式生成；默认 false。 */
    streaming?: boolean;
    /** 图片地址到可显示地址的换算；默认没有（图片显示说明）。 */
    resolveAsset?: (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;
}

type MarkdownDisplayActivation =
    | {kind: "reference"; target: string}
    | {kind: "link"; href: string}
    | {kind: "image"; address: string};

interface MarkdownDisplayEmits {
    (e: "activate", activation: MarkdownDisplayActivation): void;
}
```

没有 slot 与 expose。根元素带 `data-markdown-display`；未声明的 attribute 落到根元素上。

## 注意事项

- 语言、链接的目标分类、诊断出口、图片的说明与表情目录（`stickers`）来自宿主（`useMarkdownHost`，宿主在祖先上 `provideMarkdownHost`）；没有提供时是内置方言加核心语法、只认外部链接、诊断丢掉。挂上时取定语言（[workspace.markdown-syntaxes](../../../../docs/specs/workspace/markdown-syntaxes.md) 输出 7）。neuro-book 经 `nbook.markdown` 交出时包了一层 `MarkdownHosted`，给的是作品文件的分类与方言目录组成的语言。
- 界面文字读宿主注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`，宿主要登记本包的目录 `@notnotype/nb-markdown/locales`），语言以端口为准；上面没有注入时按 `locale`（缺省 zh-CN）建缺省端口，提供给子组件与嵌套的 nb-ui 控件（[README](../../README.md#界面文字)）。静态视图里的图片经 `markdownViewContext` 读到同一个端口，端口换语言时不重挂就换文字；小块的悬停提示与 HTML 卡片的按钮是画在普通 DOM 上的字符串，换语言时展示器整篇重画一次，提示块与 HTML 卡片的展开状态随之回到初始。
- 内部状态（提示块的折叠、`<html>` 块渲染与否）只在内存里，块被替换或卸载就没了。
