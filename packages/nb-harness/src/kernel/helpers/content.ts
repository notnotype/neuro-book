/**
 * `mapEventContent()`：出站过滤用，按字段换掉一条事件里给人或模型看的内容（用户的话、回复、工具参数与结果、摘要、标题……），
 * 宿主只写“对一段文字怎么办”，不必自己列全哪些事件的哪些字段带内容（docs/specs/harness/runtime.md 输出 54）。
 *
 * 内核事件按 `CONTENT_FIELDS` 逐个处理；表的类型要求每个内核事件都登记，内核加事件时编译不过，逼着把带内容的字段补上。
 * 扩展自己的事件内核不知道形状：整份 `data` 交给 `data`（缺省把其中每个字符串交给 `text`）。
 */

import type {JsonValue, KernelEventName, LogEvent} from "../api/index.js";

export interface ContentWhere {
    /** 事件类型。 */
    readonly type: string;
    /** 字段，例如 `input.text`、`content`、`toolCalls.args`、`result.value`。 */
    readonly field: string;
}

export interface ContentMap {
    /** 一段文字；返回换掉之后的。 */
    text(text: string, where: ContentWhere): string | Promise<string>;
    /** 一次工具调用的参数（`assistant.toolCalls[].args`、`toolStarted.args`、收尾工具交的结果）。缺省把其中每个字符串交给 `text`。 */
    args?(args: Readonly<Record<string, JsonValue>>, where: ContentWhere & {readonly tool: string; readonly callId: string | null}): Readonly<Record<string, JsonValue>> | Promise<Readonly<Record<string, JsonValue>>>;
    /** 结构化数据（初始输入、`payload`、`details`、提问与回答、扩展事件）。缺省把其中每个字符串交给 `text`。 */
    data?(value: JsonValue, where: ContentWhere): JsonValue | Promise<JsonValue>;
}

type Mapper = (data: Record<string, unknown>, map: Required<ContentMap>, type: string) => Promise<Record<string, unknown>>;

/** 每个内核事件带内容的字段；`null` 表示不带内容（只有 id、码、计数这类）。 */
const CONTENT_FIELDS: Record<KernelEventName, Mapper | null> = {
    sessionCreated: async (data, map, type) => ({...data, initial: await map.data(data.initial as JsonValue, {type, field: "initial"})}),
    inputQueued: async (data, map, type) => queued(data, map, type),
    inputEdited: async (data, map, type) => queued(data, map, type),
    inputRemoved: null,
    inputConsumed: null,
    commandAccepted: null,
    settingsChanged: null,
    leafChanged: null,
    profileChanged: null,
    approvalRemembered: null,
    titleChanged: async (data, map, type) => ({...data, title: await map.text(data.title as string, {type, field: "title"})}),
    archived: null,
    runStarted: null,
    runEnded: async (data, map, type) => {
        const result = data.result as {via: "tool" | "text"; tool?: string; value: JsonValue} | undefined;
        if (result === undefined) return data;
        const value = result.via === "tool" && typeof result.value === "object" && result.value !== null && !Array.isArray(result.value)
            ? await map.args(result.value as Readonly<Record<string, JsonValue>>, {type, field: "result.value", tool: result.tool ?? "", callId: null})
            : await map.data(result.value, {type, field: "result.value"});
        return {...data, result: {...result, value}};
    },
    turnStarted: null,
    turnEnded: null,
    input: async (data, map, type) => said(data, map, type),
    steer: async (data, map, type) => said(data, map, type),
    assistant: async (data, map, type) => ({
        ...data,
        content: await blocks(data.content as readonly Record<string, unknown>[], map, type, "content"),
        toolCalls: await Promise.all((data.toolCalls as readonly {id: string; tool: string; args: Readonly<Record<string, JsonValue>>}[]).map(async (call) => ({...call, args: await map.args(call.args, {type, field: "toolCalls.args", tool: call.tool, callId: call.id})}))),
    }),
    continued: async (data, map, type) => ({...data, text: await map.text(data.text as string, {type, field: "text"})}),
    notice: async (data, map, type) => ({...data, text: await map.text(data.text as string, {type, field: "text"})}),
    modelStarted: null,
    modelEnded: null,
    modelFailed: async (data, map, type) => ({
        ...data,
        ...(data.message === undefined ? {} : {message: await map.text(data.message as string, {type, field: "message"})}),
        ...(data.partial === undefined ? {} : {partial: await blocks(data.partial as readonly Record<string, unknown>[], map, type, "partial")}),
    }),
    toolsAnnounced: null,
    toolStarted: async (data, map, type) => ({...data, args: await map.args(data.args as Readonly<Record<string, JsonValue>>, {type, field: "args", tool: data.tool as string, callId: data.callId as string})}),
    toolResult: async (data, map, type) => ({
        ...data,
        text: await map.text(data.text as string, {type, field: "text"}),
        ...(data.raw === undefined ? {} : {raw: await map.text(data.raw as string, {type, field: "raw"})}),
        ...(data.details === undefined ? {} : {details: await map.data(data.details as JsonValue, {type, field: "details"})}),
    }),
    interactionRequested: async (data, map, type) => ({...data, request: await map.data(data.request as JsonValue, {type, field: "request"})}),
    interactionResolved: async (data, map, type) => ({
        ...data,
        ...(data.data === undefined ? {} : {data: await map.data(data.data as JsonValue, {type, field: "data"})}),
        ...(data.note === undefined ? {} : {note: await map.text(data.note as string, {type, field: "note"})}),
    }),
    compaction: async (data, map, type) => ({
        ...data,
        replacement: data.replacement === null ? null : await map.text(data.replacement as string, {type, field: "replacement"}),
        omitted: await Promise.all((data.omitted as readonly {entryId: string; placeholder: string}[]).map(async (item) => ({...item, placeholder: await map.text(item.placeholder, {type, field: "omitted.placeholder"})}))),
        ...(data.details === undefined ? {} : {details: await map.data(data.details as JsonValue, {type, field: "details"})}),
    }),
    extensionFailed: null,
    reactionLimit: null,
};

