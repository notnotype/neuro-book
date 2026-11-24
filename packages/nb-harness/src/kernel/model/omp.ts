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

import {streamSimple, type AssistantMessage, type Context, type Message as OmpMessage, type SimpleStreamOptions, type ImageContent, type TextContent, type ThinkingContent, type Tool, type ToolCall as OmpToolCall, type ToolChoice} from "@oh-my-pi/pi-ai";
import {clampThinkingLevelForModel, getSupportedEfforts, type Effort, type Model} from "@oh-my-pi/pi-catalog";
import {NO_AUTH_SENTINEL} from "@oh-my-pi/pi-ai/auth-retry";
import {providerToolName, type ContentBlock, type JsonValue, type Message, type ModelCallMeta, type ModelDelta, type ModelInfo, type ModelOrigin, type ModelRequest, type ModelResponse, type ToolCall, type Usage} from "../api/index.js";
import {extractProviderRetryHint} from "@oh-my-pi/pi-ai/utils/retry-after";
import {classifyProviderError} from "./classify.js";
import {reasoningOf} from "./reasoning.js";
import {createFinishWatch} from "./finish-watch.js";
import {redactText, sanitizeProviderText} from "./redact.js";
import {takeRequestDumps} from "./request-dump.js";
import {notify, observedFetch} from "./wire.js";

export interface OmpTarget {
    /** OMP 的模型对象（宿主用 `resolveModel`、`defineModel` 或自己的解析得到）。 */
    readonly model: Model;
    /**
     * 对外的引用 `<实例 id>/<模型 id>`：回复的 `model` 用它的第一段做公开服务商。`Model.provider` 是发给 OMP 的身份（模板的 OMP id
     * 或中性身份），同模板的两个实例相同，所以不能拿它当公开引用。不给时用 `<Model.provider>/<Model.id>`。
     */
    readonly name?: string;
    /** 签发身份（见 `OmpIdentity`）；不给的目标不写 `origin`，历史回复按 `Model.provider` 判断。 */
    readonly identity?: OmpIdentity;
    /**
     * 发出前核对每个请求的完整地址，返回失败说明就不发；`ompCall` 把失败按 `local` 类别、该码交回，优先于适配器自己报的通用错误
     * （适配器见到 `fetch` 抛错只会报“请求失败”）。
     */
    readonly guard?: (url: URL) => OmpFetchFailure | null;
    /** 不要认证的目标：发出前剥掉值是占位哨兵的认证头（`Authorization`、`x-api-key`、`x-goog-api-key`），不把它当密钥送出去。 */
    readonly keyless?: boolean;
    /**
     * 网络出口：每个请求发出前按完整地址问一次走哪条路，交回的 `proxy` 原样写进 Bun 的按次 `proxy`（`false` 是直连，盖过
     * `HTTP_PROXY`、`HTTPS_PROXY` 与 pi-ai 的 `PI_PROXY`）。选不出路时不发，`ompCall` 把它的码按 `local` 类别交回，与 `guard`
     * 一样优先于适配器的通用错误。不给时照运行时的缺省（读环境变量）。
     */
    readonly route?: NetworkRoute;
    /**
     * 取密钥，每次请求取一次（凭据库是异步的，OAuth 令牌以后要刷新）；取不到时抛错或 reject，适配器在发请求前以 `auth`、
     * 码 `missing-key` 失败。只用宿主指定的来源。
     */
    readonly apiKey: () => string | Promise<string>;
    /** 单价未知时用量的 `cost` 为 null。 */
    readonly priceKnown: boolean;
    /**
     * 宿主配置的请求头（服务商级与模型级合好、`env:` 已解析），每次请求都带上，在请求自己的 `headers` 之前（同名时请求的赢）。
     * 值可能是凭据，和密钥一起进遮盖。
     */
    readonly headers?: Readonly<Record<string, string>>;
    /** 宿主接管重发时给：不给时超时与服务商层的重试都按 OMP 的缺省。 */
    readonly transport?: OmpTransport;
    /**
     * 最内层的发送，在地址核对、选路、剥占位认证头之后，替代全局 `fetch`（收到的参数与全局 `fetch` 的相同，已带上重定向与 `proxy`）。
     * 协议检测用它只放行一次请求、读到首个生成证据就停（`models/probe.ts`）；不给用全局 `fetch`。
     */
    readonly send?: typeof fetch;
    /** 错误文字里 OMP 写的请求全文路径（docs/specs/harness/models.md 输出 19）。抛错的原因追加到错误文字末尾。内核不碰文件系统，由宿主删。 */
    readonly onRequestDump?: (path: string) => Promise<void>;
}

