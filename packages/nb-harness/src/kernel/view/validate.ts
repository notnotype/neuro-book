/**
 * 请求的校验：工具调用与结果成对（docs/specs/harness/profile.md 输出 17）。提交（输出 12）与发请求前用同一份规则。
 */

import type {Message} from "../api/index.js";

/** 第一处不合格的位置与原因；合格时为 null。`index` 是消息在列表里的下标。 */
export function pairingProblem(messages: readonly Message[]): {index: number; message: string} | null {
    /** 最近一条带工具调用的 assistant 消息还没得到结果的调用。 */
    let open: Set<string> | null = null;
    let callsAt = -1;
    /** 从那条 assistant 消息起是否只隔着 tool 消息。 */
    let adjacent = false;
    const unanswered = (index: number) => ({index, message: `tool calls ${[...open!].join(", ")} of message ${callsAt} have no result before message ${index}`});
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index]!;
        if (message.role === "tool") {
            const callId = message.callId ?? "";
            if (open === null || !open.has(callId)) return {index, message: `tool result ${callId} at message ${index} does not answer an open call of the preceding assistant message`};
            if (!adjacent) return {index, message: `tool result ${callId} at message ${index} must directly follow the assistant message ${callsAt} that called it`};
            open.delete(callId);
            continue;
        }
        if (open !== null && open.size > 0) return unanswered(index);
        open = null;
        adjacent = false;
        if (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0) {
            open = new Set(message.toolCalls!.map((call) => call.id));
            if (open.size < message.toolCalls!.length) return {index, message: `assistant message ${index} has two tool calls with the same id`};
            callsAt = index;
            adjacent = true;
        }
    }
    if (open !== null && open.size > 0) return unanswered(messages.length);
    return null;
}
