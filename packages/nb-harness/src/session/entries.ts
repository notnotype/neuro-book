/**
 * 条目的校验与补全（docs/specs/harness/session.md 的“输入与前置条件”与输出 2–4、19）。
 *
 * 校验分两层：先走一遍“能被 JSON 如实表示”（Spec 的“值”规则），再用 TypeBox 按条目类型检查形状。先走 JSON 那一遍
 * 是因为 `undefined`、`NaN` 这类值 JSON 会悄悄改写或丢掉，schema 检查对可选字段又可能放过 `undefined`，
 * 先拦住它们，后面的形状检查与存储才能相信“存进去的就是读出来的”。
 */

import {Type} from "typebox";
import type {TSchema} from "typebox";
import {Value} from "typebox/value";
import type {EntryBase, EntryInput, SessionEntry, SessionHeader} from "./types";

export const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const CUSTOM_TYPE_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/u;
const RESERVED_NAMESPACE = "harness/";

export const isValidSessionId = (id: string): boolean => SESSION_ID_PATTERN.test(id);

const TextBlock = Type.Object({type: Type.Literal("text"), text: Type.String()});
const ImageBlock = Type.Object({type: Type.Literal("image"), data: Type.String(), mimeType: Type.String()});
const UserContent = Type.Union([Type.String(), Type.Array(Type.Union([TextBlock, ImageBlock]))]);
const AssistantBlock = Type.Union([
    TextBlock,
    ImageBlock,
    Type.Object({type: Type.Literal("thinking"), thinking: Type.String()}),
    Type.Object({type: Type.Literal("redactedThinking")}),
    Type.Object({type: Type.Literal("toolCall"), id: Type.String(), name: Type.String(), arguments: Type.Record(Type.String(), Type.Unknown())}),
    // OMP 还有 Anthropic 专有的几种块；它们只在那个 provider 的回放里有意义，这里按 type 放行、不检查内部。
    Type.Object({type: Type.Union([Type.Literal("anthropicFallback"), Type.Literal("anthropicServerTool")])}),
]);

// 消息按 OMP `Message` 的必填字段校验（pi-ai 的 UserMessage、DeveloperMessage、AssistantMessage、ToolResultMessage）：
// `import type` 只约束编译期，追加时不查这些字段，缺 usage、stopReason 的助手消息会写进日志、到交给 OMP 时才出错。
// 可选字段与 OMP 以后新增的字段原样保存，所以 schema 允许额外属性。
// 条目与消息都按判别字段（type、role）先选出变体再校验：对整个 Union 校验时 TypeBox 会把每个变体的错误都列出来，
// detail 里就全是别的变体缺的字段，看不出真正的问题。
const Usage = Type.Object({
    input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), totalTokens: Type.Number(),
    cost: Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), total: Type.Number()}),
});
const StopReason = Type.Union(["stop", "length", "toolUse", "error", "aborted"].map((reason) => Type.Literal(reason)));
const MESSAGE_SCHEMAS: Readonly<Record<string, TSchema>> = {
    user: Type.Object({role: Type.Literal("user"), content: UserContent, timestamp: Type.Number()}),
    developer: Type.Object({role: Type.Literal("developer"), content: UserContent, timestamp: Type.Number()}),
    assistant: Type.Object({
        role: Type.Literal("assistant"), content: Type.Array(AssistantBlock), api: Type.String(), provider: Type.String(), model: Type.String(),
        usage: Usage, stopReason: StopReason, timestamp: Type.Number(),
    }),
    toolResult: Type.Object({
        role: Type.Literal("toolResult"), toolCallId: Type.String(), toolName: Type.String(), content: Type.Array(Type.Union([TextBlock, ImageBlock])),
        isError: Type.Boolean(), timestamp: Type.Number(),
    }),
};

const CustomType = Type.String({pattern: CUSTOM_TYPE_PATTERN.source});

