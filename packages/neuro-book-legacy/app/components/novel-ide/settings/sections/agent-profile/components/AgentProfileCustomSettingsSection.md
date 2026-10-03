---
标签: [state:local]
---

# AgentProfileCustomSettingsSection

Profile 的专属 LowCodeForm 区域。它只编排可编辑条件、继承范围和折叠状态，完整表单字段、项目覆盖和资源 mutation 语义由共享 `LowCodeForm` 保持。

## 布局与交互

加载成功且存在表单时默认展开；编译/加载状态不可编辑但保留原因说明；loaded 且没有表单时显示明确空态。项目作用域允许字段继承与覆盖，资源编辑只产生草稿 mutation，不写文件。

## 数据

```ts
interface AgentProfileCustomSettingsSectionProps {
    profile: AgentProfileDraft;
    scope: "global" | "project";
    disabled?: boolean;
}
interface AgentProfileCustomSettingsSectionEmits {
    (event: "update:settingsValues", value: LowCodeJsonObject): void;
    (event: "update:settingsOverridePaths", value: string[]): void;
    (event: "update:settingsResourceMutations", value: LowCodeResourceMutationDto[]): void;
}
```

`disabled` 默认 `false`。无 slots、expose；attrs 不透传。所有表单变化经事件上报。

## 状态

非 loaded 不挂载可编辑表单；保存中/加载中禁用表单；空表单和表单错误由 `LowCodeForm`/本区显示。组件不丢弃未知字段或资源 mutation。

## 上游边界

共享 `LowCodeForm` 负责字段控件、继承操作、问题呈现和资源 mutation 编辑；本组件只承诺把这些 props/emits 原样接到 Profile 草稿，不承诺上游未声明的视觉或焦点细节。

## 不支持

不访问 API、文件、store 或持久化，不创建 Profile 资产。
