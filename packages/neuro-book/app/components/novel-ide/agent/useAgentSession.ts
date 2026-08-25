import type {AgentChatEntryDto, AgentChatUserEntryDto} from "nbook/shared/dto/agent-public-event.dto";
import type {
    AgentPendingUserInputDto,
    AgentRuntimeStreamEventDto,
    AgentSessionEventDto,
    AgentSessionHistoryPageDto,
    AgentSessionLiveStateDto,
    AgentSessionRecoveryDto,
    AgentSessionRelationsDto,
    AgentSessionAttachmentItemDto,
    AgentSessionSystemPromptDto,
} from "nbook/shared/dto/agent-session.dto";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {computed, getCurrentScope, onScopeDispose, ref, shallowReadonly, shallowRef} from "vue";
import {
    applyRuntimeEventToMessages,
    applySessionEntryToMessages,
    deriveMessagesFromChatEntries,
    formatTimestamp,
    publicToolArgsJsonValue,
    reconcileMessages,
    toPendingUserInputSession,
    type AgentMessage,
    type AgentPendingUserInputSession,
} from "nbook/app/components/novel-ide/agent/agent-message";
import {optimisticUserMessage} from "nbook/app/components/novel-ide/agent/agent-user-message-markdown";

export type AgentConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected";

export type AgentRunPhase =
    | "idle"
    | "model_pending"
    | "thinking"
    | "assistant_streaming"
    | "tool_args_streaming"
    | "tool_running"
    | "tool_streaming"
    | "waiting_user"
    | "finishing";

export type AgentRecoveryShell = Omit<AgentSessionRecoveryDto, "history">;
export type AgentHistoryLoader = (sessionId: number, cursor: string) => Promise<AgentSessionHistoryPageDto>;
export type AgentSystemPromptLoader = (sessionId: number) => Promise<AgentSessionSystemPromptDto>;

/** recovery 应用后的本地窗口变化，供既有副作用 seam 消费。 */
export type AgentRecoveryApplyResult = {
    historyWindowReset: boolean;
};

type PendingMessageUpdate = {
    event: Extract<AgentRuntimeStreamEventDto, {type: "message_update"}>;
    invocationId?: string;
};

/** 将 tool.user-input-required 事件转换为前端等待输入状态。 */
function toPendingUserInputDto(
    event: Extract<AgentRuntimeStreamEventDto, {type: "tool.user-input-required"}>,
    assistantMessageId?: string,
): AgentPendingUserInputDto {
    return {
        assistantMessageId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        ...(event.formSpec?.form
            ? {
                formSpec: {
                    form: event.formSpec.form,
                    layout: event.formSpec.layout,
                    prompt: event.formSpec.prompt,
                },
            }
            : {}),
    };
}

/** 将 tool.user-input-required 事件转换为前端等待输入状态。 */
function toUserInputSession(
    event: Extract<AgentRuntimeStreamEventDto, {type: "tool.user-input-required"}>,
    assistantMessageId?: string,
): AgentPendingUserInputSession | null {
    return toPendingUserInputSession(toPendingUserInputDto(event, assistantMessageId), []);
}

/**
 * 管理 recovery shell、durable history、live overlay 与 optimistic message。
 * cursor 只由服务端生成和消费，前端只保存最老已加载页的 cursor。
 */
