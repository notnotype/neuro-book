---
标签: [state:inject, env:portal, env:global, env:clipboard, env:timer]
别名: ["详情对话框", "诊断详情", "Detail Dialog"]
---

# DetailDialog

显示一段开发诊断原文的模态对话框：标题写是哪件事的详情，正文是一块等宽原文加“复制”，页脚只有“关闭”。界面上放不下原文的地方（通知、状态栏条目、失败提示）都点开这同一个对话框，所以全应用只有一种“详情”。它是受控的、没有自己的状态：谁要显示详情，谁在自己的位置挂一份、自己管 `open`；`NotificationStack` 里就挂着一份。

原文不翻译（[ADR 0034](../../../../../docs/adr/0034-language-policy.md) 的“开发诊断不本地化”），标题与按钮跟着界面语言。

## 布局

`Dialog` 的 `md` 档（宽 `min(560px, 100% - 32px)`）。正文是一块 `CodeBlock`：标题行左边写“诊断原文”，右边是 `CopyButton`；下面是原文，等宽、`--text-xs` 字号，按换行拆行（CRLF、LF、单独的 CR 都算），长行不折行、在块内横向滚动。块的最大高度按对话框剩下的高度算，超出时只有块内这一层纵向滚动，复制按钮始终在块顶看得见。原文被发出方截断过时，块底一行淡色“原文过长，已截断”。页脚只有次级按钮“关闭”，靠右。

`390×844` 下左右各留 16px，结构不变。

## 交互

- 打开时焦点落在正文容器（不在复制按钮上，免得一打开就画出焦点光晕）；Tab 依次到复制、关闭。关闭后焦点交还打开前的元素（`Dialog` 的行为）；打开它的按钮已经不在时，由挂它的一方决定焦点去哪（见 `NotificationStack`）。
- Escape、点遮罩、点“关闭”都关闭：发 `update:open(false)`。
- 复制的总是完整原文（含被横向滚出视野的部分），回执见 `CopyButton`。原文也可以直接用鼠标选中复制。

## 数据

```ts
type DetailDialogProps = {
    /** 是否打开；必填、受控。 */
    open: boolean;
    /** 标题，已是当前语言的字符串；调用方按当前语言算出，所以切换语言时跟着变。必填。 */
    title: string;
    /** 诊断原文；必填。按换行拆成行显示，复制时原样复制。 */
    detail: string;
    /** 原文已被截断：块底显示“原文过长，已截断”。默认 false。 */
    truncated?: boolean;
};

type DetailDialogEmits = {
    /** Escape、点遮罩、点“关闭”时发 false。 */
    (event: "update:open", value: boolean): void;
    /** 关闭完成：内容已卸载、`Dialog` 已把焦点交还打开前的元素。要把焦点放到别处的调用方在这之后放。 */
    (event: "closed"): void;
};
```

没有插槽和 expose。未声明的 attribute 不透传（根是 `Dialog`，传送到 body）。

## 不支持

- 不做脱敏：传进来的原文必须已经脱敏，复制会把它原样交给系统剪贴板。
- 不做语法高亮，不渲染 Markdown。
- 不翻译原文。
- 同一个实例不同时显示两段详情；要换内容由调用方换属性。

## 隐藏通道理由

- `state:inject`（翻译端口）：“诊断原文”“关闭”“原文过长，已截断”经 `useUiText()` 取，随端口语言变；没有宿主时用 nb-ui 的缺省端口。
- `env:portal`、`env:global`：来自内部的 `Dialog`（传送到 body、Escape 与焦点锁定），理由见 [`Dialog.md`](Dialog.md)。
- `env:clipboard`、`env:timer`：来自内部的 `CopyButton`，理由见 [`CopyButton.md`](../controls/CopyButton.md)。
