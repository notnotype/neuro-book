---
标签: [env:portal, state:inject, state:local]
---

# AgentProfileSettingsView

完整 Agent Profile 设置页的受控视图：左侧 Profile 导航（含默认设置入口），右侧由身份摘要、模型设置、专属设置与运行策略等独立区段组成，常用设置优先，高级参数折叠。它组合本目录的领域区段与共享 `LowCodeForm`，自身不发起请求、不写持久化，一切修改通过 `update:modelValue` 交给宿主。

行为合同见 [`docs/specs/ui/agent-profile-settings.md`](../../../../../docs/specs/ui/agent-profile-settings.md)。Component Lab 中由 `AgentProfileSettingsViewFixture` 提供确定性场景（global / project / dialog-window / statuses / custom-settings / empty / loading / saving / load-error / save-error）；其中 `dialog-window` 通过 nb-ui `DialogWindow` 展示同一受控视图，关闭后保留本场景的重新打开入口。视图是就地保存的：fixture 在每次修改后立即更新内存快照并提示「改动已就地保存到本次预览」，不写真实配置。
当视图嵌入已有窗口标题（如 `DialogWindow`）时，宿主可传入 `showNavHeading=false`：导航保留 `aria-labelledby` 对应的屏幕阅读器标题，但不再渲染视觉 `Agent Profiles` 标题，避免与窗口标题重复。
视图自身不画卡片面：导航轨与详情由一条 1px 竖线分开，区段之间用同款横线分隔，静止态带描边的只有控件（输入框、下拉、按钮）。竖线与横线同款同色，并且和横线一样两端留 16px 边距（不顶到标题栏分隔线与窗口下沿）；导航轨与详情内容列没有会被横线穿越的底部动作栏。导航轨、详情内容列的左右内边距统一为 16px——与宿主窗口标题栏的 `pl-4` 对齐；宿主是 `DialogWindow` 时窗口里只有一层 chrome，不会出现「窗口套两张卡片」的双层边框。详情内容列封顶 `max-w-3xl`（768px）：窗口拖宽时控件与区段分隔线都不再增长，避免出现整行宽的下拉框。视图不展示作用域：它是宿主 chrome 的职责（宿主自己的设置界面已有作用域切换与标题），视图只透传 `scope` 用于继承解析。

```ts
// 页面草稿：一次编辑会话中的全部可编辑配置（与 agent-profile-draft.ts 的单 Profile
// AgentProfileSettingsDraft 不同层）。
type AgentProfileSettingsPageDraft = {
    /** 空串表示跟随上层默认 Profile */
    defaultProfileKey: string;
    modelDefaults: AgentProfileModelDraft;
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    profiles: AgentProfileDraft[];
};

// 宿主准备好的只读上下文；视图不自行获取任何数据。
type AgentProfileSettingsContext = {
    scope: "global" | "project";
    /** 上层继承的默认 Profile key；草稿为空串时的实际生效值 */
    inheritedDefaultProfileKey: string;
    /** Global 层默认模型参数，作为 Project 默认参数的继承基线 */
    globalModelDefaults: AgentProfileModelConfigDto;
    /** Global 层单 Profile 模型覆盖；仅 Project scope 叠加 */
    globalProfileModels: Record<string, Partial<AgentProfileModelConfigDto>>;
    /** 已解析的配置元数据与继承层 */
    settings: ConfigAgentProfileSettingsDto;
    /** Profile 用途文案表；缺省 key 不渲染说明 */
    descriptions: Record<string, string>;
};

interface AgentProfileSettingsViewProps {
    /** 受控页面草稿；组件不直接修改，仅 emit 更新 */
    modelValue: AgentProfileSettingsPageDraft;
    context: AgentProfileSettingsContext;
    /** 内嵌于已有窗口标题时隐藏导航视觉标题；无障碍标题仍保留 */
    showNavHeading?: boolean;
    /** false */
    loading?: boolean;
    /** false */
    saving?: boolean;
    /** 空串 */
    loadError?: string;
    /** 空串 */
    saveError?: string;
    /** 正在重置 Home 的 profileKey；空串表示无进行中的重置 */
    resettingHomeKey?: string;
}

interface AgentProfileSettingsViewEmits {
    /** 任意字段修改；value 为复制被改分支后的新页面草稿 */
    (event: "update:modelValue", value: AgentProfileSettingsPageDraft): void;
    /** 加载错误态的重载请求 */
    (event: "reload"): void;
    /** 维护区确认后的 Home 重置请求 */
    (event: "reset-home", profileKey: string): void;
}
```