async function queued(data: Record<string, unknown>, map: Required<ContentMap>, type: string): Promise<Record<string, unknown>> {
    const input = data.input as {text: string; payload?: JsonValue};
    return {
        ...data,
        input: {...input, text: await map.text(input.text, {type, field: "input.text"}), ...(input.payload === undefined ? {} : {payload: await map.data(input.payload, {type, field: "input.payload"})})},
        ...(data.original === undefined ? {} : {original: await map.text(data.original as string, {type, field: "original"})}),
    };
}

async function said(data: Record<string, unknown>, map: Required<ContentMap>, type: string): Promise<Record<string, unknown>> {
    return {...data, text: await map.text(data.text as string, {type, field: "text"}), ...(data.payload === undefined ? {} : {payload: await map.data(data.payload as JsonValue, {type, field: "payload"})})};
}

async function blocks(list: readonly Record<string, unknown>[], map: Required<ContentMap>, type: string, field: string): Promise<Record<string, unknown>[]> {
    return Promise.all(list.map(async (block) => (typeof block.text === "string" ? {...block, text: await map.text(block.text, {type, field})} : block)));
}

/** 把值里的每个字符串交给 `text`（键不动）。 */
async function eachString(value: JsonValue, text: (value: string) => string | Promise<string>): Promise<JsonValue> {
    if (typeof value === "string") return await text(value);
    if (Array.isArray(value)) return Promise.all(value.map((item) => eachString(item, text)));
    if (value !== null && typeof value === "object") {
        const out: Record<string, JsonValue> = {};
        for (const [key, child] of Object.entries(value)) out[key] = await eachString(child, text);
        return out;
    }
    return value;
}

/** 换掉一条事件里的内容，交回新事件（不改原来的：日志里的事件是冻结的）。 */
export async function mapEventContent(event: LogEvent, map: ContentMap): Promise<LogEvent> {
    const full: Required<ContentMap> = {
        text: map.text,
        args: map.args ?? (async (args, where) => (await eachString(args as JsonValue, (value) => map.text(value, where))) as Record<string, JsonValue>),
        data: map.data ?? ((value, where) => eachString(value, (text) => map.text(text, where))),
    };
    const mapper = Object.hasOwn(CONTENT_FIELDS, event.type) ? CONTENT_FIELDS[event.type as KernelEventName] : undefined;
    if (mapper === null) return event;
    if (mapper === undefined) return {...event, data: await full.data(event.data as JsonValue, {type: event.type, field: "data"})};
    return {...event, data: (await mapper(event.data as Record<string, unknown>, full, event.type)) as JsonValue};
}
