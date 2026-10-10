/**
 * 把模型上下文交给真实的 OMP `Agent`，用自定义 `streamFn` 截下发往模型的请求。不联网、不花钱：
 * 测的是 Agent 对我们上下文的编排（配对、过滤），不是模型生成。
 */

import {Agent} from "@oh-my-pi/pi-agent-core";
import type {AgentMessage} from "@oh-my-pi/pi-agent-core";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Message} from "@oh-my-pi/pi-ai";
import {buildModel} from "@oh-my-pi/pi-catalog/build";

const LLM_ROLES = new Set(["user", "developer", "assistant", "toolResult"]);

/** runtime 交会话上下文时应传的转换：保留四种角色。Agent 缺省的 convertToLlm 会丢掉 developer 消息。 */
export const keepAllRoles = (messages: AgentMessage[]): Message[] => messages.filter((message): message is Message => LLM_ROLES.has(message.role));

export async function requestSeenByModel(context: Message[], options: {convertToLlm?: (messages: AgentMessage[]) => Message[]} = {}): Promise<Message[]> {
    const model = buildModel({
        id: "capture", name: "capture", provider: "capture", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 32_000, maxTokens: 1_000,
    });
    let captured: Message[] = [];
    const agent = new Agent({
        initialState: {model, systemPrompt: ["test"]},
        ...(options.convertToLlm === undefined ? {} : {convertToLlm: options.convertToLlm}),
        streamFn: (_model, request) => {
            captured = structuredClone(request.messages);
            const reply: AssistantMessage = {
                role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text: "done"}],
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: "stop", timestamp: 99,
            };
            const stream = createAssistantMessageEventStream();
            stream.push({type: "start", partial: reply});
            stream.push({type: "done", reason: "stop", message: reply});
            stream.end(reply);
            return stream;
        },
    });
    agent.replaceMessages(context);
    await agent.prompt({role: "user", content: "继续", timestamp: 100});
    return captured;
}
