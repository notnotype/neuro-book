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
    // 外壳不显示配置目标标签，也不做项目切换；项目作用域的目标文案由各区段视图自己从宿主取。
    versionLabel?: string;      // 左下角版本，等宽数字
    environmentLabel?: string;  // 左下角环境标注（Lab / 本地 / 生产）
    githubUrl?: string;
    /** 读取中：外壳画居中的加载占位（宿主按「延时」判定，读得快不闪） */
    loading?: boolean;
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

加载与失败都由共享的 `SettingsLoadState` 呈现，占满内容区、居中，并且不挂可编辑控件：

- `loading`（居中的指示 + 一句能独立成立的说明）；
- `loadError`（失败形态：原因 + 重试按钮，触发 `reload`）。

**加载只有外壳这一层**：区段视图不接收 `loading` / `loadError`——宿主把所有来源（共享快照 + 各区段自带的取数，如 Provider 会话、Agent Profile 元数据）组合成一个忙信号与一个失败信号交给外壳，读取期间外壳画占位、交互按忙信号禁用。分层各自画一次就会叠出「两层加载」。

**只有延时判据**：宿主在请求飞出去后等一小段时间（`useDelayedFlag`，200ms）才显示占位——读得快时什么都不出现，不会闪一下。没有「细进度条」这类第二形态：加载就是这块居中占位，别再加第二种表达。外壳自身只有「移动端单列是否停在导航」与「按作用域记住区段」这两个局部状态。
