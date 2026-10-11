import {afterEach, describe, expect, test} from "bun:test";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Tokenizer} from "@oh-my-pi/pi-agent-core";
import {buildModelContext, createMemorySessionStore} from "../session/session";
import {withFailingAppend} from "../session/testing/store-scenarios";
import {createStaticToolSource} from "../tools/tools";
import type {AgentSession, RuntimeEvent} from "./runtime";
import Type from "typebox";
import {Appending, defineProfile, History, Input, nodeComponent, Prompt, System, User} from "../profile/profile";
import {createConfigStore} from "../config/config";
import {openCredentials} from "../models/models";
import {createProfileCatalog, createProfileHost} from "../profile/profile";
import {createRuntime, HarnessError, openRuntime, unwrap} from "./runtime";
import {createHarness, echoTool, invocationPhases, kinds, scriptedStream, shellTool, testProfile} from "./testing/harness";
import type {Harness} from "./testing/harness";

const harnesses: Harness[] = [];
afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.cleanup();
});

async function open(options: Parameters<typeof createHarness>[0] = {}): Promise<{harness: Harness; session: AgentSession; events: RuntimeEvent[]}> {
    const harness = await createHarness(options);
    harnesses.push(harness);
    const created = await harness.runtime.createSession({profileId: "writer", id: "s1", title: "第三章"});
    if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
    const events: RuntimeEvent[] = [];
    created.value.subscribe((event) => events.push(event));
    return {harness, session: created.value, events};
}

