---
标签: [state:local]
---

# WebSettingsView

「Web 工具」区段的受控视图，两块：**搜索服务**（每个服务一块：启用开关、密钥、超时，以及服务自己的字段，如 Brave 的国家与搜索语言；服务按优先级顺序排列，行首有上移/下移）与**通用设置**（默认搜索服务、本地抓取开关与五个限额、Tavily 兜底开关与超时）。

**服务是数据不是分支**：`SEARCH_PROVIDER_CATALOG` 决定有哪些服务、各自的图标、说明与独有字段，渲染与排序都按它走。再加一个服务＝往表里加一项，然后补后端契约里的对应字段（`buildWebPayload()` 里每个服务的字段仍然显式列出——后端契约本来就是按服务定义的）。这就是「以后有十几个服务」的扩展点：视图不用改。

视图只改草稿并通过 `update:modelValue` 交回宿主，不读 store、不调 API、不写持久化；旧面板 `NovelIdeWebSettingsPanel` 继续负责快照读写与 `saveGlobal`，产品接线时再消费本视图。

草稿模型与序列化规则在 `web-settings-draft.ts`，视图与宿主共用，**两个方向都在那里**：

- `createWebSettingsDraftFromConfig(web)`：config → 草稿。宿主接线时的唯一起点（旧面板的 `applySettings()` 是它的前身，接线时删掉旧面板那份，不要再抄一遍）。
- `buildWebPayload(draft)`：草稿 → 写回体，唯一的出口，与 `WebConfigDto` 逐字段对应。

优先级规范化（滤未知项、去重、补齐每个服务）、上下移边界、密钥三态与数字回落默认值都在同一个模块里，并有单元测试覆盖——其中一条是 **config → 草稿 → 写回体的往返不变量**。

语义上有两处**故意**与旧面板不同，接线时按新的来：① 数字输入清空按「未配置」处理（旧面板 `Number("") === 0` 会把空串写成 0）；② 可空超时（provider 与 Tavily 兜底）缺省显示空串而不是默认数字，这样 `null → 草稿 → null` 不会被悄悄改成 15000 / 20000。服务独有字段的长度约束（`country` 恰好 2 字符、`searchLang` 2–5）来自后端 schema，目录里带 `minLength` / `maxLength`，视图据此拦输入。

Component Lab 中由 `WebSettingsViewFixture` 提供确定性场景（default / configured / brave-first / local-fetch-off / saving / save-error / disabled）。

## 契约

```ts
type Props = {
    modelValue: WebSettingsDraft;   // {order, providers: Record<key, {enabled, apiKey*, timeoutMs, extras}>, localFetch, tavilyFallback}
    disabled?: boolean;
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelValue", value: WebSettingsDraft): void;
};
```

默认搜索服务就是优先级第一位：在默认服务下拉里选另一项，等于把它提到最前，服务列表顺序随之更新。服务密钥留空表示保留原值，只有点「清除」才写空串；清除会把 `apiKey` / `apiKeyConfigured` / `apiKeyMaskedValue` 三处一起改，`apiKeyCleared` 置位。数字字段留空或非法时，写回体回落到 `WEB_DEFAULTS` 的文档化默认值（空串是「未配置」，不是 0）；Tavily 兜底超时留空表示未配置，写 `null`。

## 布局规则

与设置外壳同源：不画卡片面，两块之间、每个服务之间、通用设置的三件之间都用 1px `--divider` 横线分段。服务行首是图标 + 名称 + 「已配置 / 未配置」徽标，行尾是上移、下移与开关；密钥占满一行、右侧是 danger 变体的「清除」，其余字段并排与否由视图自身的容器宽度（`@container min-width: 620px`）决定。视图自身不滚动（宿主负责滚动）。
