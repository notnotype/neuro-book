---
标签: [state:local]
---

# EditorSettingsView

「编辑器」区段的受控视图，两块：Markdown 富文本（正文字体、字号、行高、正文宽度、段首缩进）与源码 Monaco（字体、字号、行高、Tab Size、自动换行、缩略图、行号、空白字符），每块各有一个「重置」。视图只消费 props 并通过 `update:markdown` / `update:monaco` 交回宿主，重置只发 `reset` 事件（`"markdown"` / `"monaco"`），宿主自己决定重置成什么；视图不读 store、不写 localStorage、不直接触碰编辑器。旧宿主 `NovelIdeSettingsDialog` 继续把偏好写进 novel-ide store 的 `novel.ide.local`，产品接线时再消费本视图。

数值字段的区间、步长与字体候选在 `editor/editor-prefs.ts`，视图与宿主共用：`MARKDOWN_NUMBER_LIMITS` / `MONACO_NUMBER_LIMITS` 既是控件上 `min` / `max` / `step` 的唯一来源，也是夹紧的唯一来源；`clampEditorNumber` / `clampMonacoNumber` 在空串与非数字时返回 `null`（调用方不写回），越界夹到区间内。旧宿主在这里把空串当成 0 再夹紧，会把区间下限悄悄写进配置，本视图不再复刻这一行为。

Component Lab 中由 `EditorSettingsViewFixture` 提供确定性场景（default / custom / indent-off / boundary）。

## 契约

```ts
type Props = {
    markdown: MarkdownEditorPreferences;   // fontFamily, fontSize, lineHeight, contentWidth, paragraphIndentEnabled, paragraphIndentEm
    monaco: MonacoEditorPreferences;       // fontFamily, fontSize, lineHeight, tabSize, wordWrap, minimapEnabled, lineNumbers, renderWhitespace
    disabled?: boolean;
};

type Emits = {
    (event: "update:markdown", value: MarkdownEditorPreferences): void;
    (event: "update:monaco", value: MonacoEditorPreferences): void;
    (event: "reset", target: "markdown" | "monaco"): void;
};
```

字体是自由文本加候选联想：候选只提供常见字体族，用户可以输入任意 CSS `font-family`。段首缩进开关关闭时，缩进量输入框保持可见但禁用（`disabled`），不隐藏——否则关闭后无法预知缩进量还在不在。

## 布局规则

与设置外壳同源：不画卡片面，两块之间用 1px `--divider` 横线分段，块内字段之间不再画线。字段一律「标签在上、控件在下」，短字段并排与否由视图自身的容器宽度（`@container min-width: 620px`）决定，不看窗口宽度；字体与开关行占满整行。开关行整行可点（标题与说明都在标签里），缩进量输入框跟在开关下方。视图自身不滚动（宿主负责滚动）。
