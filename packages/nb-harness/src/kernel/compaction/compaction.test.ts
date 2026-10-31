/**
 * 压缩（t20 第 8 片）。测试名里的编号是 docs/specs/harness/runtime.md 的输出条目，“extensions 输出”指 extensions.md。
 * 压缩方法用测试方法（`testing/compaction.ts`）与测试里现写的方法；真实方法在 t11。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {AnyProfile, CompactionJob, CompactionMethodImpl, LogEvent} from "../api/index.js";
import {defineExtension, slice} from "../extension/define.js";
import {defineProfile} from "../extension/profile.js";
import {failingCompaction, summarizingCompaction} from "../testing/compaction.js";
import {createTestSession, type TestSession} from "../testing/test-session.js";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "kernel-compaction");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const id = () => `k-${(commands += 1)}`;
const types = (events: readonly LogEvent[]) => events.map((event) => event.type);
const dataOf = <T = Record<string, unknown>>(events: readonly LogEvent[], type: string) => events.filter((event) => event.type === type).map((event) => event.data as T);
const codes = async (session: TestSession) => (await session.raw.diagnostics()).map((item) => item.code);

/** 这个用量让估算超过测试模型（窗口 10 万）的触发点 83,616。 */
const HEAVY = {cacheRead: 90_000};

const profileWith = (compaction: NonNullable<Parameters<typeof defineProfile>[0]["compaction"]>): AnyProfile =>
    defineProfile({id: "lab.compact", version: "1", name: "压缩", description: "压缩测试", system: "系统", compaction}) as AnyProfile;

async function batchOf(session: TestSession): Promise<Map<string, string>> {
    const text = await readFile(join(root, session.id, "session.jsonl"), "utf8");
    const map = new Map<string, string>();
    for (const line of text.split("\n").slice(1)) if (line.trim() !== "") map.set((JSON.parse(line) as {id: string}).id, (JSON.parse(line) as {batch: {id: string}}).batch.id);
    return map;
}

