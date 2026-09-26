---
标签: [state:local, state:shared-read]
---

# SharedMergeEditor

三栏合并编辑器并排呈现当前稿、来稿和可编辑结果；它让调用方能在保留两侧上下文时直接改写合并稿，并以受控值和保存事件交回宿主。

## 布局

顶部固定三侧标签，下方三栏填满父级提供的剩余高度。父级必须给出可计算的宽高。视口宽度不高于 1100px 时，三栏切为单列，且每个编辑器至少 240px 高；宿主应提供足够高度或滚动空间。

## 交互

当前稿和来稿只读，结果栏按 `readonly` 决定能否编辑。结果变化发出 `update:modelValue`；Ctrl/Cmd+S 发出 `save-request`。Monaco 完成结果编辑器创建时发出 `ready`。本组件不提交内容。

## 数据

```ts
interface SharedMergeEditorProps {
    /** 合并结果；必填、受控。编辑时发出 update:modelValue，父级不回写则继续显示旧值。 */
    modelValue: string;
    /** 当前稿文本；默认空字符串。 */
    currentContent?: string;
    /** 来稿文本；默认空字符串。 */
    incomingContent?: string;
    /** 当前稿标签；默认 "Current"。 */
    currentLabel?: string;
    /** 来稿标签；默认 "Incoming"。 */
    incomingLabel?: string;
    /** Monaco 语言 id；默认 "markdown"。 */
    language?: string;
    /** 结果是否只读；默认 false。 */
    readonly?: boolean;
    /** Monaco 模型身份前缀；默认 "merge"。 */
    modelKey?: string;
    /** 是否显示边界空白；默认 false。 */
    showWhitespace?: boolean;
    /** 结果侧标签；默认 "Result"。 */
    resultLabel?: string;
}

interface SharedMergeEditorEmits {
    /** 结果编辑内容变化时发出。 */
    (event: "update:modelValue", value: string): void;
    /** 用户在结果编辑器中触发 Ctrl/Cmd+S 时发出。 */
    (event: "save-request"): void;
    /** 结果编辑器实例创建后发出。 */
    (event: "ready"): void;
}
```

没有 slots、没有 expose；attrs（含 class/style）按默认规则落在根元素上。除受控 `modelValue` 外不接受内部插槽或额外编辑器句柄。

## 状态

默认结果可编辑。`readonly` 时结果保留选择与滚动但不接收编辑。内容、语言或模型 key 改变会重建文本模型；外部 modelValue 更新同步到结果模型。初始化期间没有独立占位或错误提示，创建结果编辑器后发出 `ready`；卸载时释放三个编辑器和模型。

## 不支持

不自动合并冲突标记、不决定如何接受某一侧、不写入文件、不校验结果，也不提供保存进度、错误恢复或编辑器实例 expose。

## 上游边界

Monaco Editor 提供文本编辑、选择、滚动与按键处理。本组件承诺三份文本的只读/可编辑分工、受控结果、标签、语言、空白显示和保存请求；其余编辑器行为由 Monaco 决定。

## 隐藏通道理由

- `state:local`：Monaco 编辑器与模型引用、监听器及 change 抑制标志仅在组件生命周期内存在；卸载时全部释放，不保留跨实例状态。
- `state:shared-read`：组件读取全局产品主题会话的 `appearance` 并据此应用 Monaco 主题。文档内容与结果仍走明面 props/emits；主题模式必须与应用全局保持一致。
