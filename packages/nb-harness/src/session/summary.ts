import type {SessionEntry, SessionHeader, SessionSummary} from "./types";

/** 会话摘要（docs/specs/harness/session.md 输出 17）；两种存储共用，list 的结果才一致。 */
export function summaryOf(header: SessionHeader, entries: readonly SessionEntry[]): SessionSummary {
    const title = entries.filter((entry) => entry.type === "title_change").at(-1);
    const last = entries.at(-1);
    return {
        id: header.id,
        createdAt: header.createdAt,
        ...(header.parentSession === undefined ? {} : {parentSession: header.parentSession}),
        ...(title === undefined ? {} : {title: title.title}),
        updatedAt: last?.timestamp ?? header.createdAt,
    };
}
