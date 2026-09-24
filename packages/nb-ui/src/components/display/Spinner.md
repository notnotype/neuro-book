---
标签: []
---

# Spinner

`Spinner` 是局部进行中状态指示器，用于按钮以外的面板、表格或页面区块；它提供 `status` 语义和可配置的无障碍名称，可选地把同一名称显示为文字。

## 数据

```ts
type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
    /** 指示图标尺寸档位；可选，默认 "md" */
    size?: SpinnerSize;
    /** status 的无障碍名称；可选，默认 "加载中"；showLabel 为 true 时也作为可见文字 */
    label?: string;
    /** 是否显示 label 文字；可选，默认 false */
    showLabel?: boolean;
}

// 无 emits：组件不发出事件。
// 无 slots：组件不提供插槽。
```

所有 props 都是显示配置，不表示或修改外部加载状态。根节点始终是 `role="status"` 且 `aria-label` 取 `label`；`showLabel` 只控制是否另显示相同文字。图标持续旋转：`sm` 尺寸为 `calc(var(--control-h-sm)*0.5)`，`md` 为 `calc(var(--control-h-sm)*0.64)`，`lg` 为 `var(--control-h-sm)`。

不提供 `expose` API；未声明的 attributes（包括 `class`、`style`）按 Vue 单根节点默认行为落到根节点。组件不负责请求、加载完成/失败切换或取消操作，也没有禁用、只读状态。
