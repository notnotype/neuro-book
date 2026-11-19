---
标签: [state:local, state:inject, env:portal, env:clipboard]
别名: ["原图预览", "大图预览", "Image Preview"]
---

# ImagePreviewDialog

看一张图的大图：对话里点附件图片、回复里的 Markdown 图片，以及对话、编辑器、表情选择器里点表情，都打开这同一种对话框。它是受控的：谁要预览，谁在自己的位置挂一份、管 `open`。图片只在打开时读取，所以缩略图列表不会提前请求原图。

## 布局与交互

对话框是一张贴着图片的卡片，不是固定尺寸的大框：

- **头部**一行：标题是 `alt`（过长截断，悬停看全文）；右侧是可选的复制按钮（给了 `copyText` 时）、“下载原图”与“关闭”，都是 32px 的图标按钮。没有页脚。卡片最窄 240px，放得下标题与三个按钮。
- **图片**：按原始尺寸显示；长边不到 `minSize` 的放大到 `minSize`（浏览器平滑插值）。超出可用空间时等比缩小，整张收进卡片，不留上下或左右的空边。可用空间是浮层宿主扣掉四周 16px、卡片自己的头部与留白；宿主大小变化（窗口缩放、Lab 画布拖动）时重新计算。图片圆角，底下垫一层浅底，透明图片的空白处看得出边界。
- **加载中**：尺寸未知时卡片先占 320×200（放不下时收窄），中间转圈；加载完成后换成图片的尺寸。
- **失败**：同样大小的区域里显示图标、“原图加载失败”与“重试”。重试给同一 `src` 加查询参数 `previewRetry` 绕开浏览器缓存；`blob:`、`data:` 地址不加参数，只换一个图片元素重新读。
- **复制**：[`CopyButton`](../controls/CopyButton.md) 的只画图标的样子，复制 `copyText`；“已复制”“复制失败”换图标与悬停提示，按钮不变宽。
- 下载链接始终指向原始 `src`。关闭（按钮、Escape、点遮罩）只请求父级把 `open` 设为 `false`；模态焦点、Escape、遮罩关闭与焦点归还由 [`Dialog`](Dialog.md) 管。
- `390×844` 下卡片收窄到宿主宽度减去两侧 16px，图片随之缩小。

不支持缩放、平移、裁剪与编辑；下载交给浏览器的原生链接。

## 数据

```ts
interface ImagePreviewDialogProps {
    /** 是否打开；必填、受控。 */
    open: boolean;
    /** 图片读取地址；必填。打开时由浏览器读取。 */
    src: string;
    /** 替代文字，同时是对话框标题；必填。 */
    alt: string;
    /** 下载保存的名字；缺省不指定，由浏览器决定。 */
    downloadName?: string;
    /** 长边不到它的图放大到它（仍受可用空间限制）；缺省 0，只缩小不放大。 */
    minSize?: number;
    /** 给了就在头部放复制按钮，复制这段文字。 */
    copyText?: string;
    /** 复制按钮的悬停提示与可访问名称；缺省取 CopyButton 的“复制”。 */
    copyLabel?: string;
    /** 传送目标；缺省同 Dialog（宿主注入的目标，没有时 `body`），`false` 就地渲染。 */
    teleportTarget?: string | false;
}

interface ImagePreviewDialogEmits {
    (e: "update:open", value: boolean): void;
}
```

没有插槽与 `expose`；复制按钮带 `data-image-preview-copy`，供测试定位。

## 状态与边界

- `open` 为 `false` 时不挂载图片，不发起读取。
- 加载中、成功、失败的状态在组件里；`open` 或 `src` 变了回到加载中。失败态保留到重试、`src` 或开合变化；重试不改父级的 `src`。
- 空 `src` 不渲染图片，对话框照样能打开、显示加载中。

## 隐藏通道理由

不标 `io:read`：图片由浏览器按调用方给的 `src` 读取，组件自己不发请求，读什么完全由调用方决定（同 [`MarkdownImage`](../../../../nb-markdown/src/display/MarkdownImage.md)），所以在 Lab 里能用 `data:` 地址挂载。

- `env:portal`：Dialog 把模态层传送到目标，脱离消息流与编辑器的裁剪。
- `env:clipboard`：复制按钮写系统剪贴板（经 CopyButton）。
- `state:inject`：关闭、下载、加载中、加载失败与重试的文案取自 nb-ui 的翻译端口（目录键 `imagePreviewDialog.*`）。
- `state:local`：图片加载状态、重试计数与按可用空间算出的显示尺寸。显示尺寸要读浮层宿主（Dialog 面板的父元素）的大小，并用 `ResizeObserver` 跟随；纯 CSS 做不到既按宿主高度等比缩小、又让卡片贴着图片。
