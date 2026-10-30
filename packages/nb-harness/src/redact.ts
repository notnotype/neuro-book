/**
 * 遮盖 provider 错误文字里回显的密钥（docs/specs/agent/harness.md 输出 18）。有的服务在 401 的错误正文里原样带上
 * 收到的认证头，不遮盖就会进运行结果与会话日志。
 */

import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";

/** 遮盖时用的固定文字。 */
export const REDACTED_KEY = "[REDACTED]";

/** 把文字里出现的每个密钥换成遮盖文字。密钥不论长短都遮盖；“端点不要认证”的占位值不是密钥，不动。 */
export function redactText(text: string, keys: Iterable<string>): string {
    let result = text;
    for (const key of keys) if (key !== "" && key !== NO_AUTH_SENTINEL) result = result.split(key).join(REDACTED_KEY);
    return result;
}

/** 就地改写助手消息的 `errorMessage`。 */
export function redactErrorMessage(message: AssistantMessage, keys: Iterable<string>): void {
    if (typeof message.errorMessage === "string") message.errorMessage = redactText(message.errorMessage, keys);
}

/**
 * 交给订阅者的事件里的全部助手消息都遮盖：除了 `message_end` 的这一条，`message_start`、`message_update` 的快照与
 * 半截消息、`turn_end` 与 `agent_end` 带的消息列表里也会有带错误正文的助手消息（订阅者可能把事件推到网络上）。
 * 只看事件本身与一层嵌套（消息、消息列表、`assistantMessageEvent` 里的消息），这些就是事件里放消息的全部位置。
 */
export function redactEventMessages(event: object, keys: Iterable<string>): void {
    const list = [...keys];
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (typeof value === "object" && value !== null && (value as {role?: unknown}).role === "assistant") redactErrorMessage(value as AssistantMessage, list);
    };
    for (const value of Object.values(event)) {
        visit(value);
        if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as {role?: unknown}).role === undefined) {
            for (const nested of Object.values(value)) visit(nested);
        }
    }
}
