---
标签: [state:local, state:shared-read]
---

# DiffWorkbench

文档差异工作台把同一份文档的当前稿、来稿与可选基线放进一个可切换的比较视图；它既提供只读差异，也提供可编辑合并结果，并把保存意图交回调用方。这里不读取文件或决定冲突如何落盘。

## 布局

顶部固定显示标题、可选路径和可用模式按钮，编辑区占据余下高度。父级必须给工作台可计算的宽高；编辑器会填满编辑区。宽度受限时 Monaco 自身负责代码区布局，模式按钮仍为单行且容器隐藏超出的按钮。

## 交互

点击模式按钮切换 Diff、Merge、Current vs Base 或 Incoming vs Base；当受控 `mode` 未提供时，工作台保留本地活动模式。合并编辑器把结果变化通过 `update:resultContent` 交回调用方，按保存快捷键发出 `save-request`，组件不保存数据。`mode` 改变时发出 `update:mode`。不可比较的文档显示原因、可选说明和元数据，不创建编辑器。

## 数据

```ts
import type {DiffWorkbenchDocument, DiffWorkbenchMode} from "./diff-workbench.types";

interface DiffWorkbenchProps {
    /** 当前文档及比较内容；必填。resultContent 缺省时合并结果从 currentContent 起步。 */
    document: DiffWorkbenchDocument;
    /** 活动模式；可选、受控，提供时必须通过更新 mode prop 回写；不提供时使用本地模式。 */
    mode?: DiffWorkbenchMode;
    /** 允许的模式集合；默认四种模式全部可用。 */
    availableModes?: DiffWorkbenchMode[];
    /** 首次模式及文档 id 改变时的模式；默认回退到首个可用模式。 */
    initialMode?: DiffWorkbenchMode;
    /** 合并结果是否只读；默认 false。 */
    mergeReadonly?: boolean;
    /** Diff 视图是否并排显示；默认 true。 */
    renderSideBySide?: boolean;
    /** 是否显示空白字符；默认 false。 */
    showWhitespace?: boolean;
}

interface DiffWorkbenchEmits {
    /** 用户切换活动模式时发出；即使没有传入受控 mode 也会发出。 */
    (event: "update:mode", value: DiffWorkbenchMode): void;
    /** 合并结果编辑时发出；父级需把结果写回 document.resultContent 才会保留。 */
    (event: "update:resultContent", value: string): void;
    /** 合并编辑器收到保存快捷键时发出。 */
    (event: "save-request"): void;
}
```

`DiffWorkbenchDocument`、`DiffWorkbenchMode` 的字段与取值见 `diff-workbench.types.ts`。没有 slots、没有 expose；未声明 `inheritAttrs: false`，attrs（含 class/style）落在根元素上。

## 状态

默认按 `mode`、`initialMode` 或首个可用模式显示。Base 模式仅在有 `baseContent` 时出现；被禁用或缺少基线的模式不显示，当前模式失效时回退至首个可用项。`diffable: false` 显示不可用态；文档的 `unavailableReason` 决定原因文案，其余原因回退为「暂不支持 diff」。本组件没有独立加载或请求状态。

## 不支持

不读取文件、发起请求、解析冲突标记、决定如何应用合并结果、写入工作区或生成差异摘要；无基线内容时不显示任何 Base 模式。模式超出类型联合的值不受支持。

## 上游边界

Diff 与 Merge 面板由 Monaco Editor 提供。本组件承诺传入内容、语言、标签、只读与空白显示设置，并转交保存请求；差异算法、编辑器按键和具体布局细节属于 Monaco 行为，不在本组件承诺内。

## 隐藏通道理由

- `state:local`：未受控时的活动模式留在组件实例中；销毁即丢失。提供 `mode` 可将其改为受控值。
- `state:shared-read`：实际渲染由 `SharedDiffEditor` / `SharedMergeEditor` 读取产品主题会话的 `appearance`，据此选择 Monaco 明暗主题。比较组件和文档数据由 props 提供，但编辑器的产品主题需与应用保持一致。
