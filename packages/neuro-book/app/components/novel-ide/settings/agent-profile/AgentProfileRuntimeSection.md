---
标签: [state:local]
---

# AgentProfileRuntimeSection

Profile 运行策略覆盖区。它负责折叠容器、覆盖数量和运行策略基线传递；自动摘要、上下文压缩、文件变更提示的字段由 `ProfileRuntimeSettingsFields` 展示。

## 布局与交互

运行策略默认折叠；已有覆盖时初始展开，标题显示覆盖数量。运行时出现字段错误会自动展开并显示错误图标。入口是键盘可达的 disclosure 按钮，展开与收起沿用 nb-ui `Collapsible` 的高度/透明度动画；展开后保留摘要、压缩和文件变更三组字段。没有运行基线时显示不可用说明。
## 数据

```ts
interface AgentProfileRuntimeSectionProps {
    profile: AgentProfileDraft;
    runtimeBaseline: {
        settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"];
        sources: Record<string, string>;
    } | null;
    runtimeErrors?: ProfileRuntimeSettingsErrors;
    disabled?: boolean;
}
interface AgentProfileRuntimeSectionEmits {
    (event: "update:runtime", value: ProfileRuntimeSettingsDraft): void;
}
```

`disabled` 与 `runtimeErrors` 默认分别为 `false` 和空对象。无 slots、expose；attrs 不透传。

## 状态

禁用时折叠入口和字段不可编辑但当前草稿可读；错误与继承来源由字段组件显示。组件不自行验证或提交。

## 不支持

不解析后端配置、不访问 API、不启动摘要/压缩运行任务。
