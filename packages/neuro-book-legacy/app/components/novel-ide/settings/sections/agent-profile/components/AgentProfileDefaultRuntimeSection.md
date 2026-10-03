---
标签: [state:local]
---

# AgentProfileDefaultRuntimeSection

默认设置页的通用运行策略基线区。它显示当前作用域的自动摘要、上下文压缩和文件变更提示默认值，并把更新交给页面草稿。

## 布局与交互

运行策略默认折叠；入口是键盘可达的 disclosure 按钮，展开与收起沿用 nb-ui `Collapsible` 动画。存在显式默认覆盖时标题显示覆盖数量，但不自动展开；运行时字段错误会显示错误图标并自动展开。字段分组和继承提示由 `ProfileRuntimeSettingsFields` 负责。未完成加载时不挂载字段，避免用户编辑不存在的基线。
## 数据

```ts
interface AgentProfileDefaultRuntimeSectionProps {
    scope: "global" | "project";
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    runtimeEffective: ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null;
    runtimeSources: ProfileRuntimeSettingsSources | null;
    runtimeErrors: ProfileRuntimeSettingsErrors;
    disabled: boolean;
}
interface AgentProfileDefaultRuntimeSectionEmits {
    (event: "update:runtimeDefaults", value: ProfileRuntimeSettingsDraft): void;
}
```

无 slots、expose；attrs 不透传。错误由字段组件显示，保存校验由页面负责。

## 不支持

不启动运行时任务，不读写后端配置，不自行持久化。
