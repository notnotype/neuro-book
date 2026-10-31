/**
 * OMP 适配器：`ModelRequest` 与服务商之间唯一的转换点，经 OMP 的 `streamSimple` 发请求（提案第 9 节“模型适配器”）。
 *
 * - 请求：系统块进 `systemPrompt`；相邻的 user 消息合成一条（有的端点拒绝连续的 user 消息）；思考块连同签名、
 *   服务商元数据原样送回（作答的不是同一个服务商时由 OMP 自己丢掉签名）；工具用完整声明，名字按 `tool-name.ts` 换算。
 * - 回复：只认 `stream.result()` 的终态；流式增量只交给 `onDelta`。错误按状态码与标记归类，错误文字里的密钥遮盖后才交回。
 * - 用量：经计数的 fetch 发出的请求多于一次，说明中间有被服务商层丢弃的尝试，那次的用量拿不到，`complete` 为 false。
 *
 * 图片块还没有接上大块内容的读写：请求里有图片时以 `unsupported-content` 失败，回复里的图片块不收。
 */

import {streamSimple, type AssistantMessage, type Context, type Message as OmpMessage, type SimpleStreamOptions, type TextContent, type ThinkingContent, type Tool, type ToolCall as OmpToolCall, type ToolChoice} from "@oh-my-pi/pi-ai";
import {clampThinkingLevelForModel, getSupportedEfforts, type Effort, type Model} from "@oh-my-pi/pi-catalog";
import {providerToolName, type ContentBlock, type JsonValue, type Message, type ModelDelta, type ModelInfo, type ModelRequest, type ModelResponse, type ToolCall, type Usage} from "../api/index.js";
import {classifyProviderError} from "./classify.js";
import {createFinishWatch} from "./finish-watch.js";
import {redactText} from "./redact.js";

export interface OmpTarget {
    /** OMP 的模型对象（宿主用 `resolveModel`、`defineModel` 或自己的解析得到）。 */
    readonly model: Model;
    /** 取密钥；取不到时抛错，适配器在发请求前以 `auth` 失败。只用宿主指定的来源。 */
    readonly apiKey: () => string;
    /** 单价未知时用量的 `cost` 为 null。 */
    readonly priceKnown: boolean;
}

export function ompModelInfo(model: Model): ModelInfo {
    return {
        id: `${model.provider}/${model.id}`,
        contextWindow: model.contextWindow ?? 0,
        ...(model.maxTokens ? {maxOutput: model.maxTokens} : {}),
        capabilities: {vision: model.input.includes("image"), thinking: model.reasoning},
        efforts: [...getSupportedEfforts(model)],
    };
}

const EMPTY_USAGE: Usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: true};

/** 去掉已经单独存了的字段，剩下的服务商元数据只留 JSON 值；没有剩下的为 undefined。 */
function extras(block: object, known: readonly string[]): JsonValue | undefined {
    const rest: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(block)) {
        if (known.includes(key) || value === undefined || typeof value === "function") continue;
        rest[key] = value as JsonValue;
    }
    return Object.keys(rest).length === 0 ? undefined : rest;
}
const restore = (provider: JsonValue | undefined): Record<string, unknown> => (provider !== null && typeof provider === "object" && !Array.isArray(provider) ? {...provider} : {});

class UnsupportedContent extends Error {}

function textOf(block: ContentBlock): string {
    if (block.kind === "text") return block.text;
    throw new UnsupportedContent(`${block.kind} block is not supported here`);
}

function userContent(blocks: readonly ContentBlock[]): (TextContent)[] {
    return blocks.map((block) => {
        if (block.kind !== "text") throw new UnsupportedContent(`${block.kind} block in a user message is not supported`);
        return {type: "text", text: block.text};
    });
}

function assistantContent(blocks: readonly ContentBlock[], calls: readonly ToolCall[], names: ReadonlyMap<string, string>): AssistantMessage["content"] {
    const content: AssistantMessage["content"] = blocks.map((block) => {
        switch (block.kind) {
            case "text":
                return {...restore(block.provider), type: "text", text: block.text} as TextContent;
            case "thinking":
                if (block.redacted) return {type: "redactedThinking", data: block.signature ?? ""};
                return {...restore(block.provider), type: "thinking", thinking: block.text, ...(block.signature === undefined ? {} : {thinkingSignature: block.signature})} as ThinkingContent;
            case "image":
                throw new UnsupportedContent("image block in an assistant message is not supported yet");
        }
    });
    for (const call of calls) {
        content.push({...restore(call.provider), type: "toolCall", id: call.id, name: names.get(call.tool) ?? call.tool.replaceAll(".", "__"), arguments: {...call.args}} as OmpToolCall);
    }
    return content;
}

