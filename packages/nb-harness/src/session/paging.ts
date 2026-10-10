/**
 * 分页与按 id 读取（docs/specs/harness/session.md 输出 20–22）。纯函数：不改日志，返回的是截断过的副本。
 *
 * 游标绑定会话 id 与一轮的起点序号。轮的起点由那条条目自己决定（是不是用户发出的消息），追加新条目不会改变旧条目的起点，
 * 所以已发出的游标在追加之后仍然有效（Spec 场景 15）。
 */

import type {Result, SessionEntry, SessionHeader} from "./types";

export type PageCursor = string;
export type TrimmedEntry = {seq: number; entry: SessionEntry; trimmed: {path: string; originalBytes: number}[]};
export type PageOptions = {before?: PageCursor; maxTurns: number; maxBytes: number; fieldBudget: number};
export type Page = {entries: readonly TrimmedEntry[]; next: PageCursor | null; latestSeq: number};

const encoder = new TextEncoder();
const utf8Bytes = (text: string): number => encoder.encode(text).length;

/** 用户发出的消息开始新的一轮（Spec 术语“轮”）：种子、提醒、摘要回放时带 attribution: agent，不算。 */
export function startsTurn(entry: SessionEntry): boolean {
    if (entry.type !== "message" || entry.message.role !== "user") return false;
    return entry.message.attribution !== "agent" && entry.message.synthetic !== true;
}

/** 各轮起点的下标；第一条用户消息之前的条目算第一轮，所以下标 0 总是起点。 */
function turnStarts(entries: readonly SessionEntry[]): number[] {
    const starts: number[] = [];
    entries.forEach((entry, index) => {
        if (index === 0 || startsTurn(entry)) starts.push(index);
    });
    return starts;
}

function encodeCursor(sessionId: string, seq: number): PageCursor {
    return Buffer.from(JSON.stringify({s: sessionId, q: seq}), "utf8").toString("base64url");
}

function decodeCursor(cursor: PageCursor): {s: string; q: number} | null {
    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (typeof parsed !== "object" || parsed === null) return null;
        const {s, q} = parsed as {s?: unknown; q?: unknown};
        return typeof s === "string" && typeof q === "number" && Number.isInteger(q) ? {s, q} : null;
    } catch {
        return null;
    }
}

const codePointBytes = (codePoint: number): number => (codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4);

/** 截到 budget 字节以内，不拆开一个字符。 */
export function truncateUtf8(text: string, budget: number): string {
    let bytes = 0;
    let end = 0;
    for (const char of text) {
        const size = codePointBytes(char.codePointAt(0)!);
        if (bytes + size > budget) break;
        bytes += size;
        end += char.length;
    }
    return text.slice(0, end);
}

type Trims = {path: string; originalBytes: number}[];

function trimString(holder: Record<string, unknown>, key: string, path: string, budget: number, trims: Trims): void {
    const value = holder[key];
    if (typeof value !== "string") return;
    const size = utf8Bytes(value);
    if (size <= budget) return;
    holder[key] = truncateUtf8(value, budget);
    trims.push({path, originalBytes: size});
}

/** 任意深度的字符串都截（工具参数、custom 的 data、custom_message 的 details）。 */
function trimDeep(value: unknown, path: string, budget: number, trims: Trims): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (typeof item === "string") trimString(value as unknown as Record<string, unknown>, String(index), `${path}[${index}]`, budget, trims);
            else trimDeep(item, `${path}[${index}]`, budget, trims);
        });
    } else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === "string") trimString(value as Record<string, unknown>, key, `${path}.${key}`, budget, trims);
            else trimDeep(item, `${path}.${key}`, budget, trims);
        }
    }
}

/** 文本块、思考块截短；图片数据超预算时置空（截一半的 base64 没有意义）；工具调用的参数任意深度都截。 */
function trimBlocks(blocks: unknown[], path: string, budget: number, trims: Trims): void {
    blocks.forEach((block, index) => {
        if (typeof block !== "object" || block === null) return;
        const holder = block as Record<string, unknown>;
        const at = `${path}[${index}]`;
        switch (holder.type) {
            case "text":
                trimString(holder, "text", `${at}.text`, budget, trims);
                break;
            case "thinking":
                trimString(holder, "thinking", `${at}.thinking`, budget, trims);
                break;
            case "image": {
                const data = holder.data;
                if (typeof data === "string" && utf8Bytes(data) > budget) {
                    trims.push({path: `${at}.data`, originalBytes: utf8Bytes(data)});
                    holder.data = "";
                }
                break;
            }
            case "toolCall":
                trimDeep(holder.arguments, `${at}.arguments`, budget, trims);
                break;
            default:
                break;
        }
    });
}