const ENTRY_SCHEMAS: Readonly<Record<string, TSchema>> = {
    message: Type.Object({type: Type.Literal("message"), message: Type.Object({role: Type.String()})}),
    custom_message: Type.Object({type: Type.Literal("custom_message"), customType: CustomType, content: UserContent, display: Type.Boolean(), details: Type.Optional(Type.Unknown())}),
    custom: Type.Object({type: Type.Literal("custom"), customType: CustomType, data: Type.Optional(Type.Unknown())}),
    model_change: Type.Object({type: Type.Literal("model_change"), model: Type.String(), role: Type.Optional(Type.String())}),
    thinking_level_change: Type.Object({type: Type.Literal("thinking_level_change"), thinkingLevel: Type.Union([Type.String(), Type.Null()])}),
    title_change: Type.Object({type: Type.Literal("title_change"), title: Type.String(), source: Type.Union([Type.Literal("auto"), Type.Literal("user")])}),
    compaction: Type.Object({
        type: Type.Literal("compaction"), summary: Type.String(), firstKeptEntryId: Type.String(), tokensBefore: Type.Number(),
        shortSummary: Type.Optional(Type.String()), details: Type.Optional(Type.Unknown()),
        preserveData: Type.Optional(Type.Record(Type.String(), Type.Unknown())), providerReplayThroughEntryId: Type.Optional(Type.String()),
    }),
};

function variantProblem(schemas: Readonly<Record<string, TSchema>>, value: unknown, field: string, at: string): string | null {
    if (typeof value !== "object" || value === null) return `${at}：必须是对象`;
    const tag = (value as Record<string, unknown>)[field];
    const schema = typeof tag === "string" ? schemas[tag] : undefined;
    if (schema === undefined) return `${at}${field}：${typeof tag === "string" ? `不认识 ${tag}` : "缺失"}，允许 ${Object.keys(schemas).join("、")}`;
    const problem = schemaProblems(schema, value);
    return problem === null ? null : at === "/" ? problem : problem.split("；").map((part) => `${at.slice(0, -1)}${part}`).join("；");
}

export const SessionHeaderSchema = Type.Object({
    type: Type.Literal("session"), version: Type.Literal(1), id: Type.String({pattern: SESSION_ID_PATTERN.source}),
    createdAt: Type.String(), parentSession: Type.Optional(Type.String()),
});

const EntryBaseSchema = Type.Object({id: Type.String(), parentId: Type.Union([Type.String(), Type.Null()]), timestamp: Type.String()});

const InvocationDataSchema = Type.Object({
    invocationId: Type.String(),
    phase: Type.Union(["start", "waiting", "resumed", "end", "error", "aborted", "interrupted"].map((phase) => Type.Literal(phase))),
    detail: Type.Optional(Type.Unknown()),
});
const InteractionRequestSchema = Type.Object({
    assistantEntryId: Type.String(), toolCallId: Type.String(), toolName: Type.String(),
    tier: Type.Optional(Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("exec")])), data: Type.Optional(Type.Unknown()),
});
const InteractionResponseSchema = Type.Object({
    decision: Type.Union([Type.Literal("approve"), Type.Literal("reject"), Type.Literal("answer")]),
    scope: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("session")])),
    decidedBy: Type.Union([Type.Literal("user"), Type.Literal("approver")]), note: Type.Optional(Type.String()), data: Type.Optional(Type.Unknown()),
});
const InteractionDataSchema = Type.Object({
    interactionId: Type.String(), kind: Type.Union([Type.Literal("approval"), Type.Literal("question")]),
    phase: Type.Union([Type.Literal("request"), Type.Literal("response")]),
    request: Type.Optional(InteractionRequestSchema), response: Type.Optional(InteractionResponseSchema),
});
const SeedDetailsSchema = Type.Object({role: Type.Union([Type.Literal("user"), Type.Literal("developer")]), once: Type.Optional(Type.Boolean())});
const ProfileStateDataSchema = Type.Object({profileId: Type.String(), state: Type.Unknown()});

