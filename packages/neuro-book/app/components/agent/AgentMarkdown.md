---
标签: []
别名: ["Markdown 正文", "回复正文"]
---

# Agent Markdown 正文

对话视图里 Agent 回复正文、过程中的说明文字与思考全文的渲染与排版：把 Markdown 转成 HTML，经调用方提供的消毒函数处理后插入页面。没有消毒函数时按纯文本显示、不插入任何 HTML，所以它不会因为缺少依赖而引入注入风险。排版按界面字号 13px、行高 1.7，列表、引用、代码块与标题都收在对话宽度内。所在位置可用 `--acv-markdown-color` 与 `--acv-markdown-size` 改正文颜色和字号，思考全文用它显示为淡色 12px。

## 数据

```ts
type AgentMarkdownProps = {
    /** Markdown 原文，必填；流式生成中未闭合的代码块会先补齐再渲染。 */
    text: string;
    /** HTML 消毒函数；缺省时按纯文本显示。 */
    sanitizeHtml?: (html: string) => string;
    /** 正在流式生成；为 true 时在最后一段末尾显示闪烁的光标（减少动效时不闪）。默认 false。 */
    streaming?: boolean;
};
```

没有事件、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
