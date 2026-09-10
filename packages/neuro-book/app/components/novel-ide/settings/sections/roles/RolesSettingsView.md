---
标签: [state:local]
---

# RolesSettingsView

「角色」区段的受控视图：把模型按**用途**分配给角色，分两条轴——梯度轴（`tiny` / `fast` / `main` / `deep`，任何任务都可回落到这里）与专精轴（`summarize` / `writer` / `narrative` / `plan` / `vision`，按需配置并声明式回落到某个梯度）。每行显示：角色 id、用途、**建议候选链**、当前实际生效的角色，以及一个模型选择（「跟随 X」那一项就是清除本行绑定）。

**role 与 profile 不是一层**：role 是模型角色（本页），profile 是代理类型（Agent Profile 区段）；`@writer` 这样的 profile 会装载到 `writer.default` 这类 profile 配置上。本页只管前者。

**UI 先行**：后端契约（role 的 schema、候选链写在哪一层配置、本地模型怎么与 Provider 之外的端点绑定）尚未存在，这一版只在前端表达绑定关系。契约落地时 `roles/roles-settings-draft.ts` 是唯一的改写入点：`RolesSettingsDraft` 的形状与 `buildRolesSection()` 的写回体是给宿主映射用的。

Component Lab 中由 `RolesSettingsViewFixture` 提供确定性场景（unconfigured / partially-configured / fully-configured / saving / save-error）。

## 契约

```ts
type Props = {
    modelValue: RolesSettingsDraft;      // {roles: Record<ModelRoleId, string | null>}
    models: EnabledModelOptionDto[];     // 可绑定的已启用模型
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelValue", value: RolesSettingsDraft): void;
};
```

回落规则在 `roles-settings-draft.ts`：`resolveEffectiveRole()` 沿 `fallback` 往上找第一个有绑定的角色，`vision` 的 `fallback` 是 `null`——主模型多半不支持原生视觉，这类角色**不借用别人**，必须自己配。`buildRolesSection()` 只写出有绑定的角色，按目录顺序。

## 布局规则

阅读型区段：内容列封顶 `max-w-3xl`。两条轴各占一段，段内每行用 1px `--divider` 分隔，宽容器下「说明 + 选择」并排、窄容器下自动堆叠。说明性文字用 `--text-xs` 起，建议候选链用 `--text-2xs` 且靠在用途下面——它是建议，不是当前值。标题旁只放元信息 tooltip。视图自身不滚动。
