/**
 * 默认装上的两个扩展（docs/specs/agent/run-guards.md）：内核是真的（日志、归约、拦截链），假的只有模型、工具与时钟。
 * 在真实插件与设置上的接线见 `agent.test.ts`。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createTestSession} from "@notnotype/nb-harness/kernel/testing";
import type {TestSession} from "@notnotype/nb-harness/kernel/testing";
import {defineExtension} from "@notnotype/nb-harness/kernel";
import type {LogEvent, RunResult} from "@notnotype/nb-harness/kernel/contracts";

import {costGuard, type CostLimits} from "./backend/guards/cost-guard";
import {loopGuard} from "./backend/guards/loop-guard";

let commands = 0;
const id = () => `g-${(commands += 1)}`;
const logEvents = async (session: TestSession): Promise<readonly LogEvent[]> => (await session.raw.log({afterSeq: 0, limit: 100_000})).events;
const eventsNamed = async (session: TestSession, name: string): Promise<readonly LogEvent[]> => (await logEvents(session)).filter((event) => event.type === name);

/** 装配序排在两个保护之后的拦截层（同一层依赖序按 id 排）：预览要走到它，才算没被拦。 */
const INNER_LAYER = defineExtension({id: "zz.inner", intercept: {model: async (request, next) => next({...request, params: {maxTokens: 7}})}});

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "guards");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe("费用", () => {
    const COST = "nbook.agent.cost-guard";
    async function withLimits(initial: Partial<CostLimits>) {
        const limits = {warnCost: 0, maxCost: 0, ...initial};
        const session = await createTestSession({extensions: [{extension: costGuard(() => limits), plugin: "nbook.agent"}]});
        return {session, limits};
    }

    test("输出 3：到告警线告警一次；调高之后到新的线再告警", async () => {
        const {session, limits} = await withLimits({warnCost: 2});
        await using _ = session;
        session.model.script({text: "一", usage: {cost: 1}}, {text: "二", usage: {cost: 1}}, {text: "三", usage: {cost: 1}});
        await session.say("一");
        expect(await eventsNamed(session, `${COST}/costWarned`)).toHaveLength(0);
        await session.say("二");
        await session.say("三");
        const warned = await eventsNamed(session, `${COST}/costWarned`);
        expect(warned.map((event) => event.data)).toEqual([{spent: 2, limit: 2}]);
        limits.warnCost = 4;
        session.model.script({text: "四", usage: {cost: 1}});
        await session.say("四");
        expect((await eventsNamed(session, `${COST}/costWarned`)).map((event) => event.data)).toEqual([{spent: 2, limit: 2}, {spent: 4, limit: 4}]);
    });

    test("输出 4：到上限下一次请求不发、以 cost-limit 收口；拦下不算花费；调高之后 start 接着跑", async () => {
        const {session, limits} = await withLimits({maxCost: 1});
        await using _ = session;
        session.model.script({text: "一", usage: {cost: 1}});
        await session.say("一");
        const blocked = await session.say("二");
        expect(blocked.result).toMatchObject({reason: "error", error: {kind: "local", code: "cost-limit"}});
        expect(blocked.result.usage.cost).toBe(0);
        expect(session.model.requests).toHaveLength(1);
        expect((await session.raw.snapshot()).usage).toEqual({cost: 1, unpriced: 0});

        limits.maxCost = 5;
        session.model.script({text: "接着", usage: {cost: 1}});
        const resumed = await session.raw.start({commandId: id()});
        if (!resumed.ok) throw new Error(resumed.code);
        expect((await session.raw.waitRun(resumed.value.runId)).text).toBe("接着");
    });

    test("输出 4：预览不被拦：它里面的拦截层照样走到", async () => {
        const session = await createTestSession({extensions: [{extension: costGuard(() => ({warnCost: 0, maxCost: 1})), plugin: "nbook.agent"}, INNER_LAYER]});
        await using _ = session;
        session.model.script({text: "一", usage: {cost: 1}});
        await session.say("一");
        expect((await session.raw.preview({})).request.params).toEqual({maxTokens: 7});
    });

    test("输出 5：设了线且遇到单价未知的请求，提示一次；没设不提示；上限对它不起作用", async () => {
        const {session} = await withLimits({maxCost: 1});
        await using _ = session;
        session.model.script({text: "一", usage: {cost: null}}, {text: "二", usage: {cost: null}});
        await session.say("一");
        await session.say("二");
        expect(session.model.requests).toHaveLength(2);
        expect(await eventsNamed(session, `${COST}/costUnpriced`)).toHaveLength(1);

        const off = await withLimits({});
        await using __ = off.session;
        off.session.model.script({text: "一", usage: {cost: null}});
        await off.session.say("一");
        expect(await eventsNamed(off.session, `${COST}/costUnpriced`)).toHaveLength(0);
    });

    test("验收 2：这个版本之前的会话，费用已超上限：打开后第一次请求就被拦下", async () => {
        const dir = join(root, "old-session");
        const before = await createTestSession({store: {root: dir}});
        before.model.script({text: "一", usage: {cost: 9}});
        await before.say("一");
        const sessionId = before.id;
        await before.close();

        await using after = await createTestSession({store: {root: dir}, open: sessionId, extensions: [{extension: costGuard(() => ({warnCost: 0, maxCost: 5})), plugin: "nbook.agent"}]});
        const sent = await after.raw.send({commandId: id(), input: {text: "二"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        const result = await after.raw.waitRun(sent.value.runId);
        expect(result.error).toMatchObject({code: "cost-limit"});
        expect(after.model.requests).toHaveLength(0);
    });

    test("验收 1：一次失败之后，上限恰好被它的费用用完，不再重发", async () => {
        const session = await createTestSession({retry: () => ({maxRetries: 10}), extensions: [{extension: costGuard(() => ({warnCost: 0, maxCost: 1})), plugin: "nbook.agent"}]});
        await using _ = session;
        session.model.script({fail: "network", retryable: true, usage: {cost: 1}}, "不该发到这里");
        const sent = await session.raw.send({commandId: id(), input: {text: "问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
        let result: RunResult | null = null;
        void session.raw.waitRun(sent.value.runId).then((value) => {
            result = value;
        });
        while (result === null) await session.clock.advance(1000);
        expect(result).toMatchObject({error: {code: "cost-limit"}});
        expect(session.model.requests).toHaveLength(1);
    });
});

describe("重复调用", () => {
    const LOOP = "nbook.agent.loop-guard";
    const read = (args: object = {path: "a"}) => ({tools: [{tool: "lab.read", args: args as Record<string, unknown>}]});
    const repeat = (times: number, args?: object) => Array.from({length: times}, () => read(args));
    function loopSession(threshold = 3, execute: (args: Readonly<Record<string, unknown>>) => string = () => "同样的结果") {
        return createTestSession({tools: [{id: "lab.read", execute}], extensions: [{extension: loopGuard(() => threshold), plugin: "nbook.agent"}]});
    }
    const texts = (events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type);

    test("输出 7：连续到阈值提醒，排在工具结果之后，重开后一致", async () => {
        await using session = await loopSession();
        session.model.script(...repeat(3), "好了");
        const report = await session.say("开始");
        expect(report.result.text).toBe("好了");
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(1);
        const last = session.model.requests.at(-1)!;
        const roles = last.messages.map((message) => message.role);
        const reminder = last.messages.findIndex((message) => JSON.stringify(message.content).includes("times in a row"));
        expect(reminder).toBe(roles.length - 1);
        expect(roles[reminder - 1]).toBe("tool");
        const before = await logEvents(session);
        await session.reopen();
        expect(await logEvents(session)).toEqual(before);
    });

    test("输出 7：参数键的顺序不同算相同；没到阈值不提醒", async () => {
        await using session = await loopSession();
        session.model.script(read({a: 1, b: 2}), read({b: 2, a: 1}), read({a: 1, b: 2}), "好了");
        expect(texts((await session.say("开始")).events, `${LOOP}/redirected`)).toHaveLength(1);

        await using few = await loopSession();
        few.model.script(...repeat(2), "好了");
        expect(texts((await few.say("开始")).events, `${LOOP}/redirected`)).toHaveLength(0);
    });

    test("输出 8：提醒之后结果还一样，再到阈值就停，以 tool-call-loop 收口", async () => {
        await using session = await loopSession();
        session.model.script(...repeat(6), "不该发到这里");
        const report = await session.say("开始");
        expect(report.result).toMatchObject({reason: "error", error: {kind: "local", code: "tool-call-loop"}});
        expect(session.model.requests).toHaveLength(6);
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(1);
        expect(texts(report.events, `${LOOP}/stopped`)).toHaveLength(1);
        // 这一步的工具照常跑完。
        expect(texts(report.events, "toolResult")).toHaveLength(6);
    });

    test("输出 8：结果在变只提醒不停", async () => {
        let polls = 0;
        await using session = await loopSession(3, () => `第 ${String((polls += 1))} 次的结果`);
        session.model.script(...repeat(9), "好了");
        const report = await session.say("开始");
        expect(report.result.text).toBe("好了");
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(3);
        expect(texts(report.events, `${LOOP}/stopped`)).toHaveLength(0);
    });

    test("输出 9：中途换了调用，先提醒不停", async () => {
        await using session = await loopSession();
        session.model.script(...repeat(3, {path: "a"}), ...repeat(3, {path: "b"}), "好了");
        const report = await session.say("开始");
        expect(report.result.text).toBe("好了");
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(2);
        expect(texts(report.events, `${LOOP}/stopped`)).toHaveLength(0);
    });

    test("输出 10：停下之后 start 仍被挡；发新话解除；steer 也解除", async () => {
        await using session = await loopSession();
        session.model.script(...repeat(6));
        await session.say("开始");
        const requests = session.model.requests.length;
        const resumed = await session.raw.start({commandId: id()});
        if (!resumed.ok) throw new Error(resumed.code);
        expect((await session.raw.waitRun(resumed.value.runId)).error).toMatchObject({code: "tool-call-loop"});
        expect(session.model.requests).toHaveLength(requests);

        session.model.script("换个做法");
        expect((await session.say("别读了，换个做法")).result.text).toBe("换个做法");
    });

    test("输出 10：运行中的 steer 也算新话：计数清零，不停", async () => {
        let calls = 0;
        await using session = await createTestSession({extensions: [{extension: loopGuard(() => 3), plugin: "nbook.agent"}], tools: [{id: "lab.read", execute: async () => {
            calls += 1;
            if (calls === 5) await session.raw.enqueue({commandId: id(), input: {text: "换个文件读"}, mode: "steer"});
            return "同样的结果";
        }}]});
        session.model.script(...repeat(6), "好了");
        const report = await session.say("开始");
        expect(report.result.text).toBe("好了");
        expect(texts(report.events, `${LOOP}/stopped`)).toHaveLength(0);
    });

    test("输出 11：回退之后计数跟着回去", async () => {
        await using session = await loopSession();
        session.model.script(...repeat(2), "好了");
        await session.say("第一问");
        session.model.script(...repeat(2), "好了");
        await session.say("第二问");
        session.model.script(...repeat(2), "好了");
        const target = (await session.raw.rewindTargets()).find((item) => item.kind === "before-turn" && item.inputText === "第二问")!;
        await session.raw.rewind({commandId: id(), to: target.id});
        const report = await session.say("改过的第二问");
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(0);
    });

    test("输出 12：预览不被拦：它里面的拦截层照样走到；阈值 0 不检测", async () => {
        await using session = await createTestSession({tools: [{id: "lab.read", execute: () => "同样的结果"}], extensions: [{extension: loopGuard(() => 3), plugin: "nbook.agent"}, INNER_LAYER]});
        session.model.script(...repeat(6));
        expect((await session.say("开始")).result.error).toMatchObject({code: "tool-call-loop"});
        expect((await session.raw.preview({})).request.params).toEqual({maxTokens: 7});

        await using off = await loopSession(0);
        off.model.script(...repeat(8), "好了");
        const report = await off.say("开始");
        expect(report.result.text).toBe("好了");
        expect(texts(report.events, `${LOOP}/redirected`)).toHaveLength(0);
    });
});
