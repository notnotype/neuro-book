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
