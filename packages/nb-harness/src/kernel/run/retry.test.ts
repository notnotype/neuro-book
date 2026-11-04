/**
 * 模型请求的重发（docs/specs/harness/runtime.md 输出 62–69）。内核是真的，时钟是注入的：测试只推进时间，不真等。
 * 测试名里的编号是 runtime.md 的输出条目。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {defineModel} from "@notnotype/nb-harness";
import type {ApproveHook, Frame, LogEvent, ModelRequest, RunResult, RunStatus} from "../api/index.js";
import {defineExtension} from "../extension/define.js";
import {ompCall, ompModelInfo} from "../model/omp.js";
import {complete} from "../session/complete.js";
import {createTestClock} from "../testing/clock.js";
import {failingCompaction, summarizingCompaction} from "../testing/compaction.js";
import {createTestModel} from "../testing/model.js";
import {createTestSession, defaultTestProfile, type TestSession} from "../testing/test-session.js";

const retry = (maxRetries = 10) => () => ({maxRetries});
const network = {fail: "network", retryable: true} as const;
let commands = 0;
const id = () => `r-${(commands += 1)}`;
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string): T[] => events.filter((event) => event.type === type).map((event) => event.data as T);
const textOf = (request: ModelRequest): string => JSON.stringify(request.messages);

async function start(session: TestSession, text: string): Promise<string> {
    const sent = await session.raw.send({commandId: id(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error("send did not start a run");
    return sent.value.runId;
}

/** 推进时钟直到运行结束：每次走得比最长的退避还长。 */
async function finish(session: TestSession, runId: string): Promise<RunResult> {
    let result: RunResult | null = null;
    void session.raw.waitRun(runId).then((value) => {
        result = value;
    });
    while (result === null) await session.clock.advance(10_000);
    return result;
}

const logEvents = async (session: TestSession): Promise<readonly LogEvent[]> => (await session.raw.log({afterSeq: 0, limit: 100_000})).events;

