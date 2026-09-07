---
标签: [state:inject, state:local]
---

# AgentProfileSettingsView

完整 Agent Profile 设置页的受控视图：左侧 Profile 导航（含默认设置入口），右侧详情，常用设置优先，高级参数折叠。它组合本目录的 `AgentProfileNavList`、`AgentProfileDefaultsPanel`、`AgentProfileDetailPanel`、`AgentProfileModelFields`、`ProfileRuntimeSettingsFields` 与共享 `LowCodeForm`，自身不发起请求、不写持久化，一切修改通过 `update:modelValue` 交给宿主。

行为合同见 [`docs/specs/ui/agent-profile-settings.md`](../../../../../docs/specs/ui/agent-profile-settings.md)。Component Lab 中由 `AgentProfileSettingsViewFixture` 提供确定性场景（global / project / statuses / custom-settings / empty / loading / saving / load-error / save-error），保存仅更新 fixture 内存基线并提示「已保存到本次预览」，不写真实配置。

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
    /** 作用域目标名（如项目名），空串表示无目标 */
    targetLabel: string;
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
    /** 上次被宿主接受的页面草稿；未保存标记的比较基线 */
    baseline: AgentProfileSettingsPageDraft;
    context: AgentProfileSettingsContext;
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
    /** 校验通过后的保存请求；携带整份页面草稿，由宿主执行真实保存 */
    (event: "save", value: AgentProfileSettingsPageDraft): void;
    /** 加载错误态的重载请求 */
    (event: "reload"): void;
    /** 维护区确认后的 Home 重置请求 */
    (event: "reset-home", profileKey: string): void;
}
```

## 布局

桌面（容器 ≥700px）双栏：左侧 260px 导航，右侧 `minmax(0, 1fr)` 详情；外层布局不给面，导航与详情各自是面板 Surface。窄于 700px 单列，导航与详情二选一（当前实现通过容器断点类按视口切换）。详情区标题常驻、内容纵向滚动；Profile 内容固定顺序：身份与状态 → 使用模型 → 专属设置 → 高级模型参数（折叠）→ 运行策略（折叠）→ 诊断与维护。加载失败原因同时在头部可见。

## 交互

- 导航选择、搜索过滤沿用 `AgentProfileNavList` 合同；选中的 Profile 从草稿移除时回到默认设置页。
- 「保存修改」在校验通过且存在修改时可用，携带整份草稿；「放弃修改」经确认后恢复基线；「恢复默认」只清空当前 Profile 的覆盖，仍是待保存修改。
- 键盘：Tab 顺序覆盖头部动作、导航与详情控件；对话框焦点由 nb-ui Dialog/AlertDialog 合同承载。
- 容器宽度小于 700px 时单列切换（当前实现按视口断点，见已知偏差）。

## 状态

- loading：内容区显示骨架，不挂可编辑控件；saving：保存提示可见，全部修改与重置入口禁用。
- loadError：错误文案加重载按钮；saveError：就地错误，草稿与未保存标记保留，可再次提交。
- 校验失败（温度/TopK/运行策略）在字段下显示错误并阻止保存。

## 不支持

- 不创建、删除、改名 Profile；不发起真实保存、编译或模型调用；不读取路由、store 或浏览器存储；无 slots、无 expose。

## 注意事项

- `modelValue` 与 `baseline` 必须由宿主持有；组件对 props 只读。
- 未保存标记比较页面草稿与 baseline 的可编辑字段，忽略编译状态等只读派生信息；非法输入仍视为有修改。
- 旧宿主 `NovelIdeAgentProfileModelSettingsPanel.vue` 的 `runtime-override-count` / `settings-override-count` props 已由 `runtime-baseline` 与草稿内计数取代，计数逻辑收敛到本目录组件内部。

## 已知偏差

- 窄屏单列切换目前按视口断点实现，尚未按组件容器宽度（Lab 画布）切换；`390 × 844` 视口下工作正常， Lab 手机画布内的行为与该偏差一致。
- 「放弃修改」确认当前直接恢复基线，未使用 AlertDialog 包装确认对话框。

## 隐藏通道理由

- `state:inject`：仅注入应用 i18n 的 `useI18n()` 翻译能力；文案随宿主语言切换，不适合由父组件逐条传入。
- `state:local`：持有选中导航 key、搜索词、折叠开合等视图临时状态，组件销毁即丢失。
