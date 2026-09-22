---
标签: [state:local]
---

# CostSettingsView

「费用显示」区段的受控视图：选择展示币种（USD / CNY）、显示当前 USD→CNY 汇率与取回时间、手动刷新汇率。它只消费宿主给的币种与汇率状态，币种变更通过 `update:currency` 交回宿主，刷新按钮通过 `refreshRate` 请宿主去取——视图自身不读 store、不调 API、不写持久化。旧面板 `NovelIdeCostSettingsPanel` 继续负责快照读写、`saveGlobal` 与汇率请求，产品接线时再消费本视图。

Component Lab 中由 `CostSettingsViewFixture` 提供确定性场景（default / cny / stale / missing-rate / refreshing）；fixture 的「刷新汇率」只换一个确定值并记录事件，不访问网络。

## 契约

```ts
type Props = {
    currency: "USD" | "CNY";
    exchangeRate: number | null;      // null 表示本会话还没拿到
    exchangeRateStale?: boolean;      // 来自本地缓存
    exchangeRateFetchedAt?: string;   // ISO 字符串；空串不显示
    refreshing?: boolean;
    disabled?: boolean;
};

type Emits = {
    (event: "update:currency", value: "USD" | "CNY"): void;
    (event: "refreshRate"): void;
};
```

刷新汇率的返回值由宿主持有：视图不解析响应，也不把汇率写进配置（汇率只影响展示）。`exchangeRateFetchedAt` 无法解析成日期时按空串处理，不渲染残行。

## 布局规则

与设置外壳同源：不画卡片面，标题、币种、汇率三段之间用同款 1px `--divider` 横线分段；币种只有两项且各带说明，因此用 `RadioGroup` 而不是下拉——两项都能一眼看到。汇率行左侧是「1 USD = x CNY（缓存）」与取回时间，右侧是刷新按钮，窄容器下换行不挤压。视图自身不滚动（宿主负责滚动）。
