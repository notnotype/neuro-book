/**
 * 会话累计的费用与请求序号（docs/specs/harness/runtime.md 输出 6、70、71）。
 */

import {describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {defineExtension} from "../extension/define.js";
import type {ApproveHook, LogEvent, Spend} from "../api/index.js";
import {createTestSession} from "../testing/test-session.js";

const data = <T>(events: readonly LogEvent[], type: string): T[] => events.filter((event) => event.type === type).map((event) => event.data as T);
let commands = 0;
const id = () => `c-${(commands += 1)}`;

describe("输出 70：会话累计的费用", () => {
    test("回复、失败的用量都算；单价未知只数次数；回退不减；重开后还在", async () => {
        await using session = await createTestSession();
        session.model.script({text: "一", usage: {cost: 2}});
        await session.say("第一问");
        session.model.script({text: "二", usage: {cost: null}});
        await session.say("第二问");
        session.model.script({fail: "provider", usage: {cost: 3}});
        await session.say("第三问");
        expect((await session.raw.snapshot()).usage).toEqual({cost: 5, unpriced: 1});

        const target = (await session.raw.rewindTargets()).find((item) => item.kind === "before-turn" && item.inputText === "第二问")!;
        const rewound = await session.raw.rewind({commandId: id(), to: target.id});
        expect(rewound.ok).toBe(true);
        expect((await session.raw.snapshot()).usage).toEqual({cost: 5, unpriced: 1});

        await session.reopen();
        expect((await session.raw.snapshot()).usage).toEqual({cost: 5, unpriced: 1});
    });

    test("处理函数读到的含触发它的事件；模型拦截读到发请求这一刻的", async () => {
        const seen: {on: Spend[]; intercept: Spend[]} = {on: [], intercept: []};
        const watcher = defineExtension({
            id: "lab.watcher",
            on: {assistant: (_event, ctx) => void seen.on.push(ctx.spend)},
            intercept: {model: async (request, next, ctx) => {
                seen.intercept.push(ctx.spend);
                return next(request);
            }},
        });
        await using session = await createTestSession({extensions: [watcher]});
        session.model.script({text: "一", usage: {cost: 2}}, {text: "二", usage: {cost: 4}});
        await session.say("第一问");
        await session.say("第二问");
        expect(seen.on).toEqual([{cost: 2, unpriced: 0}, {cost: 6, unpriced: 0}]);
        expect(seen.intercept).toEqual([{cost: 0, unpriced: 0}, {cost: 2, unpriced: 0}]);
    });

    test("装上扩展之前花的钱也算：只看日志，不靠扩展的事件", async () => {
        const root = await createTestTmpRoot("nb-harness", "kernel-spend");
        try {
            const before = await createTestSession({store: {root}});
            before.model.script({text: "一", usage: {cost: 7}});
            await before.say("第一问");
            const sessionId = before.id;
            await before.close();

            const seen: Spend[] = [];
            const late = defineExtension({id: "lab.late", intercept: {model: async (request, next, ctx) => {
                seen.push(ctx.spend);
                return next(request);
            }}});
            await using after = await createTestSession({store: {root}, open: sessionId, extensions: [late]});
            after.model.script("二");
            const sent = await after.raw.send({commandId: id(), input: {text: "第二问"}});
            if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
            await after.raw.waitRun(sent.value.runId);
            expect(seen).toEqual([{cost: 7, unpriced: 0}]);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("输出 6：请求序号", () => {
    test("并发的审批请求序号不同，各结算一次；一个中止也不吞另一个", async () => {
        const approve: ApproveHook = async (_call, _info, ctx) => {
            await ctx.model({system: [], messages: [], params: {}, headers: {}, tools: []} as never, {purpose: "approval"});
            return {verdict: "allow", by: "test"};
        };
        const tool = (name: string) => ({id: `lab.${name}`, concurrency: "shared" as const, execute: () => name});
        await using session = await createTestSession({approve, tools: [tool("a"), tool("b")]});
        session.model.script({tools: [{tool: "lab.a"}, {tool: "lab.b"}]}, {text: "批了"}, {text: "批了"}, "完");
        const report = await session.say("开始");
        const started = data<{request: number; purpose: string}>(report.events, "modelStarted");
        expect(new Set(started.map((item) => item.request)).size).toBe(started.length);
        const ended = data<{request: number}>(report.events, "modelEnded").map((item) => item.request).sort();
        expect(ended).toEqual(started.filter((item) => item.purpose === "approval").map((item) => item.request).sort());
    });

    test("被拦下的请求也占号，重开之后不重复", async () => {
        const blocker = defineExtension({id: "lab.blocker", intercept: {model: async (request) => ({content: [], toolCalls: [], stopReason: "error", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true}, model: request.model, error: {kind: "local", code: "blocked", message: "拦下"}})}});
        await using session = await createTestSession({extensions: [blocker]});
        await session.raw.send({commandId: id(), input: {text: "一"}}).then(async (sent) => {
            if (!sent.ok || sent.value.runId === null) throw new Error("no run");
            await session.raw.waitRun(sent.value.runId);
        });
        await session.reopen();
        await session.raw.send({commandId: id(), input: {text: "二"}}).then(async (sent) => {
            if (!sent.ok || sent.value.runId === null) throw new Error("no run");
            await session.raw.waitRun(sent.value.runId);
        });
        const requests = data<{request: number}>((await session.raw.log({afterSeq: 0, limit: 1000})).events, "modelFailed").map((item) => item.request);
        expect(requests).toHaveLength(2);
        expect(new Set(requests).size).toBe(2);
    });

    test("输出 71：并发调两次 next，两次的用量都记下", async () => {
        const both = defineExtension({id: "lab.both", intercept: {model: async (request, next) => {
            const [, second] = await Promise.all([next(request), next(request)]);
            return second;
        }}});
        await using session = await createTestSession({extensions: [both]});
        session.model.script({text: "甲", usage: {cost: 1}}, {text: "乙", usage: {cost: 2}});
        const report = await session.say("问");
        expect(report.result.usage.cost).toBe(3);
        expect((await session.raw.snapshot()).usage.cost).toBe(3);
        expect(data(report.events, "modelStarted")).toHaveLength(2);
        expect(data(report.events, "modelEnded")).toHaveLength(1);
    });

    test("输出 71：一层调两次 next，前一次的用量也记下，运行结果是总和", async () => {
        const twice = defineExtension({id: "lab.twice", intercept: {model: async (request, next) => {
            await next(request);
            return next(request);
        }}});
        await using session = await createTestSession({extensions: [twice]});
        session.model.script({text: "甲", usage: {cost: 1}}, {text: "乙", usage: {cost: 2}});
        const report = await session.say("问");
        expect(data<{usage: {cost: number}}>(report.events, "modelEnded").map((item) => item.usage.cost)).toEqual([1]);
        expect(report.result.usage.cost).toBe(3);
        expect((await session.raw.snapshot()).usage.cost).toBe(3);
    });
});
