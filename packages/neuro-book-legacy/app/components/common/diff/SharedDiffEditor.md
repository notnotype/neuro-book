---
标签: [state:local, state:shared-read]
---

# SharedDiffEditor

共享的只读双侧差异查看器，为两份文本提供一致的 Monaco diff 呈现、左右标签与主题；它不判断差异属于哪个业务，也不修改输入文本。

## 布局

上下排列双侧标签与编辑区，编辑区填满父级提供的剩余高度并裁切自身溢出；父级必须给组件可计算的高度。左右并排或单栏排列由 `renderSideBySide` 交给 Monaco。组件未定义自己的窄屏断点或滚动容器。

## 交互

只读呈现原文与修改稿，可在编辑器中选择、滚动和复制。挂载并完成 Monaco 实例创建后发出 `ready`；初始实例创建后的下一动画帧发出一次 `layout`。没有组件自定义快捷键或写入动作。

## 数据

```ts
interface SharedDiffEditorProps {
    /** 原始侧文本；必填。 */
    originalContent: string;
    /** 修改侧文本；必填。 */
    modifiedContent: string;
    /** 原文侧标题；默认 "Original"。 */
    originalLabel?: string;
    /** 修改稿侧标题；默认 "Modified"。 */
    modifiedLabel?: string;
    /** Monaco 语言 id；默认 "markdown"。 */
    language?: string;
    /** 只读设置；默认 true。原始侧始终只读。 */
    readonly?: boolean;
    /** 是否并排；默认 true。 */
    renderSideBySide?: boolean;
    /** Monaco 模型身份前缀；默认 "diff"，用于避免多实例模型 URI 冲突。 */
    modelKey?: string;
    /** 是否显示边界空白；默认 false。 */
    showWhitespace?: boolean;
}

interface SharedDiffEditorEmits {
    /** Monaco 实例首次创建后发出。 */
    (event: "ready"): void;
    /** 下一帧布局完成后发出；布局帧可在初始化或内容更新后发生。 */
    (event: "layout"): void;
}
```

没有 slots、没有 expose；attrs（含 class/style）按默认规则落在根元素上。组件没有 `v-model`，两份内容变化由父级更新 props。

## 状态

初始化期间编辑区域尚未就绪，没有独立加载占位或错误提示；初始化完成后发出 `ready`。内容、语言、模型 key 改变时重建文本模型，选项改变时更新编辑器设置；卸载时释放 Monaco 实例与模型。实例引用仅在组件生命周期内存在。

## 不支持

不编辑任一侧文本、不输出差异摘要、不保存、不提供行内评论，也不自行处理窄屏模式切换或加载错误恢复。

## 上游边界

Monaco Editor 提供差异计算、编辑器绘制、选择与滚动行为。本组件承诺双文本输入、标签、语言、只读/布局选项、主题适配和初始化/布局事件；Monaco 的 diff 算法细节与内部键盘行为不作承诺。

## 隐藏通道理由

- `state:local`：Monaco 实例、diff editor 与两份模型引用由组件在挂载时建立并在卸载时释放；不跨实例保留。
- `state:shared-read`：组件直接读取 `useProductTheme()` 的全局产品主题 `appearance`，并以此更新 Monaco 主题。两侧内容通过 props 输入，但颜色模式必须与应用当前主题一致，不能由每个调用方另行维护。
