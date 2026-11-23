/** 会话列表用的索引 `index.json`：由事件算出，只是缓存；与日志对不上时按日志重建（session.md 输出 19）。 */

import {replyText, runLine, type ContentBlock, type EventData, type IndexedRun, type KernelEvents, type LogEvent, type SessionHeader, type SessionIndexEntry, type Usage} from "../api/index.js";

/** 索引留几次运行的收口：子代理卡片按 `runId` 找终态用，不必保留全部。 */
const INDEXED_RUNS = 20;

/**
 * 折叠索引的状态：索引本身，加上跨批次带着、不写进 `index.json` 的“这次运行到目前为止最后一条回复的文字”，收口时按 `runLine`
 * 算成 `runs[].line`（与子代理工具结果的取法相同）。回复与收口常在不同的批里写下，所以要带着；打开会话时从全部事件重折
 * （`jsonl-store.ts`），重启之后照样对得上。
 *
 * 折叠按写下的先后，不按路径：回退到运行中途接着跑（`runResumed`）时清空，接着跑的回复从头记；接着跑之前就收口的，
 * 首句可能缺，不会取到被丢下的那条分支上的。
 */
export interface IndexFold {
    readonly index: SessionIndexEntry;
    readonly reply: string | null;
}

export const startFold = (header: SessionHeader): IndexFold => ({index: emptyIndex(header), reply: null});

export function emptyIndex(header: SessionHeader): SessionIndexEntry {
    return {
        id: header.id,
        profile: header.profile,
        ...(header.project === undefined ? {} : {project: header.project}),
        title: null,
        description: null,
        archived: false,
        background: header.background === true,
        ...(header.caller === undefined ? {} : {caller: header.caller}),
        ...(header.owner === undefined ? {} : {owner: header.owner}),
        ...(header.origin === undefined ? {} : {origin: header.origin.session}),
        spend: {cost: 0, unpriced: 0},
        runs: [],
        createdAt: header.createdAt,
        lastActivityAt: header.createdAt,
        turns: 0,
        throughSeq: 0,
    };
}

/** 不算会话活动的事件：后台发来的提醒与门（session.md 输出 19），连同发提醒、撤回提醒的受理记录，免得把没人动过的会话顶到列表前面。 */
const QUIET: ReadonlySet<string> = new Set(["noticeQueued", "noticeRemoved", "noticeTaken", "wakeGate"]);
const QUIET_COMMANDS: ReadonlySet<string> = new Set(["notice", "removeNotice"]);
const quiet = (event: LogEvent): boolean => QUIET.has(event.type) || (event.type === "commandAccepted" && QUIET_COMMANDS.has((event.data as {name?: string}).name ?? ""));

export function advanceIndex(fold: IndexFold, events: readonly LogEvent[]): IndexFold {
    let next = fold.index;
    let reply = fold.reply;
    for (const event of events) {
        const data = event.data as Record<string, unknown>;
        if (event.type === "runStarted" || event.type === "runResumed") reply = null;
        else if (event.type === "assistant") reply = replyText(data.content as readonly ContentBlock[]);
        next = {
            ...next,
            ...spendAfter(next, event),
            ...runsAfter(next, event, reply),
            title: event.type === "titleChanged" ? (data.title as string) : next.title,
            description: event.type === "descriptionChanged" ? (data.description as string) : next.description,
            archived: event.type === "archived" ? (data.archived as boolean) : next.archived,
            turns: event.type === "turnStarted" ? next.turns + 1 : next.turns,
            lastActivityAt: quiet(event) ? next.lastActivityAt : Math.max(next.lastActivityAt, event.at),
            throughSeq: event.seq,
        };
    }
    return {index: next, reply};
}

/** 花费与快照的 `ctx.spend` 同一口径：这三种事件的 `usage`，单价未知的计数（runtime.md 输出 70）。 */
function spendAfter(index: SessionIndexEntry, event: LogEvent): Pick<SessionIndexEntry, "spend"> | null {
    if (event.type !== "assistant" && event.type !== "modelEnded" && event.type !== "modelFailed") return null;
    const usage = (event.data as {usage?: Usage}).usage;
    if (usage === undefined) return null;
    const spend = index.spend ?? {cost: 0, unpriced: 0};
    return {spend: {cost: spend.cost + (usage.cost ?? 0), unpriced: spend.unpriced + (usage.cost === null ? 1 : 0)}};
}

function runsAfter(index: SessionIndexEntry, event: LogEvent, reply: string | null): Pick<SessionIndexEntry, "runs"> | null {
    if (event.type !== "runEnded") return null;
    const data = event.data as EventData<KernelEvents["runEnded"]>;
    const line = runLine(reply ?? "", data.result);
    const run: IndexedRun = {runId: data.runId, reason: data.reason, endedAt: event.at, ...(line === undefined ? {} : {line})};
    return {runs: [...(index.runs ?? []), run].slice(-INDEXED_RUNS)};
}

/** 这份索引是加 `spend`、`runs` 之前写的：打开会话时按日志重建。 */
export const predatesRunIndex = (index: SessionIndexEntry): boolean => index.spend === undefined || index.runs === undefined;

export function parseIndex(bytes: Uint8Array | null): SessionIndexEntry | null {
    if (bytes === null) return null;
    try {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as Omit<SessionIndexEntry, "background" | "description"> & {background?: boolean; description?: string | null};
        if (typeof value !== "object" || value === null || typeof value.throughSeq !== "number") return null;
        // 加 `background`、`description` 之前写下的索引没有它们：那时还没有后台会话，也没有说明，列表照样列得出来、不必先打开。
        return {...value, background: value.background === true, description: value.description ?? null};
    } catch {
        // 索引只是缓存：读不懂就当没有，调用方按日志重建并写诊断 index-rebuilt。
        return null;
    }
}
