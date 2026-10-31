/**
 * 渲染工具 `format`：把对话事件渲染成带来源的块，拼成消息。文字的优先级与缺省见 docs/specs/harness/profile.md 输出 6–8。
 *
 * `render` 抛错时用缺省文字并交给 `onProblem`；回复与工具结果的 `render` 返回 null（类型不允许，JS 写法可能出现）
 * 同样用缺省文字：丢掉它们会留下没有结果的工具调用。
 */

import {replyText} from "../api/index.js";
import type {ConversationTurn, Format, LogEvent, Message, Origin, RenderTable, ReplyEvent, RequestBlock, Step, ToolResultEvent} from "../api/index.js";

export type RenderFn = (event: LogEvent<string, any>) => string | null;

export interface RenderProblem {
    readonly code: "render-threw";
    /** 写这个 `render` 的扩展或 Profile 的 id；`withRender` 给的算 Profile 的。 */
    readonly extension: string;
    readonly event: LogEvent;
    readonly error: unknown;
}

export interface RenderSources {
    /** Profile 的 `render`（键是事件名，依赖的写全名）。 */
    readonly profile: RenderTable;
    /** 扩展 id → 它给自己事件的 `render`（键是短名）。 */
    readonly extensions: ReadonlyMap<string, RenderTable>;
    readonly profileId: string;
    readonly onProblem: (problem: RenderProblem) => void;
}

function originOf(event: LogEvent): Origin {
    const slash = event.type.lastIndexOf("/");
    return {kind: "event", eventId: event.id, type: event.type, extension: slash < 0 ? "kernel" : event.type.slice(0, slash)};
}

function defaultText(event: LogEvent): string {
    if (event.type === "assistant") return replyText((event as ReplyEvent).data.content);
    const data = event.data as {text?: unknown};
    if (typeof data?.text === "string") return data.text;
    return `<system-reminder>\n${JSON.stringify(event.data)}\n</system-reminder>`;
}

export function createFormat(sources: RenderSources, override: RenderTable = {}): Format<RenderTable> {
    /** 按优先级找到的 `render` 与它的主人；没有时为 null（用缺省）。 */
    const rendererOf = (event: LogEvent): {fn: RenderFn; owner: string} | null => {
        const fn = override[event.type] ?? sources.profile[event.type];
        if (fn !== undefined) return {fn, owner: sources.profileId};
        const slash = event.type.lastIndexOf("/");
        if (slash < 0) return null;
        const owner = event.type.slice(0, slash);
        const own = sources.extensions.get(owner)?.[event.type.slice(slash + 1)];
        return own === undefined ? null : {fn: own, owner};
    };
    /** `undefined`：没有覆盖或覆盖出错，用缺省。 */
    const overriddenText = (event: LogEvent): string | null | undefined => {
        const renderer = rendererOf(event);
        if (renderer === null) return undefined;
        try {
            return renderer.fn(event);
        } catch (error) {
            sources.onProblem({code: "render-threw", extension: renderer.owner, event, error});
            return undefined;
        }
    };
    const textOf = (event: LogEvent): string | null => {
        const text = overriddenText(event);
        return text === undefined ? defaultText(event) : text;
    };
    /** 回复与工具结果：覆盖返回 null 也用缺省。 */
    const requiredTextOf = (event: LogEvent): string | undefined => overriddenText(event) ?? undefined;
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
            const overridden = requiredTextOf(reply);
            const content: RequestBlock[] = overridden !== undefined
                ? [block(overridden, origin)]
                : reply.data.content.map((item) => ({...item, origin}) as RequestBlock);
            return {role: "assistant", content, ...(reply.data.toolCalls.length === 0 ? {} : {toolCalls: reply.data.toolCalls}), model: reply.data.model};
        },
        assistantText(reply: ReplyEvent): Message | null {
            const text = textOf(reply);
            return text === null || text === "" ? null : {role: "assistant", content: [block(text, originOf(reply))], model: reply.data.model};
        },
        tool(result: ToolResultEvent): Message {
            return {role: "tool", callId: result.data.callId, content: [block(requiredTextOf(result) ?? defaultText(result), originOf(result))], isError: result.data.status !== "ok"};
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
