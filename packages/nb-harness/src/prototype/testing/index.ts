import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai/utils/event-stream";

export interface ScriptedReply {
    readonly text: string;
}

/**
 * 非 LLM 的脚本化流：**仅用于装配验证**（工具注册、事件订阅、会话落盘），
 * 不代表模型行为——真实模型行为只能由真实 LLM 用例覆盖。
 */
export function scriptedStreamFn(reply: string | ScriptedReply): StreamFn {
    const text = typeof reply === "string" ? reply : reply.text;
    return (model) => {
        const stream = createAssistantMessageEventStream();
        const message: AssistantMessage = {
            role: "assistant",
            content: [{type: "text", text}],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
            stopReason: "stop",
            timestamp: Date.now(),
        };
        stream.push({type: "start", partial: message});
        stream.push({type: "text_start", contentIndex: 0, partial: message});
        stream.push({type: "text_delta", contentIndex: 0, delta: text, partial: message});
        stream.push({type: "text_end", contentIndex: 0, content: text, partial: message});
        stream.push({type: "done", reason: "stop", message});
        stream.end(message);
        return stream;
    };
}