describe("输出 62–64：何时重发、等多久、写什么", () => {
    test("可重发的失败：重发后成功，每次失败一条带 retry 的 modelFailed，用量是总和，错误不留下", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script({...network, usage: {cost: 1}, partial: "半句"}, {text: "好了", usage: {cost: 2}});
        const result = await finish(session, await start(session, "问"));
        expect(result).toMatchObject({reason: "completed", text: "好了", error: null});
        expect(result.usage.cost).toBe(3);
        const events = await logEvents(session);
        expect(dataOf<{request: number}>(events, "modelStarted")).toHaveLength(2);
        const failed = dataOf<Record<string, unknown>>(events, "modelFailed");
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({kind: "network", retry: {attempt: 1, max: 10, delayMs: 500}, partial: [{kind: "text", text: "半句"}]});
    });

    test("半截内容不进下一次请求", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script({...network, partial: "不该出现的半句"}, "好了");
        await finish(session, await start(session, "问"));
        expect(session.model.requests).toHaveLength(2);
        expect(textOf(session.model.requests[1]!)).not.toContain("不该出现的半句");
    });

    test("退避从 0.5 秒翻倍、至多 8 秒；用完后以这次的类别收口", async () => {
        await using session = await createTestSession({retry: retry(6)});
        session.model.script(network, network, network, network, network, network, network);
        const result = await finish(session, await start(session, "问"));
        expect(session.model.requests).toHaveLength(7);
        expect(result).toMatchObject({reason: "error", error: {kind: "network"}});
        const failed = dataOf<{retry?: {delayMs: number}}>(await logEvents(session), "modelFailed");
        expect(failed.map((item) => item.retry?.delayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, undefined]);
    });

    test("在注入的时钟上等够了才发", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script(network, "好了");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        expect(session.model.requests).toHaveLength(1);
        await session.clock.advance(499);
        expect(session.model.requests).toHaveLength(1);
        await session.clock.advance(1);
        expect(session.model.requests).toHaveLength(2);
        await session.raw.waitRun(runId);
    });

    test("服务商要求的等待时间：比退避长时等它；超过 5 分钟不重发", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script({fail: "rate_limit", retryable: true, retryAfterMs: 30_000}, "好了");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        await session.clock.advance(29_999);
        expect(session.model.requests).toHaveLength(1);
        await session.clock.advance(1);
        expect(session.model.requests).toHaveLength(2);
        await session.raw.waitRun(runId);

        await using long = await createTestSession({retry: retry()});
        long.model.script({fail: "rate_limit", retryable: true, retryAfterMs: 300_001});
        expect((await long.say("问")).result).toMatchObject({reason: "error", error: {kind: "rate_limit"}});
        expect(long.model.requests).toHaveLength(1);
    });

    test("不可重发、maxRetries 是 0、没给策略：一次就收口", async () => {
        await using denied = await createTestSession({retry: retry()});
        denied.model.script({fail: "auth"});
        expect((await denied.say("问")).result.reason).toBe("error");
        expect(denied.model.requests).toHaveLength(1);

        await using off = await createTestSession({retry: retry(0)});
        off.model.script(network);
        expect((await off.say("问")).result.reason).toBe("error");
        expect(off.model.requests).toHaveLength(1);

        await using none = await createTestSession();
        none.model.script(network);
        expect((await none.say("问")).result.reason).toBe("error");
        expect(none.model.requests).toHaveLength(1);
    });

    test("策略每次失败时现读：设置改了下一次失败就生效", async () => {
        let maxRetries = 10;
        await using session = await createTestSession({retry: () => ({maxRetries})});
        session.model.script(network, network, "不该发到这里");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        expect(session.model.requests).toHaveLength(1);
        maxRetries = 1;
        const result = await finish(session, runId);
        expect(result.reason).toBe("error");
        expect(session.model.requests).toHaveLength(2);
    });

    test("重试成功之后因别的原因收口：错误文字不是已恢复的那条", async () => {
        const tool = {id: "lab.step", execute: () => "好"};
        await using session = await createTestSession({retry: retry(), tools: [tool]});
        session.model.script({...network, message: "503 已恢复的错误"}, {tools: [{tool: "lab.step"}]});
        const runId = await start(session, "问");
        await session.clock.advance(1000);
        session.model.unavailable.set("turn", "role-unbound");
        const result = await finish(session, runId);
        expect(result.error).toMatchObject({kind: "local", code: "role-unbound"});
        expect(JSON.stringify(result.error)).not.toContain("已恢复");
    });

    test("重开后事件一致", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script(network, "好了");
        await finish(session, await start(session, "问"));
        const before = await logEvents(session);
        await session.reopen();
        expect(await logEvents(session)).toEqual(before);
    });
});

describe("输出 66：重发回到边界", () => {
    test("等待期间的 steer、改设置、compact 都在下一次请求生效", async () => {
        await using session = await createTestSession({retry: retry(), compaction: {methods: {shake: summarizingCompaction}}});
        session.model.script("第一轮");
        await session.say("先有一轮可以压缩");
        session.model.script(network, "摘要", "好了");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        const requested = session.model.requests.length;
        await session.raw.enqueue({commandId: id(), input: {text: "等等，换个说法"}, mode: "steer"});
        await session.raw.changeSettings({commandId: id(), patch: {core: {effort: "high"}}});
        await session.raw.compact({commandId: id()});
        await finish(session, runId);
        const later = session.model.requests.slice(requested);
        expect(later.map((request) => request.purpose)).toEqual(["compaction", "turn"]);
        expect(textOf(later[1]!)).toContain("等等，换个说法");
        expect(later[1]!.effort).toBe("high");
    });

    test("拦截每次都跑：第一次失败的费用到了上限，第二次不发", async () => {
        const gate = defineExtension({id: "lab.gate", intercept: {model: async (request, next, ctx) => {
            if (ctx.spend.cost >= 1) return {content: [], toolCalls: [], stopReason: "error", usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true}, model: request.model, error: {kind: "local", code: "cost-limit", message: "到上限"}};
            return next(request);
        }}});
        await using session = await createTestSession({retry: retry(), extensions: [gate]});
        session.model.script({...network, usage: {cost: 1}}, "不该发到这里");
        const result = await finish(session, await start(session, "问"));
        expect(session.model.requests).toHaveLength(1);
        expect(result.error).toMatchObject({kind: "local", code: "cost-limit"});
    });
});