## 布局

- 依托 CSS Container Query（`container-type: inline-size`）按组件自身容器宽度响应：容器宽度小于 700px 时自动切换为单列（导航与详情二选一），详情区顶部提供轻量切换条；容器宽度 ≥700px 时保持标准双栏。详情区内 Profile 内容固定顺序：身份与状态 → 使用模型 → 专属设置 → 高级模型参数（折叠）→ 运行策略（折叠）。
- `dialog-window` 仅是 Component Lab fixture 的组合场景：由宿主 fixture 传入页面草稿、基线和上下文，再将同一受控视图放入 nb-ui `DialogWindow`。关闭后由 fixture 保留重新打开入口；设置视图本身不持有窗口状态，也不改变正式宿主接线。

## 交互

- 导航选择、搜索过滤沿用 `AgentProfileNavList` 合同；选中的 Profile 从草稿移除时回到默认设置页。Profile 详情以稳定 `profileKey` 作为组件 key，切换 Profile 时重建本地折叠状态。
- 就地保存：任何字段修改都立即发出 `update:modelValue` 交给宿主持久化，界面没有保存 / 放弃按钮；维护区只保留经确认的「重置 Home」；批量恢复默认已删除（自动保存下它会立即写盘且无法撤销，逐字段的继承 / 默认选项可达到同样结果）。
- 运行策略默认页的 Global 基线从 harness 开始，Project 基线叠加已保存的 Global patch；Profile 详情按 `harness → profileDefault → globalDefault → globalProfile → projectDefault` 解析，当前作用域的默认设置草稿可立即影响跟随项，但当前 Profile 草稿不参与自身继承基线。
- 键盘：Tab 顺序覆盖导航与工作区字段；重置 Home 确认弹窗取消、确定或 Escape 后焦点恢复到真实发起按钮。
- 依托 CSS Container Query（`container-type: inline-size`）实现容器宽度 `<700px` 单列切换，在 Lab 画布、手机视口或不同尺寸 DialogWindow 中均能精准响应。

- loading：内容区显示骨架，不挂可编辑控件；saving：内容列顶部内联显示「保存中…」，全部修改与重置入口禁用。
- loadError：错误文案加重载按钮；saveError：内容列顶部内联显示「保存失败：…」，草稿保留可继续编辑，宿主负责重试。
- 校验失败（温度/TopK/运行策略）在字段下显示错误并标记 `aria-invalid`；温度/TopK 错误会自动展开高级模型区。

## 不支持

- 不创建、删除、改名 Profile；不发起真实保存、编译或模型调用；不读取路由、store 或浏览器存储；无 slots、无 expose；attrs 透传到单根元素。

## 上游边界

确认弹窗由 nb-ui `AlertDialog` 提供模态、焦点和 Portal 语义；本视图只负责受控开合、确认动作和取消后的本地状态清理，不承诺上游组件未声明的动画与焦点细节。

## 注意事项

- `modelValue` 必须由宿主持有；组件对 props 只读，只负责把修改即时交回宿主。
- runtime 层序 helper 仅服务本 Lab 受控 View：默认页与 Profile 的当前草稿继承语义在 `profile-runtime-settings.ts` 中集中定义；正式旧宿主仍独立组装 runtime 层，未因本 Task 自动迁移。
- 就地保存下没有「未保存」概念：宿主保存成功即推进自己的快照，失败用 `saveError` 回报，草稿不因失败被丢弃。
- 旧宿主 `NovelIdeAgentProfileModelSettingsPanel.vue` 的 `runtime-override-count` / `settings-override-count` props 已由 `runtime-baseline` 与草稿内计数取代，计数逻辑收敛到本目录组件内部。
- Component Lab fixture 的数据面板同步覆盖 `draft`、`saved` 和 `message`：每次修改后立即反映本次预览的内存快照与提示。
## 隐藏通道理由

- `env:portal`：Project Home 重置的 `AlertDialog` 必须脱离设置页滚动容器渲染到 nb-ui 的浮层宿主，避免被工作区 overflow 裁剪并让模态焦点语义完整。
- `state:inject`：仅注入应用 i18n 的 `useI18n()` 翻译能力；文案随宿主语言切换，不适合由父组件逐条传入。
- `state:local`：持有选中导航 key、搜索词、折叠开合和确认 Dialog 状态，组件销毁即丢失。
