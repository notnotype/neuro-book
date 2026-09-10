---
标签: [state:local]
---

# NovelIdeSettingsView

NeuroBook 设置界面的外壳视图：一栏作用域与区段导航 + 内容区，区段体由宿主通过默认插槽提供。它只消费宿主解析好的作用域、区段与状态，不读 store、不发请求、不写持久化；作用域与区段都是受控的，切换只通过 `update:scope` / `update:modelValue` 交回宿主。

Component Lab 中由 `NovelIdeSettingsViewFixture` 提供确定性场景（global / project / dialog-window / loading / load-error）：`global` 与 `project` 在内容槽里挂真实的 `AgentProfileSettingsView`，`dialog-window` 通过 nb-ui `DialogWindow` 展示同一组合。fixture 只登记本批次已有区段体的区段，并把另外两档作用域标为不可进入（`disabledReason`），因此不会出现点不动的空区段。

## 契约

```ts
type NovelIdeSettingsViewProps = {
    /** 受控作用域 */
    scope: "boot" | "global" | "project" | "browser";
    scopes: SettingsScopeOption[];
    sections: SettingsSectionOption[];
    /** 受控区段 id；切换作用域后若该区段不可用，视图改选新作用域的第一个区段 */
    modelValue: string;
    /** 项目作用域下的配置目标标签；空则不显示 */
    targetLabel?: string;
    versionLabel?: string;
    githubUrl?: string;
    loading?: boolean;
    loadError?: string;
};

type NovelIdeSettingsViewEmits = {
    (event: "update:scope", value: SettingsScopeId): void;
    (event: "update:modelValue", value: string): void;
    (event: "reload"): void;
};
```

可见区段 = 宿主给的 `sections` 与当前 `scope` 的交集；视图不自行过滤产品规则，也不需要知道某个区段属于哪一档。

## 布局规则

与 `AgentProfileSettingsView` 同源：导航轨 276px（自带 16px 内边距），轨与内容之间是一条 1px 竖线，两端各留 16px，不与标题栏或内容边线相接；轨内不画卡片面，只有控件自身带描边。内容区不设 `max-width`——是否封顶由区段体决定（阅读型区段自己封 `max-w-3xl`，两栏型区段如 Agent Profile 需要整幅宽度）。窄容器（容器宽度 < 700px）退化为单列：导航与内容互斥，顶部切换条往返，轨道竖线一并去掉。显示态由 `@container` 查询独占，元素上不挂 display 工具类，因此不需要 `!important`。

## 状态

`loading` 渲染骨架，`loadError` 在内容上方渲染可重试的错误条并触发 `reload`；两者都不影响导航可用性。外壳自身只有「移动端单列是否停在导航」这一个局部状态。
