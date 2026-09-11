---
标签: [state:local]
---

# RolesSettingsView

「模型角色」区段的受控视图：把模型按**用途**分配给角色，分两条轴——梯度轴（`tiny` / `fast` / `main` / `deep`，固定四档、不可删）与专精轴（默认 `summarize` / `writer` / `narrative` / `plan` / `vision`，**可以自己加**）。每行显示：图标、角色名、状态徽标、建议模型 tooltip，以及一个模型下拉；专精轴多一个删除按钮。

**角色定义只有两件事**：绑哪个模型、角色描述写什么。描述会进模型看到的目录（`buildModelRoleCatalog()`），所以它是给模型看的文本，不是给人看的备注。

**没有候选链，也没有回落**：每行都是自己的绑定，没配模型的行会显示「未配置」并由 `roleConfigIssues()` 报成配置错误——宿主该报错，而不是拿别的角色的模型顶上。视觉这类角色尤其不能回落：主模型多半不支持原生视觉。

**role 与 profile 不是一层**：role 是模型角色（本页），profile 是代理类型（Agent Profile 区段）；`@writer` 这样的 profile 会装载到 `writer.default` 这类 profile 配置上。本页只管前者。

**UI 先行**：后端契约（role 的 schema、目录怎么送到模型）尚未存在，这一版只在前端表达绑定关系。契约落地时 `roles/roles-settings-draft.ts` 是唯一的改写入点：`RolesSettingsDraft` 的形状与 `buildRolesSection()` 的写回体是给宿主映射用的。提案见 `docs/proposals/model-roles-contract.md`。

Component Lab 中由 `RolesSettingsViewFixture` 提供确定性场景（unconfigured / partially-configured / fully-configured / saving / save-error）。

## 契约

```ts
type Props = {
    modelValue: RolesSettingsDraft;      // {gradient: ModelRoleDraft[]; specialist: ModelRoleDraft[]}
    models: EnabledModelOptionDto[];     // 可绑定的已启用模型
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelValue", value: RolesSettingsDraft): void;
};
```

`roles-settings-draft.ts` 负责全部规则：`createRolesSettingsDraft(translate)` 物化种子（名字与描述走 i18n，之后用户改的就是文本本身）、`addSpecialistRole()` / `removeRole()` 增删专精角色（新角色用 `custom-N` 这种稳定 id，名字可以被改、id 不会）、`roleConfigIssues()` 报配置错误、`buildModelRoleCatalog()` 产出模型看到的那份目录（只含绑好且有描述的）、`buildRolesSection()` 产出写回体（含未绑定的，宿主需要它来报错）。

## 布局规则

阅读型区段：内容列封顶 `max-w-3xl`。两条轴各占一段，段内每行用 1px `--divider` 分隔；宽容器（`@container min-width: 620px`）下「角色 + 说明」与「模型下拉 + 删除」并排且各角色对齐，窄容器下自动堆叠，模型下拉与删除始终同一行。**内置角色**（梯度轴四档与专精轴五个种子）的名字与描述由产品提供、只读，行内只有一枚启用开关与模型下拉；**用户自建的角色**（专精轴「添加角色」产出）名字与描述是行内输入框，行尾多一个删除按钮。建议模型只出现在 tooltip 里——它是建议，不是当前值。标题旁只放元信息 tooltip。视图自身不滚动。
