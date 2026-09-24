---
标签: [state:local, env:timer]
别名: ["纯文本引用编辑器"]
---

# ReferencePlainTextEditor

一个"纯文本 + 引用标记"的输入框：正文就是普通文字，但 `@`/`/` 触发的菜单会把选中的引用、技能、命令变成一枚内联 chip，图片也以标记而不是缩略图的形式留在正文里。它的价值在于**文本是唯一真相**——内容的序列化结果永远是一段可读文本，渲染成什么、图片怎么上传由宿主决定。

和 `StructuredTextEditor`（管 Markdown 结构与格式工具栏）的区别是它不提供任何格式命令、没有富文本语义；和普通 `<textarea>` 的区别是它有 chip、触发菜单、图片占位节点，并且会随内容自动长高。

## 布局

竖向两层：外框（圆角、描边、背景，`borderless` 时可去掉并改由外部结构接管圆角）与可滚动的正文区。正文区高度**随内容自动测量**，被 `minHeight` 与 `maxHeight` 夹住：内容不超过下限就保持下限，超过上限后不再增高、改为正文区内部滚动。`expanded` 会把下限抬到不低于 220px、上限抬到不低于 420px，用于展开态的输入框。

正文里的引用与图片是行内标记：引用是带底色的小 chip，图片标记显示文件名/标签，未完成的图片显示上传中或失败（失败用危险色并提供重试与移除两个动作）。

正文之外的触发菜单浮层不在本组件的 DOM 树里——它由子组件 `ReferenceSelectorPopover` 渲染（见「隐藏通道理由」）。

窄屏下结构不变，只是正文更早触到高度上限并开始内部滚动。

## 交互

- **输入即上报**：每次编辑后发出 `update:modelValue`，携带序列化后的完整文本；父组件把 `modelValue` 换成另一段内容时，正文整体替换、滚动回到顶部，并且**不会**再回发一次（不构成回声）。
- **点击正文空白处**：把光标移到末尾并聚焦；点在已有内容上保留编辑器自己的落点；点在正文内的按钮、链接、输入控件上则不动光标。
- **回车**：`submitOnEnter` 为真时回车提交（不换行），Shift+回车始终换行；`submitOnModifierEnter` 为真时 Ctrl/Meta+回车提交。触发菜单打开期间回车不提交，交给菜单选中；输入法组合态中的回车交回编辑器，不会误提交。
- **Shift+Tab** 发出 `shift-tab`（宿主据此把焦点移回上层控件）；组件不自己移动焦点。
- **触发菜单**（`enableQuickTriggers` 且 `resolveMenu` 返回非空时打开）：上下方向键在可选项之间移动高亮（跳过禁用项），回车或 Tab 选中当前高亮项，Escape 关闭菜单。这些按键由编辑器的触发插件处理，浮层只显示与回报。
- **粘贴**：图片文件在允许时变成"待上传"标记并发 `image-files`，禁用图片能力或只读时改发 `image-files-blocked` 并且不插入内容；纯文本按原样插入，命中引用语法的片段变成 chip。
- **拖入图片文件**：发出 `image-files` 并带上落点位置；同样受只读与 `enableImageFiles` 限制。
- **只读**：正文完全不可编辑，按下粘贴也不会插入内容（只读下粘贴被直接拦下），`aria-readonly` 为真；聚焦、光标与菜单都不会启动。

可访问性：编辑区是 `role="textbox"`、`aria-multiline="true"`，可访问名称取 `ariaLabel`，为空时退回 `placeholder`。

## 数据

