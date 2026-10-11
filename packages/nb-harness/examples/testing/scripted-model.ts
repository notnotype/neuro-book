/**
 * 脚本化模型：不联网、不花钱地让 OMP `Agent` 跑完整个 ReAct 循环。
 *
 * 运行时接受一个 OMP `StreamFn`（`RuntimeDeps.model.stream`），每次模型请求都经它返回一个助手消息事件流；
 * 产品里不传就是 OMP 的 `streamSimple`（真实网络）。这里按顺序回放脚本：一项是一条文字回复或一组工具调用；
 * 也可以是一个看上下文的函数，场景 2 用它从 `read` 的结果里取标签头再写 `edit` 的输入（标签是内容哈希，事先写不出来）。
 * 每次请求的 `Context`（系统提示词、消息、工具）都记下来，场景据此断言“模型看到了什么”。
 *
 * 文字回复按一个增量流出：OMP 收到 `text_delta` 才发 `message_update`，运行时据此发 `stream` 事件；
 * 不流增量的话界面只会在消息结束时收到整条消息。
 *
 * 行为合同：docs/specs/harness/runtime.md 的“输入与前置条件”（`RuntimeDeps.model`）与输出第 5 条（流式事件）。
 */

import type {StreamFn} from "@notnotype/nb-harness";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Context, ToolCall, Usage} from "@oh-my-pi/pi-ai";

export type ToolCallScript = {id: string; name: string; args: Record<string, unknown>};
export type Reply = ({text: string} | {calls: ToolCallScript[]}) & {usage?: Partial<Usage>};
/** 脚本项：固定回复，或按本次请求的上下文算出回复。 */
export type Script = (Reply | ((context: Context) => Reply))[];

const ZERO_USAGE: Usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

export function scriptedModel(script: Script): {stream: StreamFn; contexts: Context[]} {
    const queue = [...script];
    const contexts: Context[] = [];
    const stream: StreamFn = (model, context) => {
        contexts.push(context);
        // 脚本用完后一律回“done”，让没算准步数的场景也能结束，而不是悬在那里
        const item = queue.shift() ?? {text: "done"};
        const reply = typeof item === "function" ? item(context) : item;
        const usage = {...ZERO_USAGE, ...reply.usage};
        const base = {role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, usage, timestamp: contexts.length};
        const content: AssistantMessage["content"] = "text" in reply
            ? [{type: "text", text: reply.text}]
            : reply.calls.map((call): ToolCall => ({type: "toolCall", id: call.id, name: call.name, arguments: call.args}));
        const stopReason: "stop" | "toolUse" = "text" in reply ? "stop" : "toolUse";
        const message: AssistantMessage = {...base, content, stopReason};
        const out = createAssistantMessageEventStream();
        out.push({type: "start", partial: {...base, content: [], stopReason}});
        if ("text" in reply) {
            out.push({type: "text_start", contentIndex: 0, partial: {...base, content: [{type: "text", text: ""}], stopReason}});
            out.push({type: "text_delta", contentIndex: 0, delta: reply.text, partial: message});
            out.push({type: "text_end", contentIndex: 0, content: reply.text, partial: message});
        }
        out.push({type: "done", reason: stopReason, message});
        out.end(message);
        return out;
    };
    return {stream, contexts};
}

/** 上下文里最后一条消息若是工具结果，返回它的文字；否则空串。 */
export function lastToolResultText(context: Context): string {
    const last = context.messages.at(-1);
    if (last === undefined || last.role !== "toolResult") return "";
    return last.content.map((block) => ("text" in block ? block.text : "")).join("");
}

/** 上下文里全部消息的文字拼成一段，便于用 `toContain` 断言模型看到了某段内容。 */
export function contextText(context: Context): string {
    return context.messages
        .map((message) => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "")).join("")))
        .join("\n");
}
