---
标签: [state:local]
---

# AgentSessionModelControls

Agent 会话模型与推理深度选择控制器。包含快速模型下拉切换器与会话级独立模型参数弹窗（Popover），允许为当前会话覆盖默认 Profile 模型配置与思考深度。

## 数据

```typescript
type Props = {
    /** 当前选择的模型键值。 */
    sessionModelSelectionValue: string | null;
    /** 当前解析出的思考深度展示文案。 */
    sessionThinkingResolvedLabel: string;
    /** 会话级模型参数暂存草稿。 */
    sessionModelDraft: AgentSessionModelDraft;
    /** 可选的模型列表。 */
    selectableModels: EnabledModelOptionDto[];
    /** 是否正在保存模型设置。 */
    sessionModelSaving: boolean;
    /** 参数弹窗是否展开。 */
    sessionModelPopoverOpen: boolean;
    /** 是否只读。 */
    readonly?: boolean;
    /** 是否运行中。 */
    running?: boolean;
    /** 会话是否加载中。 */
    loadingSession?: boolean;
    /** 弹窗下拉展开方向。 */
    dropdownDirection?: "auto" | "down" | "up";
    /** 根容器自定义样式类。 */
    rootClass?: string;
    /** 弹窗自定义样式类。 */
    popoverClass?: string;
};

type Emits = {
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不在此处持久化配置到服务端，仅发出 `apply-session-model-settings` 或 `reset-session-model-settings` 事件由上层统一保存。
