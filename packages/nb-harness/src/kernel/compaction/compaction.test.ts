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
