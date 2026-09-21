---
标签: [state:local]
---

# AgentUserInputPrompt

Agent 等待用户交互请求（Request User Input）的回答向导面板。当 Agent 执行过程中调用用户输入工具或表单时，替换底部常规 Composer，支持单选问题、表单填写（LowCodeForm）、补充备注说明与多条请求顺序导航。

## 数据

```typescript
type Props = {
    /** 待处理的用户交互会话请求列表。 */
    sessions: readonly AgentPendingUserInputSession[];
    /** 用户回答与表单填写的暂存草稿。 */
    draft: AgentPendingResolutionDraft;
    /** 是否正在提交回答。 */
    submitting?: boolean;
    /** 是否允许提交回答。 */
    canResolve: boolean;
    /** 是否允许终止当前运行。 */
    canAbort: boolean;
    /** 阻塞提交的原因文案。 */
    blockedMessage?: string;
    /** 提交异常状态。 */
    submissionIssue?: AgentPendingSubmissionIssue | null;
    /** 菜单刷新标识。 */
    menuRefreshKey: string | number;
    /** 触发菜单解析函数。 */
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 技能触发开始回调。 */
    onSkillTriggerStart?: () => void;
};

type Emits = {
    (e: "update:draft", value: AgentPendingResolutionDraft): void;
    (e: "submit"): void;
    (e: "cancel"): void;
    (e: "resync"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不直接向服务端发送回答，通过 emits 统一冒泡至主流程调度。
