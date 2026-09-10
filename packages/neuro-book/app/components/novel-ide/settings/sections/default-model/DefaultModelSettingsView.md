---
标签: [state:local]
---

# DefaultModelSettingsView

「默认模型」区段的受控视图：Agent、续写与 AI 批注默认使用哪个模型。global 作用域选一个已启用模型；project 作用域是**覆盖**——下拉里多一项「跟随 Global 默认模型」，选它就是清除项目里的覆盖值。

视图只消费 props 并通过 `update:modelKey` 交回宿主，不读 store、不发请求；`null` 在 project 下表示跟随全局，在 global 下表示没有可选模型（下拉显示占位）。旧面板 `NovelIdeModelSettingsPanel` 继续负责读写配置，产品接线时再消费本视图。

这一页从 `ProviderSettingsView` 拆出来：原来默认模型、Agent 可见模型、Provider 与模型清单挤在一个 Tab 里，读不出主次。

Component Lab 中由 `DefaultModelSettingsViewFixture` 提供确定性场景（global / project-follow / project-override / no-models / saving / save-error）。

## 契约

```ts
type Props = {
    modelKey: string | null;          // project 下 null = 跟随全局
    models: EnabledModelOptionDto[];
    isProjectScope: boolean;
    targetLabel: string;
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelKey", value: string | null): void;
};
```

## 布局规则

阅读型区段：内容列封顶 `max-w-3xl`（≈768px），由区段体自己负责——外壳只给内容列，不封顶，因为两栏型区段（Provider 页）需要整幅宽度。标题旁只放「会写到哪里」的元信息 tooltip；讲「改了会怎样」的那句留在页面上，它是影响判断的正文。保存中与保存失败各占一行，草稿不丢。视图自身不滚动（宿主负责滚动）。
