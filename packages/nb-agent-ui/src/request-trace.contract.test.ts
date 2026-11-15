/**
 * 查看器的视图类型与真实记录器对契约：用 nb-harness 的记录器（真实目录）记几次请求，把它交出的行与详情原样交给核心。
 * 类型上核对 nb-harness 的形状能赋给这里按结构声明的类型；nb-harness 只是开发依赖，核心不依赖它（`boundary.test.ts`）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {RequestRecorder, traceModelPort} from "@notnotype/nb-harness/kit/requests";
import type {RequestDetail, RequestPage, RequestRow} from "@notnotype/nb-harness/kit/requests";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {groupRequests, matchesQuery} from "./request-trace";
import type {RequestTraceDetail, RequestTraceFacets, RequestTraceRow, RequestTraceTotals} from "./request-trace";

// 编译期核对：nb-harness 交出的形状（宿主补上 `messagesNext` 等字段之后）能赋给这里的类型。
const rowFits: (row: RequestRow) => RequestTraceRow = (value) => value;
const detailFits: (detail: RequestDetail) => RequestTraceDetail = (value) => ({...value, messagesNext: null});
const totalsFit: (page: RequestPage) => RequestTraceTotals = (page) => page.totals;
const facetsFit: (page: RequestPage) => RequestTraceFacets = (page) => page.facets;
void [rowFits, detailFits, totalsFit, facetsFit];

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-agent-ui", "request-trace-contract");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe("与真实记录器对契约", () => {
    it("记录器交出的行按会话的轮分组，详情的大纲能直接显示", async () => {
        const recorder = new RequestRecorder({root: join(root, "trace"), settings: () => ({enabled: true, payload: true, headers: false}), report: () => undefined});
        await recorder.open();
        const port = traceModelPort({resolve: () => ({
            ok: true,
            info: {id: "test/model", contextWindow: 100_000, capabilities: {vision: false, thinking: false}, efforts: []},
            call: async () => ({content: [{kind: "text", text: "好的"}], toolCalls: [], stopReason: "stop", usage: {input: 10, output: 2, cacheRead: 30, cacheWrite: 0, cost: 0.001, complete: true}, model: "test/model"}),
        })}, recorder);
        const resolution = port.resolve({settings: {model: null, effort: null, approvalMode: "ask", readOnly: false}, purpose: "turn", profile: "p"});
        if (!resolution.ok) throw new Error(resolution.code);
        for (const number of [1, 2]) {
            await resolution.call({purpose: "turn", model: "test/model", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "写第一章", origin: {kind: "fixed", by: "kernel"}}]}], tools: []}, new AbortController().signal, () => undefined, {session: "s1", request: number, hash: `h${String(number)}`, turn: {id: "t1", index: 1, input: "写第一章"}});
        }
        const page = await waitUntil("两条记录结束", async () => {
            const listed = await recorder.list();
            return listed.rows.every((item) => item.status === "ok") && listed.rows.length === 2 ? listed : null;
        });

        const groups = groupRequests(page.rows);
        expect(groups.map((group) => [group.session, group.turn?.input, group.rows.map((item) => item.request)])).toEqual([["s1", "写第一章", [2, 1]]]);
        expect(page.rows.every((item) => matchesQuery(item, {sessions: ["s1"], statuses: ["ok"]}))).toBe(true);
        const detail = await recorder.read(page.rows[0]?.id ?? "");
        expect(detail?.messages.map((message) => [message.role, message.preview])).toEqual([["user", "写第一章"]]);
        await recorder.close();
    });
});