/** `OmpTarget.guard` 的失败说明；`code` 是机读的码，`message` 是遮盖不到凭据的英文开发者文字。 */
export interface OmpFetchFailure {
    readonly code: string;
    readonly message: string;
}

/**
 * 网络出口给一次请求的路（宿主的实现，例如 nb-host 的 `routeFor`）。`proxy` 交给 Bun 的按次 `proxy`；失败的 `code` 是出口的码
 * （`proxy-unsupported` 等），请求不发。模型请求、列表、在线目录与协议检测共用这个形状。
 */
export type NetworkRoute = (url: URL) => Promise<{readonly ok: true; readonly proxy: string | false} | ({readonly ok: false} & OmpFetchFailure)>;

/**
 * 代理地址里的凭据（环境变量或系统设置给的 `http://用户:密码@主机`）：Bun 把它作 `Proxy-Authorization` 发给代理，代理在错误正文里
 * 回显时会进模型错误、检测原文与诊断。交回要遮盖的几种写法：密码、`用户:密码`、它的 Base64（Basic 的值）。没有凭据时为空。
 */
export function proxySecrets(proxy: string | false): string[] {
    if (proxy === false) return [];
    let url: URL;
    try {
        url = new URL(proxy);
    } catch {
        return [];
    }
    if (url.username === "" && url.password === "") return [];
    const pair = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    return [pair, Buffer.from(pair).toString("base64"), ...(url.password === "" ? [] : [decodeURIComponent(url.password)])].filter((value) => value.length >= 4);
}

/**
 * 一个部署的签发身份：`deployment` 区分实例与它当时的地址、协议；`credential` 只有签名绑定凭据的协议才给；`legacyProvider` 是
 * 没有 `origin` 的旧日志里 `model` 的第一段应有的值（旧运行时用实例 id 当 `Model.provider`）。
 */
export interface OmpIdentity {
    readonly deployment: string;
    readonly credential?: string;
    readonly legacyProvider: string;
}

/** 认证头：免认证时它们的值是哨兵，不能真的发出去。 */
const AUTH_HEADERS = ["authorization", "x-api-key", "x-goog-api-key"] as const;
const isSentinel = (value: string | null): boolean => value === NO_AUTH_SENTINEL || value === `Bearer ${NO_AUTH_SENTINEL}`;

/** 请求的传输（docs/specs/harness/models.md 输出 18）。超时的 0 表示不计时。 */
export interface OmpTransport {
    readonly firstEventTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    /** 只有 `openai-completions` 认：`openai-responses` 的调用处没传这个参数，`anthropic-messages` 的上限是写死的常量。 */
    readonly maxHttpAttempts?: number;
}

/**
 * 等第一个事件的计时。不用 OMP 的 `streamFirstEventTimeoutMs`：`anthropic-messages` 的内层循环会把这个超时再重试 10 次，
 * 缺省设置下一次外层尝试要卡近一小时。这里到时直接中止，所有接口都只卡一次。
 */
function firstEventWatch(parent: AbortSignal, timeoutMs: number | undefined): {readonly signal: AbortSignal; seen(): void; expired(): boolean} {
    if (timeoutMs === undefined || timeoutMs <= 0) return {signal: parent, seen: () => undefined, expired: () => false};
    const local = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
        expired = true;
        local.abort(new Error("timed out waiting for the first model stream event"));
    }, timeoutMs);
    return {signal: AbortSignal.any([parent, local.signal]), seen: () => clearTimeout(timer), expired: () => expired};
}

/** 请求头的值至少这么长才进遮盖：短值（`writing` 这类标记）不像凭据，遮了反而把错误正文里的普通词换掉。 */
const SECRET_HEADER_MIN = 8;