describe("输出 65、68：等待时的状态与中止", () => {
    test("等待中状态带 retry，下一次请求开始后去掉", async () => {
        await using session = await createTestSession({retry: retry()});
        const seen: RunStatus[] = [];
        session.raw.subscribe((frame: Frame) => {
            if (frame.type === "status") seen.push(frame.status);
        });
        session.model.script(network, "好了");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        const now = session.clock.now();
        const waiting = (await session.raw.snapshot()).status;
        expect(waiting).toMatchObject({state: "running", retry: {attempt: 1, max: 10}});
        expect((waiting as {retry: {resumeAt: number}}).retry.resumeAt).toBe(now + 500);
        await finish(session, runId);
        const after = seen.slice(seen.findIndex((status) => status.state === "running" && status.retry !== undefined) + 1);
        expect(after.length).toBeGreaterThan(0);
        expect(after.some((status) => status.state === "running" && status.retry !== undefined)).toBe(false);
    });

    test("等待中中止：立刻收口，同一个请求只有一条失败", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script(network, "不该发到这里");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        await session.raw.abort({commandId: id()});
        const result = await session.raw.waitRun(runId);
        expect(result.reason).toBe("aborted");
        expect(session.model.requests).toHaveLength(1);
        const events = await logEvents(session);
        expect(dataOf<{request: number}>(events, "modelFailed").map((item) => item.request)).toEqual(dataOf<{request: number}>(events, "modelStarted").map((item) => item.request));
    });
});

