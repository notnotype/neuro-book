import type {JsonValue, Message} from "nbook/server/agent/messages/types";
import {createStoredTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {StoredToolResultMessage} from "nbook/server/agent/messages/stored-types";
import type {AgentResolution} from "nbook/server/agent/tools/types";
import {buildRequestUserInputResult, formatRequestUserInputAnswers, parseRequestUserInputParams} from "nbook/server/agent/tools/request-user-input-result";

/**
 * 查找 session 尾部未完成的审批 tool calls。
 * 返回数组，按调用顺序排列（先出现的在前）。
 */
export function findPendingApprovalCalls(messages: Message[], approvalToolKeys: readonly string[]): Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}> {
    const completed = new Set(messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId));

    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message || message.role !== "assistant") {
            continue;
        }
        const pendingCalls = message.content.filter((block) => {
            return block.type === "toolCall" && approvalToolKeys.includes(block.name) && !completed.has(block.id);
        });

        if (pendingCalls.length > 0) {
            return pendingCalls
                .filter((block): block is Extract<typeof block, {type: "toolCall"}> => block.type === "toolCall")
                .map((toolCall) => ({
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    args: toolCall.arguments,
                }));
        }
    }
    return [];
}

/**
 * 向后兼容：查找单个 pending approval call。
 */
export function findPendingApprovalCall(messages: Message[], approvalToolKeys: readonly string[]): {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
} | null {
    const calls = findPendingApprovalCalls(messages, approvalToolKeys);
    return calls[0] ?? null;
}

/**
 * 把 continue resolution 转成标准 tool result message。
 */
export function resolutionToToolResult(resolution: AgentResolution, pending: {toolCallId: string; toolName: string; args?: Record<string, unknown>}): StoredToolResultMessage {
    if (resolution.toolCallId !== pending.toolCallId) {
        throw new Error(`resolution toolCallId ${resolution.toolCallId} 与 pending toolCallId ${pending.toolCallId} 不匹配`);
    }

    if (resolution.kind === "user_input") {
        const requestUserInputParams = pending.toolName === "request_user_input"
            ? parseRequestUserInputParams(pending.args)
            : undefined;
        if (resolution.answers) {
            return createStoredTextToolResult({
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                text: requestUserInputParams
                    ? formatRequestUserInputAnswers(requestUserInputParams, resolution.answers)
                    : [...resolution.answers]
                        .sort((left, right) => left.questionIndex - right.questionIndex)
                        .map((answer) => `${answer.questionIndex + 1}. ${answer.text || answer.note || ""}`)
                        .join("\n"),
                details: resolution,
            });
        }
        const dataDetails = userInputDataDetails(resolution.data);
        if (requestUserInputParams) {
            const result = buildRequestUserInputResult(requestUserInputParams, dataDetails.data.userInput);
            return createStoredTextToolResult({
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                text: result.text,
                details: {
                    ...resolution,
                    data: dataDetails.data,
                    answers: result.answers,
                },
            });
        }
        return createStoredTextToolResult({
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            text: userInputDataText(dataDetails.data.userInput),
            details: {
                ...resolution,
                data: dataDetails.data,
            },
        });
    }

    // tool_approval 类型：保留结构化 data，并向后兼容 answers 作为 userInput。
    const details = resolution.data && typeof resolution.data === "object" && !Array.isArray(resolution.data)
        ? {
            ...resolution,
            data: "userInput" in resolution.data
                ? {...resolution.data}
                : resolution.answers ? {...resolution.data, userInput: resolution.answers} : {...resolution.data},
        }
        : resolution.answers
            ? {...resolution, data: {userInput: resolution.answers}}
            : resolution;

    return createStoredTextToolResult({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        text: resolution.approved
            ? resolution.resultText ?? "Approved."
            : resolution.resultText ?? "Rejected.",
        isError: !resolution.approved,
        details,
    });
}

/**
 * Low-Code Form 提交统一包进 data.userInput，便于工具恢复执行时提取。
 */
function userInputDataDetails(data: JsonValue | undefined): {
    data: {userInput: unknown};
} {
    if (data && typeof data === "object" && !Array.isArray(data) && "userInput" in data) {
        return {data: data as {userInput: unknown}};
    }
    return {data: {userInput: data}};
}

function userInputDataText(data: unknown): string {
    if (typeof data === "string") {
        return data;
    }
    try {
        return JSON.stringify(data ?? {}, null, 2);
    } catch {
        return String(data);
    }
}
