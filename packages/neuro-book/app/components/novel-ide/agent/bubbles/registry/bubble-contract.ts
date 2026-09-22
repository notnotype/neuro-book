import type {Component} from "vue";
import type {AgentMessage, AgentMessageSwitcherState, AgentPendingUserInputSession, AgentToolCall, ChatNode} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentAttachmentUrlResolver} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {AgentWorkflowObservation} from "../../composables/useAgentWorkflowObservation";
import type {CostDisplayOptions} from "nbook/app/utils/cost-format";

/**
 * 气泡渲染模式。
 * - inline: 行内紧凑折叠卡片（默认轻量 Tool 调用）
 * - block: 块级卡片，展开时承载专用预览（如文件读写、补丁、工作流详情）
 * - message: 完整宽度消息气泡（如用户提问审批、模式切换卡片、任务清单）
 * - full: 全宽独立面板
 */
export type AgentBubbleRenderMode = "inline" | "block" | "message" | "full";

/**
 * 气泡基础元数据，用于折叠头、图标与预解析文案。
 */
export interface AgentBubbleMeta {
    typeLabel: string;
    iconClass?: string;
    collapsedPreview?: string;
    collapsedPreviewKey?: string;
    defaultExpanded?: (node: ChatNode) => boolean;
}

/**
 * 下发给气泡的只读上下文环境。
 * 绝不向气泡传递整个 Store、SSE 句柄或 API 客户端，只提供纯只读派生数据与解析函数。
 */
export interface AgentBubbleContext {
    sessionId: number | null;
    projectRoot: string | null;
    resolveAttachmentUrl?: AgentAttachmentUrlResolver;
    openReference?: (target: string) => void;
    pendingSessions?: readonly AgentPendingUserInputSession[];
    workflowObservations?: Readonly<Record<string, AgentWorkflowObservation>>;
}

/**
 * 气泡标准统一输入 Props。
 */
export interface AgentBubbleProps<TNode extends ChatNode = ChatNode> {
    node: TNode;
    context: AgentBubbleContext;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    savingEdit?: boolean;
    branchSwitcher?: AgentMessageSwitcherState;
    costDisplayOptions?: CostDisplayOptions;
    costExchangeRateSuffix?: string;
}

/**
 * 统一气泡上行事件动作包。
 * 任何新加入的功能气泡均可通过 bubble-action 上报专属意图，无需修改 Flow 容器模板。
 */
export interface AgentBubbleAction<TPayload = unknown> {
    type: string;
    payload?: TPayload;
    node: ChatNode;
}

/**
 * 气泡渲染定义与扩展契约。
 */
export interface AgentBubbleDefinition {
    id: string;
    name: string;
    match: (node: ChatNode) => boolean;
    mode: AgentBubbleRenderMode;
    meta: AgentBubbleMeta;
    component: Component;
}
