---
标签: [state:local]
---

# AgentProfileModelSection

Profile 详情中的模型设置区。它把模型与推理强度作为常用字段直接呈现，把温度、TopK、流式输出收进高级折叠区，避免父级重复渲染模型字段。

## 布局与交互

模型和推理强度在“使用模型”区域常驻；高级模型参数按需展开。高级折叠默认关闭，已有模型覆盖时只显示覆盖数，不自动展开。所有字段由 `AgentProfileModelFields` 负责标签、继承和字段级提示。

## 数据

```ts
interface AgentProfileModelSectionProps {
    model: AgentProfileModelDraft;
    inherited: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    disabled?: boolean;
}
interface AgentProfileModelSectionEmits {
    (event: "update:model", value: AgentProfileModelDraft): void;
}
```

`disabled` 默认 `false`。无 slots、expose；attrs 不透传。组件不直接改 `model`，更新通过事件回传。

## 状态

禁用时保留当前值和继承提示，不接受编辑；模型列表为空、未知模型和模型校验问题由子字段组件显示。高级参数值非法仍由父级保存校验处理，组件不静默修正输入。

## 不支持

不访问 Provider、不保存配置、不发起模型调用，不创建或删除模型。nb-ui `Collapsible` 的浮层/键盘行为由上游组件负责。