describe("输出 67：压缩、审批与 complete", () => {
    test("压缩请求重发；等待中中止也只有一条失败", async () => {
        await using session = await createTestSession({retry: retry(), compaction: {methods: {shake: summarizingCompaction}}});
        session.model.script("第一轮");
        await session.say("先有一轮");
        session.model.script(network, "摘要");
        const compacted = await session.raw.compact({commandId: id()});
        if (!compacted.ok || compacted.value.runId === undefined) throw new Error("compact did not start a run");
        const result = await finish(session, compacted.value.runId);
        expect(result.reason).toBe("completed");
        const failed = dataOf<{retry?: unknown}>(await logEvents(session), "modelFailed");
        expect(failed).toHaveLength(1);
        expect(failed[0]!.retry).toBeDefined();

        session.model.script(network, "不该发到这里");
        const again = await session.raw.compact({commandId: id()});
        if (!again.ok || again.value.runId === undefined) throw new Error("compact did not start a run");
        await session.clock.advance(0);
        const requested = session.model.requests.length;
        await session.raw.abort({commandId: id()});
        expect((await session.raw.waitRun(again.value.runId)).reason).toBe("aborted");
        expect(session.model.requests).toHaveLength(requested);
        const events = await logEvents(session);
        const requests = dataOf<{request: number}>(events, "modelFailed").map((item) => item.request);
        expect(new Set(requests).size).toBe(requests.length);
    });

    test("压缩请求的空回复不算空回复：不重发", async () => {
        await using session = await createTestSession({retry: retry(), compaction: {methods: {shake: failingCompaction}}});
        session.model.script("第一轮");
        await session.say("先有一轮");
        const before = session.model.requests.length;
        const compacted = await session.raw.compact({commandId: id()});
        if (!compacted.ok || compacted.value.runId === undefined) throw new Error("compact did not start a run");
        await finish(session, compacted.value.runId);
        expect(session.model.requests.length).toBe(before);
    });

    test("审批请求重发", async () => {
        let verdict = "";
        const approve: ApproveHook = async (_call, _info, ctx) => {
            const reply = await ctx.model({system: [], messages: [], params: {}, headers: {}, tools: []}, {purpose: "approval"});
            verdict = reply.stopReason === "error" ? "失败" : "通过";
            return {verdict: "allow", by: "test"};
        };
        await using session = await createTestSession({retry: retry(), approve, tools: [{id: "lab.step", execute: () => "好"}]});
        session.model.script({tools: [{tool: "lab.step"}]}, network, "批了", "完");
        const result = await finish(session, await start(session, "问"));
        expect(result.text).toBe("完");
        expect(verdict).toBe("通过");
    });

    test("等审批时重发：waiting 不被盖掉", async () => {
        // 审批钩子里的请求失败重发时，另一个调用已经在等用户：状态仍是 waiting。
        const asked = {resolve: (_value: unknown) => undefined as void};
        const pendingAsk = new Promise((resolve) => {
            asked.resolve = resolve;
        });
        const approve: ApproveHook = async (call, _info, ctx) => {
            if (call.tool === "lab.ask") return {verdict: "ask", reason: "要写文件"};
            await pendingAsk;
            await ctx.model({system: [], messages: [], params: {}, headers: {}, tools: []}, {purpose: "approval"});
            return {verdict: "allow", by: "test"};
        };
        const shared = {concurrency: "shared" as const};
        await using session = await createTestSession({retry: retry(), approve, tools: [{id: "lab.ask", ...shared, execute: () => "问了"}, {id: "lab.auto", ...shared, execute: () => "自动"}]});
        session.model.script({tools: [{tool: "lab.ask"}, {tool: "lab.auto"}]}, network, "批了", "完");
        const runId = await start(session, "问");
        await session.clock.advance(0);
        const waiting = (await session.raw.snapshot()).status;
        expect(waiting.state).toBe("waiting");
        asked.resolve(undefined);
        await session.clock.advance(0);
        // 这时审批请求已经失败、在等重发：状态不该因此带上 retry。
        expect(dataOf(await logEvents(session), "modelFailed")).toMatchObject([{retry: {attempt: 1}}]);
        const still = (await session.raw.snapshot()).status;
        expect(still.state).toBe("waiting");
        expect(still).not.toHaveProperty("retry");
        await session.raw.abort({commandId: id()});
        await session.raw.waitRun(runId);
    });

    test("complete 重发，用量是总和，不写日志", async () => {
        const model = createTestModel();
        const clock = createTestClock();
        model.script({...network, usage: {cost: 1}}, {text: "好了", usage: {cost: 2}});
        const env = {models: model.port, clock, resources: () => ({read: async () => undefined, resolve: (uri: string) => uri}), profiles: {resolve: () => defaultTestProfile}, retry: retry()};
        let settled = false;
        const done = complete(env, {profile: defaultTestProfile.id, input: {text: "问"}}).finally(() => {
            settled = true;
        });
        while (!settled) await clock.advance(1000);
        const result = await done;
        if (!result.ok) throw new Error(result.code);
        expect(result.result).toMatchObject({reason: "completed", text: "好了"});
        expect(result.result.usage.cost).toBe(3);
        expect(model.requests).toHaveLength(2);
    });
});

