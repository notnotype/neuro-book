---
标签: [state:local]
---

# EmbeddingSettingsView

「向量嵌入」区段的受控视图。Global 作用域渲染整段服务配置（启用开关、Provider、模型、维度、Timeout、Base URL、API Key、请求扩展参数 JSON）；Project 作用域只渲染模型与维度两项覆盖，服务参数继承全局。视图只改草稿并通过 `update:modelValue` 交回宿主，不读 store、不调 API、不写持久化；旧面板 `NovelIdeEmbeddingSettingsPanel` 继续负责快照读写与 `saveGlobal` / `saveProject`，产品接线时再消费本视图。

草稿模型与序列化规则在 `embedding-settings-draft.ts`，视图与宿主共用：`buildGlobalEmbeddingPayload()` / `buildProjectEmbeddingPayload()` 是唯一的写回体出口。

Component Lab 中由 `EmbeddingSettingsViewFixture` 提供确定性场景（global-disabled / global-enabled / global-api-key / project-inherit / project-override）。

## 契约

```ts
type Props = {
    modelValue: EmbeddingSettingsDraft;   // {global: EmbeddingGlobalDraft; project: EmbeddingProjectDraft}
    scope?: "global" | "project";         // 决定渲染哪一段
    targetLabel?: string;
    disabled?: boolean;
};

type Emits = {
    (event: "update:modelValue", value: EmbeddingSettingsDraft): void;
};
```

空串一律表示「未配置 / 继承上层」：文本写成 `null`，数字按未配置处理。密钥留空表示保留原值，只有点「清除」才写入空串——清除会把 `apiKey` / `apiKeyConfigured` / `apiKeyMaskedValue` 三处一起改，`apiKeyCleared` 置位，宿主据此写回。请求扩展参数非合法 JSON 时按空对象处理，不在界面上抛错。启用开关打开但模型/维度留空时，写回体按 `text-embedding-3-small` / `1536` / `30000ms` 的三处默认值补齐。

## 布局规则

与设置外壳同源：不画卡片面，标题、服务配置、字段组之间用 1px `--divider` 横线分段；短字段并排、Base URL / API Key / JSON 占满整行，并排与否由视图自身的容器宽度（`@container min-width: 620px`）决定，不看窗口宽度。API Key 行内右侧是 danger 变体的「清除」按钮。视图自身不滚动（宿主负责滚动）。
