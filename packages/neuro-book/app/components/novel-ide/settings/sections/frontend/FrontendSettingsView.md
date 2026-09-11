---
标签: [state:inject, state:local]
---

# FrontendSettingsView

「前端设定」区段的受控视图：界面语言、主题管理（内置/自定义卡片、新建、复制、编辑、导出、删除、导入）、推理强度与默认视图模式。视图只消费 props 并把动作交给宿主，自己不读 store、不写持久化、不弹系统通知。

主题卡片刻意自带一份**解析后的变量表**（`vars`）：迷你预览要用该主题自己的变量绘制，视图不解析主题、也不碰主题注册表。当前生效主题用 `activeThemeId` 判断高亮。

导入是唯一的例外：视图持有 file input 并用纯工具 `parseThemeJson` 解析，成功发 `import-theme`、失败发 `import-failed`——落盘与提示都归宿主。

```ts
type FrontendThemeCard = {
    id: string;
    name: string;
    appearance: "light" | "dark";
    /** 该主题解析后的变量表，用于迷你预览 */
    vars: Record<string, string>;
    /** 非空表示自定义主题，携带可编辑的原始 DTO */
    custom: CustomThemeDto | null;
};

interface Props {
    locale: string;
    viewMode: string;
    reasoning: string;
    reasoningOptions: string[];
    builtInThemeCards: FrontendThemeCard[];
    customThemeCards: FrontendThemeCard[];
    activeThemeId: string;
    activeThemeLabel: string;
    activeThemeIsBuiltIn: boolean;
    /** 读取配置期间整段停用 */
    disabled?: boolean;
}

interface Emits {
    (event: "update:locale", value: string): void;
    (event: "update:viewMode", value: string): void;
    (event: "update:reasoning", value: string): void;
    (event: "select-theme", themeId: string): void;
    (event: "create-theme"): void;
    (event: "copy-theme", themeId: string): void;
    (event: "edit-theme", theme: CustomThemeDto): void;
    (event: "export-theme", themeId: string): void;
    (event: "delete-theme", theme: CustomThemeDto): void;
    (event: "import-theme", theme: CustomThemeDto): void;
    (event: "import-failed", message: string): void;
}
```

## 布局

四块横排卡片：语言 / 主题（含两张卡片网格）/ 推理强度 / 视图模式。卡片网格按 `repeat(auto-fill, minmax(150px, 1fr))` 排布，迷你预览固定 64px 高，名称行与预览之间用主题自己的变量画分隔线——列表底盘始终跟随当前主题。

## 交互

- 卡片点击＝切换主题（内置与自定义同一动作，都发 `select-theme`）；
- 悬停才出现操作按钮，内置主题只有「复制为自定义 / 导出」，自定义主题多「编辑 / 删除」；
- 全部动作都是 emit，视图不自己改任何状态；`disabled` 时整段停用（含导入按钮）。

## 不支持

不读 store、不写 localStorage、不直接调主题管理器、不发请求；不自己弹通知（导入失败也交回宿主）。主题编辑窗口与删除确认窗口都是宿主级浮层，不在本视图内。

## 隐藏通道理由

- `state:inject`：只注入应用 i18n 的 `useI18n()`；文案随宿主语言切换，不适合由父组件逐条传入。
- `state:local`：文件 input 与「正在导入」这类瞬时状态属于本视图，组件销毁即丢弃。
