/**
 * 渲染工具 `format`：把对话事件渲染成带来源的块，拼成消息（提案第 8 节）。文字的优先级：`withRender` 给的
 * （只在提交时）、Profile 的 `render`、扩展给自己事件的 `render`、缺省（`{text}` 取 `text`，其余包成 `<system-reminder>`）。
 */

import type {ConversationTurn, Format, LogEvent, Message, Origin, RenderTable, ReplyEvent, RequestBlock, Step, ToolResultEvent} from "../api/index.js";

export type RenderFn = (event: LogEvent<string, any>) => string | null;

export interface RenderSources {
    /** Profile 的 `render`（键是事件名，依赖的写全名）。 */
    readonly profile: RenderTable;
    /** 扩展 id → 它给自己事件的 `render`（键是短名）。 */
    readonly extensions: ReadonlyMap<string, RenderTable>;
}

function originOf(event: LogEvent): Origin {
    const slash = event.type.lastIndexOf("/");
    return {kind: "event", eventId: event.id, type: event.type, extension: slash < 0 ? "kernel" : event.type.slice(0, slash)};
}

function defaultText(event: LogEvent): string {
    const data = event.data as {text?: unknown};
    if (typeof data?.text === "string") return data.text;
    return `<system-reminder>\n${JSON.stringify(event.data)}\n</system-reminder>`;
}

export function createFormat(sources: RenderSources, override: RenderTable = {}): Format<RenderTable> {
    const textOf = (event: LogEvent): string | null => {
        const fn = override[event.type] ?? sources.profile[event.type];
        if (fn !== undefined) return fn(event);
        const slash = event.type.lastIndexOf("/");
        if (slash >= 0) {
            const own = sources.extensions.get(event.type.slice(0, slash))?.[event.type.slice(slash + 1)];
            if (own !== undefined) return own(event);
        }
        return defaultText(event);
    };
    const block = (text: string, origin: Origin): RequestBlock => ({kind: "text", text, origin});
    const format: Format<RenderTable> = {
        user(...parts) {
            const content: RequestBlock[] = [];
            for (const part of parts) {
                if (part === null || part === undefined || part === false) continue;
                if (typeof part === "string") {
                    if (part !== "") content.push(block(part, {kind: "fixed", by: "profile"}));
                    continue;
                }
                const text = textOf(part);
                if (text !== null && text !== "") content.push(block(text, originOf(part)));
            }
            return content.length === 0 ? null : {role: "user", content};
        },
        assistant(reply: ReplyEvent): Message {
            const origin = originOf(reply);
            const overridden = override.assistant ?? sources.profile.assistant;
            const content: RequestBlock[] = overridden !== undefined
                ? [block(overridden(reply) ?? "", origin)]
                : reply.data.content.map((item) => ({...item, origin}) as RequestBlock);
            return {role: "assistant", content, ...(reply.data.toolCalls.length === 0 ? {} : {toolCalls: reply.data.toolCalls}), model: reply.data.model};
        },
        assistantText(reply: ReplyEvent): Message | null {
            const text = textOf(reply);
            return text === null || text === "" ? null : {role: "assistant", content: [block(text, originOf(reply))], model: reply.data.model};
        },
        tool(result: ToolResultEvent): Message {
            return {role: "tool", callId: result.data.callId, content: [block(textOf(result) ?? "", originOf(result))], isError: result.data.status !== "ok"};
        },
        step(step: Step) {
            return [format.assistant(step.reply), ...step.results.map((result) => format.tool(result)), format.user(...step.after)];
        },
        steps(steps: readonly Step[]) {
            return steps.flatMap((step) => format.step(step));
        },
        turn(turn: ConversationTurn<any>) {
            return [format.user(...turn.attachments, turn.input), ...format.steps(turn.steps)];
        },
        withRender(render: RenderTable) {
            return createFormat(sources, {...override, ...render});
        },
    };
    return format;
}
