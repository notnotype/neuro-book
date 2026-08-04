import {z} from "zod";
import type {AgentMessage as PiAgentMessage, AgentToolCall as PiAgentToolCall, AssistantMessage as PiAssistantMessage, JsonValue, Message as PiMessage, ToolResultMessage, Usage} from "nbook/server/agent/messages/types";
import type {AgentActiveInvocationDto, AgentAssistantUpdateDto, AgentRuntimeStreamEventDto, AgentPendingApprovalDto, AgentPendingUserInputDto, AgentMode} from "nbook/shared/dto/agent-session.dto";
import {AgentModeSchema} from "nbook/shared/dto/agent-session.dto";
import type {AgentChatEntryDto, PublicTextPreviewDto, PublicToolArgsDto, PublicToolResultDto, PublicValuePreviewDto} from "nbook/shared/dto/agent-public-event.dto";
import type {AgentAttachmentDisplay} from "nbook/app/components/novel-ide/agent/agent-attachment";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import {LowCodeFormDtoSchema} from "nbook/shared/dto/low-code-form.dto";
import {toStableArgsJson} from "nbook/app/components/novel-ide/agent/tool-args-stream";
import {userEntryContentIdentity} from "nbook/app/components/novel-ide/agent/agent-user-message-markdown";

type PiAssistantContent = PiAssistantMessage["content"][number];
type RuntimeAssistantContent = Array<PiAssistantContent | undefined>;

/**
 * 消息类型。
 */
export type MessageType = "user" | "ai" | "system";

/**
 * 系统消息在前端的展示类型。
 */
export type SystemMessageDisplayKind = "prompt" | "reminder" | "system" | "error";

/**
 * 消息状态。
 */
/** `interrupted` 专指用户主动取消：它不是错误，不走 error 配色，也不携带 provider 错误文本。 */
export type MessageStatus = "streaming" | "done" | "stopped" | "interrupted";

/**
 * 用户消息意图，用于区分普通输入和运行中 steer。
 */
export type UserMessageIntent = "normal" | "steer";

/**
 * Tool Call 状态。
 */
export type ToolCallStatus = "streaming" | "invalid" | "running" | "success" | "error";

type RuntimeI18n = {
    t: (key: string, params?: {[key: string]: string | number}) => string;
};

/**
 * 非组件工具层不能使用 useI18n；这里复用 Nuxt 注入的运行时 i18n，失败时回退中文源语言。
 */
function translate(key: string, fallback: string, params?: {[key: string]: string | number}): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key, params) ?? fallback;
    } catch {
        return fallback;
    }
}

const interruptedToolCallError = (): string => translate("agent.tool.interrupted", "工具调用未完成：服务重启或运行中断后，已经无法继续等待这个结果。");

/**
 * 单个 Tool Call 实体。
 */
export type AgentToolCall = {
    id: string;
    index: number;
    name: string;
    argsText: string;
    argsJson?: string;
    status: ToolCallStatus;
    error?: string;
    result?: string;
    /** 公开工具参数投影；只包含有界预览与展示元数据。 */
    publicArgs?: PublicToolArgsDto;
    /** 公开工具结果投影；图片正文和超长文本不会进入前端状态。 */
    publicResult?: PublicToolResultDto;
    /** 专用工具卡消费的有界 JSON details；不会保存任意 unknown 工具对象。 */
    resultData?: JsonValue;
    /** 所属 assistant 消息 ID。 */
    assistantMessageId?: string;
    /** durable tool result entry ID；只有公开历史附件可用它构造读取 locator。 */
    resultEntryId?: string;
};

/** durable user message 在 Chat Flow 中的保序内容块。 */
export type AgentMessageContentBlock =
    | {
        type: "text";
        contentIndex: number;
        content: PublicTextPreviewDto;
    }
    | ({type: "attachment"} & AgentAttachmentDisplay);

/**
 * 单条消息实体。
 */
export type AgentMessage = {
    id: string;
    /** 用户提交与 durable entry 的稳定关联 ID。 */
    clientMessageId?: string;
    /** 仅 optimistic 用户消息使用；unknown 不会自动重试或持久化到刷新后。 */
    deliveryState?: "pending" | "unknown";
    /** unknown 显式重新发送时复用原交互意图，但始终生成新的 clientMessageId。 */
    deliveryMode?: "prompt" | "steer" | "followup";
    type: MessageType;
    /** 用户消息意图；缺省为普通输入。 */
    intent?: UserMessageIntent;
    /** 仅 system 消息使用：用于区分首轮系统提示和运行时提醒。 */
    systemDisplayKind?: SystemMessageDisplayKind;
    /** 系统消息可选标题，不存在时使用默认 System/System Reminder。 */
    systemLabel?: string;
    content: string;
    /** durable history 中原始正文的 UTF-8 字节数；live/optimistic 消息为空。 */
    contentBytes?: number;
    /** durable history 只包含正文预览时为 true；此时禁止用预览覆盖原文。 */
    contentOmitted?: boolean;
    /** durable user entry 中公开的 attachment locator；不包含 blob data。 */
    attachments?: AgentAttachmentDisplay[];
    /** durable user entry 按 stored contentIndex 排序的公开内容块。 */
    contentBlocks?: AgentMessageContentBlock[];
    /** durable user entry 中未公开的内容块数量。 */
    omittedContentBlocks?: number;
    /** 前端内部用户内容身份；用于精确消费交错图片的乐观消息。 */
    userContentIdentity?: string;
    /** 正文公开预算截断时使用的文本字节数 + 图片序列身份。 */
    userContentFallbackIdentity?: string;
    html?: string;
    status?: MessageStatus;
    toolCalls?: AgentToolCall[];
    /** durable assistant 中因公开预算省略的工具调用数量。 */
    omittedToolCalls?: number;
    timestamp?: string;
    model?: string;
    /** assistant 本次 provider 调用的完整 token/cost 用量。 */
    usage?: Usage;
    tokens?: number;
    thinking?: string;
    /** assistant 生成失败时的 provider/runtime 错误文本。 */
    error?: string;
    /** 运行期错误所属 invocation，用于 HTTP 结果兜底去重。 */
    invocationId?: string;
    /** 前端内部投影来源；用于区分尚未 durable 化的 live assistant turn。 */
    projectionSource?: "live" | "durable";
    /** live assistant 的原始 Pi content blocks，用于按 contentIndex 合并流式事件。 */
    assistantContent?: RuntimeAssistantContent;
};

/**
 * 判断一条消息是否可以作为“空输入继续”的断点。
 */
