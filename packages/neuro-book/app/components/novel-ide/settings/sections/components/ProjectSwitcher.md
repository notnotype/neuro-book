---
标签: [state:local]
---

# ProjectSwitcher

设置外壳左栏的**项目切换**行：作用域选到「项目」时，这一行是可切换的项目选择，而不是只读标签。

受控件：项目清单与当前项目都由宿主给（`projects` / `modelValue`），切换只发 `update:modelValue`。它不读 store、不发请求、不决定「切换项目」在宿主侧意味着什么（重载配置还是仅切换目标，属宿主策略）。

Component Lab 中由 `NovelIdeSettingsViewFixture` 的 `project` 场景挂载：两个候选项目、当前选第一个。项目清单为空时下拉禁用（没有可切的东西，不要给一个空菜单）。

## 契约

```ts
type Props = {
    projects: Array<{id: string; name: string}>;  // 可切换的项目
    modelValue: string | null;                     // 当前项目 id；null = 尚未确定
    disabled?: boolean;
};

type Emits = {
    (event: "update:modelValue", value: string): void;
};
```

## 布局规则

与外壳左栏同一节律：顶部一条 `--divider` 发丝线收尾，行内是图标 + 下拉，左右内边距由外壳的导航列给（本组件不加自己的页面边距）。下拉宽度取剩余空间（`min-w-0 flex-1`），长项目名截断而不是撑开左栏。