```ts
interface ReferencePlainTextEditorProps {
    /** 内容文本（含引用与图片标记的序列化形式）；必填、受控 */
    modelValue: string;
    /** 空正文的占位提示，同时是可访问名称的兜底；默认空字符串 */
    placeholder?: string;
    /** 编辑区的可访问名称；默认空字符串 */
    ariaLabel?: string;
    /** 最小高度（px）；默认 36；expanded 时抬到不低于 220 */
    minHeight?: number;
    /** 最大高度（px）；默认 150；expanded 时抬到不低于 420 */
    maxHeight?: number;
    /** 展开态；默认 false */
    expanded?: boolean;
    /** 只读；默认 false */
    readonly?: boolean;
    /** 去掉外框与阴影，圆角交给外层结构（composer 里用）；默认 false */
    borderless?: boolean;
    /** 回车提交；默认 false */
    submitOnEnter?: boolean;
    /** Ctrl/Meta+回车提交；默认 false */
    submitOnModifierEnter?: boolean;
    /** 允许 `@`/`/` 这类快速触发；默认 false */
    enableQuickTriggers?: boolean;
    /** 触发菜单宽度对齐编辑框；默认 false */
    matchPopoverWidth?: boolean;
    /** 变化时重新解析当前打开的菜单（数据加载完后刷新用）；默认空字符串 */
    menuRefreshKey?: string | number;
    /** 解析触发菜单的内容；默认返回空菜单（即不显示菜单） */
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 技能类触发菜单首次出现时回调一次；默认空函数 */
    onSkillTriggerStart?: () => void;
    /** 允许粘贴与拖入图片文件；默认 false */
    enableImageFiles?: boolean;
}

interface ReferencePlainTextEditorEmits {
    /** 编辑后发出序列化后的完整文本；外部替换内容不回发 */
    (e: "update:modelValue", value: string): void;
    /** 命中提交键时发出，携带当次按键的修饰键状态 */
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    /** Shift+Tab 时发出，由宿主决定焦点去向 */
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    /** 粘贴或拖入图片文件；position 只在拖放时有（拖放落点） */
    (e: "image-files", payload: {files: File[]; position?: number}): void;
    /** 图片粘贴/拖放被拒时发出（只读，或未开启 enableImageFiles） */
    (e: "image-files-blocked"): void;
    /** 用户点了失败图片标记上的重试；宿主重试后按 uploadId 回填 */
    (e: "pending-image-retry", uploadId: string): void;
    /** 用户点了图片标记上的移除（含上传中与失败态） */
    (e: "pending-image-remove", uploadId: string): void;
    /** 正文里图片节点的投影变化（顺序即文档顺序，index 从 0 起） */
    (e: "image-document", nodes: ComposerImageNode[]): void;
}
```

对宿主的命令面（`expose`，无 slot 替代其功能）：

```ts
interface ReferencePlainTextEditorExpose {
    /** 聚焦；可指定落到 start / end / all / 具体位置 */
    focus(position?: "start" | "end" | "all" | number | boolean | null): void;
    /** 在光标处插入纯文本，命中引用语法时转成 chip；只读时不做任何事 */
    insertText(text: string): void;
    /** 读取当前正文的序列化文本 */
    getText(): string;
    /** 插入一个已完成上传的图片标记 */
    insertImage(image: PlainImageNodeAttrs, position?: number): void;
    /** 批量插入"上传中"标记，按 uploadId 后续原位替换，不依赖返回顺序 */
    insertPendingImages(items: Array<{uploadId: string; name: string}>, position?: number): void;
    /** 上传成功：把该 uploadId 的标记换成稳定图片标记 */
    replacePendingImage(uploadId: string, image: PlainImageNodeAttrs): void;
    /** 上传失败：标记为失败并保留位置，供重试或移除 */
    failPendingImage(uploadId: string, error: string): void;
    /** 把失败标记恢复为上传中 */
    startPendingImage(uploadId: string): void;
    /** 移除指定 uploadId 的标记 */
    removePendingImage(uploadId: string): void;
    /** 一次性清空所有未完成标记（会话切换时用） */
    clearPendingImages(): void;
    /** 按正文顺序删除第 N 个稳定图片标记；不动宿主的附件登记 */
    removeImageAt(imageIndex: number): void;
    /** 给草稿/历史恢复出的稳定标记补齐缺失属性（不进撤销历史） */
    hydrateImages(items: readonly PlainImageNodeAttrs[]): void;
}
```

