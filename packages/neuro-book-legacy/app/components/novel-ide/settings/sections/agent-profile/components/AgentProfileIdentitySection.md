---
标签: [state:local]
---

# AgentProfileIdentitySection

Profile 详情顶部的身份与运行状态摘要。它只负责显示名称、用途、稳定 key、源路径、默认标记以及编译/加载失败提示，不承载设置编辑或维护动作。

## 布局与交互

内容按身份标题、用途、key/源路径、运行提示顺序排列；长 key 和路径允许换行或截断，不撑宽父级。失败原因在摘要顶部直接可见，不能依赖下方折叠区。无交互控件；标题可由父级用于焦点定位。

## 数据

```ts
interface AgentProfileIdentitySectionProps {
    profile: AgentProfileDraft;
    descriptions: Record<string, string>;
    isDefaultProfile: boolean;
    buildHint: string;
}
```

无 emits、slots、expose；attrs 不透传。`descriptions` 缺少 key 时不渲染用途文案。

## 状态

已加载、编译中和失败状态使用对应语义 Badge；`buildHint` 非空时显示运行提示；`profile.issue` 非空时显示可读消息和 issue code。组件无 loading、编辑或空数据分支，调用方应准备完整 Profile。

## 不支持

不修改 Profile，不触发编译、保存、网络请求或路由跳转。
