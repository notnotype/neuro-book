import type {RunFrame, RuntimeTurn, TurnIngestResult} from "nbook/server/agent/harness/run-kernel-types";
import type {AppliedFailedTurn} from "nbook/server/agent/harness/turn-failure";
import {createPublicRuntimeProjectionState} from "nbook/server/agent/events/public-event-projection";

export type CreateRunFrameInput = {
    invocationId?: RunFrame["invocationId"];
    sessionId: RunFrame["sessionId"];
    workspaceKey: RunFrame["workspaceKey"];
    workspaceRootRef: RunFrame["workspaceRootRef"];
    workspaceFsRoot: RunFrame["workspaceFsRoot"];
    projectPath?: RunFrame["projectPath"];
    systemPrompt: RunFrame["systemPrompt"];
    messages: RunFrame["messages"];
    models: RunFrame["models"];
    model: RunFrame["model"];
    apiKey?: RunFrame["apiKey"];
    timeoutMs?: RunFrame["timeoutMs"];
    requestOptions?: RunFrame["requestOptions"];
    realtimeOutput?: RunFrame["realtimeOutput"];
    compaction?: RunFrame["compaction"];
    piTrace?: RunFrame["piTrace"];
    sessionContextEnabled: RunFrame["sessionContextEnabled"];
    toolKeys: RunFrame["toolKeys"];
    executionToolKeys?: RunFrame["executionToolKeys"];
    profileKey: RunFrame["profileKey"];
    profile: RunFrame["profile"];
    agentMode: RunFrame["agentMode"];
    profileTurnContexts?: RunFrame["profileTurnContexts"];
    fileChangeDiffMaxChars?: RunFrame["fileChangeDiffMaxChars"];
    pendingProfileTurnContextSettlements?: RunFrame["pendingProfileTurnContextSettlements"];
    thinkingLevel: RunFrame["thinkingLevel"];
    runtimeState: RunFrame["runtimeState"];
    reportResultReminderEnabled: RunFrame["reportResultReminderEnabled"];
    caller: RunFrame["caller"];
    abortSignal?: RunFrame["abortSignal"];
    onEvent?: RunFrame["onEvent"];
    forceRuntimeOnlyTranscript?: RunFrame["forceRuntimeOnlyTranscript"];
    forcePersistTranscript?: RunFrame["forcePersistTranscript"];
    transcriptParentLeafId?: RunFrame["transcriptParentLeafId"];
    restoreLeafAfterTranscript?: RunFrame["restoreLeafAfterTranscript"];
    restoreLeafIdAfterTranscript?: RunFrame["restoreLeafIdAfterTranscript"];
    suppressEvents?: RunFrame["suppressEvents"];
    disableSteer?: RunFrame["disableSteer"];
    disableAutomaticCompaction?: RunFrame["disableAutomaticCompaction"];
    activeSidecar?: RunFrame["activeSidecar"];
};

/**
 * 创建一次 invocation 的 RunFrame 初始状态。
 */
export function createRunFrame(input: CreateRunFrameInput): RunFrame {
    return {
        invocationId: input.invocationId,
        sessionId: input.sessionId,
        workspaceKey: input.workspaceKey,
        workspaceRootRef: input.workspaceRootRef,
        workspaceFsRoot: input.workspaceFsRoot,
        projectPath: input.projectPath,
        systemPrompt: input.systemPrompt,
        messages: input.messages.slice(),
        models: input.models,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        requestOptions: input.requestOptions,
        realtimeOutput: input.realtimeOutput ?? true,
        compaction: input.compaction,
        piTrace: input.piTrace,
        sessionContextEnabled: input.sessionContextEnabled,
        toolKeys: input.toolKeys,
        executionToolKeys: input.executionToolKeys,
        profileKey: input.profileKey,
        profile: input.profile,
        agentMode: input.agentMode,
        profileTurnContexts: input.profileTurnContexts ?? [],
        fileChangeDiffMaxChars: input.fileChangeDiffMaxChars,
        pendingProfileTurnContextSettlements: input.pendingProfileTurnContextSettlements ?? [],
        thinkingLevel: input.thinkingLevel,
        runtimeState: input.runtimeState,
        caller: input.caller,
        abortSignal: input.abortSignal,
        nextTurnRuntimeMessages: [],
        reportResultErrorCount: 0,
        turnIndex: 0,
        reportResultReminderSent: false,
        reportResultReminderEnabled: input.reportResultReminderEnabled,
        forceRuntimeOnlyTranscript: input.forceRuntimeOnlyTranscript,
        forcePersistTranscript: input.forcePersistTranscript,
        transcriptParentLeafId: input.transcriptParentLeafId,
        restoreLeafAfterTranscript: input.restoreLeafAfterTranscript,
        restoreLeafIdAfterTranscript: input.restoreLeafIdAfterTranscript,
        suppressEvents: input.suppressEvents,
        disableSteer: input.disableSteer,
        disableAutomaticCompaction: input.disableAutomaticCompaction,
        activeSidecar: input.activeSidecar,
        automaticCompactionDoneForTurn: false,
        pendingWritePlans: [],
        publicEventProjection: createPublicRuntimeProjectionState(),
        onEvent: input.onEvent,
    };
}

/**
 * 构造本轮模型可见消息，并消费上一轮 prepareNextTurn 注入的临时上下文。
 */
export function consumeNextTurnModelMessages(frame: RunFrame): RunFrame["messages"] {
    const messages = [...frame.messages, ...frame.nextTurnRuntimeMessages];
    frame.nextTurnRuntimeMessages = [];
    return messages;
}

/**
 * 将成功 turn 写回当前 RunFrame 的内存状态。
 */
export function applySuccessfulTurn(frame: RunFrame, turn: RuntimeTurn, ingest: TurnIngestResult): void {
    frame.finalAssistant = turn.assistant;
    frame.messages.push(turn.assistant);
    frame.messages.push(...turn.toolResults.map((toolResult) => toolResult.stored));
    frame.reportResult = turn.reportResult ?? frame.reportResult;
    frame.sidecarResult = turn.sidecarResult ?? frame.sidecarResult;
    if (turn.reportResult || turn.sidecarResult) {
        frame.reportResultErrorCount = 0;
        frame.lastReportResultError = undefined;
        frame.lastReportResultErrorTool = undefined;
    } else if (turn.reportResultError || turn.sidecarResultError) {
        frame.reportResultErrorCount += 1;
        frame.lastReportResultError = turn.reportResultError ?? turn.sidecarResultError;
        frame.lastReportResultErrorTool = turn.reportResultError ? "report_result" : "report_sidecar_result";
    }
    frame.lastTurnIngest = ingest;
    if (ingest.transcriptLeafId !== undefined) {
        frame.transcriptParentLeafId = ingest.transcriptLeafId;
    }
    frame.automaticCompactionDoneForTurn = false;
}

/**
 * 将失败 outcome 写回当前 RunFrame 的内存状态。
 */
export function applyFailedTurn(frame: RunFrame, turn: AppliedFailedTurn): void {
    frame.finalAssistant = turn.finalAssistant;
    frame.messages.push(turn.finalAssistant);
    if (turn.ingest) {
        frame.lastTurnIngest = turn.ingest;
    }
}