export const isContinuationPointMessage = (
    message: AgentMessage | undefined,
    options: {allowSettledAiToolCalls?: boolean} = {},
): boolean => {
    if (!message) {
        return false;
    }
    if (message.type !== "ai") {
        return true;
    }
    if (!options.allowSettledAiToolCalls) {
        return false;
    }
    const toolCalls = message.toolCalls ?? [];
    return toolCalls.length > 0 && toolCalls.every((toolCall) => {
        return toolCall.status === "success" || toolCall.status === "error" || toolCall.status === "invalid";
    });
};

export const AgentUserInputQuestionOptionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
}).strict();

export const AgentUserInputQuestionSchema = z.object({
    header: z.string().optional(),
    question: z.string(),
    options: z.array(AgentUserInputQuestionOptionSchema).default([]),
}).strict();

export const RequestUserInputToolArgsSchema = z.object({
    questions: z.array(AgentUserInputQuestionSchema).min(1),
}).strict();

export const RequestUserInputToolAnswerSchema = z.object({
    questionIndex: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    textOmitted: z.boolean().optional(),
    selectedOptionIndex: z.number().int().min(-1).optional(),
    note: z.string().trim().optional(),
    noteOmitted: z.boolean().optional(),
    ignored: z.boolean().optional(),
});

const RequestUserInputToolRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema),
});

export type AgentPendingUserInputQuestion = z.infer<typeof AgentUserInputQuestionSchema> & {
    toolNodeId: string;
    questionIndex: number;
    toolCallId?: string | null;
    toolName: string;
    kind: "question" | "tool_approval";
    approvalAction?: "switch_mode" | "skill";
    /** switch_mode 审批的目标模式；非 switch_mode 审批为空。 */
    switchTargetMode?: AgentMode;
    approvalToolArgsText?: string;
    planFilePath?: string;
    planContent?: string;
    planContentBytes?: number;
};

export type AgentPendingUserInputSession = {
    assistantMessageId: string;
    status: "pending";
    questions: AgentPendingUserInputQuestion[];
    /** Task 63: Low-Code Form 表单规格（存在时优先使用 LowCodeForm 渲染）。 */
    form?: LowCodeFormDto;
    /** Task 63: 当存在 form 时，关联的 toolCallId 用于提交 resolution。 */
    formToolCallId?: string;
};

export type RequestUserInputAnswerView = {
    questionIndex: number;
    question: string;
    options: z.infer<typeof AgentUserInputQuestionOptionSchema>[];
    selectedLabel: string;
    text?: string;
    note?: string;
    omitted: boolean;
    ignored: boolean;
    openAnswer: boolean;
};

/**
 * 消息级 continuation 切换状态。
 */
export type AgentMessageSwitcherState = {
    nodeIds: string[];
    currentIndex: number;
    total: number;
};

/**
 * 对话流中的渲染节点。一条 AgentMessage 可展开为多个 ChatNode。
 */
export type ChatNode =
    | { kind: "text"; message: AgentMessage }
    | { kind: "tool"; message: AgentMessage; toolCall: AgentToolCall };

/**
 * 将消息列表展开为渲染节点列表。
 */
export const toChatNodes = (messages: AgentMessage[]): ChatNode[] => {
    const nodes: ChatNode[] = [];
    for (const message of messages) {
        if (message.type !== "ai") {
            nodes.push({kind: "text", message});
            continue;
        }
        if (message.content || message.thinking || !message.toolCalls?.length) {
            nodes.push({kind: "text", message});
        }
        const toolCalls = message.toolCalls ?? [];
        const lastTaskToolIndex = toolCalls.findLastIndex((toolCall) => toolCall.name === "task_create" || toolCall.name === "task_set_status");
        for (const [toolIndex, toolCall] of toolCalls.entries()) {
            if ((toolCall.name === "task_create" || toolCall.name === "task_set_status") && toolIndex !== lastTaskToolIndex) {
                continue;
            }
            nodes.push({kind: "tool", message, toolCall});
        }
    }
    return nodes;
};

/**
 * 格式化相对时间。
 */
export const formatTimestamp = (value?: string | number): string => {
    if (value === undefined || value === null || value === "") return "";
    const date = typeof value === "number" ? new Date(value) : new Date(value);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return translate("agent.time.justNow", "刚刚");
    } else if (diffInSeconds < 3600) {
        const count = Math.floor(diffInSeconds / 60);
        return translate("agent.time.minutesAgo", `${String(count)} 分钟前`, {count});
    } else if (diffInSeconds < 86400) {
        const count = Math.floor(diffInSeconds / 3600);
        return translate("agent.time.hoursAgo", `${String(count)} 小时前`, {count});
    }
    return date.toLocaleDateString();
};

/**
 * 获取 ToolCall 的状态边框颜色类名。
 */
export const toolStatusClass = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "bg-[var(--status-success-bg)] text-[var(--status-success)]";
        case "error":
        case "invalid":
            return "bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
        case "running":
        case "streaming":
            return "bg-[var(--status-info-bg)] text-[var(--status-info)]";
        default:
            return "bg-[var(--bg-input)] text-[var(--text-muted)]";
    }
};

/**
 * 获取 ToolCall 的状态图标。
 */
export const toolStatusIcon = (toolCall: AgentToolCall): string => {
    switch (toolCall.status) {
        case "success": return "i-lucide-check";
        case "error":
        case "invalid":
            return "i-lucide-x";
        case "running":
        case "streaming":
            return "i-lucide-loader-circle";
        default:
            return "i-lucide-circle-dashed";
    }
};

/**
 * 返回消息状态文本。
 */
export const messageStatusLabel = (message: AgentMessage): string => {
    if (message.deliveryState === "unknown") {
        return "发送结果未知";
    }
    if (message.error) {
        return translate("agent.messageStatus.failed", "生成失败");
    }
    if (message.toolCalls?.some((toolCall) => toolCall.status === "running")) {
        return translate("agent.messageStatus.toolRunning", "执行工具中");
    }
    if (message.toolCalls?.some((toolCall) => toolCall.status === "streaming")) {
        return translate("agent.messageStatus.toolStreaming", "生成工具调用");
    }
    if (message.status === "streaming") {
        return translate("agent.messageStatus.streaming", "生成中");
    }
    return "";
};

/**
 * 选择更稳定的 tool call 状态，避免后到的低优先级状态覆盖终态。
 */
export const mergeToolCallStatus = (
    nextStatus: ToolCallStatus,
    previousStatus?: ToolCallStatus,
): ToolCallStatus => {
    if (!previousStatus) return nextStatus;
    if ((nextStatus === "streaming" || nextStatus === "running") && ["success", "error", "invalid"].includes(previousStatus)) {
        return previousStatus;
    }
    if (nextStatus === "streaming" && previousStatus === "running") {
        return previousStatus;
    }
    return nextStatus;
};

/**
 * 合并 assistant 上的 tool call，保持已有运行结果。
 */
