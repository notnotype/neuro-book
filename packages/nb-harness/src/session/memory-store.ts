/**
 * 内存存储。保存的是每个条目的 JSON 文本而不是对象：读回的值与 JSONL 存储一样经过 JSON 往返，
 * 两种存储对 Spec 输出 1–11、17、19 的行为才会一致（输出 18）。
 */

import {isValidSessionId} from "./entries";
import {summaryOf} from "./summary";
import type {Result, SessionEntry, SessionFailure, SessionHeader, SessionStore, SessionSummary} from "./types";

export function createMemorySessionStore(): SessionStore {
    const sessions = new Map<string, {header: string; lines: string[]}>();
    const fail = <T>(code: SessionFailure, detail: string): Result<T> => ({ok: false, code, detail});

    return {
        async create(header) {
            if (!isValidSessionId(header.id)) return fail("invalid-session-id", `会话 id 不合规则：${header.id}`);
            if (sessions.has(header.id)) return fail("session-exists", `会话已存在：${header.id}`);
            sessions.set(header.id, {header: JSON.stringify(header), lines: []});
            return {ok: true, value: undefined};
        },
        async open(id) {
            if (!isValidSessionId(id)) return fail("invalid-session-id", `会话 id 不合规则：${id}`);
            const session = sessions.get(id);
            if (session === undefined) return fail("session-not-found", `会话不存在：${id}`);
            return {
                ok: true,
                value: {header: JSON.parse(session.header) as SessionHeader, entries: session.lines.map((line) => JSON.parse(line) as SessionEntry), damagedTail: null},
            };
        },
        async append(id, entries) {
            const session = sessions.get(id);
            if (session === undefined) return fail("session-not-found", `会话不存在：${id}`);
            for (const entry of entries) session.lines.push(JSON.stringify(entry));
            return {ok: true, value: undefined};
        },
        async repair(id) {
            if (!sessions.has(id)) return fail("session-not-found", `会话不存在：${id}`);
            return {ok: true, value: {droppedBytes: 0}};
        },
        async list() {
            const summaries: SessionSummary[] = [];
            for (const session of sessions.values()) {
                summaries.push(summaryOf(JSON.parse(session.header) as SessionHeader, session.lines.map((line) => JSON.parse(line) as SessionEntry)));
            }
            return {ok: true, value: summaries};
        },
    };
}