/** 相邻的 user 消息合成一条，文字块之间空一行（搬自 master `merge-user-messages.ts`）。日志里仍是两条。 */
function mergeAdjacentUsers(messages: OmpMessage[]): OmpMessage[] {
    const merged: OmpMessage[] = [];
    for (const message of messages) {
        const last = merged.at(-1);
        if (message.role !== "user" || last?.role !== "user") {
            merged.push(message);
            continue;
        }
        const blocks = typeof last.content === "string" ? [{type: "text" as const, text: last.content}] : [...last.content];
        for (const block of typeof message.content === "string" ? [{type: "text" as const, text: message.content}] : message.content) {
            const tail = blocks.at(-1);
            if (block.type === "text" && tail?.type === "text") blocks[blocks.length - 1] = {...tail, text: `${tail.text}\n\n${block.text}`};
            else blocks.push(block);
        }
        merged[merged.length - 1] = {...message, content: blocks};
    }
    return merged;
}

function toContext(request: ModelRequest, model: Model, now: number): Context {
    const names = new Map(request.tools.map((tool) => [tool.id, providerToolName(tool)] as const));
    const toolOfCall = new Map<string, string>();
    const messages: OmpMessage[] = request.messages.map((message: Message): OmpMessage => {
        if (message.role === "user") return {role: "user", content: userContent(message.content), timestamp: now};
        if (message.role === "assistant") {
            for (const call of message.toolCalls ?? []) toolOfCall.set(call.id, call.tool);
            const [provider, ...rest] = (message.model ?? `${model.provider}/${model.id}`).split("/");
            return {
                role: "assistant",
                content: assistantContent(message.content, message.toolCalls ?? [], names),
                // 同一个服务商时沿用当前的 api：OMP 按服务商与 api 是否相同决定思考签名要不要原样送回。
                api: provider === model.provider ? model.api : "unknown",
                provider: provider ?? model.provider,
                model: rest.join("/"),
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: (message.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop",
                timestamp: now,
            } as AssistantMessage;
        }
        const tool = toolOfCall.get(message.callId ?? "") ?? "";
        return {role: "toolResult", toolCallId: message.callId ?? "", toolName: names.get(tool) ?? tool.replaceAll(".", "__"), content: userContent(message.content), isError: message.isError ?? false, timestamp: now};
    });
    const tools: Tool[] = request.tools.map((tool) => ({
        name: providerToolName(tool),
        description: tool.description,
        parameters: tool.parameters as unknown as Tool["parameters"],
        strict: tool.strict,
        ...(tool.customFormat === undefined ? {} : {customFormat: tool.customFormat as unknown as Tool["customFormat"]}),
    }));
    return {systemPrompt: request.system.map(textOf), messages: mergeAdjacentUsers(messages), tools};
}

function toolChoiceOf(request: ModelRequest): ToolChoice | undefined {
    const choice = request.toolChoice;
    if (choice === undefined || typeof choice === "string") return choice;
    const tool = request.tools.find((item) => item.id === choice.tool);
    return {type: "function", name: tool === undefined ? choice.tool : providerToolName(tool)};
}

function fromOmpContent(message: AssistantMessage, toolIds: ReadonlyMap<string, string>): {content: ContentBlock[]; toolCalls: ToolCall[]} {
    const content: ContentBlock[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of message.content) {
        if (block.type === "text") {
            const provider = extras(block, ["type", "text"]);
            content.push(provider === undefined ? {kind: "text", text: block.text} : {kind: "text", text: block.text, provider});
        } else if (block.type === "thinking") {
            const provider = extras(block, ["type", "thinking", "thinkingSignature"]);
            content.push({kind: "thinking", text: block.thinking, ...(block.thinkingSignature === undefined ? {} : {signature: block.thinkingSignature}), ...(provider === undefined ? {} : {provider})});
        } else if (block.type === "redactedThinking") {
            content.push({kind: "thinking", text: "", redacted: true, signature: block.data});
        } else if (block.type === "toolCall") {
            const provider = extras(block, ["type", "id", "name", "arguments"]);
            toolCalls.push({id: block.id, tool: toolIds.get(block.name) ?? block.name, args: block.arguments, ...(provider === undefined ? {} : {provider})});
        }
        // 其余块（Anthropic 的服务端工具、回退标记、图片）这一版不收。
    }
    return {content, toolCalls};
}

/** 模型端口的 `call`：一次逻辑请求。失败不抛错，以 `stopReason: "error"`（或 `aborted`）的回复交回。 */
export function ompCall(target: OmpTarget): (request: ModelRequest, signal: AbortSignal, onDelta: (delta: ModelDelta) => void) => Promise<ModelResponse> {
    const modelName = `${target.model.provider}/${target.model.id}`;
    return async (request, signal, onDelta) => {
        const failed = (kind: NonNullable<ModelResponse["error"]>["kind"], message: string, extra: {code?: string; status?: number; usage?: Usage; content?: ContentBlock[]} = {}): ModelResponse => ({
            content: extra.content ?? [],
            toolCalls: [],
            stopReason: "error",
            usage: extra.usage ?? EMPTY_USAGE,
            model: modelName,
            error: {kind, message, ...(extra.code === undefined ? {} : {code: extra.code}), ...(extra.status === undefined ? {} : {status: extra.status})},
        });
        let apiKey: string;
        try {
            apiKey = target.apiKey();
        } catch (error) {
            return failed("auth", error instanceof Error ? error.message : String(error), {code: "missing-key"});
        }
        let context: Context;
        try {
            context = toContext(request, target.model, Date.now());
        } catch (error) {
            if (error instanceof UnsupportedContent) return failed("local", error.message, {code: "unsupported-content"});
            throw error;
        }
        const toolIds = new Map(request.tools.map((tool) => [providerToolName(tool), tool.id] as const));
        let requests = 0;
        const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            requests += 1;
            return fetch(input, init);
        }) as typeof fetch;
        const watch = createFinishWatch();
        const effort = request.effort === undefined ? undefined : clampThinkingLevelForModel(target.model, request.effort as Effort);
        const choice = toolChoiceOf(request);
        const options: SimpleStreamOptions = {
            apiKey,
            signal,
            fetch: counted,
            onSseEvent: (event) => watch.observe(event),
            headers: {...request.headers},
            ...(request.params.maxTokens === undefined ? {} : {maxTokens: request.params.maxTokens}),
            ...(request.params.temperature === undefined ? {} : {temperature: request.params.temperature}),
            ...(effort === undefined ? {} : {reasoning: effort}),
            ...(choice === undefined ? {} : {toolChoice: choice}),
            ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
        };
        let message: AssistantMessage;
        try {
            const stream = streamSimple(target.model, context, options);
            for await (const event of stream) {
                if (event.type === "text_delta") onDelta({part: "text", text: event.delta});
                else if (event.type === "thinking_delta") onDelta({part: "thinking", text: event.delta});
                else if (event.type === "toolcall_delta") {
                    const call = event.partial.content[event.contentIndex];
                    onDelta({part: "toolArgs", text: event.delta, ...(call?.type === "toolCall" ? {callId: call.id} : {})});
                }
            }
            message = await stream.result();
        } catch (error) {
            // 建流时抛错或流 reject：没有结构化的错误信息，归为 provider（中止归 aborted），不按文字猜。
            if (signal.aborted) return {content: [], toolCalls: [], stopReason: "aborted", usage: {...EMPTY_USAGE, complete: false}, model: modelName};
            return failed("provider", redactText(error instanceof Error ? error.message : String(error), [apiKey]), {usage: {...EMPTY_USAGE, complete: false}});
        }
        const usage: Usage = {
            input: message.usage.input,
            output: message.usage.output,
            cacheRead: message.usage.cacheRead,
            cacheWrite: message.usage.cacheWrite,
            ...(message.usage.totalTokens ? {totalTokens: message.usage.totalTokens} : {}),
            cost: target.priceKnown ? message.usage.cost.total : null,
            complete: requests <= 1 && message.stopReason !== "aborted" && !signal.aborted,
        };
        const {content, toolCalls} = fromOmpContent(message, toolIds);
        const answeredBy = message.provider && message.model ? `${message.provider}/${message.model}` : modelName;
        const base = {content, toolCalls, usage, model: answeredBy, ...(message.responseId === undefined ? {} : {responseId: message.responseId})};
        switch (message.stopReason) {
            case "error": {
                const {kind, status} = classifyProviderError(message);
                return {...base, toolCalls: [], stopReason: "error", error: {kind, message: redactText(message.errorMessage ?? "model request failed", [apiKey]), ...(status === null ? {} : {status})}};
            }
            case "aborted":
                return {...base, toolCalls: [], stopReason: "aborted"};
            case "length":
                return {...base, stopReason: "length"};
            case "toolUse":
                return {...base, stopReason: "tool"};
            default:
                // 网关送了 `[DONE]` 却没送结束原因：半句话不能当正常结束，按被截断记。
                return {...base, stopReason: toolCalls.length > 0 ? "tool" : watch.missing ? "length" : "stop"};
        }
    };
}
