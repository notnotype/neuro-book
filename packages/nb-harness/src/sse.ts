import type {JsonValue} from "@notnotype/nb-session";

/** 一条 SSE 帧（WHATWG event-stream 格式）；HTTP 服务仍在宿主手里。 */
export interface SseEventInput {
    readonly data: string;
    readonly event?: string;
    readonly id?: string;
    readonly retry?: number;
}

function assertSingleLineField(name: string, value: string): void {
    if (value.includes("\r") || value.includes("\n")) {
        throw new Error(`SSE ${name} 必须是单行且不含 CR/LF`);
    }
}

/** 序列化一条 SSE 事件：字段顺序固定 event/id/retry/data，多行 data 拆成多行 `data:`，以空行结束。 */
export function serializeSseEvent(input: SseEventInput): string {
    if (input.data.includes("\r")) {
        throw new Error("SSE data 不能包含 CR");
    }
    if (input.event !== undefined) assertSingleLineField("event", input.event);
    if (input.id !== undefined) assertSingleLineField("id", input.id);
    if (input.retry !== undefined && (!Number.isSafeInteger(input.retry) || input.retry < 0)) {
        throw new Error("SSE retry 必须是非负整数");
    }
    const fields: string[] = [];
    if (input.event !== undefined) fields.push(`event: ${input.event}`);
    if (input.id !== undefined) fields.push(`id: ${input.id}`);
    if (input.retry !== undefined) fields.push(`retry: ${input.retry}`);
    for (const line of input.data.split("\n")) fields.push(`data: ${line}`);
    return `${fields.join("\n")}\n\n`;
}

/** 序列化一条 SSE 注释行（不带结束空行）。 */
export function serializeSseComment(text: string): string {
    assertSingleLineField("comment", text);
    return `: ${text}\n`;
}

/** `serializeSseEvent` 的 JSON 便捷包装。 */
export function serializeSseJsonEvent(input: {
    readonly data: JsonValue;
    readonly event?: string;
    readonly id?: string;
    readonly retry?: number;
}): string {
    return serializeSseEvent({
        data: JSON.stringify(input.data),
        ...(input.event !== undefined ? {event: input.event} : {}),
        ...(input.id !== undefined ? {id: input.id} : {}),
        ...(input.retry !== undefined ? {retry: input.retry} : {}),
    });
}

/** 把一个 agent 事件序列化成固定事件名 `agent` 的 SSE 帧字符串。 */
export function serializeAgentEvent(event: unknown): string {
    return serializeSseJsonEvent({event: "agent", data: event as JsonValue});
}