没有 slot。未声明的 attribute 落到外框元素上（`class` 与内置类名合并）。除上面这些 props / emits / expose 外没有其他交互面；组件的状态（当前高亮、测量的高度、是否吸底）不外露。

## 状态

- **默认**：可编辑、随内容增高；空内容显示占位提示。
- **只读**：不可编辑、不可聚焦输入，光标不再是文本光标；内容里的引用与图片标记照常显示。
- **内容超出上限**：正文区内部滚动，不撑高外层；文字编辑时若此前停在底部会继续吸底，滚到上方编辑则保持当前位置不回跳。
- **图片上传中 / 失败**：分别显示上传中与失败样式的标记，失败态提供重试与移除；重试与移除通过事件交给宿主。
- **出错**：组件自身没有错误态。触发菜单解析不出内容时表现为菜单不出现（空菜单）。
- **空数据**：占位提示显示在正文的首段位置。

## 不支持

- 不支持 Markdown 结构与格式命令（粗体、标题、列表等），那是 `StructuredTextEditor` 的职责。
- 不自己上传图片：只发事件与维护标记，附件登记、上传与失败重试都由宿主负责；`removeImageAt` 也**不会**删除宿主的附件登记。
- 不做表单校验、不显示错误文案、不管理禁用态（只有只读）。
- 不持久化草稿，也不缓存内容。
- 没有 slot，也没有把内部编辑器实例交出去的口子。

## 上游边界

底层是 TipTap（ProseMirror）的编辑内核。本组件承诺的是：上面这些 props / emits / expose 的语义、文本序列化后的形态、自动增高与吸底规则、chip 与图片标记的插入与替换接口、进出菜单的按键约定。

其余属于上层库、本组件不承诺、升级可能变化的有：撤销重做与编辑历史、输入法与组合输入细节、选区与光标移动、复制/粘贴以外的浏览器编辑行为、以及各种编辑快捷键。要依赖这些行为请直接查上游文档并实测，不要因为本文档没提就当它不存在。

## 隐藏通道理由

- **`env:timer`**：内容高度只能在 DOM 更新并完成布局之后测量（"内容变高了多少"是布局结果，不是数据结果），因此测量被推迟到下一帧执行，并且同一时刻只保留一次待执行测量；组件卸载时取消未执行的那次。它不是轮询，也不产生周期性回调。
- **触发菜单的浮层是子组件 `ReferenceSelectorPopover` 渲染的**，Teleport 属于那条通道（见该组件的文档）。本组件只负责算出渲染目标：取自己最近的主题容器（`.novel-ide-theme`），取不到时留给子组件的默认目标 `body`。放在 `.novel-ide-theme` 之外使用时，菜单会落在 `body` 上。
- **`state:local`**：菜单高亮下标、菜单状态、测量出的高度与是否溢出、是否吸底、上次回发的文本快照、滚动与重测标志位。

## 注意事项

- **图片流程是"事件出、接口回"**：宿主收到 `image-files` 后自己上传，再按 `uploadId` 调 `insertPendingImages` / `replacePendingImage` / `failPendingImage` / `removePendingImage`。不接这些接口会出现"标记一直转圈"或"上传完了但正文里没有图"。`image-document` 是宿主观察正文里图片顺序与存在性的唯一出口。
- **`enableImageFiles` 默认关闭**：图片粘贴与拖入会被拦下并回一个 `image-files-blocked`，而不是静默失败。只读状态下同样只回阻塞事件。
- **`resolveMenu` 决定菜单存不存在**：默认返回空菜单，此时即使打开 `enableQuickTriggers` 也没有菜单可显示。菜单里的项由宿主解析，本组件不理解它插入的是什么。
- **外部替换 `modelValue` 会覆盖用户正在编辑的内容并把视图滚回顶部**；反过来用户编辑后的文本只通过事件出去，不写回 prop。
- **`expanded` 只抬高上下限**，不会强制占满高度；要固定高度请用 `minHeight` / `maxHeight`。
- **`borderless` 会改圆角与背景**（顶角跟 `--composer-radius`，底角为直角），它假定自己贴着 composer 的其它部分，单独使用时外观会显得缺一角。
