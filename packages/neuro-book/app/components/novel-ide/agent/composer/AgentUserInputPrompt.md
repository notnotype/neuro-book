---
标签: [state:local]
别名: ["用户输入引导", "Agent 用户输入提示", "User Input Prompt"]
---

# AgentUserInputPrompt

Agent 等待用户交互请求（Request User Input）的回答向导面板。当 Agent 执行过程中调用用户输入工具或表单时，替换底部常规 Composer，支持单选问题、表单填写（LowCodeForm）、补充备注说明与多条请求顺序导航。

## 布局

由四个主要垂直分层组成（`flex flex-col` 布局，高度由内容自适应支撑，约束在 `min-h-[220px]` 与 `max-h-[min(560px,78dvh)]` 之间）：
1. **向导头部（Header）**：固定高度，展示待处理标题、当前题目进度与类型标记。当存在多题时显示翻页导航箭头与题数 badge，单题时自动收紧为紧凑单行。
2. **状态提示栏（Banners）**：当操作被系统或前序流程阻断（`blockedMessage`）或提交出现重试/同步异常（`submissionIssue`）时吸顶展示对应警示横幅。
3. **内容交互区（Content Area）**：
   - 表单模式：挂载 `LowCodeForm`，支持平滑滚动与显式确认；
   - 问答与审批模式：分为上半部选项滚动列表与下半部补充说明输入栏。
   - 空间分配与让位策略：单选题模式下，底部补充说明输入框采用紧凑形态（高度约 36px~44px），将垂直空间优先让位给核心题目与选项列表，避免短列表产生内层滚动条；仅在开放式简答或选中“其他答案”时，输入框自动扩展为答题区。
4. **操作底部（Footer）**：左侧为带有清晰按钮外观的「终止本轮」动作（杜绝复选框歧义），右侧为主操作按钮（根据题目完成进度智能切换「确认此项」、「下一条」或「确认并提交」）。
5. **窄屏（390×844）适配**：外层自适应 `w-full`，Header 与 Footer 中的元素均支持平滑换行与自适应截断，保证在移动端小屏或窄侧边栏下无水平溢出，按钮触控热区保持标准高度。

## 交互

- **选项单选**：点击任意选项卡片激活单选状态，支持键盘 Tab 导航，具备清晰的焦点指示环（`focus-visible:ring-2`）；
- **其他答案联动**：点击「其他答案」选项，焦点自动平滑移动到下方输入框，输入框占位符与标题实时变为必填指示；
- **流转导航**：单题模式下，用户做完选择即可直接点击主按钮提交；多题模式下，点击主按钮依次推进到下一未完成题目，全部完成后主按钮切换为「确认并提交」；
- **异常恢复**：当提交结果异常（`submissionIssue` 处于 `unknown` 状态）时，顶部提供「重新同步」按钮，通知宿主重新拉取会话状态；
- **终止运行**：点击「终止本轮」按钮直接触发 `@cancel` 事件，由宿主中断当前 Agent 运行。

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
- **不支持**：不直接向服务端发送回答或发起网络请求，所有用户交互结果与中断指令均通过 emits 统一冒泡至主流程调度。

## 状态

- **单选状态**：高亮选中卡片，指示器呈现主色实心状态，未选中时保持微弱悬浮态；
- **开放简答状态**：选项区域自动隐藏，输入框展开为主答题区，显示必填提示与对应占位符；
- **多步问答状态**：Header 呈现当前题目索引与已完成进度 pill，右侧提供题目切换按钮，主按钮随步骤推进动态切换文案；
- **表单确认状态**：Low-Code Form 模式下，用户修改表单后必须先确认此项，防止静默提交未复核内容；
- **提交处理中**：主按钮展示旋转 loading 动画，所有输入控件进入禁用态；
- **权限阻断状态**：展示危险警示条，操作控件禁用，清晰说明阻断原因（如前序生成未完成）；
- **同步异常状态**：展示告警横幅并提供一键重新同步按钮。

## 注意事项

- 面板替换常规 Composer 输入框展示，因此宿主容器需保证提供至少 220px 的纵向可见区域；
- 底部输入框使用了 `AgentComposerInput`，Pending 回答只消费引用与 Skill Chip，不暴露会改写 Session 的斜杠命令。
