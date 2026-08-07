import type {MaybeRefOrGetter} from "vue";
import {computed, getCurrentScope, onScopeDispose, ref, toValue, watch} from "vue";
import {isNovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import type {AgentMessage, AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import {
    AgentSurfaceOperationController,
    type AgentSurfaceActivationAttempt,
    type AgentSurfaceOperationResult,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";
import {applyClientVariablePatch, buildAgentClientState} from "nbook/app/components/novel-ide/agent/client-variables";
import {reconcileInvocationReceipt} from "nbook/app/components/novel-ide/agent/agent-invocation-reconciliation";
import {useAgentSession} from "nbook/app/components/novel-ide/agent/useAgentSession";
import {useAgentSessionStream} from "nbook/app/components/novel-ide/agent/useAgentSessionStream";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useThemeManager} from "nbook/app/composables/useThemeManager";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {agentSessionScopeKey} from "nbook/app/utils/agent-session-scope-key";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {InlineEditPayload} from "nbook/app/utils/inline-editor-selection";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigModelSettingsDto} from "nbook/shared/dto/config.dto";
import type {
    AgentSessionListQueryDto,
    AgentSessionRecoveryDto,
    AgentSessionSummaryDto,
    ClientStateSnapshotDto,
    InvokeAgentResult,
} from "nbook/shared/dto/agent-session.dto";
import type {JsonValue} from "nbook/server/agent/messages/types";

const INLINE_EDITOR_PROFILE_KEY = "inline.editor";

type InlineEditorAgentApi = Pick<ReturnType<typeof useAgentSessionApi>,
    | "abortSession"
    | "createSession"
    | "getSessionRecovery"
    | "invokeSession"
    | "listSessions"
    | "runCommand"
    | "subscribeSessionEvents"
>;

type InlineEditorAgentStream = Pick<ReturnType<typeof useAgentSessionStream>,
    | "ensure"
    | "start"
    | "stop"
    | "syncRecovery"
>;

type InlineEditorStreamFactory = (
    options: Parameters<typeof useAgentSessionStream>[0],
) => InlineEditorAgentStream;

type InlineEditorPatchRequest = Parameters<typeof applyClientVariablePatch>[0];

export type InlineEditorAgentControllerServices = {
    api: InlineEditorAgentApi;
    createStream: InlineEditorStreamFactory;
    loadSelectableModels: () => Promise<ConfigModelSettingsDto["enabledModels"]>;
    acknowledgeClientPatch: (
        sessionId: number,
        request: InlineEditorPatchRequest,
        isCurrent: () => boolean,
    ) => Promise<void>;
    buildClientState: () => ClientStateSnapshotDto;
    notifyError: (error: unknown, fallback: string) => void;
    storage: Pick<Storage, "getItem" | "setItem">;
    translate: (key: string, params?: {[key: string]: string | number}) => string;
    createClientMessageId: () => string;
};

export type InlineEditorAgentControllerOptions = {
    active: MaybeRefOrGetter<boolean>;
    projectReadyRevision: MaybeRefOrGetter<number | null | undefined>;
    selectedFilePath: MaybeRefOrGetter<string | null | undefined>;
};

/**
 * IDE Inline Prompt 的独立运行控制器。
 *
 * 它拥有 inline.editor Session、SSE、模型覆盖和调用生命周期，不依赖可见的
 * AgentChatSurface。Project generation 改变后，旧请求只能得到 superseded，不能回填新工作区。
 */
export function useInlineEditorAgentController(
    options: InlineEditorAgentControllerOptions,
    providedServices?: InlineEditorAgentControllerServices,
) {
    const ideStore = useNovelIdeStore();
    const previousSelectedFilePath = ref<string | null>(toValue(options.selectedFilePath) || null);
    const fileChangedSinceLastSend = ref(false);
    const selectionVersion = ref(0);
    const session = useAgentSession();
    const sessions = ref<AgentSessionSummaryDto[]>([]);
    const sessionId = ref<number | null>(null);
    const sessionLoading = ref(false);
    const resultText = ref("");
    const selectableModels = ref<ConfigModelSettingsDto["enabledModels"]>([]);
    const sessionModelDraft = ref<AgentSessionModelDraft>({
        modelKey: null,
        reasoningEffort: null,
    });
    const sessionModelPopoverOpen = ref(false);
    const sessionModelSaving = ref(false);
    const operationController = new AgentSurfaceOperationController();
    const operationRevision = ref(0);
    let sessionListRequestId = 0;
    let recoveryRequestId = 0;
    let readyPromise: Promise<void> = Promise.resolve();

    const buildCurrentClientState = (): ClientStateSnapshotDto => {
        const isUserAssetsWorkspace = ideStore.workspaceKind === "user-assets";
        return buildAgentClientState({
            activePanel: isNovelIdeTab(ideStore.activeLeftTab) ? ideStore.activeLeftTab : null,
            theme: ideStore.activeThemeId,
            novelId: isUserAssetsWorkspace ? "" : ideStore.currentProjectRoot,
            workspace: ideStore.currentWorkspaceRoot || null,
            workspaceKind: ideStore.workspaceKind,
            selectedFilePath: toValue(options.selectedFilePath) || null,
            selectedStoryThreadId: isUserAssetsWorkspace ? null : ideStore.selectedStoryThreadId,
            selectedStorySceneId: isUserAssetsWorkspace ? null : ideStore.selectedStorySceneId,
            previousSelectedFilePath: previousSelectedFilePath.value,
            fileChangedSinceLastSend: fileChangedSinceLastSend.value,
            selectionVersion: selectionVersion.value,
        });
    };
    const services = providedServices ?? createDefaultServices(ideStore, buildCurrentClientState);
    const messages = session.messages;
    const running = session.running;
    const memoryScopeKey = computed(() => agentSessionScopeKey(ideStore.workspaceKind, ideStore.currentProjectRoot));
    const scopeKey = computed(() => `${memoryScopeKey.value}@ready:${String(toValue(options.projectReadyRevision) ?? 0)}`);
    const operationScopeKey = computed(() => `${scopeKey.value}@inline:${String(operationRevision.value)}`);
    const sessionScope = computed<Pick<AgentSessionListQueryDto, "scope" | "projectRoot">>(() => (
        ideStore.workspaceKind === "novel" && ideStore.currentProjectRoot
            ? {scope: "project", projectRoot: ideStore.currentProjectRoot}
            : {scope: "workspace-root"}
    ));

    const stream = services.createStream({
        session,
        api: services.api,
        activeSessionId: sessionId,
        applyRecoverySideEffects: (_recovery, _result, owner) => {
            if (!owner.isCurrent()) return;
            syncSessionModelState();
        },
        onEvent: async (event, owner) => {
            if (event.kind === "session" && event.event.type === "client_variable_patch_requested") {
                await services.acknowledgeClientPatch(owner.sessionId, event.event.request, owner.isCurrent);
            }
        },
        onError: (error, fallback) => {
            services.notifyError(error, fallback);
        },
    });

    const currentTurnMessages = computed<AgentMessage[]>(() => {
        const latestUserIndex = messages.value.findLastIndex((message) => message.type === "user");
        return latestUserIndex >= 0 ? messages.value.slice(latestUserIndex + 1) : messages.value;
    });
    const editPreview = computed(() => {
        const toolCall = currentTurnMessages.value
            .flatMap((message) => message.toolCalls ?? [])
            .filter((item) => (item.name === "edit" || item.name === "write")
                && (item.status === "streaming" || item.status === "running"))
            .at(-1);
        if (!toolCall) return "";
        const path = readToolPath(toolCall);
        const status = services.translate("agent.chatSurface.inlineRunning");
        const output = toolCall.error || toolCall.result || "";
        return [`${status}${path ? `：${path}` : ""}`, output].filter(Boolean).join("\n");
    });
    const liveView = computed(() => {
        const latestAssistant = currentTurnMessages.value
            .filter((message) => message.type === "ai")
            .at(-1);
        return {
            thinking: latestAssistant?.thinking ?? "",
            content: latestAssistant?.content ?? "",
            status: latestAssistant?.status ?? null,
            editPreview: editPreview.value,
            resultText: resultText.value,
        };
    });
    const sessionLabel = computed(() => {
        const selected = sessions.value.find((item) => item.sessionId === sessionId.value)
            ?? session.recoveryShell.value?.summary
            ?? null;
        if (!selected) return services.translate("agent.chatSurface.inlineSessionLabel");
        return selected.title || `Inline AI #${String(selected.sessionId)}`;
    });
    const sessionModelSelectionValue = computed(() => sessionModelDraft.value.modelKey);
    const sessionThinkingResolvedLabel = computed(() => {
        const requested = session.recoveryShell.value?.thinkingLevel ?? null;
        const effective = session.recoveryShell.value?.effectiveThinkingLevel ?? "off";
        if (requested === null) {
            return services.translate("agent.chatSurface.followProfileCurrent", {
                level: thinkingLevelLabel(effective, services.translate),
            });
        }
        if (requested === effective) {
            return thinkingLevelLabel(effective, services.translate);
        }
        return services.translate("agent.chatSurface.requestedEffective", {
            requested: thinkingLevelLabel(requested, services.translate),
            effective: thinkingLevelLabel(effective, services.translate),
        });
    });

    function beginOperations(): AgentSurfaceActivationAttempt {
        const owner = operationController.begin(scopeKey.value);
        operationRevision.value = owner.revision;
        return owner;
    }

    function invalidateOperations(): void {
        operationController.invalidate();
        operationRevision.value += 1;
    }

    function captureOperation(expectedOperationKey?: string): AgentSurfaceActivationAttempt | null {
        if (expectedOperationKey !== undefined && expectedOperationKey !== operationScopeKey.value) {
            return null;
        }
        return operationController.capture(scopeKey.value);
    }

    function acceptsOperation(owner: AgentSurfaceActivationAttempt, expectedSessionId?: number): boolean {
        return operationController.accepts(owner, scopeKey.value)
            && (expectedSessionId === undefined || sessionId.value === expectedSessionId);
    }

    function resetState(): void {
        sessionListRequestId += 1;
        recoveryRequestId += 1;
        sessionLoading.value = false;
        stream.stop();
        sessionId.value = null;
        sessions.value = [];
        session.reset();
        resultText.value = "";
        sessionModelPopoverOpen.value = false;
        sessionModelSaving.value = false;
        syncSessionModelState();
    }

    async function activate(owner: AgentSurfaceActivationAttempt): Promise<void> {
        try {
            const models = await services.loadSelectableModels();
            if (!acceptsOperation(owner)) return;
            selectableModels.value = models;
        } catch (error) {
            if (!acceptsOperation(owner)) return;
            console.error("读取 Inline AI 模型配置失败", error);
            selectableModels.value = [];
        }
        try {
            await refreshSessions(owner);
        } catch (error) {
            if (!acceptsOperation(owner)) return;
            services.notifyError(error, services.translate("ide.inlineAi.bindFailed"));
        }
    }

    async function whenReady(): Promise<void> {
        await readyPromise;
    }

    async function refreshSessions(
        requestedOwner?: AgentSurfaceActivationAttempt,
    ): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto[]>> {
        const owner = requestedOwner ?? captureOperation();
        if (!owner) return {status: "superseded"};
        const requestId = ++sessionListRequestId;
        sessionLoading.value = true;
        try {
            const page = await services.api.listSessions({
                ...sessionScope.value,
                profileGroup: "all",
                profileKey: INLINE_EDITOR_PROFILE_KEY,
                status: "active",
                relation: "all",
                limit: 50,
            });
            if (requestId !== sessionListRequestId || !acceptsOperation(owner)) {
                return {status: "superseded"};
            }
            sessions.value = page.items;
            const rememberedId = readRememberedSessionId();
            const remembered = rememberedId ? page.items.find((item) => item.sessionId === rememberedId) : undefined;
            const current = sessionId.value ? page.items.find((item) => item.sessionId === sessionId.value) : undefined;
            const target = current ?? remembered ?? page.items[0];
            if (target && sessionId.value !== target.sessionId) {
                const loaded = await loadSession(target.sessionId, {
                    invalidateRefresh: false,
                    owner,
                });
                if (loaded.status === "superseded"
                    || requestId !== sessionListRequestId
                    || !acceptsOperation(owner)) {
                    return {status: "superseded"};
                }
            }
            if (!target) {
                recoveryRequestId += 1;
                sessionId.value = null;
                session.reset();
                resultText.value = "";
                stream.stop();
                syncSessionModelState();
            }
            return {status: "current", value: page.items};
        } catch (error) {
            if (requestId !== sessionListRequestId || !acceptsOperation(owner)) {
                return {status: "superseded"};
            }
            throw error;
        } finally {
            if (requestId === sessionListRequestId && acceptsOperation(owner)) {
                sessionLoading.value = false;
            }
        }
    }

    async function ensureSession(
        owner: AgentSurfaceActivationAttempt,
    ): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto>> {
        const listResult = await refreshSessions(owner);
        if (listResult.status === "superseded") return listResult;
        const selected = sessionId.value
            ? listResult.value.find((item) => item.sessionId === sessionId.value)
            : undefined;
        return selected ? {status: "current", value: selected} : createSession(owner);
    }

    async function createSession(
        requestedOwner?: AgentSurfaceActivationAttempt,
    ): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto>> {
        const owner = requestedOwner ?? captureOperation();
        if (!owner) return {status: "superseded"};
        const projectRoot = ideStore.workspaceKind === "novel"
            ? ideStore.currentProjectRoot || undefined
            : undefined;
        const created = await services.api.createSession({
            profileKey: INLINE_EDITOR_PROFILE_KEY,
            initial: {},
            currentProjectRoot: projectRoot,
        });
        if (!acceptsOperation(owner)) return {status: "superseded"};
        const loaded = await loadSession(created.sessionId, {owner});
        if (loaded.status === "superseded") return loaded;
        const refreshed = await refreshSessions(owner);
        return refreshed.status === "superseded"
            ? refreshed
            : {status: "current", value: loaded.value};
    }

    async function selectSession(targetSessionId: number): Promise<AgentSurfaceOperationResult<void>> {
        const owner = captureOperation();
        if (!owner) return {status: "superseded"};
        if (sessionId.value === targetSessionId) {
            return {status: "current", value: undefined};
        }
        const loaded = await loadSession(targetSessionId, {owner});
        return loaded.status === "superseded"
            ? loaded
            : {status: "current", value: undefined};
    }

    async function openSession(): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto>> {
        const owner = captureOperation();
        return owner ? ensureSession(owner) : {status: "superseded"};
    }

    async function loadSession(
        targetSessionId: number,
        loadOptions: {invalidateRefresh?: boolean; owner?: AgentSurfaceActivationAttempt} = {},
    ): Promise<AgentSurfaceOperationResult<AgentSessionSummaryDto>> {
        const owner = loadOptions.owner ?? captureOperation();
        if (!owner || !acceptsOperation(owner)) return {status: "superseded"};
        if (loadOptions.invalidateRefresh !== false) {
            sessionListRequestId += 1;
        }
        const requestId = ++recoveryRequestId;
        stream.stop();
        sessionId.value = targetSessionId;
        session.reset();
        resultText.value = "";
        const recovery = await services.api.getSessionRecovery(targetSessionId);
        if (requestId !== recoveryRequestId
            || !acceptsOperation(owner, targetSessionId)
            || recovery.summary.sessionId !== targetSessionId) {
            return {status: "superseded"};
        }
        if (recovery.summary.profileKey !== INLINE_EDITOR_PROFILE_KEY) {
            throw new Error(services.translate("agent.chatSurface.inlineLoadFailed"));
        }
        session.applyRecovery(recovery);
        rememberSessionId(targetSessionId);
        syncSessionModelState();
        sessions.value = sessions.value.some((item) => item.sessionId === recovery.summary.sessionId)
            ? sessions.value.map((item) => item.sessionId === recovery.summary.sessionId ? recovery.summary : item)
            : [recovery.summary, ...sessions.value];
        void stream.start(targetSessionId).catch(() => {});
        return {status: "current", value: recovery.summary};
    }

    async function sendPrompt(
        payload: InlineEditPayload,
        visibleMessage: string,
        expectedOperationKey?: string,
    ): Promise<AgentSurfaceOperationResult<void>> {
        const owner = captureOperation(expectedOperationKey);
        if (!owner) return {status: "superseded"};
        const targetResult = await ensureSession(owner);
        if (targetResult.status === "superseded") return targetResult;
        const targetSession = targetResult.value;
        if (targetSession.status === "running" || targetSession.status === "waiting") {
            throw new Error(services.translate("agent.chatSurface.inlineRunningError"));
        }
        if (sessionId.value !== targetSession.sessionId || !session.recoveryShell.value) {
            const loaded = await loadSession(targetSession.sessionId, {owner});
            if (loaded.status === "superseded") return loaded;
        }
        if (!acceptsOperation(owner, targetSession.sessionId)) return {status: "superseded"};

        resultText.value = "";
        const clientMessageId = services.createClientMessageId();
        const optimisticId = session.appendOptimisticUserMessage(clientMessageId, visibleMessage);
        let receivedReceipt = false;
        try {
            await stream.ensure();
            if (!acceptsOperation(owner, targetSession.sessionId)) return {status: "superseded"};
            const result = await services.api.invokeSession(targetSession.sessionId, {
                mode: "prompt",
                clientMessageId,
                message: {text: visibleMessage},
                input: inlineEditPayloadToJson(payload),
                clientState: services.buildClientState(),
            });
            if (!acceptsOperation(owner, targetSession.sessionId)) return {status: "superseded"};
            receivedReceipt = true;
            const reconciliation = reconcileInvocationReceipt(clientMessageId, result.acceptance);
            if (reconciliation.state === "rejected") {
                session.removeOptimisticUserMessage(optimisticId);
                throw new Error(result.error ?? services.translate("agent.chatSurface.runFailed"));
            }
            return handleInvokeResult(result, owner, targetSession.sessionId);
        } catch (error) {
            if (!acceptsOperation(owner, targetSession.sessionId)) return {status: "superseded"};
            if (!receivedReceipt) {
                session.markOptimisticUserMessageUnknown(clientMessageId);
            }
            throw error;
        }
    }

    async function handleInvokeResult(
        result: InvokeAgentResult,
        owner: AgentSurfaceActivationAttempt,
        targetSessionId: number,
    ): Promise<AgentSurfaceOperationResult<void>> {
        if (!acceptsOperation(owner, targetSessionId)) return {status: "superseded"};
        resultText.value = result.reportResult?.result ?? result.finalMessage ?? "";
        if (result.status !== "error") {
            const refreshed = await refreshSessions(owner);
            return refreshed.status === "superseded"
                ? refreshed
                : {status: "current", value: undefined};
        }
        await stream.syncRecovery("invoke_error_fallback");
        if (!acceptsOperation(owner, targetSessionId)) return {status: "superseded"};
        resultText.value = result.aborted
            ? services.translate("agent.chatSurface.stopped")
            : result.error ?? services.translate("agent.chatSurface.runFailed");
        throw new Error(resultText.value);
    }

    async function stopPrompt(): Promise<AgentSurfaceOperationResult<void>> {
        const owner = captureOperation();
        const targetSessionId = sessionId.value;
        if (!owner || !targetSessionId) return {status: "superseded"};
        await services.api.abortSession(targetSessionId, {});
        if (!acceptsOperation(owner, targetSessionId)) return {status: "superseded"};
        resultText.value = services.translate("agent.chatSurface.stopped");
        await stream.syncRecovery("manual_refresh");
        if (!acceptsOperation(owner, targetSessionId)) return {status: "superseded"};
        const refreshed = await refreshSessions(owner);
        return refreshed.status === "superseded"
            ? refreshed
            : {status: "current", value: undefined};
    }

    function syncSessionModelState(): void {
        sessionModelDraft.value = {
            ...sessionModelDraft.value,
            ...modelDraftFromRecovery(session.recoveryShell.value),
        };
    }

    function modelActionBlocked(): boolean {
        return !sessionId.value || running.value || sessionLoading.value || sessionModelSaving.value;
    }

    function restoreSessionModelDraft(): void {
        syncSessionModelState();
    }

    type SessionOperation = Readonly<{
        owner: AgentSurfaceActivationAttempt;
        sessionId: number;
    }>;

    function captureSessionOperation(): SessionOperation | null {
        const owner = captureOperation();
        const targetSessionId = sessionId.value;
        return owner && targetSessionId ? {owner, sessionId: targetSessionId} : null;
    }

    async function updateSessionModelSelection(
        modelKey: string | null,
        requestedOperation?: SessionOperation,
    ): Promise<boolean> {
        if (modelActionBlocked()) {
            restoreSessionModelDraft();
            return false;
        }
        const operation = requestedOperation ?? captureSessionOperation();
        if (!operation || !acceptsOperation(operation.owner, operation.sessionId)) {
            restoreSessionModelDraft();
            return false;
        }
        sessionModelDraft.value = {...sessionModelDraft.value, modelKey};
        sessionModelSaving.value = true;
        try {
            await services.api.runCommand(operation.sessionId, {command: "model", modelKey});
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            await stream.syncRecovery("manual_refresh");
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            syncSessionModelState();
            return true;
        } catch (error) {
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            services.notifyError(error, services.translate("agent.chatSurface.updateModelFailed"));
            restoreSessionModelDraft();
            return false;
        } finally {
            if (acceptsOperation(operation.owner, operation.sessionId)) {
                sessionModelSaving.value = false;
            }
        }
    }

    async function updateSessionThinkingLevel(
        thinkingLevel: ThinkingLevelDto | null,
        requestedOperation?: SessionOperation,
    ): Promise<boolean> {
        if (modelActionBlocked()) {
            restoreSessionModelDraft();
            return false;
        }
        const operation = requestedOperation ?? captureSessionOperation();
        if (!operation || !acceptsOperation(operation.owner, operation.sessionId)) {
            restoreSessionModelDraft();
            return false;
        }
        sessionModelDraft.value = {...sessionModelDraft.value, reasoningEffort: thinkingLevel};
        sessionModelSaving.value = true;
        try {
            await services.api.runCommand(operation.sessionId, {command: "thinking", thinkingLevel});
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            await stream.syncRecovery("manual_refresh");
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            syncSessionModelState();
            return true;
        } catch (error) {
            if (!acceptsOperation(operation.owner, operation.sessionId)) return false;
            services.notifyError(error, services.translate("agent.chatSurface.updateThinkingFailed"));
            restoreSessionModelDraft();
            return false;
        } finally {
            if (acceptsOperation(operation.owner, operation.sessionId)) {
                sessionModelSaving.value = false;
            }
        }
    }

    function setSessionModelDraft(value: AgentSessionModelDraft): void {
        if (modelActionBlocked()) {
            restoreSessionModelDraft();
            return;
        }
        sessionModelDraft.value = value;
    }

    function setSessionModelPopoverOpen(value: boolean): void {
        if (value && modelActionBlocked()) {
            restoreSessionModelDraft();
            sessionModelPopoverOpen.value = false;
            return;
        }
        sessionModelPopoverOpen.value = value;
    }

    function toggleSessionModelPopover(): void {
        setSessionModelPopoverOpen(!sessionModelPopoverOpen.value);
    }

    async function applySessionModelSettings(): Promise<void> {
        if (modelActionBlocked()) {
            restoreSessionModelDraft();
            sessionModelPopoverOpen.value = false;
            return;
        }
        const operation = captureSessionOperation();
        if (!operation) return;
        const nextModelKey = sessionModelDraft.value.modelKey;
        const nextThinkingLevel = sessionModelDraft.value.reasoningEffort;
        if (!await updateSessionModelSelection(nextModelKey, operation)) return;
        if (!await updateSessionThinkingLevel(nextThinkingLevel, operation)) return;
        if (!acceptsOperation(operation.owner, operation.sessionId)) return;
        restoreSessionModelDraft();
        sessionModelPopoverOpen.value = false;
    }

    async function resetSessionModelSettings(): Promise<void> {
        if (modelActionBlocked()) {
            restoreSessionModelDraft();
            sessionModelPopoverOpen.value = false;
            return;
        }
        const operation = captureSessionOperation();
        if (!operation) return;
        if (!await updateSessionModelSelection(null, operation)) return;
        if (!await updateSessionThinkingLevel(null, operation)) return;
        if (!acceptsOperation(operation.owner, operation.sessionId)) return;
        restoreSessionModelDraft();
        sessionModelPopoverOpen.value = false;
    }

    function readRememberedSessionId(): number | null {
        const raw = services.storage.getItem(`agent:inline-editor-session:${memoryScopeKey.value}`);
        const parsed = raw ? Number(raw) : NaN;
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function rememberSessionId(targetSessionId: number): void {
        services.storage.setItem(
            `agent:inline-editor-session:${memoryScopeKey.value}`,
            String(targetSessionId),
        );
    }

    watch(() => toValue(options.selectedFilePath), (nextFilePath, previousFilePath) => {
        const nextValue = nextFilePath || null;
        const previousValue = previousFilePath || null;
        if (nextValue === previousValue) return;
        previousSelectedFilePath.value = previousValue;
        fileChangedSinceLastSend.value = true;
        selectionVersion.value += 1;
    });

    watch(
        [() => toValue(options.active), () => scopeKey.value] as const,
        ([active]) => {
            invalidateOperations();
            resetState();
            if (!active) {
                readyPromise = Promise.resolve();
                return;
            }
            const owner = beginOperations();
            readyPromise = activate(owner);
        },
        {immediate: true},
    );

    watch(() => ideStore.configRevision, () => {
        const owner = captureOperation();
        if (!owner || !toValue(options.active)) return;
        readyPromise = activate(owner);
    });

    if (getCurrentScope()) {
        onScopeDispose(() => {
            invalidateOperations();
            resetState();
            operationController.dispose();
        });
    }

    return {
        operationScopeKey,
        sessions,
        sessionId,
        sessionLoading,
        running,
        resultText,
        liveView,
        editPreview,
        sessionLabel,
        selectableModels,
        sessionModelDraft,
        sessionModelPopoverOpen,
        sessionModelSaving,
        sessionModelSelectionValue,
        sessionThinkingResolvedLabel,
        whenReady,
        refreshSessions,
        selectSession,
        createSession,
        openSession,
        sendPrompt,
        stopPrompt,
        updateSessionModelSelection,
        setSessionModelDraft,
        setSessionModelPopoverOpen,
        toggleSessionModelPopover,
        applySessionModelSettings,
        resetSessionModelSettings,
    };
}

function createDefaultServices(
    ideStore: ReturnType<typeof useNovelIdeStore>,
    buildClientState: () => ClientStateSnapshotDto,
): InlineEditorAgentControllerServices {
    const api = useAgentSessionApi();
    const configApi = useConfigApi();
    const themeManager = useThemeManager();
    const notification = useNotification();
    const {t} = useI18n();
    const storage: Pick<Storage, "getItem" | "setItem"> = import.meta.client
        ? localStorage
        : {
            getItem: () => null,
            setItem: () => {},
        };
    return {
        api,
        createStream: (options) => useAgentSessionStream(options),
        loadSelectableModels: async () => (await configApi.bootstrap()).modelSettings.enabledModels,
        acknowledgeClientPatch: async (sessionId, request, isCurrent) => {
            if (!isCurrent()) return;
            const toolCallId = request.toolCallId === undefined
                ? undefined
                : assertPublicToolCallId(request.toolCallId);
            try {
                const appliedValue = await applyClientVariablePatch(request, buildClientState(), {
                    setActivePanel: (value) => {
                        if (!isCurrent()) return false;
                        ideStore.activeLeftTab = value;
                        return true;
                    },
                    setTheme: async (value) => {
                        if (!isCurrent()) return false;
                        const applied = await themeManager.setTheme(value);
                        return isCurrent() && applied;
                    },
                    customThemeIds: ideStore.customThemes.map((theme) => theme.id),
                });
                if (!isCurrent()) return;
                await api.acknowledgeClientVariablePatch(sessionId, {
                    namespace: "client",
                    path: request.path,
                    operations: request.operations,
                    appliedValue,
                    invocationId: request.invocationId,
                    toolCallId,
                });
            } catch (error) {
                if (!isCurrent()) return;
                await api.acknowledgeClientVariablePatch(sessionId, {
                    namespace: "client",
                    path: request.path,
                    operations: request.operations,
                    error: error instanceof Error ? error.message : String(error),
                    invocationId: request.invocationId,
                    toolCallId,
                });
            }
        },
        buildClientState,
        notifyError: (error, fallback) => {
            const message = resolveApiErrorMessage(error, fallback);
            notification.error(message, {title: fallback});
        },
        storage,
        translate: (key, params) => params ? t(key, params) : t(key),
        createClientMessageId: () => crypto.randomUUID(),
    };
}

function inlineEditPayloadToJson(payload: InlineEditPayload): JsonValue {
    return {
        version: payload.version,
        task: payload.task,
        targetPath: payload.targetPath,
        instruction: payload.instruction,
        references: payload.references.map((reference) => {
            const output: {[key: string]: JsonValue} = {
                ref: reference.ref,
                path: reference.path,
                match: reference.match,
                text: reference.text,
            };
            if (reference.range) {
                output.range = {
                    startLine: reference.range.startLine,
                    endLine: reference.range.endLine,
                };
            }
            return output;
        }),
    };
}

function readToolPath(toolCall: AgentToolCall): string {
    const argsText = toolCall.argsJson || toolCall.argsText;
    if (!argsText.trim()) return "";
    try {
        const parsed = JSON.parse(argsText) as {path?: string};
        return typeof parsed.path === "string" ? parsed.path : "";
    } catch {
        return "";
    }
}

function modelDraftFromRecovery(
    recovery: Pick<AgentSessionRecoveryDto, "model" | "thinkingLevel"> | null,
): AgentSessionModelDraft {
    const model = recovery?.model ?? null;
    return {
        modelKey: model ? `${model.providerConfigId}/${model.modelId}` : null,
        reasoningEffort: recovery?.thinkingLevel ?? null,
    };
}

function thinkingLevelLabel(
    level: ThinkingLevelDto,
    translate: InlineEditorAgentControllerServices["translate"],
): string {
    switch (level) {
        case "off": return translate("agent.composer.off");
        case "minimal": return translate("agent.composer.minimal");
        case "low": return translate("agent.composer.low");
        case "medium": return translate("agent.composer.medium");
        case "high": return translate("agent.composer.high");
        case "xhigh": return translate("agent.composer.xhigh");
        case "max": return translate("agent.composer.max");
    }
}