describe("一次完整调用（输出 2–5、9）", () => {
    test("场景 1：写入顺序、事件序号、状态变化、done 的结果；第二次调用不再写种子、提醒按轮触发", async () => {
        const {harness, session, events} = await open({script: [{calls: [{id: "c1", name: "echo", args: {text: "你好"}}]}, {text: "改好了"}, {text: "第二次"}]});
        const before = session.log.entries.length;
        const started = await session.prompt({content: "改第三章"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        expect(kinds(session.log.entries.slice(before))[0]).toBe("custom:harness/invocation");
        const result = await started.value.done;
        expect(result.status).toBe("completed");
        expect(kinds(result.entries)).toEqual([
            "custom:harness/invocation", "custom_message:harness/seed", "custom_message:harness/seed", "model_change",
            "message:user", "custom_message:harness/reminder", "custom:harness/profile-state",
            "message:assistant", "message:toolResult", "message:assistant", "custom:harness/invocation",
        ]);
        expect(result.entries).toEqual(session.log.entries.slice(before));
        expect(invocationPhases(result.entries)).toEqual(["start", "end"]);
        const startEntry = result.entries[0]!;
        expect(startEntry.type === "custom" && startEntry.data).toEqual({invocationId: started.value.invocationId, phase: "start", detail: {profileId: "writer", model: "test/m", tools: ["echo", "note", "shell"], reason: "prompt"}});
        expect(session.status).toMatchObject({phase: "idle", pending: [], queue: {steer: 0, followUp: 0}, profileId: "writer", model: "test/m"});

        // 事件：序号单调递增；status 先 running 后 idle；entry 事件覆盖每条写入；stream 与 tool 事件出现
        expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
        const statuses = events.filter((event) => event.type === "status").map((event) => (event as {status: {phase: string}}).status.phase);
        expect(statuses).toEqual(["running", "idle"]);
        expect(events.filter((event) => event.type === "entry")).toHaveLength(result.entries.length);
        expect(events.some((event) => event.type === "stream")).toBe(true);
        expect(events.filter((event) => event.type === "tool").map((event) => (event as {stage: string}).stage)).toEqual(["start", "end"]);
        // 模型第一次看到：系统提示词、种子、输入、提醒；第二次多了助手消息与工具结果
        expect(harness.contexts[0]!.systemPrompt).toEqual(["你是写作助手。"]);
        expect(harness.contexts[0]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user"]);
        expect(harness.contexts[1]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user", "assistant", "toolResult"]);

        const second = await session.prompt({content: "再改第四章"});
        if (!second.ok) throw new Error(second.code);
        const secondResult = await second.value.done;
        expect(kinds(secondResult.entries)).toEqual(["custom:harness/invocation", "message:user", "message:assistant", "custom:harness/invocation"]);
        expect(harness.contexts[2]!.messages.map((message) => message.role)).toEqual(["user", "developer", "user", "user", "assistant", "toolResult", "assistant", "user"]);
    });

    test("场景 2：受理失败各返回对应失败码，日志不变、无事件", async () => {
        const {harness, session, events} = await open({script: [{text: "x"}]});
        const before = session.log.entries.length;
        const code = async (promise: ReturnType<AgentSession["prompt"]>): Promise<string | null> => {
            const result = await promise;
            return result.ok ? null : result.code;
        };
        expect(await code(session.prompt({content: "  "}))).toBe("invalid-input");
        expect(await code(session.prompt({content: []}))).toBe("invalid-input");
        expect(await code(session.prompt({content: "x"}, {profileId: "nope"}))).toBe("unknown-profile");
        // 受理失败不换会话的 Profile：之后不带覆盖的调用照常受理
        expect(session.status.profileId).toBe("writer");
        expect(await code(session.prompt({content: "x"}, {profileId: "writer", model: "nowhere/m"}))).toBe("model-unavailable");
        expect(await code(session.prompt({content: "x"}, {signal: AbortSignal.abort()}))).toBe("invalid-state");
        expect(session.log.entries.length).toBe(before);
        expect(events).toEqual([]);

        const noKey = await createHarness({withKey: false});
        harnesses.push(noKey);
        const noKeySession = await noKey.runtime.createSession({profileId: "writer"});
        expect(noKeySession.ok && (await noKeySession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "credentials-missing"});

        const conflict = await createHarness({sources: [createStaticToolSource([echoTool()]), createStaticToolSource([echoTool()])]});
        harnesses.push(conflict);
        const conflictSession = await conflict.runtime.createSession({profileId: "writer"});
        expect(conflictSession.ok && (await conflictSession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "tool-conflict"});

        // 同时没有凭据又有工具来源冲突：按输出 2 的顺序先报凭据；预览不取凭据，报的是冲突
        const both = await createHarness({withKey: false, sources: [createStaticToolSource([echoTool()]), createStaticToolSource([echoTool()])]});
        harnesses.push(both);
        const bothSession = await both.runtime.createSession({profileId: "writer"});
        expect(bothSession.ok && (await bothSession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "credentials-missing"});
        expect(bothSession.ok && (await bothSession.value.preview({content: "x"}))).toMatchObject({ok: false, code: "tool-conflict"});

        const noTools = await createHarness({supportsTools: false});
        harnesses.push(noTools);
        const noToolsSession = await noTools.runtime.createSession({profileId: "writer"});
        expect(noToolsSession.ok && (await noToolsSession.value.prompt({content: "x"}))).toMatchObject({ok: false, code: "capability-missing"});
        expect(harness.contexts).toHaveLength(0);
    });
});

describe("受理期间的占用（状态与转换）", () => {
    test("两个 prompt 同时受理：只有一个受理成功，另一个 busy；受理失败后释放占用", async () => {
        const {harness, session} = await open({script: [{text: "一"}, {text: "二"}]});
        // 让受理在取凭据处停住：用真实凭据对象包一层门
        const real = harness.deps.credentials;
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        harness.deps.credentials = {...real, apiKeyFor: async (model) => {
            await gate;
            return real.apiKeyFor(model);
        }};
        const first = session.prompt({content: "甲"});
        const second = session.prompt({content: "乙"});
        release();
        const [a, b] = await Promise.all([first, second]);
        expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
        const rejected = a.ok ? b : a;
        expect(rejected.ok ? null : rejected.code).toBe("busy");
        const accepted = a.ok ? a : b;
        if (!accepted.ok) throw new Error("应有一个受理成功");
        const result = await accepted.value.done;
        expect(result.status).toBe("completed");
        expect(invocationPhases(result.entries)).toEqual(["start", "end"]);
        expect(invocationPhases(session.log.entries)).toEqual(["start", "end"]);
        // 受理失败不留占用
        harness.deps.credentials = {...real, apiKeyFor: async () => undefined};
        expect(await session.prompt({content: "丙"})).toMatchObject({ok: false, code: "credentials-missing"});
        harness.deps.credentials = real;
        const again = await session.prompt({content: "丁"});
        expect(again.ok).toBe(true);
        await (again.ok ? again.value.done : Promise.resolve());
    });
});

describe("队列（输出 1、11）", () => {
    test("场景 5：运行中 steer 在当前工具批次之后送给模型并写入；followup 在 completed 后自动开始新调用；busy 与 invalid-state", async () => {
        const {harness, session, events} = await open({script: [{calls: [{id: "c1", name: "echo", args: {text: "一"}}]}, {text: "收到插话"}, {text: "第二次完成"}]});
        expect(session.steer({content: "太早"})).toMatchObject({ok: false, code: "invalid-state"});
        // 插话要在工具批次结束前入队才会在下一次模型调用前送达：在工具开始的事件里同步 steer（轮询等待会错过这个窗口）
        let steered: unknown = null;
        session.subscribe((event) => {
            if (event.type === "tool" && event.stage === "start" && steered === null) steered = session.steer({content: "插话"});
        });
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        expect(await session.prompt({content: "再来"})).toMatchObject({ok: false, code: "busy"});
        expect(await session.continue()).toMatchObject({ok: false, code: "busy"});
        const queued = await session.prompt({content: "追加"}, {streamingBehavior: "followUp"});
        expect(queued.ok && queued.value.invocationId).toBe(started.value.invocationId);
        await waitUntil("插话已入队", () => steered !== null);
        expect(steered).toEqual({ok: true, value: undefined});
        const first = await started.value.done;
        expect(first.status).toBe("completed");
        const texts = first.entries.map((entry) => (entry.type === "message" ? `${entry.message.role}:${typeof entry.message.content === "string" ? entry.message.content : JSON.stringify(entry.message.content)}` : kinds([entry])[0]!));
        const steerIndex = texts.findIndex((text) => text === "user:插话");
        const resultIndex = texts.findIndex((text) => text.startsWith("message:toolResult") || text.startsWith("toolResult:"));
        expect(steerIndex).toBeGreaterThan(resultIndex);
        expect(harness.contexts[1]!.messages.at(-1)).toMatchObject({role: "user", content: "插话"});

        await waitUntil("第二次调用完成", () => invocationPhases(session.log.entries).length === 4 && session.status.phase === "idle");
        expect(invocationPhases(session.log.entries)).toEqual(["start", "end", "start", "end"]);
        // 追加的调用是第 3 轮（插话算用户发出的一轮），提醒每 2 轮触发一次，所以末尾是提醒、追加在它前面
        expect(harness.contexts[2]!.messages.at(-2)).toMatchObject({role: "user", content: "追加"});
        expect(harness.contexts[2]!.messages.at(-1)).toMatchObject({role: "user", attribution: "agent"});
        const queues = events.filter((event) => event.type === "queue").map((event) => `${(event as {steer: number}).steer}/${(event as {followUp: number}).followUp}`);
        expect(queues).toEqual(["0/1", "1/1", "0/1", "0/0"]);
    });
});

describe("终态分类与继续（输出 9、10）", () => {
    test("场景 6：模型错误 → failed/model 并可 continue；正常回复后 continue 为 invalid-state；轮数上限 → failed/limit", async () => {
        const {session} = await open({script: [{error: "上游挂了"}, {text: "好了"}]});
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        const failed = await started.value.done;
        expect(failed).toMatchObject({status: "failed", error: {kind: "model", message: "上游挂了", overflow: false}});
        expect(invocationPhases(failed.entries)).toEqual(["start", "error"]);
        const resumed = await session.continue();
        if (!resumed.ok) throw new Error(resumed.code);
        const result = await resumed.value.done;
        expect(result.status).toBe("completed");
        expect(kinds(result.entries)).toEqual(["custom:harness/invocation", "message:assistant", "custom:harness/invocation"]);
        expect(await session.continue()).toMatchObject({ok: false, code: "invalid-state"});

        const limited = await createHarness({maxTurns: 2, script: Array.from({length: 5}, (_, index) => ({calls: [{id: `c${index}`, name: "echo", args: {text: "x"}}]}))});
        harnesses.push(limited);
        const created = await limited.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const run = await created.value.prompt({content: "一直调工具"});
        if (!run.ok) throw new Error(run.code);
        const limitResult = await run.value.done;
        expect(limitResult).toMatchObject({status: "failed", error: {kind: "limit"}});
        expect(limitResult.entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant").length).toBeLessThanOrEqual(3);
        expect(invocationPhases(limitResult.entries)).toEqual(["start", "error"]);
    });

    test("场景 6：日志写入失败 → failed/log，句柄随日志关闭", async () => {
        const store = withFailingAppend(createMemorySessionStore());
        const {session, events} = await open({store, script: [{calls: [{id: "c1", name: "echo", args: {text: "x"}}]}, {text: "完"}]});
        // 工具开始时让下一次存储写入失败：命中的是助手消息或工具结果的写入，都在循环中途
        let armed = false;
        session.subscribe((event) => {
            if (event.type === "tool" && event.stage === "start" && !armed) {
                armed = true;
                store.failNext();
            }
        });
        const started = await session.prompt({content: "开始"});
        if (!started.ok) throw new Error(started.code);
        const result = await started.value.done;
        expect(armed).toBe(true);
        expect(events.some((event) => event.type === "entry" && event.entry.type === "message" && event.entry.message.role === "assistant")).toBe(true);
        expect(result).toMatchObject({status: "failed", error: {kind: "log"}});
        expect(await session.prompt({content: "再来"})).toMatchObject({ok: false, code: "closed"});
    });

    test("createSession 与 openSession：未知 Profile、重复 id、不存在的会话；title 写成 title_change；listSessions", async () => {
        const harness = await createHarness({profiles: [testProfile({"harness/tools": []}), testProfile({"harness/tools": []}, {id: "other"})]});
        harnesses.push(harness);
        expect(await harness.runtime.createSession({profileId: "nope"})).toMatchObject({ok: false, code: "unknown-profile"});
        const created = await harness.runtime.createSession({profileId: "other", id: "fixed", title: "标题"});
        if (!created.ok) throw new Error(created.code);
        expect(kinds(created.value.log.entries)).toEqual(["title_change"]);
        expect(await harness.runtime.createSession({profileId: "other", id: "fixed"})).toMatchObject({ok: false, code: "session-exists"});
        expect(await harness.runtime.openSession("missing")).toMatchObject({ok: false, code: "session-not-found"});
        await created.value.close();
        const reopened = await harness.runtime.openSession("fixed");
        expect(reopened.ok && reopened.value.status).toMatchObject({phase: "idle", pending: []});
        const listed = await harness.runtime.listSessions();
        expect(listed.ok && listed.value.map((summary) => summary.id)).toEqual(["fixed"]);
    });
});

describe("Profile 的数据源与中止（输出 4、8、9）", () => {
    const Weather = nodeComponent("test/weather");
    const weatherProfile = (tools: string[] = ["echo"]) => defineProfile({
        id: "writer", name: "写作助手", description: "带天气", version: 1, fields: {"harness/tools": tools},
        prompt: () => <Prompt><System>天气<Weather /></System><History /><Appending><Input /></Appending></Prompt>,
    });
    function registerWeather(harness: Harness, resolve: () => Promise<string>): void {
        const node = harness.deps.host.registerNodeType({id: "test/weather", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", sources: ["test/forecast"], render: (_node, ctx) => String(ctx.sources["test/forecast"])});
        if (!node.ok) throw new Error(node.detail);
        const source = harness.deps.host.registerSource({id: "test/forecast", schema: Type.String(), phase: "model-call", resolve});
        if (!source.ok) throw new Error(source.detail);
    }

    test("model-call 数据源每次模型调用前刷新，刷新后的系统提示词当次就进请求；刷新失败 → failed/profile 且不再请求模型", async () => {
        let version = 0;
        const harness = await createHarness({profiles: [weatherProfile()], script: [{calls: [{id: "c1", name: "echo", args: {text: "a"}}]}, {calls: [{id: "c2", name: "echo", args: {text: "b"}}]}, {text: "完"}]});
        harnesses.push(harness);
        registerWeather(harness, async () => `数据版本${(version += 1)}`);
        const created = await harness.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const started = await created.value.prompt({content: "天气如何"});
        if (!started.ok) throw new Error(started.code);
        expect((await started.value.done).status).toBe("completed");
        // prepare 取一次（版本 1），之后每次模型调用前刷新一次：三次请求看到 2、3、4
        expect(harness.contexts.map((context) => context.systemPrompt?.[0])).toEqual(["天气数据版本2", "天气数据版本3", "天气数据版本4"]);

        // 预览与真跑同一阶段：种子按 prepare 的结果，系统提示词按刷新后的
        const seeded = await createHarness({profiles: [defineProfile({
            id: "writer", name: "写作助手", description: "种子里也有天气", version: 1, fields: {"harness/tools": ["echo"]},
            prompt: () => <Prompt><System>天气<Weather /></System><History><User>开场<Weather /></User></History><Appending><Input /></Appending></Prompt>,
        })], script: [{text: "完"}]});
        harnesses.push(seeded);
        let seedVersion = 0;
        registerWeather(seeded, async () => `版本${(seedVersion += 1)}`);
        const seedSession = await seeded.runtime.createSession({profileId: "writer"});
        if (!seedSession.ok) throw new Error(seedSession.code);
        const preview = await seedSession.value.preview({content: "今天"});
        if (!preview.ok) throw new Error(preview.detail);
        expect(preview.value.seeds.map((message) => message.content)).toEqual(["开场版本1"]);
        expect(preview.value.system).toEqual(["天气版本2"]);
        const ran = await seedSession.value.prompt({content: "今天"});
        if (!ran.ok) throw new Error(ran.code);
        await ran.value.done;
        const seedEntry = seedSession.value.log.entries.find((entry) => entry.type === "custom_message" && entry.customType === "harness/seed");
        expect(seedEntry?.type === "custom_message" ? seedEntry.content : null).toBe("开场版本3");
        expect(seeded.contexts[0]?.systemPrompt?.[0]).toBe("天气版本4");

        let calls = 0;
        const failing = await createHarness({profiles: [weatherProfile()], script: [{calls: [{id: "c1", name: "echo", args: {text: "a"}}]}, {text: "不该到"}]});
        harnesses.push(failing);
        registerWeather(failing, async () => {
            calls += 1;
            if (calls === 3) throw new Error("刷新数据源失败");
            return `v${calls}`;
        });
        const session = await failing.runtime.createSession({profileId: "writer"});
        if (!session.ok) throw new Error(session.code);
        const run = await session.value.prompt({content: "天气如何"});
        if (!run.ok) throw new Error(run.code);
        const result = await run.value.done;
        expect(result.status).toBe("failed");
        expect(result.error).toMatchObject({kind: "profile"});
        expect(result.error?.message).toContain("刷新数据源失败");
        expect(failing.contexts).toHaveLength(1);
        expect(invocationPhases(result.entries)).toEqual(["start", "error"]);
    });

    test("prepare 期间 abort：数据源收到信号，放行后不开始循环，调用以 aborted 收口；调用的 signal 收口后不再影响下一次调用", async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let sourceStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            sourceStarted = resolve;
        });
        let sawAbort = false;
        const harness = await createHarness({profiles: [weatherProfile(["echo", "shell"])], tools: [echoTool(), shellTool()], approvalMode: "write", script: [{text: "一"}, {calls: [{id: "c1", name: "shell", args: {cmd: "ls"}}]}, {text: "二"}]});
        harnesses.push(harness);
        const node = harness.deps.host.registerNodeType({id: "test/weather", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", sources: ["test/forecast"], render: (_node, ctx) => String(ctx.sources["test/forecast"])});
        if (!node.ok) throw new Error(node.detail);
        let gated = true;
        const source = harness.deps.host.registerSource({id: "test/forecast", schema: Type.String(), phase: "invocation", resolve: async (_request, signal) => {
            if (!gated) return "晴";
            sourceStarted();
            signal.addEventListener("abort", () => {
                sawAbort = true;
            }, {once: true});
            await gate;
            return "晴";
        }});
        if (!source.ok) throw new Error(source.detail);
        const created = await harness.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const run = await session.prompt({content: "天气如何"});
        if (!run.ok) throw new Error(run.code);
        await started;
        expect(session.status.phase).toBe("running");
        expect(session.abort()).toEqual({ok: true, value: undefined});
        release();
        const result = await run.value.done;
        expect(result.status).toBe("aborted");
        expect(sawAbort).toBe(true);
        expect(harness.contexts).toHaveLength(0);
        expect(invocationPhases(result.entries)).toEqual(["start", "aborted"]);

        // 第一次调用带 signal 并正常完成；第二次调用不带 signal、等待审批；这时中止第一次的控制器不能影响第二次
        gated = false;
        const controller = new AbortController();
        const first = await session.prompt({content: "一"}, {signal: controller.signal});
        if (!first.ok) throw new Error(first.code);
        expect((await first.value.done).status).toBe("completed");
        const second = await session.prompt({content: "跑命令"});
        if (!second.ok) throw new Error(second.code);
        await waitUntil("等待用户", () => session.status.phase === "waiting-user");
        controller.abort();
        expect(session.status.phase).toBe("waiting-user");
        expect(await session.resolve({interactionId: session.status.pending[0]!.interactionId, decision: "approve"})).toEqual({ok: true, value: undefined});
        expect((await second.value.done).status).toBe("completed");
    });
});

describe("缺省依赖、目录跟配置与上下文用量（输入、输出 5、14）", () => {
    test("输出 18：openRuntime 只给配置、一组 Profile 与 key 就能跑；unwrap 成功给值、失败抛带同一 code 的 HarnessError；坏配置、重复 Profile 在装配时就抛", async () => {
        const {stream} = scriptedStream([{text: "你好呀"}]);
        const runtime = await openRuntime({
            config: {providers: [{id: "a", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "m"}]}], models: {defaultModel: "a/m"}},
            profiles: [testProfile({})], apiKeys: {a: "k"}, model: {stream},
        });
        try {
            const session = unwrap(await runtime.createSession({profileId: "writer"}));
            const result = await unwrap(await session.prompt({content: "你好"})).done;
            expect(result.status).toBe("completed");
            expect(kinds(result.entries)).toContain("message:assistant");
            // 失败：同一个 code 与 detail 进异常
            const failed = await session.prompt({content: "x"}, {profileId: "nope"});
            expect(() => unwrap(failed)).toThrow(HarnessError);
            try {
                unwrap(failed);
            } catch (error) {
                expect(error).toMatchObject({name: "HarnessError", code: "unknown-profile", detail: expect.stringContaining("nope")});
            }
            await session.close();
        } finally {
            runtime.close();
        }
        // 装配时就报：坏配置、目录里重复的 Profile、打不开的凭据库
        const credentials = unwrap(await openCredentials({sqlitePath: ":memory:"}));
        try {
            expect(() => createRuntime({config: {providers: "x"} as never, profiles: [testProfile({})], credentials})).toThrow(HarnessError);
            expect(() => createRuntime({config: {providers: [], models: {}}, profiles: [testProfile({}), testProfile({})], credentials})).toThrow(HarnessError);
        } finally {
            credentials.close();
        }
        await expect(openRuntime({config: {providers: [], models: {}}, profiles: [testProfile({}), testProfile({})], apiKeys: {}})).rejects.toMatchObject({code: "invalid-profile"});
        await expect(openRuntime({config: {providers: [], models: {}}, profiles: [testProfile({})], credentialsPath: "/dev/null/nowhere/auth.sqlite"})).rejects.toBeInstanceOf(HarnessError);
        // 判别按完整的方法集合：带 current/replace 的配置对象仍按配置校验（未知字段），类数组对象不是 Profile 目录
        const loose = unwrap(await openCredentials({sqlitePath: ":memory:"}));
        try {
            const odd = {providers: [], models: {}, current: {}, replace() {}} as never;
            expect(() => createRuntime({config: odd, profiles: [testProfile({})], credentials: loose})).toThrow(expect.objectContaining({code: "invalid-config"}));
            const arrayLike = Object.freeze({0: testProfile({}), length: 1}) as never;
            expect(() => createRuntime({config: {providers: [], models: {}}, profiles: arrayLike, credentials: loose})).toThrow(expect.objectContaining({code: "invalid-profile"}));
            expect(() => createRuntime({config: null as never, profiles: [testProfile({})], credentials: loose})).toThrow(expect.objectContaining({code: "invalid-config"}));
            // 冻结的 Profile 数组照常
            expect(() => createRuntime({config: {providers: [], models: {}}, profiles: Object.freeze([testProfile({})]), credentials: loose}).close()).not.toThrow();
        } finally {
            loose.close();
        }
        // unwrap 也认配置模块的 problems 形状
        expect(() => unwrap(createConfigStore({providers: "x"}))).toThrow(expect.objectContaining({code: "invalid-config", detail: expect.stringContaining("providers")}));
    });

    test("场景 10：只给 config、profiles、credentials、store 的运行时能跑完一次调用；replace 加服务后能用新模型；status.context 给用量；没有 contextWindow 的模型 compact 为 compaction-failed", async () => {
        const config = createConfigStore({providers: [{id: "a", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "m"}]}], models: {defaultModel: "a/m"}});
        if (!config.ok) throw new Error(JSON.stringify(config.problems));
        const credentials = await openCredentials({sqlitePath: ":memory:", apiKeys: {a: "k", b: "k"}});
        if (!credentials.ok) throw new Error(credentials.detail);
        const {stream} = scriptedStream([{text: "一", usage: {input: 400, output: 20, totalTokens: 420}}, {text: "二", usage: {input: 500, output: 20, totalTokens: 520}}]);
        const input = {config: config.value, profiles: createProfileCatalog([{source: "t", profiles: [testProfile({})]}]), credentials: credentials.value, store: createMemorySessionStore(), model: {stream}};
        const runtime = createRuntime(input);
        // 换一个配置存储对象（不是 replace）：缺省目录跟着换
        const other = createConfigStore({providers: [{id: "c", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "n"}]}], models: {defaultModel: "c/n"}});
        if (!other.ok) throw new Error(JSON.stringify(other.problems));
        const swapDeps: Parameters<typeof createRuntime>[0] = {...input, store: createMemorySessionStore()};
        const swappedSession = unwrap(await createRuntime(swapDeps).createSession({profileId: "writer"}));
        expect((await swappedSession.preview({content: "x"}, {model: "c/n"})).ok).toBe(false);
        swapDeps.config = other.value;
        expect(unwrap(await swappedSession.preview({content: "x"}, {model: "c/n"})).model).toBe("c/n");
        await swappedSession.close();
        const created = await runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const session = created.value;
        expect(session.status.context).toBeUndefined();
        const first = await session.prompt({content: "你好"});
        if (!first.ok) throw new Error(`${first.code}: ${first.detail}`);
        expect((await first.value.done).status).toBe("completed");
        // 自建模型没给 contextWindow：窗口为 0，用量照报；手动压缩按配置缺项报错，不是“没东西可压”
        expect(session.status.context).toEqual({tokens: 420, source: "reported", window: 0, threshold: 0});
        const compacted = await session.compact();
        expect(compacted.ok ? null : `${compacted.code}:${compacted.detail}`).toMatch(/^compaction-failed:.*contextWindow/u);

        // 配置换成另一个服务：目录跟着变，不用重建运行时
        const replaced = config.value.replace({providers: [{id: "b", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{id: "n", contextWindow: 100_000}]}], models: {defaultModel: "b/n"}});
        expect(replaced.ok).toBe(true);
        const second = await session.prompt({content: "再来"}, {model: "b/n"});
        if (!second.ok) throw new Error(`${second.code}: ${second.detail}`);
        expect((await second.value.done).status).toBe("completed");
        expect(session.status.model).toBe("b/n");
        // 阈值按 compaction 输出 9：80% 与“窗口减余量（缺省 16384）”取小
        expect(session.status.context).toEqual({tokens: 520, source: "reported", window: 100_000, threshold: 80_000});

        // 事后换主机：运行时的字段登记到换上来的主机上，同一个 Profile 照常跑完
        (input as {host?: ReturnType<typeof createProfileHost>}).host = createProfileHost();
        const third = await session.prompt({content: "换了主机"});
        if (!third.ok) throw new Error(`${third.code}: ${third.detail}`);
        expect((await third.value.done).status).toBe("completed");
        await session.close();
        credentials.value.close();
    });

    test("输出 5：模型报错、还没有可用的用量时 status.context 是估算值；没有新条目时连续读 status 得到同一份 pending 与 context", async () => {
        const {harness, session} = await open({script: [{error: "boom"}]});
        const started = await session.prompt({content: "你好"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        expect((await started.value.done).status).toBe("failed");
        const context = session.status.context;
        expect(context).toMatchObject({source: "estimated", window: 100_000, threshold: 80_000});
        // 估算值就是 OMP Tokenizer 对回放上下文的计数（bun test 下 NODE_ENV=test，Tokenizer 走字节除 4；已知分词器家族的原生计数由 OMP 自己的测试覆盖）
        const model = harness.deps.models.resolve("test/m");
        if (!model.ok) throw new Error(model.detail);
        expect(context!.tokens).toBe(new Tokenizer(model.value).countMessages(buildModelContext(session.log.entries)));
        expect(context!.tokens).toBeGreaterThan(0);
        // 缓存按条目数组：日志没变就是同一份对象，不重新回放；是冻结的，调用方改不了
        expect(session.status.pending).toBe(session.status.pending);
        expect(session.status.context).toBe(context!);
        expect(() => (session.status.pending as unknown[]).push({})).toThrow(TypeError);
        expect(() => {
            (session.status.context as {tokens: number}).tokens = 0;
        }).toThrow(TypeError);
        expect(session.status.context!.tokens).toBeGreaterThan(0);
        const again = await session.prompt({content: "再来"});
        if (!again.ok) throw new Error(`${again.code}: ${again.detail}`);
        await again.value.done;
        expect(session.status.context).not.toBe(context!);
    });
});

describe("工具结果的预算（输入 artifacts、limits.toolResult；输出 3）", () => {
    test("超预算的工具结果：全文进溢出存储（缺省内存），日志里的结果是头尾加 artifact://0 的回读提示；limits.toolResult 可改阈值", async () => {
        const {harness, session} = await open({script: [{calls: [{id: "c1", name: "echo", args: {text: "y".repeat(60 * 1024)}}]}, {text: "好"}]});
        const started = await session.prompt({content: "回显"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        expect((await started.value.done).status).toBe("completed");
        const result = session.log.entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
        const text = result?.type === "message" && result.message.role === "toolResult" ? result.message.content.map((block) => ("text" in block ? block.text : "")).join("") : "";
        expect(text.length).toBeLessThan(45 * 1024);
        expect(text).toContain("read artifact://0");
        const stored = await harness.deps.artifacts.read(session.id, "0");
        expect(stored.ok && stored.value).toBe(`回显：${"y".repeat(60 * 1024)}`);

        const tight = await createHarness({script: [{calls: [{id: "c1", name: "echo", args: {text: "短短"}}]}, {text: "好"}]});
        harnesses.push(tight);
        tight.deps.limits = {toolResult: {spillBytes: 4}};
        // 预算不是非负整数：装配时就拒绝
        expect(() => createRuntime({...tight.deps, limits: {toolResult: {headBytes: -1}}})).toThrow(HarnessError);
        const created = await tight.runtime.createSession({profileId: "writer"});
        if (!created.ok) throw new Error(created.code);
        const run = await created.value.prompt({content: "回显"});
        if (!run.ok) throw new Error(run.code);
        await run.value.done;
        const small = created.value.log.entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
        const smallText = small?.type === "message" && small.message.role === "toolResult" ? small.message.content.map((block) => ("text" in block ? block.text : "")).join("") : "";
        expect(smallText).toContain("超过预算 4 字节");
        expect(smallText).toContain("read artifact://0");
        await created.value.close();
    });
});

describe("预览（输出 17）", () => {
    test("场景 12：新会话 preview 得到种子、输入、系统提示词与请求消息，日志、状态不变、无事件；没有凭据也能预览；一次调用后 request 含历史、seeds 为空；字段拼错为 invalid-profile", async () => {
        const {harness, session, events} = await open({script: [{text: "好的"}], withKey: false});
        const before = session.log.entries;
        const preview = await session.preview({content: "开始写"});
        if (!preview.ok) throw new Error(`${preview.code}: ${preview.detail}`);
        expect(preview.value.model).toBe("test/m");
        expect(preview.value.tools).toEqual(["echo", "note", "shell"]);
        expect(preview.value.system.join("\n")).toContain("你是写作助手");
        expect(preview.value.seeds.map((message) => message.role)).toEqual(["user", "developer"]);
        // 种子是回放后的形状（attribution: agent），History 的 last 数起来与真跑一致
        expect(preview.value.seeds.map((message) => (message as {attribution?: string}).attribution)).toEqual(["agent", "agent"]);
        expect((await session.preview({content: "x"}, {signal: AbortSignal.abort()})).ok ? null : "invalid-state").toBe("invalid-state");
        expect(preview.value.appended[0]).toMatchObject({role: "user"});
        expect(JSON.stringify(preview.value.appended[0])).toContain("开始写");
        // 请求消息：种子在前，本次输入与提醒在后
        expect(preview.value.request.map((message) => message.role).slice(0, 2)).toEqual(["user", "developer"]);
        expect(JSON.stringify(preview.value.request.slice(2))).toContain("开始写");
        expect(preview.value.diagnostics).toEqual([]);
        expect(session.log.entries).toBe(before);
        // 请求了没装的工具：受理照常，预览给 unknown-tool 警告
        const lacking = await open({fields: {"harness/tools": ["echo", "nowhere"]}, script: [{text: "好"}]});
        const warned = await lacking.session.preview({content: "x"});
        expect(warned.ok && warned.value.tools).toEqual(["echo"]);
        expect(warned.ok && warned.value.diagnostics).toEqual([{severity: "warning", code: "unknown-tool", path: "fields.harness/tools[1]", detail: expect.stringContaining("nowhere")}]);
        const lackingRun = await lacking.session.prompt({content: "x"});
        if (!lackingRun.ok) throw new Error(lackingRun.code);
        const lackingResult = await lackingRun.value.done;
        const start = lackingResult.entries.find((entry) => entry.type === "custom" && entry.customType === "harness/invocation");
        expect(start?.type === "custom" && start.data).toMatchObject({phase: "start", detail: {tools: ["echo"], missingTools: ["nowhere"]}});
        expect(events).toEqual([]);
        expect(session.status.phase).toBe("idle");
        // 没有凭据：真跑受理失败，预览照常
        expect(await session.prompt({content: "开始写"})).toMatchObject({ok: false, code: "credentials-missing"});

        await harness.deps.credentials.setApiKey("test", "k");
        const started = await session.prompt({content: "开始写"});
        if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
        expect((await started.value.done).status).toBe("completed");
        // 真跑第一次请求的消息与预览的 request 同形（时间戳除外）
        const shape = (message: unknown): unknown => (({timestamp: _timestamp, ...rest}) => rest)(message as {timestamp?: number});
        expect(harness.contexts[0]!.messages.map(shape)).toEqual(preview.value.request.map(shape));
        const again = await session.preview({content: "继续"});
        if (!again.ok) throw new Error(`${again.code}: ${again.detail}`);
        expect(again.value.seeds).toEqual([]);
        expect(again.value.request.some((message) => message.role === "assistant")).toBe(true);
        expect(JSON.stringify(again.value.request.slice(-2))).toContain("继续");
        // 不带输入：只看系统提示词与历史
        const bare = await session.preview();
        expect(bare.ok && bare.value.appended).toEqual([]);

        const typo = await open({fields: {"harness/tool": ["echo"]}});
        const rejected = await typo.session.preview({content: "x"});
        expect(rejected.ok ? null : rejected.code).toBe("invalid-profile");
        expect(rejected.ok ? "" : rejected.detail).toContain("unknown-field");

        // 渲染诊断只收一次：系统提示词里的未知节点在 diagnostics 里只出现一条
        const Stranger = nodeComponent("test/stranger");
        const strange = await createHarness({profiles: [defineProfile({
            id: "writer", name: "写作助手", description: "带未知节点", version: 1, fields: {"harness/tools": ["echo"]},
            prompt: () => <Prompt><System>你好<Stranger /></System><History /><Appending><Input /></Appending></Prompt>,
        })], script: [{text: "完"}]});
        harnesses.push(strange);
        const registered = strange.deps.host.registerNodeType({id: "test/stranger", category: "content", props: Type.Object({}), parents: ["*message", "harness/system"], children: "none", render: () => nodeComponent("test/unregistered")({})});
        if (!registered.ok) throw new Error(registered.detail);
        const strangeSession = await strange.runtime.createSession({profileId: "writer"});
        if (!strangeSession.ok) throw new Error(strangeSession.code);
        const diagnosed = await strangeSession.value.preview({content: "x"});
        expect(diagnosed.ok && diagnosed.value.diagnostics.map((item) => item.code)).toEqual(["unknown-node"]);
    });
});
