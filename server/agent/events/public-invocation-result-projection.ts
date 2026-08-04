import {
    PUBLIC_INVOCATION_ERROR_BYTES,
    PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES,
    PUBLIC_INVOCATION_TEXT_SERIALIZED_BYTES,
} from "nbook/server/agent/events/public-event-policy";
import {textPreview} from "nbook/server/agent/events/public-tool-projection";
import {
    createPublicTextBudget,
    projectPublicText,
    type PublicTextBudget,
} from "nbook/server/agent/events/public-text-projection";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";
import type {InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";

/** 把 durable assistant 正文投影为阻塞 Invocation 结果中的有界摘要。 */
export function projectPublicFinalMessage(value: string | undefined): Pick<InvokeAgentResult, "finalMessage" | "finalMessageBytes" | "finalMessageOmitted"> {
    if (value === undefined) {
        return {};
    }
    const projected = textPreview(value, PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES);
    return {
        finalMessage: projected.preview,
        finalMessageBytes: projected.bytes,
        finalMessageOmitted: projected.omitted,
    };
}

/**
 * 把内部 invocation 结果投影成 HTTP DTO。
 *
 * report_result.data 只在内部 Harness、runtime hook 和 durable session 中流动；
 * HTTP 只返回结果正文摘要和 dataOmitted，避免业务 output 重新绕过公开事件预算。
 */
export function projectPublicInvocationResult(input: AgentInvocationResult): InvokeAgentResult {
    const textBudget = createPublicTextBudget(
        PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES,
        PUBLIC_INVOCATION_TEXT_SERIALIZED_BYTES,
    );
    const error = projectInvocationError(input, textBudget);
    const reportResult = input.reportResult
        ? projectReportResult(input.reportResult, textBudget)
        : undefined;
    const final = projectInvocationText(
        input.finalMessage,
        textBudget,
        input.finalMessageBytes,
        input.finalMessageOmitted === true,
        PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES,
    );

    return {
        sessionId: input.sessionId,
        invocationId: input.invocationId,
        status: input.status,
        acceptance: input.acceptance,
        ...(final.preview === undefined ? {} : {
            finalMessage: final.preview,
            finalMessageBytes: final.bytes,
            finalMessageOmitted: final.omitted,
        }),
        ...(reportResult ? {reportResult} : {}),
        ...(error.message === undefined ? {} : {error: error.message}),
        ...(input.errorPhase ? {errorPhase: input.errorPhase} : {}),
        ...(error.info ? {errorInfo: error.info} : {}),
        ...(input.aborted ? {aborted: true} : {}),
        ...(input.usage ? {usage: input.usage} : {}),
        ...(input.elapsedMs === undefined ? {} : {elapsedMs: input.elapsedMs}),
        ...(input.queuedItem ? {queuedItem: input.queuedItem} : {}),
    };
}

function projectInvocationError(
    input: AgentInvocationResult,
    budget: PublicTextBudget,
): {message?: string; info?: InvokeAgentResult["errorInfo"]} {
    const value = input.error ?? input.errorInfo?.message;
    if (value === undefined) {
        return {};
    }
    const copies = input.errorInfo ? 2 : 1;
    const rawBudget = Math.min(PUBLIC_INVOCATION_ERROR_BYTES, Math.floor(budget.remainingRawBytes / copies));
    const serializedBudget = Math.floor(budget.remainingSerializedBytes / copies);
    const localBudget = createPublicTextBudget(rawBudget, serializedBudget);
    const projected = projectPublicText(value, localBudget, rawBudget);
    const rawUsed = rawBudget - localBudget.remainingRawBytes;
    const serializedUsed = serializedBudget - localBudget.remainingSerializedBytes;
    budget.remainingRawBytes = Math.max(0, budget.remainingRawBytes - rawUsed * copies);
    budget.remainingSerializedBytes = Math.max(0, budget.remainingSerializedBytes - serializedUsed * copies);
    const info = input.errorInfo
        ? {
            ...input.errorInfo,
            message: projected.preview,
            ...(input.errorInfo.code ? {code: textPreview(input.errorInfo.code, 512).preview} : {}),
        }
        : undefined;
    return {
        message: projected.preview,
        ...(info ? {info} : {}),
    };
}

function projectReportResult(
    report: NonNullable<AgentInvocationResult["reportResult"]>,
    budget: PublicTextBudget,
): NonNullable<InvokeAgentResult["reportResult"]> {
    const result = projectInvocationText(report.result, budget, undefined, false, PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES);
    return {
        result: result.preview ?? "",
        resultBytes: result.bytes,
        resultOmitted: result.omitted,
        ...(report.success === undefined ? {} : {success: report.success}),
        ...(report.data === undefined ? {} : {dataOmitted: true as const}),
    };
}

function projectInvocationText(
    value: string | undefined,
    budget: PublicTextBudget,
    originalBytes: number | undefined,
    originalOmitted: boolean,
    rawLimit: number,
): {preview?: string; bytes: number; omitted: boolean} {
    if (value === undefined) {
        return {bytes: 0, omitted: false};
    }
    const projected = projectPublicText(value, budget, rawLimit);
    return {
        preview: projected.preview,
        bytes: originalBytes ?? projected.bytes,
        omitted: originalOmitted || projected.omitted,
    };
}
