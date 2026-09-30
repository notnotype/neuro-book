---
标签: [state:local]
---

# ModelPickerPopover

通用模型选择触发按钮与弹出层封装。将触发按钮与 `ModelPickerContent` 弹层集成，支持向上/向下弹出定位、点击外部关闭与 Escape 键监听。

## 数据

```typescript
type Props = {
    open: boolean;
    modelValue: ModelPickerSelectionValue;
    roles?: ModelPickerRoleItem[];
    models: ModelPickerModelItem[];
    showSpecialistInPicker?: boolean;
    direction?: "up" | "down" | "auto";
    align?: "start" | "end" | "center";
    disabled?: boolean;
    triggerClass?: string;
    popoverClass?: string;
    pickerWidthClass?: string;
    /** 弹层高度类名（默认 h-[440px]，贴合卡片布局且无多余空隙，未开启专精轴时自适应收紧为 h-[330px]） */
    pickerHeightClass?: string;
    thinkingLevel?: ThinkingLevelDto | null;
};

type Emits = {
    (e: "update:open", value: boolean): void;
    (e: "update:modelValue", value: string): void;
    (e: "update:thinkingLevel", value: ThinkingLevelDto | null): void;
    (e: "select", value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void;
};
```

- **弹出动效**：通过动态计算的 `transform-origin` 结合减速弹簧曲线 `cubic-bezier(0.16, 1, 0.3, 1)`（`var(--motion-enter)`），自触发胶囊按钮平滑向外展开与收拢。
- **选择语义**：选择角色时不自动关闭弹出层，保留浮层以便调整思考等级；选择物理模型或按 Esc / 点击外部时自动收拢。
