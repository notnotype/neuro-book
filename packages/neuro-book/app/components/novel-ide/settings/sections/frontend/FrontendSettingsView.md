---
标签: [state:inject]
---

# FrontendSettingsView

「前端设定」区段的受控视图：界面语言、主题两轴（主题包 × 配色明暗）、推理强度与默认视图模式。视图只消费 props 并把动作交回宿主，自己不读 store、不写持久化、不弹系统通知。

主题区段是两轴选择器，不做主题预览：主题包的名字与一句话简介由 `themeOptions` 带进来（来自主题包 manifest），当前选中态只用 `--accent-main` 描边与 `--bg-hover` 底表达。视图不解析主题、不碰主题注册表，也不自己算缩略图——两轴的取值与持久化都在宿主的主题会话与设置里。

```ts
interface Props {
    locale: string;
    viewMode: string;
    reasoning: string;
    reasoningOptions: string[];
    /** 可选主题包：名字与一句话简介来自主题包 manifest */
    themeOptions: readonly ProductThemeOption[];
    /** 当前主题包 id */
    themeId: ProductThemeId;
    /** 当前配色明暗 */
    appearance: ProductAppearance;
    /** 读取配置期间整段停用 */
    disabled?: boolean;
}

interface Emits {
    (event: "update:locale", value: string): void;
    (event: "update:viewMode", value: string): void;
    (event: "update:reasoning", value: string): void;
    (event: "select-theme", themeId: ProductThemeId): void;
    (event: "select-appearance", appearance: ProductAppearance): void;
}
```

## 布局

四块区段：语言 / 主题（主题包网格 + 配色两档）/ 推理强度 / 视图模式。主题包按 `repeat(auto-fill, minmax(180px, 1fr))` 排布，每格是主题包名 + 简介；配色是两枚按钮（浅色 / 深色，文案走 i18n），顺序固定亮在前。

## 交互

- 点主题包发 `select-theme`、点亮/暗发 `select-appearance`：两轴各自独立生效，切一轴不动另一轴；
- 全部动作都是 emit，视图不自己改任何状态；`disabled` 时整段停用（两轴按钮一并进 disabled）。

## 不支持

不读 store、不写 localStorage、不直接调主题会话或配置接口、不发请求；不自己弹通知（保存失败与回滚由宿主提示）。没有自定义主题、导入/导出这类入口。

## 隐藏通道理由

- `state:inject`：只注入应用 i18n 的 `useI18n()`；文案随宿主语言切换，不适合由父组件逐条传入。
