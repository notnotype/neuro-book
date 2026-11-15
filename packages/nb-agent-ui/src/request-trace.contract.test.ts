/**
 * 查看器的视图类型与真实记录器对契约：用 nb-harness 的记录器（真实目录）记几次请求，把它交出的行与详情原样交给核心。
 * 类型上核对 nb-harness 的形状能赋给这里按结构声明的类型；nb-harness 只是开发依赖，核心不依赖它（`boundary.test.ts`）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {RequestRecorder, searchablePieces, traceModelPort} from "@notnotype/nb-harness/kit/requests";
import type {RequestDetail, RequestPage, RequestRow} from "@notnotype/nb-harness/kit/requests";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contentPieces, groupRequests, highlightSegments, matchesQuery} from "./request-trace";
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

        // 查找条按显示的文字数处数：与记录器查找用的文字逐字相同，处数也就相同。
        const stored = await recorder.content(detail?.messages[0]?.hash ?? "") ?? "";
        const shown = contentPieces(stored).filter((piece) => piece.kind !== "image").map((piece) => piece.text);
        expect(shown).toEqual(searchablePieces(JSON.parse(stored)));
        const counted = shown.flatMap((text) => highlightSegments(text, "第一").filter((segment) => segment.ordinal !== null)).length;
        expect(counted).toBe((await recorder.hits(detail?.id ?? "", "第一"))?.filter((hit) => hit.item === 0).length ?? -1);
        await recorder.close();
    });

    it("各种内容（系统提示词、思考、工具调用与结果、工具声明、带调用的回复、图片）显示的几段与查找用的逐字相同，每条的处数与记录器一致", async () => {
        const recorder = new RequestRecorder({root: join(root, "shapes"), settings: () => ({enabled: true, payload: false, headers: false}), report: () => undefined});
        await recorder.open();
        const search = {id: "story.search", description: "查雾港的资料。\n第二行。", parameters: {type: "object", properties: {query: {type: "string", description: "雾港之类的词"}}}, provider: "builtin", version: "1", finish: false, concurrency: "shared", strict: false, effect: "read"} as const;
        const port = traceModelPort({resolve: () => ({
            ok: true,
            info: {id: "test/model", contextWindow: 100_000, capabilities: {vision: true, thinking: true}, efforts: []},
            call: async () => ({content: [{kind: "text", text: "雾港在第三章；İstanbul 雾港"}], toolCalls: [{id: "c2", tool: "story.search", args: {query: "雾港 第四章"}}], stopReason: "tool", usage: {input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: null, complete: true}, model: "test/model"}),
        })}, recorder);
        const resolution = port.resolve({settings: {model: null, effort: null, approvalMode: "ask", readOnly: false}, purpose: "turn", profile: "p"});
        if (!resolution.ok) throw new Error(resolution.code);
        const fixed = {kind: "fixed", by: "kernel"} as const;
        await resolution.call({
            purpose: "turn", model: "test/model", params: {}, headers: {}, tools: [search],
            system: [{kind: "text", text: "你是写作助手。雾港是地名。", origin: {kind: "fixed", by: "profile"}}, {kind: "text", text: "第二段：İSTANBUL 与雾港", origin: fixed}],
            messages: [
                {role: "user", content: [{kind: "text", text: "讲讲雾港", origin: fixed}, {kind: "image", data: "QUJD", mime: "image/png", origin: fixed}, {kind: "text", text: "图里也是雾港", origin: fixed}]},
                {role: "assistant", content: [{kind: "thinking", text: "先查雾港", origin: fixed}, {kind: "text", text: "我查一下。", origin: fixed}], toolCalls: [{id: "c1", tool: "story.search", args: {query: "雾港"}}], model: "test/model"},
                {role: "tool", callId: "c1", content: [{kind: "text", text: "雾港：第三章出现。", origin: fixed}]},
            ],
        }, new AbortController().signal, () => undefined, {session: "s2", request: 1, hash: "h1"});
        const [row] = await waitUntil("记录结束", async () => {
            const listed = await recorder.list();
            return listed.rows[0]?.status === "ok" ? listed.rows : null;
        });
        const detail = await recorder.read(row?.id ?? "");
        if (detail === null) throw new Error("没有详情");
        const items = [
            ...detail.messages.map((message, item) => ({page: "messages" as const, item, hash: message.hash})),
            ...(detail.reply === undefined ? [] : [{page: "messages" as const, item: detail.messages.length, hash: detail.reply.hash}]),
            ...detail.system.map((block, item) => ({page: "system" as const, item, hash: block.hash})),
            ...detail.tools.map((tool, item) => ({page: "tools" as const, item, hash: tool.hash})),
        ];
        expect(items.length).toBe(3 + 1 + 2 + 1);
        for (const needle of ["雾港", "stanbul", "\"query\"", "第四章"]) {
            const hits = await recorder.hits(detail.id, needle) ?? [];
            expect([needle, hits.length > 0]).toEqual([needle, true]);
            for (const {page, item, hash} of items) {
                const stored = await recorder.content(hash) ?? "";
                const shown = contentPieces(stored).filter((piece) => piece.kind !== "image").map((piece) => piece.text);
                expect(shown).toEqual(searchablePieces(JSON.parse(stored)));
                const counted = shown.flatMap((text) => highlightSegments(text, needle).filter((segment) => segment.ordinal !== null)).length;
                expect([needle, page, item, counted]).toEqual([needle, page, item, hits.filter((hit) => hit.page === page && hit.item === item).length]);
            }
        }
        // 高亮切出的是原文里的字（小写后变长的字符不让它错位）。
        expect(highlightSegments("第二段：İSTANBUL 与雾港", "雾港").find((segment) => segment.ordinal !== null)?.text).toBe("雾港");
        await recorder.close();
    });
});
