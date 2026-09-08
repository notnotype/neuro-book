---
标签: [state:local]
---

# AgentProfileDiagnosticsSection

Profile 详情底部的诊断与维护区。它把恢复当前 Profile 默认覆盖和项目 Home 重置请求集中在同一处，避免维护动作混入模型或表单编辑区。

## 布局与交互

显示恢复默认按钮、项目作用域且允许时显示 Home 重置按钮，以及构建原因。按钮拥有明确可访问名称；禁用或重置进行中时不接受操作。Home 重置由父级负责确认和发出最终事件。

## 数据

```ts
interface AgentProfileDiagnosticsSectionProps {
    profile: AgentProfileDraft;
    scope: "global" | "project";
    disabled?: boolean;
    resetHomeDisabled: boolean;
    resettingHome: boolean;
}
interface AgentProfileDiagnosticsSectionEmits {
    (event: "reset"): void;
    (event: "reset-home"): void;
}
```

`disabled` 默认 `false`。无 slots、expose；attrs 不透传。

## 状态与边界

仅项目作用域、Profile 声明 `canResetHome` 时显示 Home 按钮；组件不删除数据、不宣告成功，事件由宿主或 fixture 处理。Tooltip 与按钮视觉由 nb-ui 提供。
