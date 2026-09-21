---
标签: [state:local, env:timer]
---

# AgentChatFlow

Agent 会话流的滚动与消息列表容器。承载多轮对话中用户提问、思考过程、模型回复、工具调用与工作流气泡的垂直流式展示，并管理自动吸底、向上加载更早历史以及滚动锚定（Scroll Anchoring）。

## 布局

由三部分垂直组织而成，外层为弹性自适应高度的纵向滚动容器：

1. **顶部历史加载区（可选）**：当存在更早历史、正在拉取或拉取失败时显示。包含居中的操作按钮（加载中转圈 / 出错重试 / 加载更早）与右侧局部错误截断说明。
2. **消息列表主体（有数据时）**：遍历由 `messages` 展平计算出的节点列表。
   - 节点垂直排列，通过前置与当前节点的类型动态收敛外边距（连续工具调用或思维链之间紧凑排列，不同气泡间保持标准间距）。
   - 默认插槽 `#node="{ node, index }"` 允许外部自定义节点渲染，未提供时由内置节点分发器渲染文本气泡（`AgentTextBubble`）或工具气泡（`AgentToolBubble`）。
3. **空状态区（无数据时）**：当消息列表为空时垂直居中展示。
   - `main` 模式且 `unselected`：黄色警示图标与提示，引导用户从列表选择对话。
   - `main` 模式常规：机器人图标与欢迎引导说明。
   - `compact` 模式：紧凑转圈状态与等待提示。

在标准桌面（>= 1440px）与移动端手机（`390×844`）下，滚动容器充满父级可用空间，无横向溢出，底部保留安全内边距（`pb-12`）。

## 交互

- **自动吸底（Stick-to-bottom）**：
  - 默认处于吸底状态。新消息生成或最后一条消息尺寸/文本长度变化时，使用 `requestAnimationFrame` 防抖合并滚动指令，平滑滚动至最底部。
  - 用户主动向上滚动时，若距离底部超过 12px 阈值，立即释放吸底状态，保持用户当前阅读位置，不强行将视口拉回底部。
  - 当用户再次滑回距离底部 12px 以内时，自动恢复吸底。
- **更早历史分页与无感锚定（Scroll Anchoring）**：
  - 用户向上滚动接近顶部时，自动触发更早历史拉取事件 `load-previous`，并记录当时的滚动高度与首项消息 ID 作为锚点。
  - 亦可直接点击顶部按钮手动加载或重试。
  - 历史数据返回并 prepend 到列表顶部后，根据高度差无缝修正 `scrollTop`，使用户视野内的原顶部消息保持在原屏幕绝对位置，视觉无跳动。
- **切换会话即时定位**：
  - 当 `sessionId` 变化时，重置所有滚动锚点，立即强制定位到底部，避免在长会话间切换时产生从顶部到底部的视觉飞跃。

## 数据

```ts
interface AgentChatFlowProps {
    /** 消息列表。 */
    messages: AgentMessage[];
    /** 当前会话 ID；变化时认为是整段历史切换，需要立即定位到底部。 */
    sessionId?: number | null;
    /** 有可用对话但尚未选择时，显示选择提示而不是伪装成空历史。 */
    unselected?: boolean;
    /** 是否正在执行中。 */
    running?: boolean;
    /** 模式区分。main 显示标准空状态引导，compact 显示紧凑等待态。 */
    mode?: "main" | "compact";
    /** 当前 durable history 是否还有更早一页。 */
    historyHasPrevious?: boolean;
    /** 是否正在加载更早历史。 */
    historyLoading?: boolean;
    /** 更早历史的局部加载错误信息。 */
    historyError?: string;

    // 以下透传属性用于默认内置渲染器，由具名插槽重写时可省略：
    editingMessageId?: string | null;
    editingMessageText?: string;
    messageActionDisabled?: boolean;
    runActionDisabled?: boolean;
    savingEdit?: boolean;
    sessionAttachments?: AgentSessionAttachmentItemDto[];
    canRegisterAttachments?: boolean;
    canInsertAttachments?: boolean;
    projectRoot?: string | null;
    modelSupportsImages?: boolean;
    attachmentInsertRequest?: {id: number; item: AgentSessionAttachmentItemDto} | null;
    branchSwitcherStateByMessageId?: Record<string, AgentMessageSwitcherState>;
    menuRefreshKey?: string | number;
    resolveEditorMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onEditorSkillTriggerStart?: () => void;
    openReference?: (target: string) => void;
    costDisplayOptions?: CostDisplayOptions;
    costExchangeRateSuffix?: string;
}

interface AgentChatFlowEmits {
    /** 向上滚动到顶或点击顶栏时请求加载更早历史。 */
    (e: "load-previous"): void;

    // 子气泡透传事件（用于默认内置渲染）：
    (e: "copy", message: AgentMessage): void;
    (e: "copy-tool", toolCall: AgentToolCall): void;
    (e: "start-edit", message: AgentMessage): void;
    (e: "cancel-edit", message: AgentMessage): void;
    (e: "save-edit", payload: {message: AgentMessage; content: string}): void;
    (e: "retry", message: AgentMessage): void;
    (e: "branch-from-here", message: AgentMessage): void;
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
    (e: "attachment-registered", item: AgentSessionAttachmentItemDto): void;
    (e: "resend-unknown", message: AgentMessage): void;
    (e: "dismiss-unknown", message: AgentMessage): void;
}
```

### 插槽 (Slots)

- `#default` 或 `#node="{ node, index }"`：单个节点项的作用域插槽。外部提供时完全由外部控制气泡组件与交互，解耦所有子气泡 props/emits。
- `#empty`：自定义空状态插槽。
- `#history-loader`：自定义历史加载栏插槽。

### 暴露方法 (Expose)

- `scrollToBottom: () => void`：外部显式强制滚动到底部并重新激活吸底。
- `scrollRef: Ref<HTMLDivElement | null>`：底层原生滚动元素引用。

## 状态

- **空状态**：根据 `mode` 与 `unselected` 分别展示引导、警示或等待指示器。
- **普通展示**：遍历呈现各节点，流式更新平滑滚底。
- **历史加载中**：顶部按钮显示 loading 转圈状态并禁用点击。
- **历史出错**：顶部按钮切换为重试图标并显示红色错误提示文本。

## 不支持

- 不支持虚拟滚动（Virtual List）。长会话依赖后端分页（每次拉取 30 条），当前 DOM 节点数由会话分页长度控制，不设窗口化裁剪。
- 不自身持久化滚动位置，页面重载或切换会话时始终回到最新消息底部。
- 不直接发起任何网络请求或读取数据库；历史数据的加载完全通过 `@load-previous` 声明式委托给父级宿主。

## 隐藏通道理由

- `env:timer`：使用 `requestAnimationFrame` 将流式更新触发的多次滚动合并到单帧渲染中，降低高频流式输出带来的回流抖动；组件销毁时通过 `cancelAnimationFrame` 释放。
- `state:local`：持有当前是否吸底（`shouldStickToBottom`）、上次滚动高度与顶部锚定快照（`pendingPrependAnchor`）等纯界面展示与交互状态，组件销毁即丢弃，不污染外部全局状态。
