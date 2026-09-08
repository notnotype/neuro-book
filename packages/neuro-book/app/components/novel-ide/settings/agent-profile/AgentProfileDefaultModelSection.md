---
标签: [state:local]
---

# AgentProfileDefaultModelSection

默认设置页的模型基线区。它负责解释全局或项目作用域的默认模型参数，并把恢复默认动作限制在默认模型草稿。

## 布局与交互

标题、作用域说明和恢复默认按钮位于同一段；模型字段由 `AgentProfileModelFields` 渲染，常用模型与推理强度可直接编辑，高级参数遵循字段区约定。项目作用域显示全局基线继承。

## 数据

```ts
interface AgentProfileDefaultModelSectionProps {
    scope: "global" | "project";
    modelDefaults: AgentProfileModelDraft;
    globalModelDefaults: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    disabled: boolean;
}
interface AgentProfileDefaultModelSectionEmits {
    (event: "update:modelDefaults", value: AgentProfileModelDraft): void;
    (event: "reset"): void;
}
```

无 slots、expose；attrs 不透传。恢复默认仍只产生草稿更新，由父级决定保存。

## 不支持

不访问 Provider，不保存配置，不修改单 Profile 草稿。