export const mergeToolCalls = (nextToolCalls?: AgentToolCall[], previousToolCalls?: AgentToolCall[]): AgentToolCall[] | undefined => {
    if (!nextToolCalls?.length && !previousToolCalls?.length) {
        return undefined;
    }

    const previousMap = new Map((previousToolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
    const merged = (nextToolCalls ?? []).map((toolCall) => {
        const previous = previousMap.get(toolCall.id);
        if (!previous) {
            return toolCall;
        }
        return {
            ...previous,
            ...toolCall,
            status: mergeToolCallStatus(toolCall.status, previous.status),
            error: toolCall.error ?? previous.error,
            result: toolCall.result ?? previous.result,
            publicArgs: toolCall.publicArgs ?? previous.publicArgs,
            publicResult: toolCall.publicResult ?? previous.publicResult,
            resultData: toolCall.resultData ?? previous.resultData,
            resultEntryId: toolCall.resultEntryId ?? previous.resultEntryId,
        };
    });

    for (const previous of previousToolCalls ?? []) {
        const replacedByResolvedToolCall = previous.id.startsWith("content-")
            && merged.some((toolCall) => toolCall.index === previous.index);
        if (!merged.some((toolCall) => toolCall.id === previous.id) && !replacedByResolvedToolCall) {
            merged.push(previous);
        }
    }

    return merged.sort((left, right) => left.index - right.index);
};

/**
 * 用稳定 key 对消息数组做原地 reconcile。
 */
export const reconcileMessages = (previousMessages: AgentMessage[], nextMessages: AgentMessage[]): AgentMessage[] => {
    const previousMap = new Map(previousMessages.map((message) => [message.id, message]));
    return nextMessages.map((message) => {
        const previous = previousMap.get(message.id);
        if (!previous) {
            return message;
        }
        return {
            ...previous,
            ...message,
            toolCalls: mergeToolCalls(message.toolCalls, previous.toolCalls),
        };
    });
};

/**
 * 将 session_entry 增量事件投影到前端消息，避免等待下一次完整 snapshot。
 */
export const applySessionEntryToMessages = (
    previousMessages: AgentMessage[],
    entry: AgentChatEntryDto,
): AgentMessage[] => {
    if (entry.type === "invocation_error") {
        // 同一次运行的错误有两个出口：assistant 气泡的内嵌红字，和独立的 Run Error 卡片。
        // 卡片是权威详情，它一到就把同一次运行的 assistant 错误清掉：有正文则保留正文气泡（用户能看见写了
        // 一半的内容），没正文就整条移除，只留卡片。live 与 durable 两条路径由此得到相同结果，刷新前后一致。
        //
        // 旧实现是反过来的——「已有 assistant error 就丢弃这条 entry」。那在 deriveMessagesFromChatEntries
        // 的 durable 折叠里有效，但对真正的重复无效：useAgentSession 收到 session_entry 时会把 entry 无条件
        // 合并进 durableEntries，只有 liveOverlay 采用这里的返回值，丢弃 entry 拦不住 durable 那一份（Task 139）。
        const cleaned = previousMessages.flatMap((message) => {
            const isSameInvocationError = message.type === "ai"
                && message.invocationId === entry.invocationId
                && Boolean(message.error);
            if (!isSameInvocationError) {
                return [message];
            }
            if (!message.content.trim() && !message.toolCalls?.length) {
                return [];
            }
            return [{...message, error: undefined}];
        });
        return [...cleaned, messageFromChatEntry(entry)];
    }
    if (entry.type === "tool_result") {
        const assistant = previousMessages.findLast((message) => {
            return message.type === "ai" && message.toolCalls?.some((toolCall) => toolCall.id === entry.toolCallId);
        });
        if (!assistant) {
            return previousMessages;
        }
        const nextMessages = previousMessages.map((message) => message.id === assistant.id ? {...message} : message);
        const nextAssistant = nextMessages.find((message) => message.id === assistant.id);
        if (nextAssistant) {
            upsertPublicToolResult(nextAssistant, entry);
        }
        return reconcileMessages(previousMessages, nextMessages);
    }
    const nextMessage = messageFromChatEntry(entry);
    if (entry.type === "assistant") {
        const toolCallIds = new Set<string>(entry.toolCalls.map((toolCall) => toolCall.id));
        let liveIndex = previousMessages.findIndex((message) => message.id === entry.id);
        if (liveIndex < 0 && toolCallIds.size > 0) {
            liveIndex = previousMessages.findIndex((message) => {
                return message.type === "ai"
                    && message.projectionSource === "live"
                    && message.toolCalls?.some((toolCall) => toolCallIds.has(toolCall.id));
            });
        }
        if (liveIndex < 0 && toolCallIds.size === 0 && entry.invocationId) {
            liveIndex = previousMessages.findLastIndex((message) => {
                return message.type === "ai"
                    && message.projectionSource === "live"
                    && message.invocationId === entry.invocationId;
            });
        }
        if (liveIndex >= 0) {
            const previous = previousMessages[liveIndex]!;
            const nextMessages = [...previousMessages];
            nextMessages[liveIndex] = {
                ...previous,
                ...nextMessage,
                toolCalls: mergeToolCalls(nextMessage.toolCalls, previous.toolCalls),
            };
            return nextMessages;
        }
    }
    const withoutOptimisticDuplicate = nextMessage.type === "user"
        ? previousMessages.filter((message) => !(message.id.startsWith("optimistic-user:")
            && Boolean(nextMessage.clientMessageId)
            && message.clientMessageId === nextMessage.clientMessageId))
        : previousMessages;
    if (nextMessage.type === "system") {
        const optimisticIndex = withoutOptimisticDuplicate.findIndex((message) => message.id.startsWith("optimistic-user:"));
        if (optimisticIndex >= 0 && !withoutOptimisticDuplicate.some((message) => message.id === nextMessage.id)) {
            const nextMessages = [...withoutOptimisticDuplicate];
            nextMessages.splice(optimisticIndex, 0, nextMessage);
            return reconcileMessages(previousMessages, nextMessages);
        }
    }
    const nextMessages = previousMessages.some((message) => message.id === nextMessage.id)
        ? withoutOptimisticDuplicate.map((message) => message.id === nextMessage.id ? nextMessage : message)
        : [...withoutOptimisticDuplicate, nextMessage];
    return reconcileMessages(previousMessages, nextMessages);
};

export const hasVisibleInvocationError = (messages: AgentMessage[], invocationId: string): boolean => {
    return messages.some((message) => {
        return message.invocationId === invocationId
            && (message.systemDisplayKind === "error" || (message.type === "ai" && Boolean(message.error)));
    });
};

/**
 * 把服务端 pending approval 投影成底部待处理面板的统一 Session。
 */
export const toPendingUserInputSession = (
    pending: AgentPendingApprovalDto | null,
    messages: AgentMessage[],
): AgentPendingUserInputSession | null => {
    if (!pending) {
        return null;
    }
    if (pending.detailsOmitted && !pending.formSpec) {
        return null;
    }
    const assistantMessage = messages.find((message) => message.toolCalls?.some((toolCall) => toolCall.id === pending.toolCallId));

    const projectedArgs = pending.args ? publicToolArgsJsonValue(pending.args) : {};
    const args = projectedArgs && typeof projectedArgs === "object" && !Array.isArray(projectedArgs)
        ? projectedArgs as Record<string, unknown>
        : {};

    if (pending.toolName === "request_user_input") {
        const parsed = RequestUserInputToolArgsSchema.safeParse(args);
        if (!parsed.success) {
            console.warn("request_user_input args 验证失败", parsed.error);
            return null;
        }
        return {
            assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
            status: "pending",
            questions: parsed.data.questions.map((question, index) => ({
                ...question,
                toolNodeId: pending.toolCallId,
                questionIndex: index,
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                kind: "question" as const,
            })),
        };
    }

    // 非 request_user_input 的用户输入工具可使用 Low-Code Form 渲染结构化表单。
    if (pending.formSpec) {
        const formValidation = LowCodeFormDtoSchema.safeParse(pending.formSpec.form);
        if (!formValidation.success) {
            console.warn("pending.formSpec.form 验证失败", formValidation.error);
            return null;
        }
        return {
            assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
            status: "pending",
            questions: [],
            form: formValidation.data,
            formToolCallId: pending.toolCallId,
        };
    }

    // SSE 事件可以直接在 args.form 携带表单；与 recovery formSpec 共用同一 schema。
    const form = args.form;
    if (form && typeof form === "object" && !Array.isArray(form) && "fields" in form && Array.isArray(form.fields)) {
        const formValidation = LowCodeFormDtoSchema.safeParse(form);
        if (!formValidation.success) {
            console.warn("args.form 验证失败", formValidation.error);
            return null;
        }
        return {
            assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
            status: "pending",
            questions: [],
            form: formValidation.data,
            formToolCallId: pending.toolCallId,
        };
    }

    return {
        assistantMessageId: assistantMessage?.id ?? pending.assistantMessageId ?? pending.toolCallId,
        status: "pending",
        questions: [{
            toolNodeId: pending.toolCallId,
            questionIndex: 0,
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            kind: "tool_approval",
            approvalAction: pending.toolName === "switch_mode" || pending.toolName === "skill"
                ? pending.toolName
                : undefined,
            switchTargetMode: pending.toolName === "switch_mode"
                ? parseAgentMode(args.targetMode)
                : undefined,
            approvalToolArgsText: JSON.stringify(args, null, 2),
            planFilePath: pending.toolName === "switch_mode" ? pending.planFilePath : undefined,
            planContent: pending.toolName === "switch_mode" ? pending.planContent : undefined,
            planContentBytes: pending.toolName === "switch_mode" ? pending.planContentBytes : undefined,
            header: pending.toolName === "skill" ? "Skill" : translate("agent.approval.header", "审批"),
            question: approvalQuestion(pending.toolName, args),
            options: [
                {label: translate("agent.userInput.approve", "批准"), description: translate("agent.approval.allowDescription", "允许 Agent 继续执行该动作。")},
                {label: translate("agent.planApproval.reject", "拒绝"), description: translate("agent.approval.rejectDescription", "阻止该动作，并把结果返回给 Agent。")},
            ],
        }],
    };
};

/**
 * 从 request_user_input 的 args/resultData 推导历史气泡展示数据。
 */
export const deriveRequestUserInputAnswerViews = (
    args: z.infer<typeof RequestUserInputToolArgsSchema> | null,
    resultData: unknown,
    options?: {
        fallbackQuestion?: AgentPendingUserInputQuestion | null;
        otherLabel?: string;
    },
): RequestUserInputAnswerView[] => {
    const parsedRawResult = RequestUserInputToolRawResultSchema.safeParse(resultData);
    const answers = parsedRawResult.success
        ? parsedRawResult.data.answers
        : (() => {
            const parsedAnswer = RequestUserInputToolAnswerSchema.safeParse(resultData);
            return parsedAnswer.success ? [parsedAnswer.data] : [];
        })();
    if (answers.length === 0) {
        return [];
    }

    return answers.map((answer, answerIndex) => {
        const questionIndex = answer.questionIndex ?? answerIndex;
        const question = options?.fallbackQuestion?.questionIndex === questionIndex
            ? options.fallbackQuestion
            : args?.questions[questionIndex] ?? options?.fallbackQuestion ?? args?.questions[0];
        const questionOptions = question?.options ?? [];
        const selectedOptionIndex = answer.selectedOptionIndex;
        const selectedLabel = selectedOptionIndex === undefined
            ? ""
            : selectedOptionIndex === -1
                ? options?.otherLabel ?? translate("agent.userInput.otherAnswer", "其他答案")
                : questionOptions[selectedOptionIndex]?.label ?? String(selectedOptionIndex);

        return {
            questionIndex,
            question: question?.question ?? "",
            options: questionOptions,
            selectedLabel,
            text: selectedOptionIndex === undefined && !answer.note ? answer.text : undefined,
            note: answer.note,
            omitted: answer.textOmitted === true || answer.noteOmitted === true,
            ignored: Boolean(answer.ignored),
            openAnswer: !answer.ignored && selectedOptionIndex === undefined,
        };
    });
};

/**
 * 从 public runtime event 更新 live message。
 */
export const applyRuntimeEventToMessages = (previousMessages: AgentMessage[], event: AgentRuntimeStreamEventDto, invocationId?: string): AgentMessage[] => {
    if (event.type === "message_start") {
        const previousMessage = previousMessages.find((message) => message.id === event.messageId);
        const message: AgentMessage = {
            ...(previousMessage ?? {
                id: event.messageId,
                type: "ai",
                content: "",
            }),
            status: "streaming",
            timestamp: formatTimestamp(event.timestamp),
            model: event.model,
            invocationId,
            projectionSource: "live",
        };
        return upsertLiveAssistantMessage(previousMessages, message);
    }

    if (event.type === "message_update") {
        const previousMessage = previousMessages.find((message) => message.id === event.messageId);
        const message = applyAssistantUpdate(previousMessage ?? {
            id: event.messageId,
            type: "ai",
            content: "",
            status: "streaming",
            invocationId,
            projectionSource: "live",
        }, event.update);
        return upsertLiveAssistantMessage(previousMessages, message);
    }

    if (event.type === "message_end") {
        const previousMessage = previousMessages.find((message) => message.id === event.messageId);
        // 取消不取 provider 的 errorMessage：SDK 给的是英文 "Request was aborted"，
        // 以前它会短路掉中文兜底并当成错误红字显示。取消只标 interrupted，由气泡用中性文案呈现（Task 139）。
        const aborted = event.stopReason === "aborted";
        const errorText = event.stopReason === "error"
            ? event.errorMessage?.trim() || translate("agent.userInput.providerNoDetail", "生成失败，provider 未返回错误详情。")
            : "";
        const message: AgentMessage = {
            ...(previousMessage ?? {
                id: event.messageId,
                type: "ai",
                content: "",
            }),
            content: previousMessage?.content || errorText,
            status: aborted ? "interrupted" : errorText ? "stopped" : "done",
            model: event.responseModel ?? previousMessage?.model,
            usage: event.usage,
            tokens: event.usage.totalTokens,
            error: errorText || undefined,
            invocationId: previousMessage?.invocationId ?? invocationId,
            projectionSource: "live",
        };
        return upsertLiveAssistantMessage(previousMessages, message);
    }

    if (event.type === "tool_execution_start") {
        const argsText = formatPublicToolArgs(event.args);
        return upsertLiveToolCall(previousMessages, event.toolCallId, invocationId, {
            name: event.toolName,
            argsText,
            argsJson: toStableArgsJson(argsText),
            status: "running",
            publicArgs: event.args,
        });
    }

    if (event.type === "tool_execution_update") {
        return upsertLiveToolCall(previousMessages, event.toolCallId, invocationId, {
            result: publicToolResultText(event.partialResult),
            publicResult: event.partialResult,
            resultData: publicToolResultDetails(event.partialResult),
            status: "running",
        });
    }

    if (event.type === "tool_execution_end") {
        return upsertLiveToolCall(previousMessages, event.toolCallId, invocationId, {
            name: event.toolName,
            result: publicToolResultText(event.result),
            publicResult: event.result,
            resultData: publicToolResultDetails(event.result),
            status: event.isError ? "error" : "success",
            error: event.isError ? publicToolResultText(event.result) : undefined,
        });
    }

    return previousMessages;
};

/**
 * 从公开 durable entry 真相派生 Chat Flow 消息。history 页和 live session_entry
 * 共用这一条投影路径，避免分页恢复重新解释 raw SessionEntry。
 */
export const deriveMessagesFromChatEntries = (
    entries: AgentChatEntryDto[],
    options: {
        activeInvocation?: AgentActiveInvocationDto | null;
        pendingUserInputs?: AgentPendingUserInputDto[];
    } = {},
): AgentMessage[] => {
    let messages: AgentMessage[] = [];
    for (const entry of entries) {
        messages = applySessionEntryToMessages(messages, entry);
    }
    markInterruptedToolCalls(messages, {
        hasActiveInvocation: Boolean(options.activeInvocation),
        pendingToolCallId: options.pendingUserInputs?.[0]?.toolCallId ?? null,
    });
    return messages.map((message) => ({...message, projectionSource: "durable"}));
};

/** 将公开投影的原始字节数格式化为紧凑 UI 文案。 */
export const formatByteCount = (bytes: number): string => {
    if (bytes < 1024) {
        return `${String(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

/**
 * 将一条公开 assistant delta 应用到对应 contentIndex，不读取 provider partial/message。
 */
const applyAssistantUpdate = (message: AgentMessage, update: AgentAssistantUpdateDto): AgentMessage => {
    const content = contentFromMessage(message);
    const previousBlock = content[update.contentIndex];
    if (update.type === "text_start") {
        content[update.contentIndex] = previousBlock?.type === "text" ? previousBlock : {type: "text", text: ""};
    }
    if (update.type === "text_delta") {
        content[update.contentIndex] = {
            type: "text",
            text: `${previousBlock?.type === "text" ? previousBlock.text : ""}${update.delta}`,
        };
    }
    if (update.type === "text_end" && previousBlock?.type !== "text") {
        content[update.contentIndex] = {type: "text", text: ""};
    }
    if (update.type === "thinking_start") {
        content[update.contentIndex] = previousBlock?.type === "thinking" ? previousBlock : {type: "thinking", thinking: ""};
    }
    if (update.type === "thinking_delta") {
        content[update.contentIndex] = {
            type: "thinking",
            thinking: `${previousBlock?.type === "thinking" ? previousBlock.thinking : ""}${update.delta}`,
        };
    }
    if (update.type === "thinking_end" && previousBlock?.type !== "thinking") {
        content[update.contentIndex] = {type: "thinking", thinking: ""};
    }
    if (update.type === "toolcall_start") {
        content[update.contentIndex] = {
            type: "toolCall",
            id: update.toolCallId ?? (previousBlock?.type === "toolCall" ? previousBlock.id : `content-${String(update.contentIndex)}`),
            name: update.toolName ?? (previousBlock?.type === "toolCall" ? previousBlock.name : ""),
            arguments: previousBlock?.type === "toolCall" ? previousBlock.arguments : "",
        } as PiAssistantContent;
    }
    if (update.type === "toolcall_args" || update.type === "toolcall_end") {
        content[update.contentIndex] = {
            type: "toolCall",
            id: update.toolCallId ?? (previousBlock?.type === "toolCall" ? previousBlock.id : `content-${String(update.contentIndex)}`),
            name: update.toolName ?? (previousBlock?.type === "toolCall" ? previousBlock.name : ""),
            arguments: formatPublicToolArgs(update.args),
        } as unknown as PiAssistantContent;
    }
    const toolCalls = toolCallsFromContent(content, message.id)?.map((toolCall) => {
        if ((update.type === "toolcall_args" || update.type === "toolcall_end") && toolCall.index === update.contentIndex) {
            return {...toolCall, publicArgs: update.args};
        }
        const previousToolCall = message.toolCalls?.find((item) => item.id === toolCall.id || item.index === toolCall.index);
        return previousToolCall?.publicArgs ? {...toolCall, publicArgs: previousToolCall.publicArgs} : toolCall;
    });
    return {
        ...message,
        status: "streaming",
        content: textFromContent(content),
        thinking: thinkingFromContent(content) || undefined,
        toolCalls: mergeToolCalls(toolCalls, message.toolCalls),
        assistantContent: content,
    };
};

const contentFromMessage = (message: AgentMessage): RuntimeAssistantContent => {
    if (message.assistantContent?.length) {
        return [...message.assistantContent];
    }
    const content: RuntimeAssistantContent = [];
    if (message.thinking) {
        content.push({type: "thinking", thinking: message.thinking});
    }
    if (message.content && !message.error) {
        content.push({type: "text", text: message.content});
    }
    for (const toolCall of message.toolCalls ?? []) {
        content.push({
            type: "toolCall",
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.argsText,
        } as unknown as PiAssistantContent);
    }
    return content;
};

/** 将真实 assistant tool call 接管同 ID 的 tool_execution fallback 气泡。 */
const upsertLiveAssistantMessage = (previousMessages: AgentMessage[], message: AgentMessage): AgentMessage[] => {
    const fallbackMessageIds = new Set((message.toolCalls ?? []).map((toolCall) => `tool-execution:${toolCall.id}`));
    const fallbackToolCalls = previousMessages
        .filter((item) => fallbackMessageIds.has(item.id))
        .flatMap((item) => item.toolCalls ?? []);
    const mergedMessage = fallbackToolCalls.length > 0
        ? {...message, toolCalls: mergeToolCalls(message.toolCalls, fallbackToolCalls)}
        : message;
    const messagesWithoutFallback = fallbackMessageIds.size > 0
        ? previousMessages.filter((item) => !fallbackMessageIds.has(item.id))
        : previousMessages;
    const nextMessages = messagesWithoutFallback.some((item) => item.id === message.id)
        ? messagesWithoutFallback.map((item) => item.id === message.id ? mergedMessage : item)
        : [...messagesWithoutFallback, mergedMessage];
    return reconcileMessages(previousMessages, nextMessages);
};

/**
 * 将 live session_entry 的公开 Chat Flow DTO 转成前端消息。
 */
const messageFromChatEntry = (entry: Exclude<AgentChatEntryDto, {type: "tool_result"}>): AgentMessage => {
    if (entry.type === "user") {
        const contentBlocks = entry.blocks
            .map((block): AgentMessageContentBlock => block.type === "text"
                ? {type: "text", contentIndex: block.contentIndex, content: {...block.content}}
                : {type: "attachment", contentIndex: block.contentIndex, attachment: {...block.attachment}})
            .sort((left, right) => left.contentIndex - right.contentIndex);
        const attachments = contentBlocks.flatMap((block) => block.type === "attachment"
            ? [{contentIndex: block.contentIndex, attachment: {...block.attachment}}]
            : []);
        const content = userEntryTextPreview(entry);
        const identity = userEntryContentIdentity(entry);
        return {
            id: entry.id,
            clientMessageId: entry.clientMessageId,
            type: "user",
            intent: entry.intent,
            content: content.preview,
            contentBytes: content.bytes,
            contentOmitted: content.omitted,
            attachments,
            contentBlocks,
            omittedContentBlocks: entry.omittedBlocks,
            ...(identity.exact === undefined ? {} : {userContentIdentity: identity.exact}),
            userContentFallbackIdentity: identity.fallback,
            status: "done",
            timestamp: formatTimestamp(entry.timestamp),
            projectionSource: "durable",
        };
    }
    if (entry.type === "assistant") {
        return {
            id: entry.id,
            type: "ai",
            // 正文就是正文：不再用错误文本冒充正文。错误详情归 invocation_error 卡片，
            // 否则同一段错误会既当正文又当红字，跨层合成时变成两个气泡（Task 139）。
            content: entry.content.preview,
            contentBytes: entry.content.bytes,
            contentOmitted: entry.content.omitted,
            thinking: entry.thinking.preview || undefined,
            error: entry.error?.preview,
            status: entry.status === "partial" ? "streaming" : entry.status === "done" ? "done" : entry.status === "interrupted" ? "interrupted" : "stopped",
            timestamp: formatTimestamp(entry.timestamp),
            model: entry.model,
            usage: entry.usage,
            tokens: entry.usage.totalTokens,
            invocationId: entry.invocationId,
            projectionSource: "durable",
            toolCalls: entry.toolCalls.map((toolCall) => {
                const argsText = formatPublicToolArgs(toolCall.args);
                return {
                    id: toolCall.id,
                    assistantMessageId: entry.id,
                    index: toolCall.index,
                    name: toolCall.name,
                    argsText,
                    argsJson: toStableArgsJson(argsText),
                    status: "streaming" as const,
                    publicArgs: toolCall.args,
                };
            }),
            omittedToolCalls: entry.omittedToolCalls,
        };
    }
    if (entry.type === "invocation_error") {
        return {
            id: entry.id,
            type: "system",
            systemDisplayKind: "error",
            systemLabel: "Run Error",
            content: entry.message.preview,
            contentBytes: entry.message.bytes,
            contentOmitted: entry.message.omitted,
            status: "stopped",
            timestamp: formatTimestamp(entry.timestamp),
            error: entry.message.preview,
            invocationId: entry.invocationId,
            projectionSource: "durable",
        };
    }
    return {
        id: entry.id,
        type: "system",
        systemDisplayKind: entry.source === "reminder" ? "reminder" : "system",
        systemLabel: entry.label,
        content: entry.content.preview,
        contentBytes: entry.content.bytes,
        contentOmitted: entry.content.omitted,
        status: "done",
        timestamp: formatTimestamp(entry.timestamp),
        projectionSource: "durable",
    };
};

/** 从唯一 ordered blocks 派生 optimistic 匹配与现有文本 UI 使用的聚合 preview。 */
export const userEntryTextPreview = (
    entry: Extract<AgentChatEntryDto, {type: "user"}>,
): PublicTextPreviewDto => ({
    preview: entry.blocks
        .filter((block) => block.type === "text")
        .map((block) => block.content.preview)
        .join(""),
    bytes: entry.textSummary.bytes,
    omitted: entry.textSummary.omitted,
});

const textFromContent = (content: RuntimeAssistantContent): string => {
    return content
        .filter((block): block is Extract<PiAssistantContent, {type: "text"}> => block?.type === "text")
        .map((block) => block.text)
        .join("");
};

const thinkingFromContent = (content: RuntimeAssistantContent): string => {
    return content
        .filter((block): block is Extract<PiAssistantContent, {type: "thinking"}> => block?.type === "thinking")
        .map((block) => block.thinking)
        .join("");
};

const toolCallsFromContent = (content: RuntimeAssistantContent, assistantMessageId: string): AgentToolCall[] | undefined => {
    const toolCalls = content
        .map((block, contentIndex) => ({block, contentIndex}))
        .filter((item): item is {block: PiAgentToolCall; contentIndex: number} => item.block?.type === "toolCall")
        .map((item) => toLocalToolCall(item.block, item.contentIndex, assistantMessageId));
    return toolCalls.length ? toolCalls : undefined;
};

const messageContentText = (message: PiMessage): string => {
    if (typeof message.content === "string") {
        return message.content;
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
};

const customMessageText = (message: Record<string, unknown>): string => {
    const content = message.content;
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((block): block is {type?: string; text?: string} => Boolean(block) && typeof block === "object")
            .filter((block) => block.type === "text")
            .map((block) => block.text ?? "")
            .join("\n");
    }
    const details = message.details;
    if (typeof details === "string") {
        return details;
    }
    try {
        return JSON.stringify(message, null, 2);
    } catch {
        return String(message.role ?? "custom message");
    }
};

const resolveLiveMessageId = (message: PiAgentMessage): string => {
    if (message.role === "toolResult") {
        return `tool-result:${message.toolCallId}:${String(message.timestamp)}`;
    }
    return `${message.role}:${String(message.timestamp)}`;
};

const toLocalToolCall = (toolCall: PiAgentToolCall, index: number, assistantMessageId: string): AgentToolCall => {
    const argsText = formatToolArgs(toolCall.arguments);
    return {
        id: toolCall.id,
        assistantMessageId,
        index,
        name: toolCall.name,
        argsText,
        argsJson: toStableArgsJson(argsText),
        status: "streaming",
    };
};

const formatToolArgs = (args: unknown): string => {
    if (typeof args === "string") {
        return args;
    }
    return JSON.stringify(args ?? {}, null, 2);
};

/**
 * 将公开工具参数恢复成旧工具卡可消费的有界 JSON 形状。
 * 正文字段仍只使用 preview，并显式附带 bytes / omitted 元数据。
 */
export const publicToolArgsJsonValue = (args: PublicToolArgsDto): JsonValue => {
    if (args.kind === "write") {
        return {
            ...(args.path ? {path: args.path} : {}),
            content: args.contentPreview,
            contentBytes: args.contentBytes,
            contentOmitted: args.contentOmitted,
        };
    }
    if (args.kind === "edit") {
        return {
            ...(args.path ? {path: args.path} : {}),
            edits: args.edits.map((edit) => ({
                oldText: edit.oldTextPreview,
                oldTextBytes: edit.oldTextBytes,
                oldTextOmitted: edit.oldTextOmitted,
                newText: edit.newTextPreview,
                newTextBytes: edit.newTextBytes,
                newTextOmitted: edit.newTextOmitted,
            })),
            omittedEdits: args.omittedEdits,
        };
    }
    if (args.kind === "apply_patch") {
        return {
            patch: args.patchPreview,
            patchBytes: args.patchBytes,
            patchOmitted: args.patchOmitted,
            touchedFiles: args.touchedFiles,
            touchedFilesOmitted: args.touchedFilesOmitted,
        };
    }
    return publicValuePreviewJsonValue(args.value);
};

/** 公开参数的稳定 JSON 文本；输入已经有界，因此这里不会重新复制内部完整正文。 */
const formatPublicToolArgs = (args: PublicToolArgsDto): string => JSON.stringify(publicToolArgsJsonValue(args), null, 2);

/** 将有界 generic preview 转成现有专用工具卡可校验的 JSON 值。 */
export const publicValuePreviewJsonValue = (value: PublicValuePreviewDto): JsonValue => {
    if (value.kind === "null") {
        return null;
    }
    if (value.kind === "boolean" || value.kind === "number") {
        return value.value;
    }
    if (value.kind === "string") {
        return value.preview;
    }
    if (value.kind === "array") {
        return value.items.map(publicValuePreviewJsonValue);
    }
    if (value.kind === "object") {
        return Object.fromEntries(value.entries.map((entry) => [entry.key, publicValuePreviewJsonValue(entry.value)]));
    }
    return `[${value.valueType}]`;
};

const markInterruptedToolCalls = (
    messages: AgentMessage[],
    input: {
        hasActiveInvocation: boolean;
        pendingToolCallId: string | null;
    },
): void => {
    if (input.hasActiveInvocation) {
        return;
    }
    for (const message of messages) {
        if (!message.toolCalls?.length) {
            continue;
        }
        message.toolCalls = message.toolCalls.map((toolCall) => {
            if (toolCall.id === input.pendingToolCallId || toolCall.status === "success" || toolCall.status === "error" || toolCall.status === "invalid") {
                return toolCall;
            }
            return {
                ...toolCall,
                status: "error",
                error: toolCall.error ?? interruptedToolCallError(),
                result: toolCall.result ?? interruptedToolCallError(),
            };
        });
    }
};

const upsertToolResult = (assistant: AgentMessage, toolResult: ToolResultMessage): void => {
    const toolCalls = [...(assistant.toolCalls ?? [])];
    const index = toolCalls.findIndex((toolCall) => toolCall.id === toolResult.toolCallId);
    const result = messageContentText(toolResult);
    const nextToolCall: AgentToolCall = {
        id: toolResult.toolCallId,
        assistantMessageId: assistant.id,
        index: index >= 0 ? toolCalls[index]!.index : toolCalls.length,
        name: toolResult.toolName,
        argsText: index >= 0 ? toolCalls[index]!.argsText : "",
        argsJson: index >= 0 ? toolCalls[index]!.argsJson : undefined,
        status: toolResult.isError ? "error" : "success",
        error: toolResult.isError ? result : undefined,
        result,
        resultData: jsonValue(toolResult.details),
    };
    if (index >= 0) {
        toolCalls[index] = {
            ...toolCalls[index],
            ...nextToolCall,
        };
    } else {
        toolCalls.push(nextToolCall);
    }
    assistant.toolCalls = toolCalls.sort((left, right) => left.index - right.index);
};

const updateToolCall = (messages: AgentMessage[], toolCallId: string, patch: Partial<AgentToolCall>): AgentMessage[] => {
    return messages.map((message) => {
        if (!message.toolCalls?.some((toolCall) => toolCall.id === toolCallId)) {
            return message;
        }
        const nextToolCalls = message.toolCalls.map((toolCall) => toolCall.id === toolCallId
            ? {
                ...toolCall,
                ...patch,
                status: mergeToolCallStatus(patch.status ?? toolCall.status, toolCall.status),
            }
            : toolCall);
        const allToolsSettled = nextToolCalls.every((toolCall) => toolCall.status === "success" || toolCall.status === "error" || toolCall.status === "invalid");
        return {
            ...message,
            status: message.id.startsWith("tool-execution:") && allToolsSettled ? "done" : message.status,
            toolCalls: nextToolCalls,
        };
    });
};

const upsertLiveToolCall = (messages: AgentMessage[], toolCallId: string, invocationId: string | undefined, patch: Partial<AgentToolCall>): AgentMessage[] => {
    const nextMessages = updateToolCall(messages, toolCallId, patch);
    if (messages.some((message) => message.toolCalls?.some((toolCall) => toolCall.id === toolCallId))) {
        return nextMessages;
    }
    const assistantMessageId = `tool-execution:${toolCallId}`;
    const toolCall: AgentToolCall = {
        id: toolCallId,
        assistantMessageId,
        index: 0,
        name: patch.name ?? "unknown_tool",
        argsText: patch.argsText ?? "",
        argsJson: patch.argsJson,
        status: patch.status ?? "running",
        error: patch.error,
        result: patch.result,
        publicArgs: patch.publicArgs,
        publicResult: patch.publicResult,
        resultData: patch.resultData,
    };
    return reconcileMessages(messages, [
        ...nextMessages,
        {
            id: assistantMessageId,
            type: "ai",
            content: "",
            status: toolCall.status === "success" || toolCall.status === "error" ? "done" : "streaming",
            invocationId,
            projectionSource: "live",
            toolCalls: [toolCall],
        },
    ]);
};

/** 从公开工具结果提取有界文本预览。 */
const publicToolResultText = (result: PublicToolResultDto): string => {
    return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.textPreview)
        .join("\n");
};

/**
 * 将有界公开 tool result 合并到所属 assistant，不恢复被省略的原始正文。
 */
const upsertPublicToolResult = (
    assistant: AgentMessage,
    toolResult: Extract<AgentChatEntryDto, {type: "tool_result"}>,
): void => {
    const toolCalls = [...(assistant.toolCalls ?? [])];
    const index = toolCalls.findIndex((toolCall) => toolCall.id === toolResult.toolCallId);
    const result = publicToolResultText(toolResult.result);
    const previous = index >= 0 ? toolCalls[index] : undefined;
    const nextToolCall: AgentToolCall = {
        id: toolResult.toolCallId,
        assistantMessageId: assistant.id,
        index: previous?.index ?? toolCalls.length,
        name: toolResult.toolName,
        argsText: previous?.argsText ?? "",
        argsJson: previous?.argsJson,
        status: toolResult.isError ? "error" : "success",
        error: toolResult.isError ? result : undefined,
        result,
        publicArgs: previous?.publicArgs,
        publicResult: toolResult.result,
        resultData: publicToolResultDetails(toolResult.result),
        resultEntryId: toolResult.id,
    };
    if (index >= 0) {
        toolCalls[index] = nextToolCall;
    } else {
        toolCalls.push(nextToolCall);
    }
    assistant.toolCalls = toolCalls;
};

/** 专用工具卡只消费公开 details 的 JSON 预览。 */
const publicToolResultDetails = (result: PublicToolResultDto): JsonValue | undefined => {
    const details = result.details;
    if (!details) {
        return undefined;
    }
    if (details.kind === "generic") {
        return publicValuePreviewJsonValue(details.value);
    }
    if (details.kind === "file_change") {
        return {
            diff: details.diffPreview,
            diffBytes: details.diffBytes,
            diffOmitted: details.diffOmitted,
            files: details.files,
            filesOmitted: details.filesOmitted,
            ...(details.firstChangedLine === undefined ? {} : {firstChangedLine: details.firstChangedLine}),
        };
    }
    if (details.kind === "read") {
        return {
            ...(details.path ? {path: details.path} : {}),
            ...(details.startLine === undefined ? {} : {startLine: details.startLine}),
            ...(details.endLine === undefined ? {} : {endLine: details.endLine}),
            ...(details.totalLines === undefined ? {} : {totalLines: details.totalLines}),
            ...(details.nextOffset === undefined ? {} : {nextOffset: details.nextOffset}),
        };
    }
    if (details.kind === "bash") {
        return {
            truncated: details.truncated,
            ...(details.truncatedBy ? {truncatedBy: details.truncatedBy} : {}),
            ...(details.totalLines === undefined ? {} : {totalLines: details.totalLines}),
            ...(details.totalBytes === undefined ? {} : {totalBytes: details.totalBytes}),
            ...(details.fullOutput ? {fullOutput: details.fullOutput} : {}),
        };
    }
    if (details.kind === "request_user_input") {
        return {answers: details.answers};
    }
    if (details.kind === "switch_mode") {
        return {
            ...(details.approved === undefined ? {} : {approved: details.approved}),
            ...(details.pending === undefined ? {} : {pending: details.pending}),
            ...(details.targetMode ? {targetMode: details.targetMode} : {}),
        };
    }
    const value = publicValuePreviewJsonValue(details.value);
    if (details.kind === "task") {
        return value;
    }
    return value && typeof value === "object" && !Array.isArray(value)
        ? {
            ...value,
            ...(details.sessionId === undefined ? {} : {sessionId: details.sessionId}),
            ...(details.profileKey ? {profileKey: details.profileKey} : {}),
            ...(details.status ? {status: details.status} : {}),
        }
        : {
            value,
            ...(details.sessionId === undefined ? {} : {sessionId: details.sessionId}),
            ...(details.profileKey ? {profileKey: details.profileKey} : {}),
            ...(details.status ? {status: details.status} : {}),
        };
};

/**
 * 将持久化 tool details 收窄为真正 JSON 值，避免 UI 状态长期持有 unknown。
 * 非 JSON 字段按 JSON.stringify 的语义忽略，循环引用不会进入公开状态。
 */
const jsonValue = (value: unknown, seen = new WeakSet<object>()): JsonValue | undefined => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "object" || seen.has(value)) {
        return undefined;
    }
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => jsonValue(item, seen) ?? null);
        }
        const entries = Object.entries(value)
            .map(([key, item]) => [key, jsonValue(item, seen)] as const)
            .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
        return Object.fromEntries(entries);
    } finally {
        seen.delete(value);
    }
};

/** 将任意工具参数值解析为 AgentMode；非法/缺失时返回 undefined。复用 shared schema 避免手写枚举漂移。 */
const parseAgentMode = (value: unknown): AgentMode | undefined => {
    const parsed = AgentModeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
};

const approvalQuestion = (toolName: string, args: Record<string, unknown>): string => {
    if (toolName === "switch_mode") {
        const targetMode = parseAgentMode(args.targetMode) ?? "normal";
        const modeLabel = targetMode === "normal"
            ? translate("agent.mode.normal", "普通模式")
            : targetMode === "discuss" ? translate("agent.mode.discuss", "讨论模式") : translate("agent.mode.plan", "计划模式");
        return typeof args.reason === "string" && args.reason
            ? translate("agent.approval.switchModeWithReason", `Agent 请求切换到${modeLabel}：${args.reason}`, {mode: modeLabel, reason: args.reason})
            : translate("agent.approval.switchMode", `Agent 请求切换到${modeLabel}。`, {mode: modeLabel});
    }
    if (toolName === "skill") {
        const skillKey = typeof args.skillKey === "string" ? args.skillKey : translate("agent.approval.unknownSkill", "未知 skill");
        return translate("agent.approval.activateSkill", `Agent 请求激活 skill：${skillKey}`, {skill: skillKey});
    }
    return translate("agent.approval.executeTool", `Agent 请求执行 ${toolName}。`, {tool: toolName});
};