export function ompModelInfo(model: Model, name?: string): ModelInfo {
    return {
        id: name ?? `${model.provider}/${model.id}`,
        contextWindow: model.contextWindow ?? 0,
        ...(model.maxTokens ? {maxOutput: model.maxTokens} : {}),
        capabilities: {vision: model.input.includes("image"), thinking: model.reasoning},
        efforts: [...getSupportedEfforts(model)],
        reasoning: reasoningOf(model),
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

/** 用户与工具结果消息的内容：相邻的文字块合成一块、中间空一行（块是按来源分的，服务商不一定在块之间加分隔）；图片转成服务商的图片块，模型不能看图时换成一行文字（runtime.md 输出 61）。 */
function textAndImages(blocks: readonly ContentBlock[], vision: boolean): (TextContent | ImageContent)[] {
    const out: (TextContent | ImageContent)[] = [];
    const pushText = (text: string): void => {
        const last = out.at(-1);
        if (last?.type === "text") out[out.length - 1] = {type: "text", text: `${last.text}\n\n${text}`};
        else out.push({type: "text", text});
    };
    for (const block of blocks) {
        if (block.kind === "text") pushText(block.text);
        else if (block.kind !== "image") throw new UnsupportedContent(`${block.kind} block in a user or tool message is not supported`);
        else if (vision) out.push({type: "image", data: block.data, mimeType: block.mime});
        else pushText(`[图片 ${block.mime}${block.width === undefined || block.height === undefined ? "" : ` ${block.width}x${block.height}`}：当前模型不能看图]`);
    }
    return out;
}

const WEBP_FALLBACK_PNG_LIMIT = 4 * 1024 * 1024;

/** 本地推理后端（llama.cpp 的解码器）解不了 WebP；同 omp 的判断，另加本机回环地址：自定义服务商指向本机的多半也是这类后端。 */
export function lacksWebp(model: Pick<Model, "provider" | "api" | "baseUrl" | "imageInputDecoder">): boolean {
    return model.imageInputDecoder === "stb"
        || ["ollama", "ollama-cloud", "llama.cpp", "lm-studio", "local-server"].includes(model.provider)
        || model.api === "ollama-chat"
        || /^https?:\/\/(?:localhost|127\.|\[::1\])/u.test(model.baseUrl);
}

/** 发送前把用户与工具消息里的 WebP 转成 PNG；转不了的换成一行文字，不能让一张图卡死这个会话之后的每次请求。 */
async function withoutWebp(request: ModelRequest): Promise<ModelRequest> {
    const convert = async (block: Message["content"][number]): Promise<Message["content"][number]> => {
        if (block.kind !== "image" || block.mime !== "image/webp") return block;
        try {
            const source = Buffer.from(block.data, "base64");
            const png = await new Bun.Image(source).png().bytes();
            // PNG 无损，压过的图转回去可能大十几倍；回环地址后面也可能是转发到云端的网关，有单图上限。透明丢了也比这个会话之后每次都失败好。
            if (png.length <= WEBP_FALLBACK_PNG_LIMIT) return {...block, data: Buffer.from(png).toString("base64"), mime: "image/png"};
            return {...block, data: await new Bun.Image(source).jpeg({quality: 80}).toBase64(), mime: "image/jpeg"};
        } catch (error) {
            return {kind: "text", text: `[图片 image/webp：转换失败（${error instanceof Error ? error.message : String(error)}）]`, origin: block.origin};
        }
    };
    const messages = await Promise.all(request.messages.map(async (message) => (message.role !== "assistant" ? {...message, content: await Promise.all(message.content.map(convert))} : message)));
    return {...request, messages};
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
            case "imageRef":
                throw new UnsupportedContent(`${block.kind} block in an assistant message is not supported yet`);
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

/**
 * 这条历史回复的思考签名与服务商元数据能不能原样送回：有 `origin` 时整组（OMP 身份、协议、作答的模型、部署、凭据）相同才行；旧日志
 * 没有 `origin`，按旧运行时的规则，`model` 的第一段是同一个实例 id（模型 id 照历史交给 OMP，由它按模型再判一次）。目标没有
 * `identity` 时（直接用 OMP 模型的宿主）退回 `Model.provider`。
 */
function restorable(message: Message, model: Model, identity: OmpIdentity | undefined): boolean {
    const origin = message.origin;
    if (origin !== undefined) {
        if (origin.provider !== model.provider || origin.api !== model.api || origin.model !== model.id) return false;
        return identity === undefined || (origin.deployment === identity.deployment && (origin.credential ?? null) === (identity.credential ?? null));
    }
    if (message.model === undefined) return true;
    return message.model.split("/")[0] === (identity?.legacyProvider ?? model.provider);
}

function toContext(request: ModelRequest, model: Model, now: number, identity?: OmpIdentity): Context {
    const names = new Map(request.tools.map((tool) => [tool.id, providerToolName(tool)] as const));
    const toolOfCall = new Map<string, string>();
    const messages: OmpMessage[] = request.messages.map((message: Message): OmpMessage => {
        if (message.role === "user") return {role: "user", content: textAndImages(message.content, model.input.includes("image")), timestamp: now};
        if (message.role === "assistant") {
            for (const call of message.toolCalls ?? []) toolOfCall.set(call.id, call.tool);
            const same = restorable(message, model, identity);
            const [first, ...rest] = (message.model ?? `${model.provider}/${model.id}`).split("/");
            return {
                role: "assistant",
                content: assistantContent(message.content, message.toolCalls ?? [], names),
                // 能还原时沿用当前的身份与 api：OMP 按服务商与 api 是否相同决定思考签名要不要原样送回；不能还原时 api 写 unknown。
                api: same ? model.api : "unknown",
                provider: same ? model.provider : message.origin?.provider ?? first ?? model.provider,
                // 有 `origin` 且整组相同时就是这个模型；旧日志只核对了实例，交出历史里真正作答的模型 id，让 OMP 换了模型时不送签名。
                model: same && message.origin !== undefined ? model.id : message.origin?.model ?? (rest.length > 0 ? rest.join("/") : model.id),
                usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
                stopReason: (message.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop",
                timestamp: now,
            } as AssistantMessage;
        }
        const tool = toolOfCall.get(message.callId ?? "") ?? "";
        return {role: "toolResult", toolCallId: message.callId ?? "", toolName: names.get(tool) ?? tool.replaceAll(".", "__"), content: textAndImages(message.content, model.input.includes("image")), isError: message.isError ?? false, timestamp: now};
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
export function ompCall(target: OmpTarget): (request: ModelRequest, signal: AbortSignal, onDelta: (delta: ModelDelta) => void, meta?: ModelCallMeta) => Promise<ModelResponse> {
    const modelName = target.name ?? `${target.model.provider}/${target.model.id}`;
    const publicProvider = modelName.split("/")[0] ?? target.model.provider;
    return async (request, signal, onDeltaToHost, meta) => {
        const observer = meta?.observe;
        let contentSeen = false;
        // 第一块内容（models.md 输出 20）：与首事件看门狗（`firstEvent.seen()`）分开，失败收口时也会调看门狗，那不算内容。
        const onDelta = (delta: ModelDelta): void => {
            if (!contentSeen) {
                contentSeen = true;
                if (observer?.firstContent !== undefined) notify(() => observer.firstContent?.());
            }
            onDeltaToHost(delta);
        };
        const failed = (kind: NonNullable<ModelResponse["error"]>["kind"], message: string, extra: {code?: string; status?: number; usage?: Usage; content?: ContentBlock[]; retryable?: boolean} = {}): ModelResponse => ({
            content: extra.content ?? [],
            toolCalls: [],
            stopReason: "error",
            usage: extra.usage ?? EMPTY_USAGE,
            model: modelName,
            error: {kind, message, ...(extra.code === undefined ? {} : {code: extra.code}), ...(extra.status === undefined ? {} : {status: extra.status}), ...(extra.retryable === true ? {retryable: true} : {})},
        });
        /** 错误原文交回之前：取走落盘路径交给宿主，再遮盖。截断在遮盖里，所以要在原文上取，路径可能在 8 KB 之后。 */
        const providerText = async (raw: string): Promise<string> => {
            const {text, paths} = takeRequestDumps(raw);
            const problems: string[] = [];
            for (const path of paths) {
                try {
                    await target.onRequestDump?.(path);
                } catch (error) {
                    problems.push(`request dump not removed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            return sanitizeProviderText([text, ...problems].join("\n"), secrets);
        };
        let apiKey: string;
        try {
            apiKey = await target.apiKey();
        } catch (error) {
            return failed("auth", error instanceof Error ? error.message : String(error), {code: "missing-key"});
        }
        const secrets = [apiKey, ...Object.values(target.headers ?? {}).filter((value) => value.length >= SECRET_HEADER_MIN)];
        let context: Context;
        try {
            const vision = target.model.input.includes("image");
            context = toContext(vision && lacksWebp(target.model) ? await withoutWebp(request) : request, target.model, Date.now(), target.identity);
        } catch (error) {
            if (error instanceof UnsupportedContent) return failed("local", error.message, {code: "unsupported-content"});
            throw error;
        }
        const toolIds = new Map(request.tools.map((tool) => [providerToolName(tool), tool.id] as const));
        let requests = 0;
        /** 发出前的核对失败（地址不符）：适配器只会把它报成通用的“请求失败”，在这里记下，之后优先交出。 */
        const wire: {blocked: OmpFetchFailure | null} = {blocked: null};
        /** 拦下之后整次调用就此结束：有的协议（Anthropic）会对抛错的请求按退避重试十来次，本地拦下的没有重试的意义。 */
        const stopOnBlock = new AbortController();
        // 写明函数类型：TS 只对带类型注解的 `never` 函数在调用之后收窄。
        const block: (problem: OmpFetchFailure) => never = (problem) => {
            wire.blocked ??= problem;
            stopOnBlock.abort();
            throw new Error(problem.message);
        };
        const guarded = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const url = new URL(href);
            const problem = target.guard?.(url) ?? null;
            if (problem !== null) block(problem);
            const route = target.route === undefined ? null : await target.route(url);
            if (route !== null && !route.ok) block({code: route.code, message: route.message});
            // 选路是异步的：等它期间实例可能已经换了地址或认证（旧解析不能再发，docs/specs/models/service.md 输出 24），再核一次。
            if (route !== null) {
                const late = target.guard?.(url) ?? null;
                if (late !== null) block(late);
                for (const secret of proxySecrets(route.proxy)) if (!secrets.includes(secret)) secrets.push(secret);
            }
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            if (init?.headers !== undefined) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
            // 只剥适配器垫的占位值本身（或 `Bearer <占位>`）：用户自己配的同名头哪怕含有同样的字符也照发。
            if (target.keyless === true) for (const name of AUTH_HEADERS) if (isSentinel(headers.get(name))) headers.delete(name);
            // 重定向交给调用方改地址，不替它跟随：跟随会把密钥带到没核对过的地址（docs/specs/harness/models.md）。
            // `proxy: false` 是 Bun 的按次直连（1.4.3 起），类型声明里没有 `false` 这一项。
            return (target.send ?? fetch)(input, {...init, headers, redirect: "error", ...(route === null ? {} : {proxy: route.proxy as string})});
        }) as typeof fetch;
        const observed = observedFetch(guarded, observer, secrets);
        const counted = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            requests += 1;
            return observed(input, init);
        }) as typeof fetch;
        /** 不经 `fetch` 的传输（Bedrock SDK、Codex WebSocket）只交得出请求体：在回调里立刻序列化，provider 之后还会改这个对象。 */
        let builtPayload: string | null = null;
        const deliverPayload = (): void => {
            const payload = observer?.payload;
            const body = builtPayload;
            if (requests === 0 && body !== null && payload !== undefined) notify(() => payload.call(observer, body));
        };
        const watch = createFinishWatch();
        const effort = request.effort === undefined ? undefined : clampThinkingLevelForModel(target.model, request.effort as Effort);
        const choice = toolChoiceOf(request);
        const transport = target.transport;
        const firstEvent = firstEventWatch(signal, transport?.firstEventTimeoutMs);
        const options: SimpleStreamOptions = {
            apiKey,
            signal: AbortSignal.any([firstEvent.signal, stopOnBlock.signal]),
            fetch: counted,
            onSseEvent: (event) => watch.observe(event),
            ...(observer?.payload === undefined ? {} : {onPayload: (payload: unknown) => {
                builtPayload = redactText(JSON.stringify(payload) ?? "null", secrets);
                return undefined;
            }}),
            headers: {...target.headers, ...request.headers},
            // 缓存键按会话固定：pi-ai 在调用方没给 `sessionId`、`promptCacheKey` 时每次现生成一个随机 UUID 当 `prompt_cache_key`，
            // 服务端按它分片或粘住节点，相邻两轮落到不同节点就整段不命中（ollama-cloud 实测：键不变 99.9%，只换键 0%）。
            // 只给 `promptCacheKey`、不给 `sessionId`：后者还牵动 Codex 等协议的传输状态与会话头，那是另一件事。
            // `complete()` 没有会话（不带 meta），照旧由 pi-ai 生成。
            ...(meta?.session === undefined ? {} : {promptCacheKey: meta.session}),
            ...(request.params.maxTokens === undefined ? {} : {maxTokens: request.params.maxTokens}),
            ...(request.params.temperature === undefined ? {} : {temperature: request.params.temperature}),
            ...(request.params.disableReasoning === true ? {disableReasoning: true} : {}),
            ...(effort === undefined ? {} : {reasoning: effort}),
            ...(choice === undefined ? {} : {toolChoice: choice}),
            ...(request.providerOptions === undefined ? {} : {providerOptions: request.providerOptions}),
            // 接管重发时只留外面一层：空回复的内层重发用量不进回复，还会和外面相乘。
            ...(transport === undefined ? {} : {acceptEmptyResponse: true}),
            ...(transport?.firstEventTimeoutMs === undefined ? {} : {streamFirstEventTimeoutMs: 0}),
            ...(transport?.idleTimeoutMs === undefined ? {} : {streamIdleTimeoutMs: transport.idleTimeoutMs}),
            ...(transport?.maxHttpAttempts === undefined ? {} : {maxHttpAttempts: transport.maxHttpAttempts}),
        };
        const firstEventFailed = (): ModelResponse => failed("network", `timed out after ${String(transport?.firstEventTimeoutMs)} ms waiting for the first model stream event`, {code: "first-event-timeout", retryable: true, usage: {...EMPTY_USAGE, complete: false}});
        let message: AssistantMessage;
        try {
            const stream = streamSimple(target.model, context, options);
            const announcedCalls = new Set<string>();
            for await (const event of stream) {
                if (event.type !== "start") firstEvent.seen();
                if (event.type === "text_delta") onDelta({part: "text", text: event.delta});
                else if (event.type === "thinking_delta") onDelta({part: "thinking", text: event.delta});
                else if (event.type === "toolcall_delta") {
                    const call = event.partial.content[event.contentIndex];
                    if (call?.type !== "toolCall") onDelta({part: "toolArgs", text: event.delta});
                    else {
                        const first = !announcedCalls.has(call.id);
                        announcedCalls.add(call.id);
                        onDelta({part: "toolArgs", text: event.delta, callId: call.id, ...(first ? {tool: toolIds.get(call.name) ?? call.name} : {})});
                    }
                }
            }
            message = await stream.result();
            deliverPayload();
        } catch (error) {
            deliverPayload();
            // 建流时抛错或流 reject：没有结构化的错误信息，归为 provider（中止归 aborted），不按文字猜。
            firstEvent.seen();
            if (signal.aborted) return {content: [], toolCalls: [], stopReason: "aborted", usage: {...EMPTY_USAGE, complete: false}, model: modelName};
            if (wire.blocked !== null) return failed("local", wire.blocked.message, {code: wire.blocked.code});
            if (firstEvent.expired()) return firstEventFailed();
            return failed("provider", await providerText(error instanceof Error ? error.message : String(error)), {usage: {...EMPTY_USAGE, complete: false}});
        }
        firstEvent.seen();
        if (wire.blocked !== null && !signal.aborted) return failed("local", wire.blocked.message, {code: wire.blocked.code});
        if (firstEvent.expired() && !signal.aborted) return firstEventFailed();
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
        const answeredBy = message.model ? `${publicProvider}/${message.model}` : modelName;
        const identity = target.identity;
        const origin: ModelOrigin | undefined = identity === undefined ? undefined : {
            provider: message.provider || target.model.provider,
            api: message.api || target.model.api,
            model: message.model || target.model.id,
            deployment: identity.deployment,
            ...(identity.credential === undefined ? {} : {credential: identity.credential}),
        };
        const base = {content, toolCalls, usage, model: answeredBy, ...(origin === undefined ? {} : {origin}), ...(message.responseId === undefined ? {} : {responseId: message.responseId})};
        switch (message.stopReason) {
            case "error": {
                const {kind, status, retryable, code} = classifyProviderError(message);
                const raw = message.errorMessage ?? "model request failed";
                const retryAfterMs = extractProviderRetryHint(target.model.provider, raw);
                return {...base, toolCalls: [], stopReason: "error", error: {kind, message: await providerText(raw), ...(status === null ? {} : {status}), ...(code === null ? {} : {code}), ...(retryable ? {retryable: true} : {}), ...(retryAfterMs === undefined ? {} : {retryAfterMs})}};
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
