import {describe, expect, test} from "bun:test";
import type {AssistantMessage, Message} from "@oh-my-pi/pi-ai";
import {buildModel} from "@oh-my-pi/pi-catalog/build";
import {buildModelContext, createMemorySessionStore, createSession} from "../session/session";
import type {EntryInput, SessionLog} from "../session/session";
import {assistantMessage, seed, userMessage} from "../session/testing/fixtures";
import {withFailingAppend} from "../session/testing/store-scenarios";
import {COMPACTION_FIELD, compactSession, createCompactionRegistry, createSoftCompaction, resolveCompactionSettings, shouldCompact} from "./compaction";
import type {CompactionMethod, CompactionSettings, CompleteImpl} from "./compaction";
import {Value} from "typebox/value";

const model = buildModel({
    id: "m", name: "m", provider: "p", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100_000, maxTokens: 4_000,
});
const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
// 六轮对话，每轮约 400 字：keepRecentTokens 取 300 时只保留最后一轮
const settings: CompactionSettings = resolveCompactionSettings({keepRecentTokens: 300});

async function sessionWithTurns(turns: number, store = createMemorySessionStore()): Promise<SessionLog> {
    const created = await createSession(store, {id: "s"});
    if (!created.ok) throw new Error(created.detail);
    const inputs: EntryInput[] = [seed("技能目录", {role: "developer"}), seed("只写一次", {once: true})];
    for (let i = 1; i <= turns; i++) {
        inputs.push(userMessage(`第 ${i} 轮用户说的话 `.repeat(40), i * 10));
        inputs.push(assistantMessage([{type: "text", text: `第 ${i} 轮助手的回答 `.repeat(40)}], {timestamp: i * 10 + 1}));
    }
    const appended = await created.value.append(inputs);
    if (!appended.ok) throw new Error(appended.detail);
    return created.value;
}

/** 脚本化的摘要传输：记录每次提示词，按顺序回复；OMP 给宿主的正式接口，产品代码没有测试分支。 */
function scripted(replies: (() => Partial<AssistantMessage>)[] = [], every?: () => Partial<AssistantMessage>): {completeImpl: CompleteImpl; prompts: string[]} {
    const prompts: string[] = [];
    const completeImpl: CompleteImpl = async (m, ctx) => {
        prompts.push(ctx.messages.map((message: Message) => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "")).join(""))).join("\n"));
        const base: AssistantMessage = {role: "assistant", api: m.api, provider: m.provider, model: m.id, content: [{type: "text", text: `摘要#${prompts.length}`}], usage, stopReason: "stop", timestamp: prompts.length};
        return {...base, ...(every?.() ?? {}), ...(replies[prompts.length - 1]?.() ?? {})};
    };
    return {completeImpl, prompts};
}

function registryWith(...methods: CompactionMethod[]) {
    const registry = createCompactionRegistry();
    for (const method of methods) {
        const result = registry.register(method);
        if (!result.ok) throw new Error(result.detail);
    }
    return registry;
}

const never: CompactionMethod = {id: "never", applicable: () => ({ok: false, detail: "从不适用"}), run: async () => ({ok: false, detail: "不该被调用"})};
const flaky: CompactionMethod = {id: "flaky", applicable: () => ({ok: true}), run: async () => { throw new Error("上游挂了"); }};

describe("注册表（输出 1）", () => {
    test("场景 1：新建即有 soft；重复 id 得 duplicate-method；dispose 后可再注册；不合规的方法得 invalid-method", () => {
        const registry = createCompactionRegistry();
        expect(registry.list()).toEqual(["soft"]);
        expect(registry.register(createSoftCompaction()).ok).toBe(false);
        const custom = registry.register(never);
        if (!custom.ok) throw new Error(custom.detail);
        expect(registry.list()).toEqual(["soft", "never"]);
        const again = registry.register({...never});
        expect(again.ok ? null : again.code).toBe("duplicate-method");
        custom.value.dispose();
        expect(registry.get("never")).toBeUndefined();
        expect(registry.register(never).ok).toBe(true);
        for (const bad of [{id: "bad id", applicable: never.applicable, run: never.run}, {id: "x", applicable: never.applicable}, {id: "plugin/ok", run: never.run}, null]) {
            const result = registry.register(bad as never);
            expect(result.ok ? null : result.code).toBe("invalid-method");
        }
        expect(registry.register({...never, id: "my.plugin/summarise"}).ok).toBe(true);
    });
});