function trimContent(holder: Record<string, unknown>, path: string, budget: number, trims: Trims): void {
    if (typeof holder.content === "string") trimString(holder, "content", path, budget, trims);
    else if (Array.isArray(holder.content)) trimBlocks(holder.content, path, budget, trims);
}

/** 输出 21：只截正文类的位置，类型、角色、各种 id、工具名、customType 原样。 */
export function trimEntry(entry: SessionEntry, budget: number): TrimmedEntry["entry"] & {trimmed: Trims} {
    const copy = structuredClone(entry) as SessionEntry;
    const trims: Trims = [];
    switch (copy.type) {
        case "message":
            trimContent(copy.message as unknown as Record<string, unknown>, "message.content", budget, trims);
            break;
        case "custom_message":
            trimContent(copy as unknown as Record<string, unknown>, "content", budget, trims);
            trimDeep(copy.details, "details", budget, trims);
            break;
        case "custom":
            trimDeep(copy.data, "data", budget, trims);
            break;
        case "compaction":
            trimString(copy as unknown as Record<string, unknown>, "summary", "summary", budget, trims);
            break;
        default:
            break;
    }
    return Object.assign(copy, {trimmed: trims});
}

export function readPage(session: {header: SessionHeader; entries: readonly SessionEntry[]}, options: PageOptions): Result<Page> {
    const {entries} = session;
    const starts = turnStarts(entries);
    let end = entries.length;
    if (options.before !== undefined) {
        const cursor = decodeCursor(options.before);
        if (cursor === null) return {ok: false, code: "invalid-cursor", detail: "游标格式不对"};
        if (cursor.s !== session.header.id) return {ok: false, code: "invalid-cursor", detail: `游标属于会话 ${cursor.s}，不是 ${session.header.id}`};
        if (cursor.q < 1 || cursor.q > entries.length) return {ok: false, code: "invalid-cursor", detail: `游标位置 ${cursor.q} 超出当前条目`};
        if (!starts.includes(cursor.q - 1)) return {ok: false, code: "invalid-cursor", detail: `游标位置 ${cursor.q} 不是一轮的起点`};
        end = cursor.q - 1;
    }

    const page: TrimmedEntry[] = [];
    let turns = 0;
    let bytes = 0;
    let earliestStart = end;
    for (let index = starts.length - 1; index >= 0; index -= 1) {
        const start = starts[index]!;
        if (start >= end) continue;
        const stop = index + 1 < starts.length ? Math.min(starts[index + 1]!, end) : end;
        const turn: TrimmedEntry[] = [];
        let turnBytes = 0;
        for (let position = start; position < stop; position += 1) {
            const {trimmed, ...entry} = trimEntry(entries[position]!, options.fieldBudget);
            turnBytes += utf8Bytes(JSON.stringify(entry));
            turn.push({seq: position + 1, entry: entry as SessionEntry, trimmed});
        }
        // 至少一轮：最近的一轮单独超过预算时整轮成页（输出 20）。
        if (turns > 0 && (turns + 1 > options.maxTurns || bytes + turnBytes > options.maxBytes)) break;
        page.unshift(...turn);
        turns += 1;
        bytes += turnBytes;
        earliestStart = start;
    }
    return {
        ok: true,
        value: {entries: page, next: earliestStart > 0 && page.length > 0 ? encodeCursor(session.header.id, earliestStart + 1) : null, latestSeq: entries.length},
    };
}

export function readEntry(entries: readonly SessionEntry[], id: string): Result<{seq: number; entry: SessionEntry}> {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return {ok: false, code: "entry-not-found", detail: `没有 id 为 ${id} 的条目`};
    return {ok: true, value: {seq: index + 1, entry: entries[index]!}};
}
