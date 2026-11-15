/**
 * 模型请求查看器的核心（docs/specs/agent/request-trace.md 输出 14、15）：列表的分组与新记录进不进当前筛选。
 */

import {describe, expect, it} from "bun:test";

import {cacheHitRate, formatCost, formatDuration, formatTokens, groupRequests, matchesQuery} from "./request-trace";
import type {RequestTraceRow} from "./request-trace";

let counter = 0;
function row(fields: Partial<RequestTraceRow> = {}): RequestTraceRow {
    counter += 1;
    return {id: `r${String(counter)}`, session: "s1", request: counter, purpose: "turn", model: "deepseek/flash", startedAt: 1000 - counter, status: "ok", toolsChanged: false, attempts: 1, ...fields};
}

const turn = (id: string, index: number, input?: string) => ({id, index, ...(input === undefined ? {} : {input})});

describe("分组（输出 14）", () => {
    it("相邻、同一会话同一轮的请求合成一组；几个会话交错时组也交错，不先按会话聚拢", () => {
        const rows = [
            row({turn: turn("t2", 2, "改写第二章")}),
            row({turn: turn("t2", 2, "改写第二章")}),
            row({session: "s2", title: "人物小传", turn: turn("u1", 1)}),
            row({turn: turn("t2", 2, "改写第二章")}),
        ];
        const groups = groupRequests(rows);
        expect(groups.map((group) => [group.session, group.turn?.index, group.rows.length])).toEqual([["s1", 2, 2], ["s2", 1, 1], ["s1", 2, 1]]);
        expect(groups[0]?.startedAt).toBe(Math.min(rows[0]!.startedAt, rows[1]!.startedAt));
        expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length);
    });

    it("回退之后同一个序号的两轮 id 不同，各成一组", () => {
        const groups = groupRequests([row({turn: turn("again", 3)}), row({turn: turn("first", 3)})]);
        expect(groups.map((group) => group.turn?.id)).toEqual(["again", "first"]);
    });

    it("后台标题会话的请求归到所属会话的“后台”组；找不到所属的单独一组；轮外的请求各自成组", () => {
        const groups = groupRequests([
            row({session: "session-title-1", background: {owner: "s1"}, turn: turn("bt", 1), title: "雨夜"}),
            row({session: "session-title-2", background: {owner: null}, turn: turn("bt2", 1)}),
            row({purpose: "compaction"}),
            row({purpose: "compaction"}),
        ]);
        expect(groups.map((group) => [group.session, group.background, group.turn, group.title])).toEqual([
            ["s1", true, null, "雨夜"],
            ["session-title-2", true, null, undefined],
            ["s1", false, null, undefined],
            ["s1", false, null, undefined],
        ]);
    });
});

describe("新记录进不进当前筛选（输出 15）", () => {
    it("筛选一个会话时连它的后台请求一起；状态里的“重发过”“缓存没命中”是附加的条件", () => {
        const background = row({session: "session-title-1", background: {owner: "s1"}});
        expect(matchesQuery(background, {sessions: ["s1"]})).toBe(true);
        expect(matchesQuery(row({session: "s2"}), {sessions: ["s1"]})).toBe(false);
        expect(matchesQuery(row({resend: 2, status: "error"}), {statuses: ["resend"]})).toBe(true);
        expect(matchesQuery(row({usage: {input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: null}}), {statuses: ["cache-miss"]})).toBe(true);
        expect(matchesQuery(row({usage: {input: 10, output: 1, cacheRead: 90, cacheWrite: 0, cost: null}}), {statuses: ["cache-miss"]})).toBe(false);
        expect(matchesQuery(row({purpose: "approval"}), {purposes: ["turn", "compaction"]})).toBe(false);
        expect(matchesQuery(row({startedAt: 5}), {since: 10})).toBe(false);
        expect(matchesQuery(row(), {sessions: [], statuses: []})).toBe(true);
    });
});

describe("数值的写法", () => {
    it("token、用时、费用与缓存命中", () => {
        expect([formatTokens(980), formatTokens(1234), formatTokens(45_600), formatTokens(2_300_000)]).toEqual(["980", "1.2k", "46k", "2.3M"]);
        expect([formatDuration(850), formatDuration(12_340), formatDuration(125_000)]).toEqual(["850ms", "12.3s", "2m 05s"]);
        expect([formatCost(null), formatCost(0.00123), formatCost(1.5)]).toEqual([null, "$0.0012", "$1.50"]);
        // OMP 的 `input` 不含缓存的部分：命中率按全部输入算。
        expect(cacheHitRate({input: 20, output: 5, cacheRead: 60, cacheWrite: 20, cost: null})).toBe(0.6);
        expect(cacheHitRate({input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null})).toBeNull();
    });
});