describe("阈值触发", () => {
    test("输出 46–49：缓存读也算进用量；第一个方法失败换下一个；摘要排在前面，放回的内容与压缩同批", async () => {
        const jobs: CompactionJob[] = [];
        const recording = (impl: CompactionMethodImpl): CompactionMethodImpl => async (job) => {
            jobs.push(job);
            return impl(job);
        };
        await using session = await createTestSession({
            store: {root},
            profile: profileWith({onThreshold: ["fail", "summarize"], require: "保留人名"}),
            compaction: {methods: {fail: recording(failingCompaction), summarize: recording(summarizingCompaction)}, restore: () => ["放回的计划"]},
        });
        session.model.script("答一", {text: "答二", usage: HEAVY}, "前两轮的摘要", "答三");
        await session.say("第一问");
        await session.say("第二问");
        const third = await session.say("第三问");
        expect(jobs.map((job) => [job.method, job.reason, job.require])).toEqual([["fail", "threshold", ["保留人名"]], ["summarize", "threshold", ["保留人名"]]]);
        expect(jobs[0]!.request.purpose).toBe("compaction");
        expect(jobs[0]!.cuts.map((cut) => cut.kind)).toEqual(["turn", "turn", "turn"]);
        expect(dataOf(third.events, "modelStarted").map((data) => data.purpose)).toEqual(["compaction", "turn"]);
        expect(dataOf(third.events, "modelEnded")).toHaveLength(1);
        const compaction = third.events.find((event) => event.type === "compaction")!;
        expect(compaction.data).toMatchObject({method: "summarize", replacement: "前两轮的摘要", firstKeptEntryId: jobs[1]!.cuts[2]!.entryId});
        const restored = third.events.find((event) => event.type === "notice")!;
        expect(restored.data).toEqual({code: "restored", text: "放回的计划"});
        const batches = await batchOf(session);
        expect(batches.get(restored.id)).toBe(batches.get(compaction.id));
        expect(third.requests.at(-1)!.outline()).toEqual(["system: fixed:profile", `user: summary:${compaction.id}`, "user: event:notice | event:input"]);
        expect(third.result.text).toBe("答三");
    });

    test("输出 46、47：全部方法失败不写压缩事件，请求照发；结果不合格的换下一个；compaction: false 不压缩", async () => {
        const invalid: CompactionMethodImpl = async (job) => ({method: job.method, firstKeptEntryId: "not-a-cut", replacement: null, omitted: [], tokensBefore: 1, tokensAfter: 1});
        await using session = await createTestSession({profile: profileWith({onThreshold: ["fail", "invalid"]}), compaction: {methods: {fail: failingCompaction, invalid}}});
        session.model.script({text: "答一", usage: HEAVY}, "答二");
        await session.say("第一问");
        const second = await session.say("第二问");
        expect(types(second.events)).not.toContain("compaction");
        expect(second.result.text).toBe("答二");
        expect(await codes(session)).toEqual(expect.arrayContaining(["compaction-invalid", "compaction-failed"]));

        await using off = await createTestSession({profile: profileWith(false as never), compaction: {methods: {summarize: summarizingCompaction}}});
        off.model.script({text: "答一", usage: HEAVY}, "答二");
        await off.say("第一问");
        expect(types((await off.say("第二问")).events)).not.toContain("compaction");
    });

    test("输出 49：省略的条目渲染成占位，消息与工具调用照样在", async () => {
        const omitResults: CompactionMethodImpl = async (job) => {
            const toolBlocks = job.request.messages.filter((message) => message.role === "tool").flatMap((message) => message.content);
            const firstInput = job.request.messages[0]!.content[0]!.origin as {eventId: string};
            const omitted = [{entryId: firstInput.eventId, placeholder: "（已省略的提问）"}, ...toolBlocks.map((block) => ({entryId: (block.origin as {eventId: string}).eventId, placeholder: "（已省略工具结果，需要时重新读取）"}))];
            return {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: null, omitted, tokensBefore: job.tokens, tokensAfter: job.tokens / 2};
        };
        await using session = await createTestSession({profile: profileWith({onThreshold: ["shake"]}), compaction: {methods: {shake: omitResults}}, tools: [{id: "lab.read", execute: () => "很长很长的文件内容"}]});
        session.model.script({tools: [{tool: "lab.read"}]}, {text: "读完了", usage: HEAVY}, "答二");
        await session.say("读文件");
        const second = await session.say("接着");
        const request = second.requests.at(-1)!.raw;
        const tool = request.messages.find((message) => message.role === "tool")!;
        expect(tool.content).toMatchObject([{kind: "text", text: "（已省略工具结果，需要时重新读取）"}]);
        expect(request.messages[0]!.content).toMatchObject([{kind: "text", text: "（已省略的提问）"}]);
        expect(request.messages.find((message) => message.toolCalls !== undefined)!.toolCalls).toHaveLength(1);
    });

    test("输出 49、extensions 输出 9：写了 resetOnCompaction 的片回到初始值；回退到压缩之前，对话是压缩前的", async () => {
        const told = defineExtension({id: "lab.told", state: {told: slice.path(0, {resetOnCompaction: true}), all: slice.path(0)}, reduce: {input: (_event, state) => ({told: state.told + 1, all: state.all + 1})}});
        await using session = await createTestSession({extensions: [told], profile: profileWith({onThreshold: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        session.model.script("答一", {text: "答二", usage: HEAVY}, "摘要", "答三", "摘要二", "重答三");
        await session.say("第一问");
        await session.say("第二问");
        await session.say("第三问");
        // 第三轮的 input 在压缩之前写下，压缩把 told 清零。
        expect(await session.state(told)).toEqual({told: 0, all: 3});
        const before = (await session.raw.rewindTargets()).find((target) => target.kind === "before-turn" && target.inputText === "第三问")!;
        await session.raw.rewind({commandId: id(), to: before.id});
        expect(types(await session.events())).not.toContain("compaction");
        expect(await session.state(told)).toEqual({told: 2, all: 2});
        // 回退后的分支上第二轮的大用量还在，下一次请求前照样压缩；这次压缩的请求算自压缩前的对话：前两轮全文、没有摘要。
        const again = await session.say("重问第三问");
        const compacting = again.requests.find((request) => request.raw.purpose === "compaction")!;
        expect(compacting.outline().slice(0, 6)).toEqual(["system: fixed:kernel", "user: event:input", "assistant: event:assistant", "user: event:input", "assistant: event:assistant", "user: event:input"]);
    });
});

describe("溢出与中止", () => {
    test("输出 50：服务商报溢出时压缩后重发一次；再溢出以 context_overflow 收口", async () => {
        await using session = await createTestSession({profile: profileWith({onOverflow: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        session.model.script("答一", {fail: "context_overflow"}, "摘要", "压缩后答二");
        await session.say("第一问");
        const second = await session.say("第二问");
        expect(second.result).toMatchObject({reason: "completed", text: "压缩后答二"});
        expect(dataOf(second.events, "modelFailed").map((data) => data.kind)).toEqual(["context_overflow"]);
        expect(dataOf(second.events, "modelStarted").map((data) => data.purpose)).toEqual(["turn", "compaction", "turn"]);
        expect(types(second.events)).toContain("compaction");

        session.model.script({fail: "context_overflow"}, "摘要", {fail: "context_overflow"});
        const third = await session.say("第三问");
        expect(third.result).toMatchObject({reason: "error", error: {kind: "context_overflow"}});
        expect(dataOf(third.events, "modelFailed")).toHaveLength(2);
    });

    test("输出 51：压缩中被中止不写压缩事件，运行以 aborted 收口", async () => {
        let entered!: () => void;
        const inside = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const slow: CompactionMethodImpl = async (job) => {
            entered();
            await new Promise<void>((resolve) => job.signal.addEventListener("abort", () => resolve(), {once: true}));
            return {method: job.method, firstKeptEntryId: null, replacement: "太晚了", omitted: [], tokensBefore: job.tokens, tokensAfter: 1};
        };
        await using session = await createTestSession({profile: profileWith({onThreshold: ["slow"]}), compaction: {methods: {slow}}});
        session.model.script({text: "答一", usage: HEAVY});
        await session.say("第一问");
        const sent = await session.raw.send({commandId: id(), input: {text: "第二问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await inside;
        await session.raw.abort({commandId: id()});
        expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("aborted");
        expect(types(await session.events())).not.toContain("compaction");
    });
});

describe("compact 指令", () => {
    test("输出 52：空闲时开只压缩的运行；没有可切的得 nothing-to-compact；全部失败以 compaction-failed 收口；重发只生效一次", async () => {
        await using fresh = await createTestSession({compaction: {methods: {summarize: summarizingCompaction}}});
        expect(await fresh.raw.compact({commandId: id()})).toEqual({ok: false, code: "nothing-to-compact"});

        await using session = await createTestSession({profile: profileWith({onThreshold: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        session.model.script("答一", "摘要");
        await session.say("第一问");
        const command = {commandId: id(), requirement: "只留结论"};
        const accepted = await session.raw.compact(command);
        if (!accepted.ok || accepted.value.runId === undefined) throw new Error("compact did not start");
        expect(accepted.value.scheduled).toBe("now");
        expect((await session.raw.waitRun(accepted.value.runId)).reason).toBe("completed");
        expect(await session.raw.compact(command)).toMatchObject({ok: true, replayed: true, value: accepted.value});
        const events = await session.events();
        expect(dataOf(events, "runStarted").at(-1)).toMatchObject({kind: "compact"});
        expect(types(events).slice(-3)).toEqual(["modelEnded", "compaction", "runEnded"]);
        expect(session.model.requests.at(-1)!.messages.at(-1)!.content).toMatchObject([{text: "写摘要。\n只留结论"}]);

        await using failing = await createTestSession({profile: profileWith({onThreshold: ["fail"]}), compaction: {methods: {fail: failingCompaction}}});
        failing.model.script("答一");
        await failing.say("第一问");
        const run = await failing.raw.compact({commandId: id()});
        if (!run.ok || run.value.runId === undefined) throw new Error("compact did not start");
        expect(await failing.raw.waitRun(run.value.runId)).toMatchObject({reason: "error", error: {code: "compaction-failed"}});
    });

    test("输出 52：运行中受理的 compact 到下一个边界做，要求交给方法", async () => {
        const jobs: CompactionJob[] = [];
        const record: CompactionMethodImpl = async (job) => {
            jobs.push(job);
            return summarizingCompaction(job);
        };
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started!: () => void;
        const running = new Promise<void>((resolve) => {
            started = resolve;
        });
        await using session = await createTestSession({profile: profileWith({onThreshold: ["record"]}), compaction: {methods: {record}}, tools: [{id: "lab.hold", execute: async () => {
            started();
            await held;
            return "好了";
        }}]});
        session.model.script("答一", {tools: [{tool: "lab.hold"}]}, "摘要", "答二");
        await session.say("第一问");
        const sent = await session.raw.send({commandId: id(), input: {text: "第二问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await running;
        expect(await session.raw.compact({commandId: id(), requirement: "留下工具结果"})).toMatchObject({ok: true, value: {scheduled: "next-boundary"}});
        release();
        await session.raw.waitRun(sent.value.runId);
        expect(jobs.map((job) => [job.reason, job.require])).toEqual([["manual", ["留下工具结果"]]]);
        expect(types(await session.events())).toContain("compaction");
    });
});

describe("切点、摘要与链", () => {
    test("输出 47、49：切在进行中这一轮的某一步，之前的步去掉、输入留着；切点保留的 token 随切点后移而变少", async () => {
        const jobs: CompactionJob[] = [];
        const lastStep: CompactionMethodImpl = async (job) => {
            jobs.push(job);
            const cut = job.cuts.filter((item) => item.kind === "step").at(-1)!;
            return {method: job.method, firstKeptEntryId: cut.entryId, replacement: "前几步的摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: cut.tokensKept};
        };
        await using session = await createTestSession({profile: profileWith({onThreshold: ["step"]}), compaction: {methods: {step: lastStep}}, tools: [{id: "lab.read", execute: () => "内容".repeat(200)}]});
        session.model.script({tools: [{tool: "lab.read"}]}, {tools: [{tool: "lab.read"}], usage: HEAVY}, "完成");
        const report = await session.say("读两次");
        const cuts = jobs[0]!.cuts;
        expect(cuts.map((cut) => cut.kind)).toEqual(["turn", "step", "step"]);
        // 这一轮的“轮”切点与第一步的切点保留的都是整轮。
        expect(cuts[0]!.tokensKept).toBe(cuts[1]!.tokensKept);
        expect(cuts[1]!.tokensKept).toBeGreaterThan(cuts[2]!.tokensKept);
        expect(cuts[2]!.tokensKept).toBeGreaterThan(0);
        const compaction = report.events.find((event) => event.type === "compaction")!;
        // 第三次请求：摘要、这一轮的输入，加切点那一步（第二次读）及其结果；第一次读的那一步没了。
        expect(report.requests.at(-1)!.outline()).toEqual(["system: fixed:profile", `user: summary:${compaction.id}`, "user: event:input", "assistant: call:lab.read", "tool: event:toolResult"]);
    });

    test("输出 49：切点为 null 去掉全部已提交轮与这一轮的步；再次压缩不给摘要时留着上一次的", async () => {
        let round = 0;
        const method: CompactionMethodImpl = async (job) => {
            round += 1;
            return round === 1
                ? {method: job.method, firstKeptEntryId: null, replacement: "全部的摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 10}
                : {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: null, omitted: [], tokensBefore: job.tokens, tokensAfter: job.tokens};
        };
        await using session = await createTestSession({profile: profileWith({onThreshold: ["m"]}), compaction: {methods: {m: method}}});
        session.model.script({text: "答一", usage: HEAVY}, {text: "答二", usage: HEAVY}, "答三");
        await session.say("第一问");
        const second = await session.say("第二问");
        const first = second.events.find((event) => event.type === "compaction")!;
        expect(second.requests[0]!.outline()).toEqual(["system: fixed:profile", `user: summary:${first.id}`, "user: event:input"]);
        const third = await session.say("第三问");
        expect(types(third.events)).toContain("compaction");
        expect(third.requests[0]!.outline()[1]).toBe(`user: summary:${first.id}`);
    });

    test("输出 49：一轮中途以 null 切点压缩时，这一轮的步也去掉，只剩摘要与输入", async () => {
        const all: CompactionMethodImpl = async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "全部的摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1});
        await using session = await createTestSession({profile: profileWith({onThreshold: ["all"]}), compaction: {methods: {all}}, tools: [{id: "lab.read", execute: () => "读到了"}]});
        session.model.script({tools: [{tool: "lab.read"}], usage: HEAVY}, "答完");
        const report = await session.say("读");
        const compaction = report.events.find((event) => event.type === "compaction")!;
        expect(report.requests.at(-1)!.outline()).toEqual(["system: fixed:profile", `user: summary:${compaction.id}`, "user: event:input"]);
    });

    test("输出 47：方法经压缩拦截链；方法发的模型请求经模型拦截链、purpose 为 compaction", async () => {
        const seen: string[] = [];
        const watcher = defineExtension({id: "lab.watch", intercept: {
            compaction: async (job, next) => {
                seen.push(`compaction:${job.method}:${job.reason}`);
                return next({...job, require: [...job.require, "拦截加的要求"]});
            },
            model: async (request, next) => {
                seen.push(`model:${request.purpose}`);
                return next(request);
            },
        }});
        const jobs: CompactionJob[] = [];
        const record: CompactionMethodImpl = async (job) => {
            jobs.push(job);
            return summarizingCompaction(job);
        };
        await using session = await createTestSession({extensions: [watcher], profile: profileWith({onThreshold: ["record"]}), compaction: {methods: {record}}});
        session.model.script({text: "答一", usage: HEAVY}, "摘要", "答二");
        await session.say("第一问");
        await session.say("第二问");
        expect(seen).toEqual(["model:turn", "compaction:record:threshold", "model:compaction", "model:turn"]);
        expect(jobs[0]!.require).toEqual(["拦截加的要求"]);
    });
});

describe("估算的来源", () => {
    test("输出 46：服务商给了总数用总数；模型端口给了 compactAt 用它", async () => {
        await using byTotal = await createTestSession({profile: profileWith({onThreshold: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        byTotal.model.script({text: "答一", usage: {totalTokens: 90_000}}, "摘要", "答二");
        await byTotal.say("第一问");
        expect(types((await byTotal.say("第二问")).events)).toContain("compaction");

        await using byCompactAt = await createTestSession({modelInfo: {id: "test/small", contextWindow: 100_000, compactAt: 100, capabilities: {vision: false, thinking: false}, efforts: []}, profile: profileWith({onThreshold: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        byCompactAt.model.script({text: "答一", usage: {input: 400}}, "摘要", "答二");
        await byCompactAt.say("第一问");
        expect(types((await byCompactAt.say("第二问")).events)).toContain("compaction");
    });

    test("输出 46、47：省略之后按占位估算，再次压缩时的 token 估算变小", async () => {
        const jobs: CompactionJob[] = [];
        let round = 0;
        const shake: CompactionMethodImpl = async (job) => {
            jobs.push(job);
            round += 1;
            const tool = job.request.messages.find((message) => message.role === "tool");
            const omitted = round === 1 && tool !== undefined ? [{entryId: (tool.content[0]!.origin as {eventId: string}).eventId, placeholder: "（已省略）"}] : [];
            return {method: job.method, firstKeptEntryId: job.cuts[0]!.entryId, replacement: null, omitted, tokensBefore: job.tokens, tokensAfter: 1};
        };
        await using session = await createTestSession({profile: profileWith({onThreshold: ["shake"]}), compaction: {methods: {shake}}, tools: [{id: "lab.read", execute: () => "很长的原文".repeat(3_000)}]});
        session.model.script({tools: [{tool: "lab.read"}]}, "读完了", "答二", "答三");
        await session.say("读文件");
        await session.raw.compact({commandId: id()}).then(async (accepted) => accepted.ok && accepted.value.runId !== undefined && session.raw.waitRun(accepted.value.runId));
        await session.raw.compact({commandId: id()}).then(async (accepted) => accepted.ok && accepted.value.runId !== undefined && session.raw.waitRun(accepted.value.runId));
        expect(jobs).toHaveLength(2);
        expect(jobs[1]!.tokens).toBeLessThan(jobs[0]!.tokens / 10);
    });
});

describe("失败与边界", () => {
    test("输出 51：不理会中止信号的方法与放回内容的回调挡不住中止", async () => {
        for (const stuck of ["method", "restore"] as const) {
            let entered!: () => void;
            const inside = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const hang = <T>() => new Promise<T>(() => undefined);
            const method: CompactionMethodImpl = async (job) => {
                if (stuck === "method") {
                    entered();
                    return hang();
                }
                return {method: job.method, firstKeptEntryId: null, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1};
            };
            await using session = await createTestSession({profile: profileWith({onThreshold: ["m"]}), compaction: {methods: {m: method}, restore: () => {
                entered();
                return hang<readonly string[]>();
            }}});
            session.model.script({text: "答一", usage: HEAVY});
            await session.say("第一问");
            const sent = await session.raw.send({commandId: id(), input: {text: "第二问"}});
            if (!sent.ok || sent.value.runId === null) throw new Error("no run");
            await inside;
            await session.raw.abort({commandId: id()});
            expect((await session.raw.waitRun(sent.value.runId)).reason).toBe("aborted");
            expect(types(await session.events())).not.toContain("compaction");
        }
    });

    test("输出 47：压缩前的请求算不出来时不压缩，手动压缩以 compaction-failed 收口", async () => {
        let broken = false;
        const profile = defineProfile({id: "lab.fragile", version: "1", name: "f", description: "f", system: () => {
            if (broken) throw new Error("system 坏了");
            return "系统";
        }, compaction: {onThreshold: ["summarize"]}}) as AnyProfile;
        await using session = await createTestSession({profile, compaction: {methods: {summarize: summarizingCompaction}}});
        session.model.script("答一");
        await session.say("第一问");
        broken = true;
        const accepted = await session.raw.compact({commandId: id()});
        if (!accepted.ok || accepted.value.runId === undefined) throw new Error("compact did not start");
        expect(await session.raw.waitRun(accepted.value.runId)).toMatchObject({reason: "error", error: {code: "compaction-failed"}});
        expect(types(await session.events())).not.toContain("compaction");
        expect(session.model.requests).toHaveLength(1);
    });

    test("输出 47：缺字段、无穷大或字符串的 token 都算不合格，换下一个方法", async () => {
        const bads: CompactionMethodImpl[] = [
            async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "x", tokensBefore: 1, tokensAfter: 1}) as never,
            async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "x", omitted: [], tokensBefore: 1, tokensAfter: Number.POSITIVE_INFINITY}),
            async (job) => ({method: job.method, firstKeptEntryId: null, replacement: "x", omitted: [], tokensBefore: 1, tokensAfter: "99999" as never}),
        ];
        for (const bad of bads) {
            await using session = await createTestSession({profile: profileWith({onThreshold: ["bad", "good"]}), compaction: {methods: {bad, good: summarizingCompaction}}});
            session.model.script("答一", "摘要");
            await session.say("第一问");
            const accepted = await session.raw.compact({commandId: id()});
            if (!accepted.ok || accepted.value.runId === undefined) throw new Error("compact did not start");
            expect((await session.raw.waitRun(accepted.value.runId)).reason).toBe("completed");
            expect(dataOf(await session.events(), "compaction")[0]).toMatchObject({method: "good"});
            expect(await codes(session)).toContain("compaction-invalid");
        }
    });

    test("输出 52：运行中受理的 compact 只属于那次运行：运行没到下一个边界就结束时丢掉，不会被下一次运行拿到", async () => {
        const jobs: CompactionJob[] = [];
        const record: CompactionMethodImpl = async (job) => {
            jobs.push(job);
            return summarizingCompaction(job);
        };
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        let replying!: () => void;
        const inside = new Promise<void>((resolve) => {
            replying = resolve;
        });
        let calls = 0;
        const hold = defineExtension({id: "lab.hold", intercept: {model: async (request, next) => {
            calls += 1;
            if (calls === 2) {
                replying();
                await held;
            }
            return next(request);
        }}});
        await using session = await createTestSession({extensions: [hold], profile: profileWith({onThreshold: ["record"]}), compaction: {methods: {record}}});
        session.model.script("答一", "答二", "答三");
        await session.say("第一问");
        const sent = await session.raw.send({commandId: id(), input: {text: "第二问"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await inside;
        expect(await session.raw.compact({commandId: id(), requirement: "只给第二轮"})).toMatchObject({ok: true, value: {scheduled: "next-boundary"}});
        release();
        await session.raw.waitRun(sent.value.runId);
        await session.say("第三问");
        expect(jobs).toHaveLength(0);
    });

    test("输出 52：对话模型不可用时只压缩的运行照样用压缩的模型跑", async () => {
        await using session = await createTestSession({profile: profileWith({onThreshold: ["summarize"]}), compaction: {methods: {summarize: summarizingCompaction}}});
        session.model.script("答一", "摘要");
        await session.say("第一问");
        session.model.unavailable.add("turn");
        const accepted = await session.raw.compact({commandId: id()});
        if (!accepted.ok || accepted.value.runId === undefined) throw new Error("compact did not start");
        expect((await session.raw.waitRun(accepted.value.runId)).reason).toBe("completed");
        expect(types(await session.events())).toContain("compaction");
    });

    test("extensions 输出 17：压缩切掉早先的步，这一轮 continue 的上限不重置", async () => {
        let asked = 0;
        const nudger = defineExtension({id: "lab.nudge", on: {assistant: (_event, ctx) => {
            if (ctx.continue("接着写", {max: 1})) asked += 1;
        }}});
        const keepLastStep: CompactionMethodImpl = async (job) => {
            const cut = job.cuts.filter((item) => item.kind === "step").at(-1) ?? job.cuts.at(-1)!;
            return {method: job.method, firstKeptEntryId: cut.entryId, replacement: "摘要", omitted: [], tokensBefore: job.tokens, tokensAfter: 1};
        };
        await using session = await createTestSession({extensions: [nudger], profile: profileWith({onThreshold: ["keep"]}), compaction: {methods: {keep: keepLastStep}}});
        session.model.script({text: "一", usage: HEAVY}, {text: "二", usage: HEAVY}, {text: "三", usage: HEAVY});
        const report = await session.say("写");
        expect(asked).toBe(1);
        expect(dataOf(report.events, "continued")).toEqual([{text: "接着写", by: "lab.nudge", count: 1}]);
        expect(report.result.reason).toBe("completed");
    });
});
