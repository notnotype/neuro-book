---
标签: [state:local, state:inject, env:clipboard, env:timer]
别名: ["复制按钮", "Copy Button"]
---

# CopyButton

把一段给定的文字复制到系统剪贴板的小按钮，带“已复制”“复制失败”的回执。它放在原文旁边（例如 `DetailDialog` 的页脚），复制的总是调用方传入的完整文字，不是屏幕上被截断或滚出视野的那部分。与自己调 `navigator.clipboard` 的按钮不同，它在非安全上下文（`http://` 局域网地址）里还有一条退路，两条路都不通时才如实说失败。

## 布局

一个 `Button`（`ghost`、`sm`）带图标与文字，宽度随文字；状态变化只换图标与文字，按钮高度不变。`iconOnly` 时是一个 `IconButton`（32px），只有图标，文字（“复制”或 `label`、“已复制”、“复制失败，请手动选择文字”）改作悬停提示与可访问名称，按钮不变宽；用在放不下文字的头部（例如 [`ImagePreviewDialog`](../feedback/ImagePreviewDialog.md)）。窄屏同一结构。旁边有一个视觉上隐藏的 `role="status"` 区域，状态变化时读屏会播报“已复制”或“复制失败”。

## 交互

- 点按钮：先用 `navigator.clipboard.writeText`；这个 API 不存在（非安全上下文）或被拒（权限）时，退到组件自己的一个不可见 `<textarea>` 加 `document.execCommand("copy")`；两条都失败才进入“复制失败”。
- 成功后显示对勾与“已复制”，`resetAfter` 毫秒后回到“复制”；失败显示警示图标与“复制失败，请手动选择文字”，同样到时回到“复制”。复制进行中再点一次，以最后一次的结果为准。
- 没有剪贴板 API 时，退路在点击的同一个任务里执行（Safari 要求 `execCommand` 在用户手势之内）；剪贴板 API 被拒时只能在它 reject 之后再退。
- 键盘：原生按钮，Enter、Space 触发。退路用的 `<textarea>` 会短暂取得焦点；按钮原本有焦点时复制后交还，并保持原来画不画焦点环（鼠标点的不画）；组件不在别处移动焦点。

## 数据

```ts
export type CopyButtonState = "idle" | "copied" | "failed";

type CopyButtonProps = {
    /** 要复制的完整文字，必填。 */
    text: string;
    /** “已复制”“复制失败”保持多久（毫秒）后回到 idle；默认 1500。 */
    resetAfter?: number;
    /** 按钮文字；默认取文字端口的“复制”。 */
    label?: string;
    /** 只画图标，文字改作悬停提示与可访问名称；默认 false。 */
    iconOnly?: boolean;
};
```

没有 emits、插槽和 expose。当前状态写在根节点的 `data-copy-state`（`idle`、`copied`、`failed`），供测试与外层样式读取。未声明的 attribute、`class` 与 `style` 落到根节点（包住按钮与播报区的 `span`）。

## 状态

- `idle`：复制图标与“复制”（或 `label`）。
- `copied`：对勾、成功色文字“已复制”。
- `failed`：警示图标、危险色文字“复制失败，请手动选择文字”。按钮可以再点。
- 没有禁用、加载态；`text` 为空串时照样复制空串。

## 不支持

- 不复制富文本或图片，只写 `text/plain`。
- 不读剪贴板。
- 不提供“选中原文让用户自己按快捷键”的退路：那要监听全局选区变化，快捷键也随平台不同；原文所在的组件本身可以选中文字，失败文案提示用户手动选择。

## 注意事项

- 退路的 `<textarea>` 挂在组件自己的根节点里，不挂到 `document.body`：组件常在模态对话框里，对话框的焦点陷阱会把焦点从对话框外的元素拽回去，`execCommand` 随之失败。
- `execCommand("copy")` 已被标为弃用，但它是非安全上下文里唯一的一键复制方式；浏览器去掉它之后，这条退路自然落到“复制失败”。
- 组件卸载后，还没完成的复制不再改状态，复位计时器随卸载清掉。

## 隐藏通道理由

- `env:clipboard`：复制就是这个组件的全部职责。若改成发事件让宿主去写剪贴板，每个放原文的地方都要各写一遍两条路径与回执，而回执的状态又要传回来，组件就只剩一个外观；所以写剪贴板留在组件里。
- `env:timer`：回执到时回到 `idle`。计时器只在组件里，卸载时清掉。
- `state:inject`（翻译端口）：经 `useUiText()` 取“复制”“已复制”“复制失败，请手动选择文字”，语言跟着端口走；没有宿主时用 nb-ui 的缺省端口。调用方传 `label` 时只覆盖 idle 的文字。
- `state:local`：当前回执状态。
