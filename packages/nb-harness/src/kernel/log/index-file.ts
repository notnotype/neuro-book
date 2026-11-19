/** 会话列表用的索引 `index.json`：由事件算出，只是缓存；与日志对不上时按日志重建（session.md 输出 19）。 */

import type {IndexedRun, LogEvent, SessionHeader, SessionIndexEntry, Usage} from "../api/index.js";

/** 索引留几次运行的收口：子代理卡片按 `runId` 找终态用，不必保留全部。 */
const INDEXED_RUNS = 20;

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

export function advanceIndex(index: SessionIndexEntry, events: readonly LogEvent[]): SessionIndexEntry {
    let next = index;
    for (const event of events) {
        const data = event.data as Record<string, unknown>;
        next = {
            ...next,
            ...spendAfter(next, event),
            ...runsAfter(next, event),
            title: event.type === "titleChanged" ? (data.title as string) : next.title,
            description: event.type === "descriptionChanged" ? (data.description as string) : next.description,
            archived: event.type === "archived" ? (data.archived as boolean) : next.archived,
            turns: event.type === "turnStarted" ? next.turns + 1 : next.turns,
            lastActivityAt: Math.max(next.lastActivityAt, event.at),
            throughSeq: event.seq,
        };
    }
    return next;
}

/** 花费与快照的 `ctx.spend` 同一口径：这三种事件的 `usage`，单价未知的计数（runtime.md 输出 70）。 */
function spendAfter(index: SessionIndexEntry, event: LogEvent): Pick<SessionIndexEntry, "spend"> | null {
    if (event.type !== "assistant" && event.type !== "modelEnded" && event.type !== "modelFailed") return null;
    const usage = (event.data as {usage?: Usage}).usage;
    if (usage === undefined) return null;
    const spend = index.spend ?? {cost: 0, unpriced: 0};
    return {spend: {cost: spend.cost + (usage.cost ?? 0), unpriced: spend.unpriced + (usage.cost === null ? 1 : 0)}};
}

function runsAfter(index: SessionIndexEntry, event: LogEvent): Pick<SessionIndexEntry, "runs"> | null {
    if (event.type !== "runEnded") return null;
    const data = event.data as {runId: string; reason: string};
    const run: IndexedRun = {runId: data.runId, reason: data.reason, endedAt: event.at};
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
