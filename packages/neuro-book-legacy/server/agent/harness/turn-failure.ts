import type {AssistantMessage} from "nbook/server/agent/messages/types";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";
import type {FailedRunLoopResult, FailedTurnOutcome, RunFrame, TurnIngestResult} from "nbook/server/agent/harness/run-kernel-types";
import {providerErrorText, sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";
import {isPublicToolCallId} from "nbook/shared/agent/public-tool-identity";

export type FailedTurnIngestDraft = {
    assistant: AssistantMessage;
    toolResults: [];
    messageStatus?: "partial" | "interrupted" | "error";
};

export type AppliedFailedTurn = {
    finalAssistant: AssistantMessage;
    ingest?: TurnIngestResult;
};

/**
 * provider streaming 失败后，只保留可展示文本，剥离未闭合 tool calls。
 *
 * 不变量：错误详情只记在 invocation_lifecycle entry 上，assistant entry 只承载正文。
 * 否则同一次失败会在账本里留下两份错误文本，前端渲染成两个气泡（Task 139）。
 */
export function sanitizePartialAssistant(assistant: AssistantMessage): AssistantMessage | null {
    const content = assistant.content.filter((block) => block.type !== "toolCall");
    if (!content.some((block) => block.type === "text" && block.text.trim())) {
        return null;
    }
    return sanitizeProviderAssistant({
        ...assistant,
        content,
        errorMessage: undefined,
    });
}

/**
 * 清理 Provider assistant 终态中的错误文本，正文与 usage 保持不变。
 */
export function sanitizeProviderAssistant(assistant: AssistantMessage): AssistantMessage {
    for (const block of assistant.content) {
        if (block.type === "toolCall" && !isPublicToolCallId(block.id)) {
            throw new Error("provider_tool_call_id_invalid");
        }
    }
    return {
        ...assistant,
        errorMessage: assistant.errorMessage ? sanitizeProviderErrorMessage(assistant.errorMessage) : undefined,
    };
}

/**
 * 构造 provider/request 失败时的内部 assistant 标记。
 *
 * 该 message 只用于 run result / SSE 终态，不应在没有 partial content 时写入 session。
 */
export function createRuntimeErrorAssistant(error: unknown): AssistantMessage {
    const message = providerErrorText(error);
    return {
        ...createAssistantTextMessage({
            text: "",
            stopReason: "error",
        }),
        errorMessage: message,
    };
}

/**
 * 将 failed outcome 转成可选的 partial assistant ingest 草案。
 */
export function createFailedTurnIngestDraft(outcome: FailedTurnOutcome): FailedTurnIngestDraft | undefined {
    if (!outcome.partialAssistant) {
        return undefined;
    }
    return {
        assistant: outcome.partialAssistant,
        toolResults: [],
        messageStatus: outcome.messageStatus,
    };
}

/**
 * 将失败 outcome 和可选 ingest 结果归并为 RunFrame 需要的失败状态。
 */
export function applyFailedTurnOutcome(outcome: FailedTurnOutcome, ingest?: TurnIngestResult): AppliedFailedTurn {
    return {
        finalAssistant: outcome.finalAssistant,
        ingest,
    };
}

/**
 * 将失败后的 RunFrame 归并成 Run Kernel 的 failed 结果。
 */
export function createFailedRunLoopResult(frame: RunFrame, outcome: FailedTurnOutcome): FailedRunLoopResult {
    return {
        status: "failed",
        finalAssistant: frame.finalAssistant,
        usage: frame.usage,
        errorInfo: outcome.errorInfo,
        terminalStatus: outcome.messageStatus === "interrupted" ? "aborted" : "error",
    };
}
