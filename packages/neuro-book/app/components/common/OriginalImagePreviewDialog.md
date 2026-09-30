---
标签: [state:local, state:inject, env:portal, env:global, io:read]
验证入口: AgentSidebarView
---

# OriginalImagePreviewDialog

共享原图预览对话框：按受控的开合状态加载并显示完整图片，提供关闭、失败重试与下载原件入口。它把缩略图列表里的原图读取延后到用户打开预览时，避免缩略图浏览提前加载原图。

## 布局与交互

对话框由图片区域与底部信息栏组成。图片区域至少 260px 高（`sm` 屏幕起 420px），占据可用剩余高度并自行滚动；图片按原比例完整收进区域。底栏显示 `alt` 文本与下载按钮。底层 nb-ui `Dialog` 使用 `xl` 尺寸，在窄屏把宽度收敛到窗口内，并管理模态焦点、Escape 与遮罩关闭。

打开后显示加载指示并挂载 `<img>`；加载成功后只移除指示，失败时显示错误提示和重试按钮。重试会给同一 `src` 增加 `previewRetry` 查询参数以绕开浏览器缓存。下载链接始终指向原始 `src`。关闭只请求父级把 `modelValue` 设为 `false`；Dialog 将焦点还给打开前的元素。本文不承诺 nb-ui Dialog 之外的浏览器图片加载时序。

## 数据

```ts
interface OriginalImagePreviewDialogProps {
    /** 是否打开；必填、受控。 */
    modelValue: boolean;
    /** 图片读取地址；必填。打开时由浏览器读取该资源。 */
    src: string;
    /** 图片替代文字，同时显示在底栏。必填。 */
    alt: string;
    /** 下载保存名称；可选，默认不指定名称。 */
    downloadName?: string;
    /** Dialog Teleport 目标；默认 ".novel-ide-theme"，传 false 关闭 Teleport。 */
    teleportTarget?: string | boolean;
}

interface OriginalImagePreviewDialogEmits {
    /** Dialog 请求开合状态变化时发出；父级负责回写受控值。 */
    (e: "update:modelValue", value: boolean): void;
}

type OriginalImagePreviewDialogSlots = {};
```

组件不向调用方透出插槽；Dialog 内部默认 body slot 未被本组件接线。组件不 expose 方法或属性；不承诺未声明 attrs 的稳定透传位置。

## 状态与边界

- 默认：`modelValue` 为 `false` 时不挂载图片，不发起图片读取。
- 加载中、成功、失败：状态保存在组件实例内；`modelValue` 或 `src` 改变时重置为加载中。
- 禁用、只读、空数据：没有统一 disabled/readonly 状态；空 `src` 不渲染图片，但对话框仍可打开并显示其加载状态。`alt` 是必填输入。
- 错误：错误态保留到重试、`src` 或开合状态变化；重试不会改写父级的 `src`。

不支持缩放、平移、裁剪、图片编辑或为调用方发起下载请求；下载通过原生链接交给浏览器。`src` 是资源地址而非预取结果，打开对话框和点击下载都会由浏览器读取该地址。

## 上游边界

nb-ui `Dialog` 提供模态语义、Portal、焦点陷阱、Escape/遮罩关闭和生命周期；本组件承诺图片预览区域、加载错误与重试、原图下载链接以及上述 props/emits。其余 Dialog 行为按 nb-ui 契约，未在此重复承诺。

## 隐藏通道理由

- `io:read`：打开时渲染带 `src` 的 `<img>`，由浏览器直接读取图片资源；下载链接也指向同一资源。预览读取与该组件的职责绑定，调用方只提供地址，不替代浏览器的图像解码与预览行为。
- `env:portal`：nb-ui Dialog 默认将模态层传送到 `.novel-ide-theme`，使预览脱离附件面板的裁剪上下文并继承 IDE 主题；目标不存在时 Dialog 按自身实现回退到 `body`。
- `env:global`：打开时所用的 nb-ui Dialog 管理 `document` 键盘监听与 body 滚动锁，并在关闭或卸载时清理、归还焦点。
- `state:inject`：使用应用 `useI18n()` 获取预览标题、加载失败、重试与下载文案，使它们跟随宿主语言；这些文案不逐项作为 props 暴露。
- `state:local`：持有图片加载状态与重试计数，关闭或卸载后不保留。

## 已知偏差

`验证入口` 指向 AgentSidebarView 的附件预览集成链，但当前 `AgentSidebarView` fixture 的 `images` 场景只准备静态附件数据，未自动打开附件面板或原图预览；宿主 fixture 仍需增加明确的预览场景并提供不会触发真实网络读取的静态 URL。入口可定位真实宿主链，不代表该 Lab 验收场景已完成。即使场景补齐，静态 URL 也只能验证宿主装配与预览状态，不验证真实附件服务的网络结果。
