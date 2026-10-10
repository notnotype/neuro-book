/**
 * 用真实的 OMP `Agent` 跑一段脚本化的模型回复：每次模型请求按顺序取一条脚本（工具调用或文字），脚本用完后回“done”。
 * 不联网、不花钱；测的是 Agent 对我们适配出的工具的编排（执行、错误、中止），不是模型生成。
 */

import {Agent} from "@oh-my-pi/pi-agent-core";
import type {AgentMessage, AgentTool} from "@oh-my-pi/pi-agent-core";
import {createAssistantMessageEventStream} from "@oh-my-pi/pi-ai";
import type {AssistantMessage, Message, ToolCall} from "@oh-my-pi/pi-ai";
import {buildModel} from "@oh-my-pi/pi-catalog/build";

export type ScriptedReply = {calls: {id: string; name: string; args: Record<string, unknown>}[]} | {text: string};

const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

export function scriptedModel() {
    return buildModel({
        id: "scripted", name: "scripted", provider: "scripted", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 32_000, maxTokens: 1_000,
    });
}

export async function runScriptedAgent(input: {tools: AgentTool[]; script: ScriptedReply[]; abortAfterFirstCall?: boolean}): Promise<{
    toolResults: {toolCallId: string; text: string; isError: boolean}[];
    requests: number;
}> {
    const model = scriptedModel();
    const script = [...input.script];
    let requests = 0;
    const agent = new Agent({
        initialState: {model, systemPrompt: ["test"], tools: input.tools},
        convertToLlm: (messages: AgentMessage[]) => messages.filter((m): m is Message => ["user", "developer", "assistant", "toolResult"].includes(m.role)),
        streamFn: () => {
            requests += 1;
            const reply = script.shift() ?? {text: "done"};
            const content: AssistantMessage["content"] =
                "text" in reply ? [{type: "text", text: reply.text}] : reply.calls.map((call): ToolCall => ({type: "toolCall", id: call.id, name: call.name, arguments: call.args}));
            const reason: "stop" | "toolUse" = "text" in reply ? "stop" : "toolUse";
            const message: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content, usage, stopReason: reason, timestamp: requests};
            const stream = createAssistantMessageEventStream();
            stream.push({type: "start", partial: message});
            stream.push({type: "done", reason, message});
            stream.end(message);
            return stream;
        },
    });
    if (input.abortAfterFirstCall === true) {
        agent.subscribe((event) => {
            if (event.type === "tool_execution_start") agent.abort();
        });
    }
    await agent.prompt({role: "user", content: "go", timestamp: 0});
    // OMP 并行执行一批工具调用，结果按完成顺序进历史；按 id 排序，测试只看内容。
    const toolResults = agent.state.messages
        .filter((message): message is Message & {role: "toolResult"} => message.role === "toolResult")
        .map((message) => ({toolCallId: message.toolCallId, text: message.content.map((block) => ("text" in block ? block.text : `[${block.type}]`)).join(""), isError: message.isError}))
        .sort((a, b) => a.toolCallId.localeCompare(b.toolCallId));
    return {toolResults, requests};
}