describe("顺序、写入与回放（输出 2–8、11）", () => {
    test("场景 2、3：不适用与失败的方法被跳过，soft 胜出；压缩条目与种子一批追加；回放为种子、摘要、保留的历史；再次压缩带上一条摘要", async () => {
        const log = await sessionWithTurns(6);
        const before = log.entries.length;
        const {completeImpl, prompts} = scripted();
        // 内置的 soft 走真实传输；测试用同一实现换上脚本化传输，另起一个 id 注册
        const mine = {registry: registryWith(never, flaky, {...createSoftCompaction({completeImpl}), id: "scripted-soft"}), order: ["never", "flaky", "scripted-soft"]};

        const result = await compactSession({log, registry: mine.registry, methods: mine.order, model, apiKey: "k", settings, seeds: [seed("技能目录", {role: "developer"})]});
        if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
        expect(result.value.method).toBe("scripted-soft");
        expect(result.value.entries.map((entry) => entry.type)).toEqual(["compaction", "custom_message"]);
        expect(log.entries.length).toBe(before + 2);
        const compaction = log.entries[before]!;
        if (compaction.type !== "compaction") throw new Error("应是压缩条目");
        expect(compaction.summary).toContain("摘要#1");
        expect(compaction.shortSummary).toMatch(/^摘要#\d$/u);
        expect(log.entries.some((entry) => entry.id === compaction.firstKeptEntryId)).toBe(true);
        expect(compaction.details).toEqual({readFiles: [], modifiedFiles: []});

        const context = buildModelContext(log.entries);
        expect(context[0]).toMatchObject({role: "developer", content: "技能目录"});
        expect(context[1]).toMatchObject({role: "user", attribution: "agent"});
        expect(JSON.stringify(context[1]!.content)).toContain("摘要#1");
        // 切点由 OMP 按 keepRecentTokens 定（这里切在第 6 轮中间）：保留的历史只有近期的，前几轮都进了摘要
        const kept = context.slice(2).map((message) => JSON.stringify(message.content));
        expect(kept.length).toBeGreaterThan(0);
        expect(kept.at(-1)).toContain("第 6 轮");
        expect(kept.some((text) => text.includes("第 1 轮"))).toBe(false);

        // 再追加三轮后二次压缩：OMP 从上一条 firstKeptEntryId 起取历史，提示词里带上一条摘要
        for (let i = 7; i <= 9; i++) await log.append([userMessage(`第 ${i} 轮用户 `.repeat(40), i * 10), assistantMessage([{type: "text", text: `第 ${i} 轮助手 `.repeat(40)}], {timestamp: i * 10 + 1})]);
        const promptsBefore = prompts.length;
        const second = await compactSession({log, registry: mine.registry, methods: ["scripted-soft"], model, apiKey: "k", settings});
        if (!second.ok) throw new Error(`${second.code}: ${second.detail}`);
        expect(prompts.slice(promptsBefore).some((prompt) => prompt.includes("<previous-summary>") && prompt.includes("摘要#1"))).toBe(true);
        const again = buildModelContext(log.entries);
        expect(again[0]).toMatchObject({role: "user", attribution: "agent"});
        expect(JSON.stringify(again.at(-1)!.content)).toContain("第 9 轮助手");
        expect(again.some((message) => JSON.stringify(message.content).includes("第 6 轮用户"))).toBe(false);
    });

    test("场景 2：顺序里有未注册的 id → unknown-method 且不写入；全部不适用 → nothing-to-compact；有失败无成功 → compaction-failed，attempts 按序", async () => {
        const log = await sessionWithTurns(6);
        const before = log.entries.length;
        const registry = registryWith(never, flaky);
        const unknown = await compactSession({log, registry, methods: ["soft", "nope"], model, apiKey: "k", settings});
        expect(unknown.ok ? null : unknown.code).toBe("unknown-method");
        const nothing = await compactSession({log, registry, methods: ["never"], model, apiKey: "k", settings});
        expect(nothing.ok ? null : [nothing.code, nothing.attempts]).toEqual(["nothing-to-compact", [{method: "never", detail: "不适用：从不适用"}]]);
        // 历史太短时 soft 也不适用
        const short = await sessionWithTurns(1);
        const tooShort = await compactSession({log: short, registry, methods: ["soft"], model, apiKey: "k", settings: resolveCompactionSettings({keepRecentTokens: 100_000})});
        expect(tooShort.ok ? null : tooShort.code).toBe("nothing-to-compact");
        const failed = await compactSession({log, registry, methods: ["never", "flaky"], model, apiKey: "k", settings});
        expect(failed.ok ? null : [failed.code, failed.attempts]).toEqual(["compaction-failed", [{method: "never", detail: "不适用：从不适用"}, {method: "flaky", detail: "失败：上游挂了"}]]);
        expect(log.entries.length).toBe(before);
    });

    test("输出 4：结果不合规（切点不在条目里、摘要为空）当作该方法失败，换下一个", async () => {
        const log = await sessionWithTurns(6);
        const bogus: CompactionMethod = {id: "bogus", applicable: () => ({ok: true}), run: async () => ({ok: true, value: {summary: "s", firstKeptEntryId: "not-there", tokensBefore: 1}})};
        const empty: CompactionMethod = {id: "empty", applicable: () => ({ok: true}), run: async (input) => ({ok: true, value: {summary: "", firstKeptEntryId: input.entries[0]!.id, tokensBefore: 1}})};
        const {completeImpl} = scripted();
        const registry = registryWith(bogus, empty, {...createSoftCompaction({completeImpl}), id: "scripted-soft"});
        const result = await compactSession({log, registry, methods: ["bogus", "empty", "scripted-soft"], model, apiKey: "k", settings});
        if (!result.ok) throw new Error(result.code);
        expect(result.value.method).toBe("scripted-soft");
        const onlyBad = await compactSession({log: await sessionWithTurns(6), registry, methods: ["bogus", "empty"], model, apiKey: "k", settings});
        expect(onlyBad.ok ? null : onlyBad.attempts?.map((item) => item.detail)).toEqual(["失败：结果不合规（firstKeptEntryId 不是输入条目的 id）", "失败：结果不合规（summary 必须是非空字符串）"]);
    });

    test("场景 3：append 被拒绝 → log-failed 且不留条目（存储失败后句柄已坏，后续写入都失败）；种子不合会话规则时整批被拒", async () => {
        const store = withFailingAppend(createMemorySessionStore());
        const log = await sessionWithTurns(6, store);
        const before = log.entries.length;
        const {completeImpl} = scripted();
        const registry = registryWith({...createSoftCompaction({completeImpl}), id: "scripted-soft"});
        store.failNext();
        const failed = await compactSession({log, registry, methods: ["scripted-soft"], model, apiKey: "k", settings});
        expect(failed.ok ? null : [failed.code, failed.detail]).toEqual(["log-failed", "store-failed：模拟的 I/O 失败"]);
        expect(log.entries.length).toBe(before);

        const fresh = await sessionWithTurns(6);
        const badSeed = await compactSession({log: fresh, registry, methods: ["scripted-soft"], model, apiKey: "k", settings, seeds: [{type: "custom_message", customType: "harness/seed", content: "x", display: true, details: {}}]});
        expect(badSeed.ok ? null : [badSeed.code, badSeed.detail.startsWith("invalid-entry")]).toEqual(["log-failed", true]);
        expect(fresh.entries.length).toBe(before);
    });

    test("场景 4：中止 → cancelled 不写入；模型回复 error（OMP 缺省重试三次后仍失败）→ 方法失败带错误文本；输入不被修改", async () => {
        const log = await sessionWithTurns(6);
        const before = log.entries.length;
        // 传输在第一次调用时中止并以 aborted 回复（OMP 本地摘要对此不抛出，拼出来的“摘要”只剩分隔符）
        const controller = new AbortController();
        const aborting = scripted([() => {
            controller.abort();
            return {content: [], stopReason: "aborted"};
        }]);
        const abortRegistry = registryWith({...createSoftCompaction({completeImpl: aborting.completeImpl}), id: "scripted-soft"});
        const cancelled = await compactSession({log, registry: abortRegistry, methods: ["scripted-soft"], model, apiKey: "k", settings, signal: controller.signal});
        expect(cancelled.ok ? null : cancelled.code).toBe("cancelled");
        expect(log.entries.length).toBe(before);
        const preAborted = await compactSession({log, registry: abortRegistry, methods: ["scripted-soft"], model, apiKey: "k", settings, signal: AbortSignal.abort()});
        expect(preAborted.ok ? null : preAborted.code).toBe("cancelled");
        expect(aborting.prompts.length).toBeGreaterThanOrEqual(1);

        const erroring = scripted([], () => ({content: [], stopReason: "error", errorMessage: "配额用完"}));
        const errorRegistry = registryWith({...createSoftCompaction({completeImpl: erroring.completeImpl}), id: "scripted-soft"});
        const snapshot = JSON.stringify(log.entries);
        const settingsSnapshot = JSON.stringify(settings);
        const errored = await compactSession({log, registry: errorRegistry, methods: ["scripted-soft"], model, apiKey: "k", settings});
        expect(errored.ok ? null : [errored.code, errored.attempts?.[0]?.detail.includes("配额用完")]).toEqual(["compaction-failed", true]);
        expect(JSON.stringify(log.entries)).toBe(snapshot);
        expect(JSON.stringify(settings)).toBe(settingsSnapshot);
    });
});

describe("soft 单独使用（输出 7、8）", () => {
    test("服务方支持原生压缩的模型（openai-responses）也走本地摘要、不碰网络；直接调用 run 时中止以 aborted 失败而不是把空回复当摘要", async () => {
        const responses = buildModel({
            // OMP 对 provider 为 openai 的 responses 模型会走服务方原生压缩（打到 baseUrl，这里连不上）；关闭后只走本地摘要
            id: "r", name: "r", provider: "openai", api: "openai-responses", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100_000, maxTokens: 4_000,
        });
        const log = await sessionWithTurns(6);
        const {completeImpl, prompts} = scripted();
        const local = await compactSession({log, registry: registryWith({...createSoftCompaction({completeImpl}), id: "scripted-soft"}), methods: ["scripted-soft"], model: responses, apiKey: "k", settings});
        expect(local.ok ? local.value.output.summary : local.code).toContain("摘要#");
        expect(prompts.length).toBeGreaterThanOrEqual(2);

        const controller = new AbortController();
        const aborting = scripted([], () => {
            controller.abort();
            return {content: [], stopReason: "aborted"};
        });
        const direct = await createSoftCompaction({completeImpl: aborting.completeImpl}).run({entries: (await sessionWithTurns(6)).entries, model, apiKey: "k", settings}, controller.signal);
        expect(direct).toEqual({ok: false, detail: "aborted"});
    });
});

describe("阈值与设置（输出 9、10）", () => {
    const withUsage = (contextTokens: number | undefined, totalTokens: number, stopReason: AssistantMessage["stopReason"] = "stop"): EntryInput => ({
        type: "message",
        message: {role: "assistant", content: [{type: "text", text: "x"}], api: "openai-completions", provider: "p", model: "m", stopReason, timestamp: 1, usage: {...usage, totalTokens, ...(contextTokens === undefined ? {} : {contextTokens})}},
    });
    const entriesOf = async (...inputs: EntryInput[]) => {
        const created = await createSession(createMemorySessionStore(), {id: "t"});
        if (!created.ok) throw new Error(created.detail);
        await created.value.append([userMessage("一"), ...inputs]);
        return created.value.entries;
    };

    test("场景 5：百分比与固定阈值；没有可用用量不压缩；error 的助手消息不算", async () => {
        const percent = resolveCompactionSettings({threshold: {percent: 80}});
        expect(shouldCompact({entries: await entriesOf(withUsage(80_001, 0)), contextWindow: 100_000, settings: percent})).toEqual({compact: true, contextTokens: 80_001, thresholdTokens: 80_000});
        expect(shouldCompact({entries: await entriesOf(withUsage(80_000, 0)), contextWindow: 100_000, settings: percent}).compact).toBe(false);
        const tokens = resolveCompactionSettings({threshold: {tokens: 50_000}});
        expect(shouldCompact({entries: await entriesOf(withUsage(undefined, 50_001)), contextWindow: 100_000, settings: tokens})).toEqual({compact: true, contextTokens: 50_001, thresholdTokens: 50_000});
        expect(shouldCompact({entries: await entriesOf(), contextWindow: 100_000, settings: tokens})).toEqual({compact: false, contextTokens: null, thresholdTokens: 50_000});
        expect(shouldCompact({entries: await entriesOf(withUsage(90_000, 0), withUsage(99_000, 0, "error")), contextWindow: 100_000, settings: percent}).contextTokens).toBe(90_000);
        // 百分比不能吃掉余量：窗口 20000、95% 时阈值是 20000 - 16384
        expect(shouldCompact({entries: await entriesOf(withUsage(5_000, 0)), contextWindow: 20_000, settings: resolveCompactionSettings({threshold: {percent: 95}})})).toEqual({compact: true, contextTokens: 5_000, thresholdTokens: 3_616});
        expect(shouldCompact({entries: await entriesOf(withUsage(5, 0)), contextWindow: 0, settings: percent}).compact).toBe(false);
    });

    test("场景 6：缺省值与覆盖、深冻结；字段 schema 拒绝未知键、percent 100、空的 methods 项", () => {
        const defaults = resolveCompactionSettings(undefined);
        expect(defaults).toEqual({methods: ["soft"], keepRecentTokens: 20_000, threshold: {percent: 80}});
        expect(resolveCompactionSettings({})).toEqual(defaults);
        expect(() => {
            (defaults.methods as string[]).push("x");
        }).toThrow(TypeError);
        expect(resolveCompactionSettings({methods: ["a", "soft"], reserveTokens: 1_000, threshold: {tokens: 5}, instructions: "多提人名"})).toEqual({methods: ["a", "soft"], keepRecentTokens: 20_000, reserveTokens: 1_000, threshold: {tokens: 5}, instructions: "多提人名"});
        const valid = (value: unknown) => Value.Check(COMPACTION_FIELD.schema, value);
        expect(valid({methods: ["soft"], threshold: {percent: 99}})).toBe(true);
        expect(valid({extra: 1})).toBe(false);
        expect(valid({threshold: {percent: 100}})).toBe(false);
        expect(valid({methods: [""]})).toBe(false);
        expect(valid({methods: ["a", "a"]})).toBe(false);
        expect(valid({threshold: {tokens: 1, percent: 1}})).toBe(false);
    });
});
