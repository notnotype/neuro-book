---
标签: []
---

# DropIndicatorLabel

`DropIndicatorLabel` 为拖放形状提供紧凑的提示文案与可选图标。它是纯展示零件：只要标签去除首尾空白后仍有内容才显示，且整个提示对辅助技术隐藏；需要管理定位或播报时由上层覆盖层负责。

## 数据

```ts
type DropIndicatorLabelProps = {
    /** 提示文字；必填。trim 后为空时整个标签不渲染。 */
    label: string;
    /** 可选图标 CSS class；缺省不渲染图标。 */
    iconClass?: string;
};

type DropIndicatorLabelEmits = Record<never, never>;

type DropIndicatorLabelSlots = Record<never, never>;
```

标签与图标节点均为 `aria-hidden="true"`。没有插槽或 expose API。未声明 attrs 按 Vue 默认行为落到根节点；标签为空白时根节点不存在，因此 attrs 也无挂载目标。

## 状态与边界

- 非空标签渲染文案；提供 `iconClass` 时在文案前渲染装饰图标。
- 空字符串或纯空白不渲染任何节点。
- 组件不处理文案翻译、位置、最大宽度、剪裁、播报或拖放状态。