export function useAgentSession() {
    const recoveryShell = shallowRef<AgentRecoveryShell | null>(null);
    const durableEntries = shallowRef<AgentChatEntryDto[]>([]);
    /** durableEntries 当前对应的 active path revision；live shell 可提前进入下一 revision。 */
    const durableRevision = ref<string | null>(null);
    const previousCursor = ref<string | null>(null);
    const liveOverlay = shallowRef<AgentMessage[]>([]);
    const optimisticMessages = shallowRef<AgentMessage[]>([]);
    const liveRunStatus = ref<"idle" | "running" | "waiting" | "aborting">("idle");
    const runPhase = ref<AgentRunPhase>("idle");
    const connectionStatus = ref<AgentConnectionStatus>("idle");
    const pendingUserInputSessions = shallowRef<AgentPendingUserInputSession[]>([]);
    const eventEpoch = ref<string | null>(null);
    const lastSeq = ref(0);
    const needsRecovery = ref(false);
    const recoveryReasons = ref<string[]>([]);
    const historyLoading = ref(false);
    const historyError = ref("");
    const systemPrompt = ref<string | null>(null);
    const systemPromptLoading = ref(false);
    const systemPromptError = ref("");
    const pendingMessageUpdates: PendingMessageUpdate[] = [];
    let runtimeUpdateFrame: number | null = null;
    let runtimeUpdateFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let historyRequest: {sessionId: number; cursor: string; promise: Promise<boolean>} | null = null;
    let systemPromptRequest: {sessionId: number; promise: Promise<boolean>} | null = null;
    let historyWindowInvalid = false;
    let requestGeneration = 0;

    const durableMessages = computed(() => deriveMessagesFromChatEntries(durableEntries.value, {
        activeInvocation: recoveryShell.value?.activeInvocation,
        pendingUserInputs: recoveryShell.value?.pendingUserInputs,
    }));
    const messages = computed(() => mergeMessageLayers(durableMessages.value, liveOverlay.value, optimisticMessages.value));
    const running = computed(() => Boolean(recoveryShell.value?.activeInvocation) || liveRunStatus.value === "running" || liveRunStatus.value === "aborting");
    const pendingUserInputSession = computed<AgentPendingUserInputSession | null>(() => pendingUserInputSessions.value[0] ?? null);
    const hasPrevious = computed(() => previousCursor.value !== null);

    /** 取消尚未执行的 message_update 批量提交。 */
    const cancelPendingMessageUpdateFlush = (): void => {
        if (runtimeUpdateFrame !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(runtimeUpdateFrame);
        }
        runtimeUpdateFrame = null;
        if (runtimeUpdateFallbackTimer !== null) {
            clearTimeout(runtimeUpdateFallbackTimer);
        }
        runtimeUpdateFallbackTimer = null;
    };

    /** 清理尚未应用的流式 message_update。 */
    const clearPendingMessageUpdates = (): void => {
        cancelPendingMessageUpdateFlush();
        pendingMessageUpdates.splice(0);
    };

    /** 将完整投影视图保存为 live overlay；optimistic message 始终由独立层持有。 */
    const applyProjectedMessages = (nextMessages: AgentMessage[]): void => {
        const optimisticIds = new Set(optimisticMessages.value.map((message) => message.id));
        liveOverlay.value = nextMessages.filter((message) => message.projectionSource === "live" && !optimisticIds.has(message.id));
    };

    /** 一次性提交帧内累积的 message_update。 */
    const flushPendingMessageUpdates = (): void => {
        cancelPendingMessageUpdateFlush();
        if (pendingMessageUpdates.length === 0) {
            return;
        }
        const updates = pendingMessageUpdates.splice(0);
        let nextMessages: AgentMessage[] = messages.value;
        for (const item of updates) {
            nextMessages = applyRuntimeEventToMessages(nextMessages, item.event, item.invocationId);
        }
        applyProjectedMessages(nextMessages);
    };

    /** 把流式 token 更新合并到浏览器下一帧再提交。 */
    const schedulePendingMessageUpdateFlush = (): void => {
        if (runtimeUpdateFrame !== null || runtimeUpdateFallbackTimer !== null) {
            return;
        }
        if (typeof requestAnimationFrame === "function") {
            runtimeUpdateFrame = requestAnimationFrame(() => {
                runtimeUpdateFrame = null;
                flushPendingMessageUpdates();
            });
            return;
        }
        runtimeUpdateFallbackTimer = setTimeout(() => {
            runtimeUpdateFallbackTimer = null;
            flushPendingMessageUpdates();
        }, 0);
    };

    /** 暂存一次流式 message_update。 */
    const queuePendingMessageUpdate = (event: Extract<AgentRuntimeStreamEventDto, {type: "message_update"}>, invocationId?: string): void => {
        pendingMessageUpdates.push({event, invocationId});
        schedulePendingMessageUpdateFlush();
    };

    /** 根据 runtime event 更新运行阶段。 */
    const applyRuntimePhase = (event: AgentRuntimeStreamEventDto): void => {
        if (event.type === "agent_start" || event.type === "turn_start") {
            liveRunStatus.value = "running";
            runPhase.value = "model_pending";
        }
        if (event.type === "agent_end") {
            if (event.status === "waiting") {
                liveRunStatus.value = "waiting";
                runPhase.value = "waiting_user";
            } else {
                liveRunStatus.value = "idle";
                runPhase.value = "idle";
            }
        }
        if (event.type === "message_start" || event.type === "message_update") {
            const update = event.type === "message_update" ? event.update : null;
            if (update?.type === "thinking_start" || update?.type === "thinking_delta") {
                runPhase.value = "thinking";
            } else if (update?.type === "toolcall_start" || update?.type === "toolcall_args") {
                runPhase.value = "tool_args_streaming";
            } else {
                runPhase.value = "assistant_streaming";
            }
        }
        if (event.type === "tool_execution_start") runPhase.value = "tool_running";
        if (event.type === "tool_execution_update") runPhase.value = "tool_streaming";
        if (event.type === "tool_execution_end") runPhase.value = "finishing";
        if (event.type === "turn_end" && liveRunStatus.value === "running") runPhase.value = "finishing";
    };

    if (getCurrentScope()) {
        onScopeDispose(() => {
            clearPendingMessageUpdates();
            requestGeneration += 1;
        });
    }

    /** 重置当前会话的全部本地真相与请求代次。 */
    const reset = (): void => {
        clearPendingMessageUpdates();
        requestGeneration += 1;
        historyRequest = null;
        systemPromptRequest = null;
        historyWindowInvalid = false;
        recoveryShell.value = null;
        durableEntries.value = [];
        durableRevision.value = null;
        previousCursor.value = null;
        liveOverlay.value = [];
        optimisticMessages.value = [];
        liveRunStatus.value = "idle";
        runPhase.value = "idle";
        connectionStatus.value = "idle";
        pendingUserInputSessions.value = [];
        eventEpoch.value = null;
        lastSeq.value = 0;
        needsRecovery.value = false;
        recoveryReasons.value = [];
        historyLoading.value = false;
        historyError.value = "";
        systemPrompt.value = null;
        systemPromptLoading.value = false;
        systemPromptError.value = "";
    };

    /** 追加与 durable history 分离的保序乐观用户消息，并返回可回滚 ID。 */
    const appendOptimisticUserMessage = (
        clientMessageId: string,
        content: string,
        attachments: readonly AgentSessionAttachmentItemDto[] = [],
        deliveryMode: "prompt" | "steer" | "followup" = "prompt",
    ): string => {
        const id = `optimistic-user:${clientMessageId}`;
        optimisticMessages.value = [
            ...optimisticMessages.value,
            optimisticUserMessage({
                id,
                clientMessageId,
                markdown: content,
                attachments,
                timestamp: formatTimestamp(Date.now()),
                deliveryMode,
            }),
        ];
        return id;
    };

    /** admission 或 transport 失败时按 ID 回滚尚未 durable 化的乐观消息。 */
    const removeOptimisticUserMessage = (messageId: string): void => {
        optimisticMessages.value = optimisticMessages.value.filter((message) => message.id !== messageId);
    };

    /** transport failure 后保留本地占位并明确标记 unknown。 */
    const markOptimisticUserMessageUnknown = (clientMessageId: string): void => {
        optimisticMessages.value = optimisticMessages.value.map((message) => message.clientMessageId === clientMessageId
            ? {...message, deliveryState: "unknown"}
            : message);
    };

    /** queue SSE/recovery 也可按 clientMessageId 消费对应 optimistic。 */
    const consumeOptimisticClientMessageIds = (clientMessageIds: readonly string[]): void => {
        const accepted = new Set(clientMessageIds);
        optimisticMessages.value = optimisticMessages.value.filter((message) => {
            return !message.clientMessageId || !accepted.has(message.clientMessageId);
        });
    };

    /** durable user entry 按 clientMessageId 精确消费对应 optimistic message。 */
    const consumeOptimisticUserMessages = (entries: AgentChatUserEntryDto[]): void => {
        const accepted = new Set(entries.map((entry) => entry.clientMessageId));
        optimisticMessages.value = optimisticMessages.value.filter((message) => {
            return !message.clientMessageId || !accepted.has(message.clientMessageId);
        });
    };

    /** 记录一次需要通过唯一 recovery GET 恢复的原因。 */
    const requestRecovery = (reason: string): void => {
        needsRecovery.value = true;
        if (!recoveryReasons.value.includes(reason)) {
            recoveryReasons.value = [...recoveryReasons.value, reason];
        }
    };

    const clearRecoveryRequest = (): void => {
        needsRecovery.value = false;
        recoveryReasons.value = [];
    };

    /** 应用 recovery 真相；同 revision 合并旧页，失效窗口或 revision 变化时替换。 */
    const applyRecovery = (payload: AgentSessionRecoveryDto): AgentRecoveryApplyResult => {
        clearPendingMessageUpdates();
        const previousShell = recoveryShell.value;
        const sameSession = previousShell?.summary.sessionId === payload.summary.sessionId;
        const sameDurableRevision = sameSession && durableRevision.value === payload.activePathRevision;
        const historyWindowReset = sameSession && historyWindowInvalid;
        const mergeHistoryWindow = sameDurableRevision && !historyWindowInvalid;
        const existingEntryIds = new Set(durableEntries.value.map((entry) => entry.id));
        if (!sameSession) {
            requestGeneration += 1;
            historyRequest = null;
            systemPromptRequest = null;
            historyLoading.value = false;
            systemPromptLoading.value = false;
            systemPrompt.value = null;
            systemPromptError.value = "";
        }
        const existingMessages = messages.value;
        const nextEntries = mergeHistoryWindow
            ? mergeDurableEntries(durableEntries.value, payload.history.entries)
            : payload.history.entries;
        durableEntries.value = nextEntries;
        durableRevision.value = payload.activePathRevision;
        if (!mergeHistoryWindow) {
            previousCursor.value = payload.history.previousCursor;
            liveOverlay.value = [];
            historyError.value = "";
        }
        historyWindowInvalid = false;
        const {history: _history, ...shell} = payload;
        recoveryShell.value = shell;
        if (mergeHistoryWindow) {
            let reconciled = existingMessages;
            for (const entry of payload.history.entries) {
                reconciled = applySessionEntryToMessages(reconciled, entry);
            }
            liveOverlay.value = reconciled.filter((message) => message.projectionSource === "live");
        }
        if (sameDurableRevision) {
            consumeOptimisticUserMessages(payload.history.entries.filter((entry): entry is AgentChatUserEntryDto => {
                return entry.type === "user" && !existingEntryIds.has(entry.id);
            }));
        }
        applyRunState(payload.activeInvocation, payload.pendingUserInputs);
        pendingUserInputSessions.value = payload.pendingUserInputs
            .map((pending) => toPendingUserInputSession(pending, messages.value))
            .filter((session): session is AgentPendingUserInputSession => session !== null);
        eventEpoch.value = payload.eventCursor.eventEpoch;
        lastSeq.value = payload.eventCursor.after;
        clearRecoveryRequest();
        return {historyWindowReset};
    };

    /** 将更早 history 页 prepend 到 durable truth；旧 revision 响应会被拒绝。 */
    const applyHistoryPage = (payload: AgentSessionHistoryPageDto): boolean => {
        const shell = recoveryShell.value;
        if (!shell || payload.sessionId !== shell.summary.sessionId) {
            return false;
        }
        if (payload.activePathRevision !== shell.activePathRevision) {
            requestRecovery("active_path_changed");
            return false;
        }
        durableEntries.value = prependDurableEntries(durableEntries.value, payload.history.entries);
        previousCursor.value = payload.history.previousCursor;
        historyError.value = "";
        return true;
    };

    /** 同一 cursor single-flight 地加载更早 history。 */
    const loadPrevious = async (loader: AgentHistoryLoader): Promise<boolean> => {
        const shell = recoveryShell.value;
        const cursor = previousCursor.value;
        if (!shell || !cursor) {
            return false;
        }
        const sessionId = shell.summary.sessionId;
        if (historyRequest?.sessionId === sessionId && historyRequest.cursor === cursor) {
            return historyRequest.promise;
        }
        const generation = requestGeneration;
        historyLoading.value = true;
        historyError.value = "";
        const request = {sessionId, cursor, promise: Promise.resolve(false)};
        request.promise = (async () => {
            try {
                const page = await loader(sessionId, cursor);
                if (generation !== requestGeneration || recoveryShell.value?.summary.sessionId !== sessionId || previousCursor.value !== cursor) {
                    return false;
                }
                return applyHistoryPage(page);
            } catch (error) {
                if (generation !== requestGeneration || recoveryShell.value?.summary.sessionId !== sessionId) {
                    return false;
                }
                const code = resolveApiErrorCode(error);
                if (code === "ACTIVE_PATH_CHANGED") {
                    requestRecovery("active_path_changed");
                } else if (code === "INVALID_HISTORY_CURSOR") {
                    historyWindowInvalid = true;
                    requestRecovery("invalid_history_cursor");
                }
                historyError.value = resolveApiErrorMessage(error, "加载更早对话失败");
                return false;
            } finally {
                if (historyRequest === request) {
                    historyRequest = null;
                    historyLoading.value = false;
                }
            }
        })();
        historyRequest = request;
        return request.promise;
    };

    /** 按需加载当前 session 的 system prompt；普通 recovery 不会调用 loader。 */
    const loadSystemPrompt = async (loader: AgentSystemPromptLoader, refresh = false): Promise<boolean> => {
        const shell = recoveryShell.value;
        if (!shell) {
            return false;
        }
        const sessionId = shell.summary.sessionId;
        if (!refresh && systemPrompt.value !== null) {
            return true;
        }
        if (systemPromptRequest?.sessionId === sessionId) {
            return systemPromptRequest.promise;
        }
        const generation = requestGeneration;
        systemPromptLoading.value = true;
        systemPromptError.value = "";
        const request = {sessionId, promise: Promise.resolve(false)};
        request.promise = (async () => {
            try {
                const result = await loader(sessionId);
                if (generation !== requestGeneration || recoveryShell.value?.summary.sessionId !== sessionId || result.sessionId !== sessionId) {
                    return false;
                }
                systemPrompt.value = result.systemPrompt;
                return true;
            } catch (error) {
                if (generation !== requestGeneration || recoveryShell.value?.summary.sessionId !== sessionId) {
                    return false;
                }
                systemPromptError.value = resolveApiErrorMessage(error, "加载 System Prompt 失败");
                return false;
            } finally {
                if (systemPromptRequest === request) {
                    systemPromptRequest = null;
                    systemPromptLoading.value = false;
                }
            }
        })();
        systemPromptRequest = request;
        return request.promise;
    };

    /** 只更新关联 Agent 数据，不触碰 durable history。 */
    const applyRelations = (payload: AgentSessionRelationsDto): void => {
        if (!recoveryShell.value || recoveryShell.value.summary.sessionId !== payload.sessionId) {
            return;
        }
        recoveryShell.value = {
            ...recoveryShell.value,
            linkedAgents: payload.linkedAgents,
            linkedByAgents: payload.linkedByAgents,
            ...(payload.unavailableLinkedAgents !== undefined
                ? {unavailableLinkedAgents: payload.unavailableLinkedAgents}
                : {unavailableLinkedAgents: undefined}),
        };
    };

    /** 应用轻量 live state；active path revision 变化只请求统一 recovery。 */
    const applyLiveState = (state: AgentSessionLiveStateDto): void => {
        if (!recoveryShell.value) {
            requestRecovery("missing_recovery");
            return;
        }
        const current = recoveryShell.value;
        if (state.summary.sessionId !== current.summary.sessionId) {
            return;
        }
        const activePathChanged = state.activePathRevision !== current.activePathRevision;
        let pendingDetailsMissing = false;
        const pendingUserInputs = state.pendingUserInputs.map((pending) => {
            const existing = current.pendingUserInputs.find((item) => item.toolCallId === pending.toolCallId);
            if (pending.detailsOmitted && !existing?.formSpec) {
                pendingDetailsMissing = true;
            }
            // 同一 pending tool call 的参数与表单在生命周期内不可变；runtime/recovery 详情比共享预算 live preview 更完整。
            return existing ? {...pending, ...existing, detailsOmitted: pending.detailsOmitted} : pending;
        });
        recoveryShell.value = {
            ...current,
            summary: state.summary,
            summarizer: state.summarizer,
            activeLeafId: state.activeLeafId,
            activePathRevision: state.activePathRevision,
            pendingUserInputs,
            steerQueue: trimQueuedMessages(current.steerQueue, state.steerQueue.count),
            followUpQueue: {
                ...current.followUpQueue,
                status: state.followUpQueue.status,
                ...(state.followUpQueue.pausedBy ? {pausedBy: state.followUpQueue.pausedBy} : {pausedBy: undefined}),
                ...trimQueuedMessages(current.followUpQueue, state.followUpQueue.count),
            },
            activeInvocation: state.activeInvocation,
            model: state.model,
            thinkingLevel: state.thinkingLevel,
            effectiveThinkingLevel: state.effectiveThinkingLevel,
            agentMode: state.agentMode,
            contextUsage: state.contextUsage,
        };
        applyRunState(state.activeInvocation, pendingUserInputs);
        pendingUserInputSessions.value = pendingUserInputs
            .map((pending: AgentPendingUserInputDto) => toPendingUserInputSession(pending, messages.value))
            .filter((session): session is AgentPendingUserInputSession => session !== null);
        if (pendingDetailsMissing) {
            requestRecovery("pending_input_details_missing");
        }
        if (activePathChanged) {
            requestRecovery("active_path_changed");
        }
    };

    const applyConnectionStatus = (status: AgentConnectionStatus): void => {
        connectionStatus.value = status;
    };

    /** 应用一次 session event envelope。 */
    const applyEvent = (payload: AgentSessionEventDto): void => {
        if (payload.kind === "session" && payload.event.type === "connected") {
            const epochChanged = eventEpoch.value !== null && eventEpoch.value !== payload.event.eventEpoch;
            const cursorAheadOfStream = payload.event.latestSeq < lastSeq.value;
            if (epochChanged || cursorAheadOfStream) {
                requestRecovery("event_epoch_changed");
            } else {
                eventEpoch.value = payload.event.eventEpoch;
            }
            connectionStatus.value = "connected";
            return;
        }
        if (eventEpoch.value !== null && eventEpoch.value !== payload.eventEpoch) {
            flushPendingMessageUpdates();
            requestRecovery("event_epoch_changed");
            return;
        }
        if (eventEpoch.value === null) eventEpoch.value = payload.eventEpoch;
        if (payload.kind === "session" && payload.event.type === "snapshot_required") {
            flushPendingMessageUpdates();
            requestRecovery("snapshot_required");
            return;
        }
        if (payload.seq <= lastSeq.value) return;
        if (payload.seq > lastSeq.value + 1 && lastSeq.value > 0) {
            flushPendingMessageUpdates();
            requestRecovery("seq_gap");
            return;
        }
        lastSeq.value = payload.seq;

        if (payload.kind === "runtime") {
            if (payload.event.type === "message_update") {
                queuePendingMessageUpdate(payload.event, payload.invocationId);
                applyRuntimePhase(payload.event);
                return;
            }
            if (payload.event.type === "tool.user-input-required") {
                flushPendingMessageUpdates();
                const event = payload.event;
                const assistant = messages.value.find((message) => message.toolCalls?.some((toolCall) => toolCall.id === event.toolCallId));
                const pendingInput = toPendingUserInputDto(event, assistant?.id);
                if (recoveryShell.value) {
                    recoveryShell.value = {
                        ...recoveryShell.value,
                        pendingUserInputs: [
                            ...recoveryShell.value.pendingUserInputs.filter((item) => item.toolCallId !== event.toolCallId),
                            pendingInput,
                        ],
                    };
                }
                const pending = toUserInputSession(event, assistant?.id);
                if (pending) {
                    pendingUserInputSessions.value = [
                        ...pendingUserInputSessions.value.filter((item) => item.formToolCallId !== event.toolCallId && item.questions.every((question) => question.toolCallId !== event.toolCallId)),
                        pending,
                    ];
                    liveRunStatus.value = "waiting";
                    runPhase.value = "waiting_user";
                }
                return;
            }
            flushPendingMessageUpdates();
            applyProjectedMessages(applyRuntimeEventToMessages(messages.value, payload.event, payload.invocationId));
            applyRuntimePhase(payload.event);
            return;
        }

        flushPendingMessageUpdates();
        if (payload.event.type === "session_entry") {
            const entry = payload.event.entry;
            const projected = applySessionEntryToMessages(messages.value, entry);
            durableEntries.value = mergeDurableEntries(durableEntries.value, [entry]);
            liveOverlay.value = projected.filter((message) => message.projectionSource === "live");
            if (entry.type === "user") {
                consumeOptimisticUserMessages([entry]);
            }
            if (entry.type === "tool_result") {
                pendingUserInputSessions.value = pendingUserInputSessions.value.filter((session) => {
                    return !session.questions.some((question) => (question.toolCallId ?? question.toolNodeId) === entry.toolCallId)
                        && session.formToolCallId !== entry.toolCallId;
                });
            }
            return;
        }
        if (payload.event.type === "session_projection_invalidated") {
            requestRecovery(payload.event.reason);
            return;
        }
        if (payload.event.type === "session_state_changed") {
            applyLiveState(payload.event.state);
            return;
        }
        if (payload.event.type === "follow_up_queued" && recoveryShell.value) {
            recoveryShell.value = {
                ...recoveryShell.value,
                followUpQueue: {
                    ...recoveryShell.value.followUpQueue,
                    ...appendQueuedMessage(recoveryShell.value.followUpQueue, payload.event.item),
                },
            };
            return;
        }
        if (payload.event.type === "steer_queued" && recoveryShell.value) {
            recoveryShell.value = {
                ...recoveryShell.value,
                steerQueue: appendQueuedMessage(recoveryShell.value.steerQueue, payload.event.item),
            };
            return;
        }
        if (payload.event.type === "invocation_aborted") {
            liveRunStatus.value = "aborting";
            runPhase.value = "finishing";
        }
    };

    /** 根据恢复/live shell 同步运行阶段。 */
    function applyRunState(activeInvocation: AgentSessionRecoveryDto["activeInvocation"], pendingInputs: AgentPendingUserInputDto[]): void {
        if (activeInvocation) {
            liveRunStatus.value = activeInvocation.status === "waiting" ? "waiting" : activeInvocation.status;
            runPhase.value = pendingInputs.length > 0 ? "waiting_user" : runPhase.value === "idle" ? "model_pending" : runPhase.value;
        } else {
            // 服务端报「没有活动 invocation」就是权威终态，aborting 也不例外：
            // 取消侧补发的 agent_end 万一丢包，这里是唯一的兜底出口，加守卫会让界面永久停在「正在停止」。
            liveRunStatus.value = "idle";
            runPhase.value = "idle";
        }
    }

    return {
        appendOptimisticUserMessage,
        applyConnectionStatus,
        applyEvent,
        applyHistoryPage,
        applyLiveState,
        applyRecovery,
        applyRelations,
        clearRecoveryRequest,
        connectionStatus,
        durableEntries,
        eventEpoch,
        hasPrevious,
        historyError,
        historyLoading,
        lastSeq,
        liveOverlay,
        liveRunStatus,
        loadPrevious,
        loadSystemPrompt,
        messages,
        needsRecovery,
        optimisticMessages,
        pendingUserInputSession,
        pendingUserInputSessions: shallowReadonly(pendingUserInputSessions),
        previousCursor,
        recoveryReasons,
        recoveryShell,
        removeOptimisticUserMessage,
        markOptimisticUserMessageUnknown,
        consumeOptimisticClientMessageIds,
        requestRecovery,
        reset,
        runPhase,
        running,
        systemPrompt,
        systemPromptError,
        systemPromptLoading,
    };
}

