---
标签: [state:local]
---

# WebSettingsView

「Web 工具」区段的受控视图，三块：搜索服务（默认服务与优先级、Tavily / Brave 各自的启用、密钥、超时，Brave 另有国家与搜索语言）、本地抓取（开关与五个限额）、Tavily 兜底（开关与超时）。视图只改草稿并通过 `update:modelValue` 交回宿主，不读 store、不调 API、不写持久化；旧面板 `NovelIdeWebSettingsPanel` 继续负责快照读写与 `saveGlobal`，产品接线时再消费本视图。

草稿模型与序列化规则在 `web-settings-draft.ts`，视图与宿主共用：`buildWebPayload()` 是唯一的写回体出口，优先级规范化（滤未知项、去重、补齐两个 provider）、上下移边界、密钥三态与数字回落默认值都在那里，并有单元测试覆盖。

Component Lab 中由 `WebSettingsViewFixture` 提供确定性场景（default / configured / brave-first / local-fetch-off / saving / save-error / disabled）。

## 契约

```ts
type Props = {
    modelValue: WebSettingsDraft;   // {order, tavily, brave, localFetch, tavilyFallback}
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelValue", value: WebSettingsDraft): void;
};
```

默认搜索服务就是优先级第一位：在默认服务下拉里选另一项，等于把它提到最前，`Fallback:` 提示实时反映完整顺序。provider 密钥留空表示保留原值，只有点「清除」才写空串；清除会把 `apiKey` / `apiKeyConfigured` / `apiKeyMaskedValue` 三处一起改，`apiKeyCleared` 置位。数字字段留空或非法时，写回体回落到 `web-settings-draft.ts` 里 `WEB_DEFAULTS` 的文档化默认值；Tavily 兜底超时留空表示未配置，写 `null`。

## 布局规则

与设置外壳同源：不画卡片面，三块之间与两个 provider 之间都用 1px `--divider` 横线分段；provider 行首是图标 + 名称 + 「已配置 / 未配置」与「启用 / 停用」两枚软底徽标，行尾是上移、下移与开关。API Key 占满一行、右侧是 danger 变体的「清除」，其余字段并排与否由视图自身的容器宽度（`@container min-width: 620px`）决定。视图自身不滚动（宿主负责滚动）。
