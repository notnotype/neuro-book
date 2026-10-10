import {afterEach, describe, expect, test} from "bun:test";
import type {AssistantMessage, Message} from "@oh-my-pi/pi-ai";
import {createCompactionRegistry, createSoftCompaction} from "../compaction/compaction";
import type {CompleteImpl} from "../compaction/compaction";
import {createHarness, invocationPhases, kinds} from "./testing/harness";
import type {Harness} from "./testing/harness";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

/** 摘要传输脚本化（OMP SummaryOptions.completeImpl），记录提示词。 */
function scriptedRegistry(): {registry: ReturnType<typeof createCompactionRegistry>; prompts: string[]} {
    const prompts: string[] = [];
    const completeImpl: CompleteImpl = async (model, ctx) => {
        prompts.push(ctx.messages.map((message: Message) => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "")).join(""))).join("\n"));
        const reply: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text: `摘要#${prompts.length}`}], usage, stopReason: "stop", timestamp: prompts.length};
        return reply;
    };
    const registry = createCompactionRegistry();
    const registered = registry.register({...createSoftCompaction({completeImpl}), id: "scripted"});
    if (!registered.ok) throw new Error(registered.detail);
    return {registry, prompts};
}

describe("压缩（输出 14、15）", () => {
    test("场景 8：手动 compact 在没有历史时返回 null；阈值很低时调用 completed 后自动压缩，done 完成时日志末尾已是压缩条目与种子", async () => {
        const {registry, prompts} = scriptedRegistry();
        const harness = await createHarness({
            compaction: registry,
            fields: {"harness/compaction": {methods: ["scripted"], keepRecentTokens: 60, threshold: {tokens: 100}}},
            script: Array.from({length: 6}, (_, index) => ({text: `第 ${index + 1} 次回复 `.repeat(30), usage: {input: 500, output: 20, totalTokens: 520}})),
        });
        harnesses.push(harness);
        const created = await harness.runtime.createSession({profileId: "writer", id: "s1"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const events: string[] = [];
        session.subscribe((event) => {
            if (event.type === "compaction") events.push(event.result.ok ? `ok:${event.result.method}` : `fail:${event.result.code}`);
        });
        expect(await session.compact()).toEqual({ok: true, value: null});

        for (let index = 0; index < 3; index += 1) {
            const started = await session.prompt({content: `第 ${index + 1} 轮输入 `.repeat(30)});
            if (!started.ok) throw new Error(started.code);
            expect((await started.value.done).status).toBe("completed");
        }
        // 用量 520 超过阈值 100：每次 completed 后都压缩（第一次历史太短时不压，由方法自己判断）
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((item) => item === "ok:scripted")).toBe(true);
        const tail = kinds(session.log.entries).slice(-2);
        expect(tail).toEqual(["compaction", "custom_message:harness/seed"]);
        const seed = session.log.entries.at(-1)!;
        expect(seed.type === "custom_message" && seed.details).toEqual({role: "developer"});
        expect(prompts.length).toBeGreaterThan(0);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "end", "start", "end", "start", "end"]);

        // 压缩后再调用：模型看到种子、摘要与保留的历史
        const after = await session.prompt({content: "压缩后"});
        if (!after.ok) throw new Error(after.code);
        expect((await after.value.done).status).toBe("completed");
        const context = harness.contexts.at(-1)!;
        expect(context.messages[0]).toMatchObject({role: "developer"});
        expect(JSON.stringify(context.messages[1]!.content)).toContain("摘要#");

        // 自动压缩写入的条目算在本次调用里
        const last = await session.prompt({content: "再来一轮 ".repeat(30)});
        if (!last.ok) throw new Error(last.code);
        const lastResult = await last.value.done;
        expect(kinds(lastResult.entries).slice(-2)).toEqual(["compaction", "custom_message:harness/seed"]);
        expect(lastResult.entries).toEqual(session.log.entries.slice(-lastResult.entries.length));

        // 压缩期间会话被占用：第二次 compact 与 prompt 都 busy，直到第一次完成
        let releaseSummary: () => void = () => undefined;
        const gated = new Promise<void>((resolve) => {
            releaseSummary = resolve;
        });
        const slow = createCompactionRegistry();
        const slowComplete: CompleteImpl = async (model, ctx) => {
            await gated;
            const text = ctx.messages.length > 0 ? "慢摘要" : "";
            return {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text}], usage, stopReason: "stop", timestamp: 1} as AssistantMessage;
        };
        const slowRegistered = slow.register({...createSoftCompaction({completeImpl: slowComplete}), id: "slow"});
        if (!slowRegistered.ok) throw new Error(slowRegistered.detail);
        const slowHarness = await createHarness({compaction: slow, fields: {"harness/compaction": {methods: ["slow"], keepRecentTokens: 60, threshold: {tokens: 100_000}}}, script: Array.from({length: 3}, () => ({text: "回复 ".repeat(40)}))});
        harnesses.push(slowHarness);
        const slowSession = await slowHarness.runtime.createSession({profileId: "writer"});
        if (!slowSession.ok) throw new Error(slowSession.code);
        for (let index = 0; index < 3; index += 1) {
            const started = await slowSession.value.prompt({content: `第 ${index} 轮 `.repeat(40)});
            if (!started.ok) throw new Error(started.code);
            await started.value.done;
        }
        const firstCompact = slowSession.value.compact();
        expect(await slowSession.value.compact()).toMatchObject({ok: false, code: "busy"});
        expect(await slowSession.value.prompt({content: "压缩中"})).toMatchObject({ok: false, code: "busy"});
        releaseSummary();
        const compacted = await firstCompact;
        expect(compacted.ok && compacted.value?.method).toBe("slow");
        expect(slowSession.value.log.entries.filter((entry) => entry.type === "compaction")).toHaveLength(1);
        expect((await slowSession.value.compact()).ok).toBe(true);

        // 自动压缩是调用的尾段：期间 abort 取消压缩、不写条目，调用结果仍是 completed
        let releaseAuto: () => void = () => undefined;
        let autoStarted: () => void = () => undefined;
        const autoGate = new Promise<void>((resolve) => {
            releaseAuto = resolve;
        });
        const started = new Promise<void>((resolve) => {
            autoStarted = resolve;
        });
        const autoRegistry = createCompactionRegistry();
        const autoComplete: CompleteImpl = async (model, ctx) => {
            autoStarted();
            await autoGate;
            return {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text: ctx.messages.length > 0 ? "摘要" : ""}], usage, stopReason: "stop", timestamp: 1} as AssistantMessage;
        };
        const autoRegistered = autoRegistry.register({...createSoftCompaction({completeImpl: autoComplete}), id: "auto"});
        if (!autoRegistered.ok) throw new Error(autoRegistered.detail);
        const autoHarness = await createHarness({compaction: autoRegistry, fields: {"harness/compaction": {methods: ["auto"], keepRecentTokens: 60, threshold: {tokens: 100}}}, script: Array.from({length: 3}, () => ({text: "回复 ".repeat(200), usage: {input: 500, output: 20, totalTokens: 520}}))});
        harnesses.push(autoHarness);
        const autoSession = await autoHarness.runtime.createSession({profileId: "writer"});
        if (!autoSession.ok) throw new Error(autoSession.code);
        const compactionEvents: string[] = [];
        autoSession.value.subscribe((event) => {
            if (event.type === "compaction") compactionEvents.push(event.result.ok ? "ok" : event.result.code);
        });
        // 第一次调用就超阈值：它的尾段（自动压缩）卡在摘要传输上
        const entriesBefore = autoSession.value.log.entries.length;
        const tailRun = await autoSession.value.prompt({content: "一 ".repeat(200)});
        if (!tailRun.ok) throw new Error(tailRun.code);
        await started;
        expect(autoSession.value.status.phase).toBe("running");
        expect(autoSession.value.abort()).toEqual({ok: true, value: undefined});
        releaseAuto();
        const abortedTail = await tailRun.value.done;
        expect(abortedTail.status).toBe("completed");
        expect(compactionEvents.at(-1)).toBe("cancelled");
        expect(autoSession.value.log.entries.slice(entriesBefore).filter((entry) => entry.type === "compaction")).toHaveLength(0);
        expect(invocationPhases(autoSession.value.log.entries)).toEqual(["start", "end"]);
        expect(autoSession.value.status.phase).toBe("idle");

        // 手动压缩：方法顺序里有未注册的 id → compaction-failed；运行中 → busy
        const bad = await createHarness({compaction: registry, fields: {"harness/compaction": {methods: ["nope"]}}, script: [{text: "x"}]});
        harnesses.push(bad);
        const badSession = await bad.runtime.createSession({profileId: "writer"});
        if (!badSession.ok) throw new Error(badSession.code);
        const run = await badSession.value.prompt({content: "一"});
        if (!run.ok) throw new Error(run.code);
        expect(await badSession.value.compact()).toMatchObject({ok: false, code: "busy"});
        await run.value.done;
        expect(await badSession.value.compact()).toMatchObject({ok: false, code: "compaction-failed"});
    });
});