/** 保留类型表：`customType` → 条目类型与 `data`/`details` 的 schema（Spec“输入与前置条件”的保留类型表）。 */
const RESERVED: Readonly<Record<string, {entryType: "custom" | "custom_message"; payload: TSchema | null}>> = {
    "harness/invocation": {entryType: "custom", payload: InvocationDataSchema},
    "harness/interaction": {entryType: "custom", payload: InteractionDataSchema},
    "harness/seed": {entryType: "custom_message", payload: SeedDetailsSchema},
    "harness/reminder": {entryType: "custom_message", payload: null},
    "harness/profile-state": {entryType: "custom", payload: ProfileStateDataSchema},
};

function schemaProblems(schema: TSchema, value: unknown): string | null {
    if (Value.Check(schema, value)) return null;
    return [...Value.Errors(schema, value)]
        .slice(0, 5)
        .map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`)
        .join("；");
}

/** 返回第一处不能被 JSON 如实表示的位置；全部可以时返回 null。 */
export function jsonProblem(value: unknown, path = "/"): string | null {
    const seen = new Set<object>();
    const visit = (current: unknown, at: string): string | null => {
        switch (typeof current) {
            case "string":
            case "boolean":
                return null;
            case "number":
                return Number.isFinite(current) ? null : `${at}：${String(current)} 不能用 JSON 表示`;
            case "undefined":
            case "function":
            case "bigint":
            case "symbol":
                return `${at}：${typeof current} 不能用 JSON 表示`;
            case "object": {
                if (current === null) return null;
                if (seen.has(current)) return `${at}：循环引用`;
                seen.add(current);
                if (Array.isArray(current)) {
                    for (let index = 0; index < current.length; index += 1) {
                        const problem = visit(current[index], `${at}${index}/`);
                        if (problem !== null) return problem;
                    }
                } else {
                    const prototype = Object.getPrototypeOf(current);
                    if (prototype !== Object.prototype && prototype !== null) return `${at}：只允许普通对象，不允许 ${prototype.constructor?.name ?? "未知类型"}`;
                    for (const [key, item] of Object.entries(current)) {
                        const problem = visit(item, `${at}${key}/`);
                        if (problem !== null) return problem;
                    }
                }
                seen.delete(current);
                return null;
            }
        }
    };
    return visit(value, path);
}

export function headerProblem(value: unknown): string | null {
    return jsonProblem(value) ?? schemaProblems(SessionHeaderSchema, value);
}

/** 校验已有条目时用的上下文：id 与各助手消息里的工具调用、每个 interaction 已出现的阶段。 */
export interface EntryContext {
    readonly ids: ReadonlySet<string>;
    readonly toolCallsByAssistantEntry: ReadonlyMap<string, ReadonlySet<string>>;
    readonly interactions: ReadonlyMap<string, {request: boolean; response: boolean}>;
}

/** 只看条目本身的规则；与已有条目有关的规则在 `relationProblem`。 */
export function shapeProblem(input: unknown): string | null {
    const json = jsonProblem(input);
    if (json !== null) return json;
    const shape = variantProblem(ENTRY_SCHEMAS, input, "type", "/");
    if (shape !== null) return shape;
    const entry = input as EntryInput;
    if (entry.type === "message") return variantProblem(MESSAGE_SCHEMAS, entry.message, "role", "/message/");
    if (entry.type !== "custom" && entry.type !== "custom_message") return null;
    if (!entry.customType.startsWith(RESERVED_NAMESPACE)) return null;
    const reserved = RESERVED[entry.customType];
    if (reserved === undefined) return `/customType：${RESERVED_NAMESPACE} 命名空间只允许 ${Object.keys(RESERVED).join("、")}`;
    if (reserved.entryType !== entry.type) return `/type：${entry.customType} 必须是 ${reserved.entryType} 条目`;
    const payload = entry.type === "custom" ? entry.data : entry.details;
    const field = entry.type === "custom" ? "data" : "details";
    if (reserved.payload === null) return payload === undefined ? null : `/${field}：${entry.customType} 不带 ${field}`;
    const problem = schemaProblems(reserved.payload, payload);
    if (problem !== null) return `/${field}${problem.startsWith("/") ? problem : `：${problem}`}`;
    if (entry.type === "custom" && entry.customType === "harness/interaction") {
        const data = entry.data as {phase: "request" | "response"; request?: unknown; response?: unknown};
        if (data.phase === "request" && (data.request === undefined || data.response !== undefined)) return "/data：phase 为 request 时必须有 request、不得有 response";
        if (data.phase === "response" && (data.response === undefined || data.request !== undefined)) return "/data：phase 为 response 时必须有 response、不得有 request";
    }
    return null;
}

/** 与已有条目有关的规则：interaction 的阶段顺序与它指向的助手消息、工具调用。 */
export function relationProblem(input: EntryInput, context: EntryContext): string | null {
    if (input.type !== "custom" || input.customType !== "harness/interaction") return null;
    const data = input.data as {interactionId: string; phase: "request" | "response"; request?: {assistantEntryId: string; toolCallId: string}};
    const seen = context.interactions.get(data.interactionId) ?? {request: false, response: false};
    if (data.phase === "request") {
        if (seen.request) return `/data/interactionId：${data.interactionId} 已有 request`;
        const request = data.request as {assistantEntryId: string; toolCallId: string};
        const calls = context.toolCallsByAssistantEntry.get(request.assistantEntryId);
        if (calls === undefined) return `/data/request/assistantEntryId：${request.assistantEntryId} 不是已有的助手消息条目`;
        if (!calls.has(request.toolCallId)) return `/data/request/toolCallId：助手消息 ${request.assistantEntryId} 里没有工具调用 ${request.toolCallId}`;
        return null;
    }
    if (!seen.request) return `/data/interactionId：${data.interactionId} 还没有 request`;
    if (seen.response) return `/data/interactionId：${data.interactionId} 已有 response`;
    return null;
}

/** 条目 id：8 位十六进制随机数，与会话内已有的冲突时重取（与 OMP 相同）。 */
export function newEntryId(taken: ReadonlySet<string>): string {
    for (;;) {
        const bytes = crypto.getRandomValues(new Uint8Array(4));
        const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (!taken.has(id)) return id;
    }
}

export function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const item of Object.values(value as object)) deepFreeze(item);
    return Object.freeze(value);
}

export function completeEntry(input: EntryInput, base: EntryBase): SessionEntry {
    return deepFreeze({...structuredClone(input), ...base}) as SessionEntry;
}

/** 从条目维护校验上下文；日志句柄与存储打开时都用它，保证两边对“已有条目”的判断一致。 */
export function indexEntry(context: {ids: Set<string>; toolCallsByAssistantEntry: Map<string, Set<string>>; interactions: Map<string, {request: boolean; response: boolean}>}, entry: SessionEntry): void {
    context.ids.add(entry.id);
    if (entry.type === "message" && entry.message.role === "assistant") {
        const calls = new Set<string>();
        for (const block of entry.message.content) if (block.type === "toolCall") calls.add(block.id);
        context.toolCallsByAssistantEntry.set(entry.id, calls);
    } else if (entry.type === "custom" && entry.customType === "harness/interaction") {
        const data = entry.data as {interactionId: string; phase: "request" | "response"};
        const seen = context.interactions.get(data.interactionId) ?? {request: false, response: false};
        context.interactions.set(data.interactionId, {...seen, [data.phase]: true});
    }
}

export function headerOf(value: unknown): SessionHeader | null {
    return headerProblem(value) === null ? (value as SessionHeader) : null;
}

/** 从存储读回的一行是否是合法条目（带 id、parentId、timestamp 的完整条目）。 */
export function storedEntryProblem(value: unknown): string | null {
    const base = jsonProblem(value) ?? schemaProblems(EntryBaseSchema, value);
    if (base !== null) return base;
    const {id: _id, parentId: _parentId, timestamp: _timestamp, ...input} = value as SessionEntry;
    return shapeProblem(input);
}
