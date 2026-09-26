---
标签: []
---

# Panel

`Panel` 是可选择根 HTML 标签、表面色调与内边距的内容容器，提供统一的边框和圆角，避免调用方重复搭建基础面板。它不规定面板标题、内部布局或内容滚动。

## 数据

```ts
type PanelTone = "default" | "subtle";
type PanelPadding = "none" | "sm" | "md";

type PanelProps = {
    /** 根元素或动态组件名；默认 "section"。 */
    as?: string;
    /** 表面色调；默认 "default"。 */
    tone?: PanelTone;
    /** 内边距档位；默认 "md"。 */
    padding?: PanelPadding;
};

type PanelSlots = {
    /** 面板内容。 */
    default(): unknown;
};
```

组件没有 emits。`default` 色调使用 `--panel-surface` 与面板阴影；`subtle` 使用 `--bg-subtle`。`sm` 为 `p-3`，`md` 为 `p-5`。`none` 不加内边距并使用 `overflow-hidden` 裁切内容以保住圆角。三档都有圆角和边框。

组件无 expose API。未声明 attrs、class 与 style 按 Vue 默认行为落到动态根元素。选择 `as` 的语义、交互与可访问角色由调用方负责。

## 状态与边界

面板没有受控状态、禁用、加载、错误或空态。尺寸、响应式布局、溢出滚动与内部内容均由调用方管理；`padding="none"` 会裁切超出边界的内容。

## 不支持

- 不提供标题、页脚、滚动区域或焦点管理。
- 不校验 `as` 是否为有效或语义合适的标签。
