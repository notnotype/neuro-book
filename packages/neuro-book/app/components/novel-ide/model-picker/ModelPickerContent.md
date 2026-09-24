---
标签: [state:local]
---

# ModelPickerContent

通用现代模型选择器内容视图。融合快速角色选择（梯度轴与可配置的专精轴）与按 Provider 分组检索的物理模型库，提供即时过滤、能力标记、上下文窗口与定价展示，并标明会话级覆盖语义。

## 数据

```typescript
type Props = {
    /** 当前选中值，支持 `role:<roleId>` 或具体的 `<modelKey>` */
    modelValue: ModelPickerSelectionValue;
    /** 模型角色列表（梯度轴 + 专精轴） */
    roles?: ModelPickerRoleItem[];
    /** 可选的物理模型列表 */
    models: ModelPickerModelItem[];
    /** 是否在选择器中展示专精轴（受控于设置中的偏好） */
    showSpecialistInPicker?: boolean;
    /** 当前会话的思考等级 */
    thinkingLevel?: ThinkingLevelDto | null;
    /** 容器宽度类名或内联样式控制 */
    widthClass?: string;
    /** 容器高度类名（保持完全固定尺寸） */
    heightClass?: string;
    /** 是否为独立渲染（独立渲染时自带面板外边框与底色） */
    standalone?: boolean;
};

type Emits = {
    (e: "update:modelValue", value: string): void;
    (e: "update:thinkingLevel", value: ThinkingLevelDto | null): void;
    (e: "select", value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void;
    (e: "close"): void;
};
```

- **角色快速选择**：上方固定展示梯度轴（极轻量/快速/主力/深度），可选展开专精轴（写作/叙事/计划/视觉等）。
- **物理模型库**：按 Provider 分组展开/折叠，包含推理/多模态/长文本标签与定价估算。
- **状态栏提示**：底部状态栏明确当前会话覆盖状态与操作快捷键。
