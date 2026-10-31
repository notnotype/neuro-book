/** 会话列表用的索引 `index.json`：由事件算出，只是缓存；与日志对不上时按日志重建（session.md 输出 19）。 */

import type {LogEvent, SessionHeader, SessionIndexEntry} from "../api/index.js";

export function emptyIndex(header: SessionHeader): SessionIndexEntry {
    return {
        id: header.id,
        profile: header.profile,
        ...(header.project === undefined ? {} : {project: header.project}),
        title: null,
        archived: false,
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
            title: event.type === "titleChanged" ? (data.title as string) : next.title,
            archived: event.type === "archived" ? (data.archived as boolean) : next.archived,
            turns: event.type === "turnStarted" ? next.turns + 1 : next.turns,
            lastActivityAt: Math.max(next.lastActivityAt, event.at),
            throughSeq: event.seq,
        };
    }
    return next;
}

export function parseIndex(bytes: Uint8Array | null): SessionIndexEntry | null {
    if (bytes === null) return null;
    try {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as SessionIndexEntry;
        return typeof value === "object" && value !== null && typeof value.throughSeq === "number" ? value : null;
    } catch {
        // 索引只是缓存：读不懂就当没有，调用方按日志重建并写诊断 index-rebuilt。
        return null;
    }
}
