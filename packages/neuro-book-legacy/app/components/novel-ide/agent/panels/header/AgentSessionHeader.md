---
标签: [state:local]
---

# AgentSessionHeader

Agent 右侧抽屉/边栏顶部标题栏。左侧展示当前活跃会话的图标、会话标题、运行模式徽标、会话摘要以及会话总结器状态指示；右侧集成常用操作入口（新建会话、附件抽屉开关、关联 Agent 抽屉开关、分支树弹窗、系统提示词面板、会话列表弹窗以及关闭抽屉按钮）。

## 数据

```typescript
type SummarizerStatus = {
    className: string;
    title: string;
    icon: string;
    spinning: boolean;
    label: string;
};

type Props = {
    /** 抽屉主体图标样式类名。 */
    drawerIconClass: string;
    /** 当前会话主标题。 */
    activeSessionTitle: string;
    /** 当前会话运行模式标签（如“小说创作”、“计划与大纲”）。 */
    activeDrawerTitle: string;
    /** 当前会话最新摘要文案。 */
    activeSessionSummaryText: string;
    /** 自动总结器当前状态指示（生成中、已就绪、报错等）。 */
    summarizerStatus?: SummarizerStatus | null;
    /** 是否可选择 Profile 创建新会话（下拉菜单）。 */
    canChooseCreateProfile?: boolean;
    /** 新建会话可选 Profile 下拉项。 */
    createProfileDropdownItems?: any[];
    /** 会话是否正在加载/切换中。 */
    loadingSession?: boolean;
    /** 当前活跃会话 ID。 */
    activeSessionId: number | null;
    /** 附件面板是否展开。 */
    attachmentPanelOpen?: boolean;
    /** 当前会话已引用的附件数量。 */
    sessionAttachmentUniqueTotal?: number;
    /** 关联 Agent 面板是否展开。 */
    linkedAgentPanelOpen?: boolean;
    /** 当前会话关联的子/父 Agent 数量。 */
    linkedAgentCount?: number;
    /** 当前交互上下文是否允许分支与历史修改。 */
    canMutateHistory?: boolean;
    /** 系统提示词面板是否展开。 */
    systemPromptPanelOpen?: boolean;
};

type Emits = {
    (e: "create-session", profileKey?: string): void;
    (e: "toggle-attachment-panel"): void;
    (e: "toggle-linked-agent-panel"): void;
    (e: "open-session-tree"): void;
    (e: "toggle-system-prompt"): void;
    (e: "open-session-dialog"): void;
    (e: "close"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不在组件内部直接管理会话状态或发起加载请求，所有交互通过 emits 向上派发。