/** 将 durable、live overlay、optimistic 三层合并为只读渲染列表。 */
function mergeMessageLayers(durable: AgentMessage[], live: AgentMessage[], optimistic: AgentMessage[]): AgentMessage[] {
    const liveMap = new Map(live.map((message) => [message.id, message]));
    const durableIds = new Set(durable.map((message) => message.id));
    const merged = durable.map((message) => liveMap.get(message.id) ?? message);
    for (const message of live) {
        if (!durableIds.has(message.id)) merged.push(message);
    }
    const durableClientMessageIds = new Set(merged.flatMap((message) => {
        return message.type === "user" && message.clientMessageId ? [message.clientMessageId] : [];
    }));
    const optimisticWithoutDurable = optimistic.filter((message) => {
        return !message.clientMessageId || !durableClientMessageIds.has(message.clientMessageId);
    });
    return reconcileMessages(merged, [...merged, ...optimisticWithoutDurable]);
}

/** same-revision recovery：更新重叠 entry，并保留已经加载的旧页顺序。 */
function mergeDurableEntries(current: AgentChatEntryDto[], incoming: AgentChatEntryDto[]): AgentChatEntryDto[] {
    const incomingMap = new Map(incoming.map((entry) => [entry.id, entry]));
    const currentIds = new Set(current.map((entry) => entry.id));
    return [
        ...current.map((entry) => incomingMap.get(entry.id) ?? entry),
        ...incoming.filter((entry) => !currentIds.has(entry.id)),
    ];
}

/** history page：先放更旧一页，再接现有窗口，重叠 entry 以现有较新投影为准。 */
function prependDurableEntries(current: AgentChatEntryDto[], previous: AgentChatEntryDto[]): AgentChatEntryDto[] {
    const currentMap = new Map(current.map((entry) => [entry.id, entry]));
    const previousIds = new Set(previous.map((entry) => entry.id));
    return [
        ...previous.map((entry) => currentMap.get(entry.id) ?? entry),
        ...current.filter((entry) => !previousIds.has(entry.id)),
    ];
}

function appendQueuedMessage<T extends {id: string}>(queue: {items: T[]; omittedItems: number}, item: T): {items: T[]; omittedItems: number} {
    if (queue.items.some((current) => current.id === item.id)) return queue;
    if (queue.items.length >= 64) return {...queue, omittedItems: queue.omittedItems + 1};
    return {...queue, items: [...queue.items, item]};
}

function trimQueuedMessages<T>(queue: {items: T[]; omittedItems: number}, count: number): {items: T[]; omittedItems: number} {
    if (count >= queue.items.length + queue.omittedItems) return queue;
    const items = queue.items.slice(0, Math.min(count, queue.items.length));
    return {items, omittedItems: Math.max(0, count - items.length)};
}
