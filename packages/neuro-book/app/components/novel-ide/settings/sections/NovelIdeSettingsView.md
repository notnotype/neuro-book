---
标签: [state:local]
---

# NovelIdeSettingsView

NeuroBook 设置界面的外壳视图：一栏作用域与区段导航 + 内容区，区段体由宿主通过默认插槽提供。它只消费宿主解析好的作用域、区段与状态，不读 store、不发请求、不写持久化；作用域与区段都是受控的，切换只通过 `update:scope` / `update:modelValue` 交回宿主。

Component Lab 中由 `NovelIdeSettingsViewFixture` 提供确定性场景（global / project / dialog-window / loading / load-error）：`global` 与 `project` 在内容槽里挂真实的 `AgentProfileSettingsView`，`dialog-window` 通过 nb-ui `DialogWindow` 展示同一组合。四档作用域都能进入：`global` 挂七个区段（Provider / 模型角色 / Agent Profile / Web 工具 / 向量嵌入 / 费用显示 / 可观测），`project` 挂 Agent Profile，`boot` 挂密码保护，`browser` 挂前端设定 / 编辑器 / 桌面应用；区段体由 fixture 自己提供确定性数据，不读 store。区段切换走「短位移 + 淡入」（§七 内容切换），两段各取 `--motion-fast`。

## 契约

```ts
type SettingsSectionOption = {
    value: string;
    label: string;
    description: string;
    iconClass: string;
    /** 该区段出现在哪些作用域下；可见区段是它与当前作用域的交集 */
    scopes: SettingsScopeId[];
    /**
     * 内容布局。默认 `scroll`：外壳给内边距并拥有滚动，适合阅读型区段。
     * `fill`：区段自己占满内容区并管理内部滚动（两栏型、长列表型），外壳不加内边距也不再套一层滚动。
     */
    layout?: "scroll" | "fill";
};

type NovelIdeSettingsViewProps = {
    /** 受控作用域 */
    scope: "boot" | "global" | "project" | "browser";
    scopes: SettingsScopeOption[];  // label / description / disabledReason，两字短标签
    sections: SettingsSectionOption[];
    /** 受控区段 id；切换作用域时视图改选该档「上次停留」的区段，没记过才取第一个 */
    modelValue: string;
    /** 项目作用域下的配置目标标签；空则不显示 */
    targetLabel?: string;
    versionLabel?: string;      // 左下角版本，等宽数字
    environmentLabel?: string;  // 左下角环境标注（Lab / 本地 / 生产）
    githubUrl?: string;
    /** 整屏加载占位：只在确实没有内容可显示时用（宿主负责「首屏 + 短延时」的判据） */
    loading?: boolean;
    /** 有内容可显示时的后台重取：内容原地保留，只在内容列顶端走一条细进度条 */
    busy?: boolean;
    loadError?: string;
};

type NovelIdeSettingsViewEmits = {
    (event: "update:scope", value: SettingsScopeId): void;
    (event: "update:modelValue", value: string): void;
    (event: "reload"): void;
};
```

可见区段 = 宿主给的 `sections` 与当前 `scope` 的交集；视图不自行过滤产品规则，也不需要知道某个区段属于哪一档。作用域一档只有约 61px，标签请用两字（更长的标签会被截断），写到哪里放 `description` 作悬停提示。

**作用域记忆**：视图按作用域记住上次停留的区段（`lastSectionByScope`），切回来回到原处；没记过或记的那个在这档不存在时，才取该档第一个区段。这条规则必须是单向的——修「有的方向跳第一个、有的方向保留当前」的不一致，只能靠一个明确的记忆规则，不能靠 `if` 补丁。

## 布局规则

与 `AgentProfileSettingsView` 同源：导航轨 276px（自带 16px 内边距），轨与内容之间是一条 1px 竖线，两端各留 16px，不与标题栏或内容边线相接；轨内不画卡片面，只有控件自身带描边。内容区不设 `max-width`——是否封顶由区段体决定（阅读型区段自己封 `max-w-3xl`，两栏型区段如 Agent Profile 需要整幅宽度）。窄容器（容器宽度 < 700px）退化为单列：导航与内容互斥，顶部切换条往返，轨道竖线一并去掉。显示态由 `@container` 查询独占，元素上不挂 display 工具类，因此不需要 `!important`。

## 状态

加载与失败都由共享的 `SettingsLoadState` 呈现，占满内容区并且不挂可编辑控件：

- `loading`（整屏占位：转动的指示 + 一句能独立成立的说明）；
- `busy`（有内容时的后台重取：内容原地保留，内容列顶端走 1px 细进度条，不推动布局）；
- `loadError`（失败形态：原因 + 重试按钮，触发 `reload`）。

宿主负责「什么时候用哪个」：读得快时不该闪整屏占位——只有「确实没有内容可显示」且已经等过一个短延时（`useSettingsSnapshot` 的 `blockingLoading`）才用 `loading`；有旧内容就保留内容、只给 `busy`。三者都不影响导航可用性。外壳自身只有「移动端单列是否停在导航」与「按作用域记住区段」这两个局部状态。