describe("输出 69：空回复", () => {
    const empties: readonly [string, Parameters<TestSession["model"]["script"]>[0]][] = [
        ["没有内容", {stop: "stop"}],
        ["只有空白", {text: " \n"}],
        ["只有思考", {thinking: "想了想"}],
        ["结束原因是 tool 却没有调用", {stop: "tool"}],
        ["结束原因是 length 而内容完全为空", {stop: "length"}],
    ];
    for (const [name, reply] of empties) {
        test(`${name}：不写成回复，带提醒重发`, async () => {
            await using session = await createTestSession({retry: retry()});
            session.model.script(reply, "好了");
            const result = await finish(session, await start(session, "问"));
            expect(result.text).toBe("好了");
            const events = await logEvents(session);
            expect(dataOf(events, "assistant")).toHaveLength(1);
            expect(dataOf(events, "modelFailed")[0]).toMatchObject({kind: "provider", code: "empty-reply", retry: {attempt: 1, max: 3}});
            expect(textOf(session.model.requests[1]!)).toContain("Your last reply was empty");
        });
    }

    test("3 次用完以 empty-reply 收口", async () => {
        await using session = await createTestSession({retry: retry()});
        session.model.script({stop: "stop"}, {stop: "stop"}, {stop: "stop"}, {stop: "stop"});
        const result = await finish(session, await start(session, "问"));
        expect(session.model.requests).toHaveLength(4);
        expect(result).toMatchObject({reason: "error", error: {kind: "provider", code: "empty-reply"}});
        expect(dataOf(await logEvents(session), "assistant")).toHaveLength(0);
    });

    test("次数不超过 maxRetries；maxRetries 是 0 时按普通回复写下", async () => {
        await using one = await createTestSession({retry: retry(1)});
        one.model.script({stop: "stop"}, {stop: "stop"});
        expect((await finish(one, await start(one, "问"))).error).toMatchObject({code: "empty-reply"});
        expect(one.model.requests).toHaveLength(2);

        await using off = await createTestSession({retry: retry(0)});
        off.model.script({stop: "stop"});
        expect((await off.say("问")).result).toMatchObject({reason: "completed", text: ""});
    });

    test("真被截断的回复与工具调用不算空回复", async () => {
        await using cut = await createTestSession({retry: retry()});
        cut.model.script({text: "写到一半", stop: "length"});
        expect((await cut.say("问")).result.text).toBe("写到一半");
        expect(cut.model.requests).toHaveLength(1);

        await using thought = await createTestSession({retry: retry()});
        thought.model.script({thinking: "想到一半", stop: "length"});
        expect((await thought.say("问")).result.reason).toBe("completed");
        expect(thought.model.requests).toHaveLength(1);
    });
});

describe("真实适配器与本机端点", () => {
    const replies: (() => Response)[] = [];
    let sent = 0;
    const server = Bun.serve({port: 0, hostname: "127.0.0.1", async fetch(request) {
        sent += 1;
        await request.text();
        return replies.shift()!();
    }});
    afterAll(() => server.stop(true));
    const chunk = (body: object): string => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
    const sse = (text: string): Response => new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: text}, finish_reason: "stop"}]}) + chunk({choices: [], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
    const {model} = defineModel({provider: "local-test", api: "openai-completions", baseUrl: `http://127.0.0.1:${server.port}/v1`, id: "m", apiKey: "none"});
    const call = ompCall({model, apiKey: () => "sk-test-not-a-real-key", priceKnown: false, transport: {maxHttpAttempts: 1}});
    const models = {resolve: () => ({ok: true as const, info: ompModelInfo(model), call})};

    test("503 一次后成功：HTTP 正好两次", async () => {
        sent = 0;
        replies.push(() => new Response(JSON.stringify({error: {message: "Service overloaded"}}), {status: 503, headers: {"content-type": "application/json"}}), () => sse("好了"));
        await using session = await createTestSession({retry: retry(), models});
        const result = await finish(session, await start(session, "问"));
        expect(result).toMatchObject({reason: "completed", text: "好了"});
        expect(sent).toBe(2);
    });

    test("空回复：内外都算上，HTTP 总次数 4，以 empty-reply 收口", async () => {
        sent = 0;
        replies.push(() => sse(""), () => sse(""), () => sse(""), () => sse(""));
        await using session = await createTestSession({retry: retry(), models});
        const result = await finish(session, await start(session, "问"));
        expect(result.error).toMatchObject({code: "empty-reply"});
        expect(sent).toBe(4);
    });
});

