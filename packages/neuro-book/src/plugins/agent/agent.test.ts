/**
 * `nbook.agent` 的贡献点与句柄表（docs/specs/agent/contributions.md、sessions.md）：真实服务端内核、真实设置与模型服务，
 * 模型是本机的 OpenAI 兼容端点；贡献方是测试插件。测试名里的编号是 contributions.md（“贡献”）与 sessions.md（“会话”）的
 * 输出条目。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createJsonlStore, defineExtension, defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent, SessionApi, ToolImplementation} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {IDLE_CLOSE_MS} from "./backend/sessions";
import {REVOKE_GRACE_MS} from "./backend/tools";
import {agentExtension, agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "contributions");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `c-${String((commands += 1))}`;

const WRITER = "test.profiles.writer";
const ECHO = "test.tools.echo";

/** 交出一个 Profile 的插件：它的工具要求可选 `test.tools.echo`。 */
function profilesPlugin(activations: {count: number}, tools = {required: [] as string[], optional: [ECHO]}): PluginDefinition {
    const writer = agentProfile(WRITER, {name: "写手", description: "测试用", tools});
    return {id: "test.profiles", entries: [defineEntry({id: "server", location: "server", activationEvents: [writer.activationEvent], contributions: [writer.contribution], activate: () => {
        activations.count += 1;
        return {contributions: {"agent.profiles": {[WRITER]: defineProfile({id: WRITER, version: "1", name: "写手", description: "测试用", system: "你是写手。"})}}};
    }})]};
}

/** 交出工具的插件；`execute` 缺省回显参数里的 `text`。 */
function toolsPlugin(activations: {count: number}, options: {readonly id?: string; readonly tools?: ReadonlyArray<{readonly id: string; readonly defaultForAll?: boolean; readonly execute?: ToolImplementation["execute"]; readonly disposed?: {count: number}; readonly created?: Promise<void>}>} = {}): PluginDefinition {
    const tools = options.tools ?? [{id: ECHO}];
    const declared = tools.map((tool) => agentTool(tool.id, {description: tool.id, parameters: {type: "object", properties: {text: {type: "string"}}}, version: "1", effect: "read", ...(tool.defaultForAll === true ? {defaultForAll: true} : {})}));
    return {id: options.id ?? "test.tools", entries: [defineEntry({id: "server", location: "server", activationEvents: declared.map((item) => item.activationEvent), contributions: declared.map((item) => item.contribution), activate: () => {
        activations.count += 1;
        const implementations: Record<string, AgentToolImplementation> = {};
        for (const tool of tools) implementations[tool.id] = {create: async () => {
            await tool.created;
            return {
                execute: tool.execute ?? (async (args) => `echo ${String(args.text)}`),
                dispose: () => {
                    if (tool.disposed !== undefined) tool.disposed.count += 1;
                },
            };
        }};
        return {contributions: {"agent.tools": implementations}};
    }})]};
}

/** 交出扩展的插件：扩展往系统提示词里加一句。 */
function extensionsPlugin(activations: {count: number}): PluginDefinition {
    const note = agentExtension("test.ext.note");
    return {id: "test.ext", entries: [defineEntry({id: "server", location: "server", activationEvents: [note.activationEvent], contributions: [note.contribution], activate: () => {
        activations.count += 1;
        return {contributions: {"agent.extensions": {"test.ext.note": defineExtension({id: "test.ext.note", contribute: {note: {value: () => "扩展在场"}}})}}};
    }})]};
}

async function world(plugins: PluginDefinition[], userSettings: Record<string, unknown> = {}): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins, userSettings: {...localModelSettings(endpoint.baseUrl), ...userSettings}});
    worlds.push(created);
    return created;
}

async function createSession(w: AgentWorld, profile = WRITER): Promise<SessionApi> {
    const created = await w.service.create({profile});
    if (!created.ok) throw new Error(`create failed: ${created.code} ${JSON.stringify(created.detail)}`);
    return created.value;
}

async function say(session: SessionApi, text: string): Promise<LogEvent[]> {
    const before = (await session.snapshot()).head;
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await session.waitRun(sent.value.runId);
    return (await session.log({afterSeq: before})).events;
}

const toolResults = (events: readonly LogEvent[]) => events.filter((event) => event.type === "toolResult").map((event) => event.data as {text: string; code?: string});

describe("贡献", () => {
    test("输出 2、5、7：建会话前激活扩展的提供方；工具声明不激活也交给模型，第一次执行才激活；Profile 解析时才激活提供方", async () => {
        const counts = {profiles: {count: 0}, tools: {count: 0}, ext: {count: 0}};
        const w = await world([profilesPlugin(counts.profiles), toolsPlugin(counts.tools), extensionsPlugin(counts.ext)]);
        expect(w.service.profiles().filter((profile) => profile.source !== "nbook.agent")).toEqual([{key: WRITER, name: "写手", description: "测试用", source: "test.profiles", status: "ok"}]);
        expect([counts.profiles.count, counts.tools.count, counts.ext.count]).toEqual([0, 0, 0]);

        const session = await createSession(w);
        expect([counts.profiles.count, counts.tools.count, counts.ext.count]).toEqual([1, 0, 1]);

        const sent = endpoint.requests.length;
        endpoint.script({tool: "test__tools__echo", args: {text: "你好"}}, "完成");
        const events = await say(session, "试试工具");
        expect(counts.tools.count).toBe(1);
        const [first, second] = endpoint.requests.slice(sent);
        expect(first!.tools).toEqual(["test__tools__echo"]);
        expect(first!.system).toContain("扩展在场");
        expect(toolResults(events).map((result) => result.text)).toEqual(["echo 你好"]);
        expect(JSON.stringify(second!.messages)).toContain("echo 你好");
    });

    test("输出 6：工具的提供方停止后调用得 tool-unavailable、声明还在；再登记后用新的一代", async () => {
        const counts = {profiles: {count: 0}, tools: {count: 0}};
        const disposed = {count: 0};
        const w = await world([profilesPlugin(counts.profiles)]);
        const tools = toolsPlugin(counts.tools, {tools: [{id: ECHO, disposed}]});
        const first = await w.register(tools);
        expect(first.result.status).toBe("accepted");
        const session = await createSession(w);
        endpoint.script({tool: "test__tools__echo", args: {text: "一"}}, "好");
        expect(toolResults(await say(session, "一")).map((result) => result.text)).toEqual(["echo 一"]);

        await first.stop();
        expect(disposed.count).toBe(1);
        const sent = endpoint.requests.length;
        endpoint.script({tool: "test__tools__echo", args: {text: "二"}}, "好");
        // 提供方停了：声明随登记一起没了，这次请求里不再有这个工具；模型照样调它时内核按未知工具处理。
        await say(session, "二");
        expect(endpoint.requests[sent]!.tools).toEqual([]);

        const again = await w.register(tools);
        expect(again.result.status).toBe("accepted");
        endpoint.script({tool: "test__tools__echo", args: {text: "三"}}, "好");
        expect(toolResults(await say(session, "三")).map((result) => result.text)).toEqual(["echo 三"]);
        expect(counts.tools.count).toBe(2);
    });

    test("输出 6：执行中的调用在撤回后最多等 5 秒，到时以 tool-unavailable 结算；底层没结束的写 tool-abandoned、不释放", async () => {
        const counts = {profiles: {count: 0}, tools: {count: 0}};
        const disposed = {count: 0};
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const w = await world([profilesPlugin(counts.profiles)]);
        const hanging = await w.register(toolsPlugin(counts.tools, {tools: [{id: ECHO, disposed, execute: () => {
            entered();
            return new Promise(() => undefined);
        }}]}));
        const session = await createSession(w);
        endpoint.script({tool: "test__tools__echo", args: {text: "卡住"}}, "收到");
        const sent = await session.send({commandId: cid(), input: {text: "卡住"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await started;
        let stopped = false;
        const stopping = hanging.stop().then(() => {
            stopped = true;
        });
        // 撤回等执行中的调用：时钟不走就一直等着。
        await Promise.resolve();
        expect(stopped).toBe(false);
        await waitUntil("5 秒后撤回完成", () => {
            w.settings.clock.advance(REVOKE_GRACE_MS);
            return stopped;
        });
        await stopping;
        await session.waitRun(sent.value.runId);
        const events = (await session.log({afterSeq: 0})).events;
        expect(toolResults(events).map((result) => result.code)).toEqual(["tool-unavailable"]);
        expect(disposed.count).toBe(0);
        expect(w.settings.diagnostics("hub").query({}).records.some((record) => record.event === "agent.tool-abandoned")).toBe(true);
    });

    test("输出 6：工厂建实现时运行已中止，迟到的实现不再执行；工厂挂住时撤回照样 5 秒完成", async () => {
        const counts = {profiles: {count: 0}, tools: {count: 0}};
        let releaseFactory!: () => void;
        const factory = new Promise<void>((resolve) => {
            releaseFactory = resolve;
        });
        const executions = {count: 0};
        const w = await world([profilesPlugin(counts.profiles)]);
        const slow = await w.register(toolsPlugin(counts.tools, {tools: [{id: ECHO, created: factory, execute: async () => {
            executions.count += 1;
            return "执行了";
        }}]}));
        const session = await createSession(w);
        endpoint.script({tool: "test__tools__echo", args: {text: "慢"}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "慢工具"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await waitUntil("工具开始建", () => counts.tools.count === 1);
        // 中止等宽限期（在场地的手动时钟上）：一边推时钟一边等它收口。
        const aborting = session.abort({commandId: cid()});
        const result = await waitUntil("中止收口", async () => {
            w.settings.clock.advance(2_000);
            return session.runResult({runId: sent.value.runId!});
        });
        expect(await aborting).toMatchObject({ok: true});
        expect(result.reason).toBe("aborted");
        releaseFactory();
        await waitUntil("工厂放行后的结算", () => factory.then(() => true));
        await Promise.resolve();
        expect(executions.count).toBe(0);
    });

    test("输出 6：工厂挂住时撤回不等它，5 秒完成；调用以 tool-unavailable 结算", async () => {
        const hang = new Promise<void>(() => undefined);
        const w = await world([profilesPlugin({count: 0})], {"nbook.agent/toolBindings": {[WRITER]: {added: ["test.hang.echo"], removed: []}}});
        const hanging = await w.register(toolsPlugin({count: 0}, {id: "test.hang", tools: [{id: "test.hang.echo", created: hang}]}));
        const session = await createSession(w);
        endpoint.script({tool: "test__hang__echo", args: {text: "挂"}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "挂住的工具"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await waitUntil("工具开始建", async () => {
            const {status} = await session.snapshot();
            return status.state === "running" && status.phase === "tools";
        });
        let stopped = false;
        void hanging.stop().then(() => {
            stopped = true;
        });
        await waitUntil("挂住的工厂不挡撤回", () => {
            w.settings.clock.advance(REVOKE_GRACE_MS);
            return stopped;
        });
        await session.waitRun(sent.value.runId);
        expect(toolResults((await session.log({afterSeq: 0})).events).map((result) => result.code)).toEqual(["tool-unavailable"]);
    });

    test("输出 7：来源按登记判定：发布者叫 user 的插件贡献 user. 开头的 Profile，照样从插件解析", async () => {
        const writer = agentProfile("user.profiles.writer", {name: "插件的", description: "测试用", tools: {required: [], optional: []}});
        const plugin: PluginDefinition = {id: "user.profiles", entries: [defineEntry({id: "server", location: "server", activationEvents: [writer.activationEvent], contributions: [writer.contribution], activate: () => ({contributions: {"agent.profiles": {"user.profiles.writer": defineProfile({id: "user.profiles.writer", version: "1", name: "插件的", description: "测试用"})}}})})]};
        const w = await world([plugin]);
        expect(w.service.profiles().find((profile) => profile.key === "user.profiles.writer")).toMatchObject({source: "user.profiles", status: "ok"});
        expect((await w.service.create({profile: "user.profiles.writer"})).ok).toBe(true);
    });

    test("输出 4：工具集 = Profile 要的 + 装到所有 Profile 的 + 绑定加的 − 绑定去掉的；必需的去不掉", async () => {
        const counts = {profiles: {count: 0}, tools: {count: 0}};
        const w = await world([
            profilesPlugin(counts.profiles, {required: ["test.tools.must"], optional: [ECHO]}),
            toolsPlugin(counts.tools, {tools: [{id: ECHO}, {id: "test.tools.must"}, {id: "test.tools.extra"}, {id: "test.tools.everywhere", defaultForAll: true}, {id: "test.tools.unused"}]}),
        ], {"nbook.agent/toolBindings": {[WRITER]: {added: ["test.tools.extra", "test.tools.missing"], removed: [ECHO, "test.tools.must"]}}});
        const session = await createSession(w);
        const sent = endpoint.requests.length;
        endpoint.script("好");
        await say(session, "看看工具");
        expect([...endpoint.requests[sent]!.tools].sort()).toEqual(["test__tools__everywhere", "test__tools__extra", "test__tools__must"]);
    });

    test("输出 4：声明 defaultTools: false 的 Profile 不加装到所有 Profile 的工具，绑定加的照样生效", async () => {
        const lean = agentProfile("test.lean.writer", {name: "精简", description: "测试用", tools: {required: [], optional: [ECHO]}, defaultTools: false});
        const leanPlugin: PluginDefinition = {id: "test.lean", entries: [defineEntry({id: "server", location: "server", activationEvents: [lean.activationEvent], contributions: [lean.contribution], activate: () => ({contributions: {"agent.profiles": {"test.lean.writer": defineProfile({id: "test.lean.writer", version: "1", name: "精简", description: "测试用", system: "你是写手。"})}}})})]};
        const w = await world([leanPlugin, toolsPlugin({count: 0}, {tools: [{id: ECHO}, {id: "test.tools.extra"}, {id: "test.tools.everywhere", defaultForAll: true}]})], {"nbook.agent/toolBindings": {"test.lean.writer": {added: ["test.tools.extra"], removed: []}}});
        const session = await createSession(w, "test.lean.writer");
        const sent = endpoint.requests.length;
        endpoint.script("好");
        await say(session, "看看工具");
        expect([...endpoint.requests[sent]!.tools].sort()).toEqual(["test__tools__echo", "test__tools__extra"]);
    });

    test("输出 7、13：声明的 role 是缺省角色，Profile 设置优先；hidden 的条目带标记、仍在目录里", async () => {
        const tiny = agentProfile("test.small.namer", {name: "取名", description: "测试用", tools: {required: [], optional: []}, role: "tiny", hidden: true});
        const smallPlugin: PluginDefinition = {id: "test.small", entries: [defineEntry({id: "server", location: "server", activationEvents: [tiny.activationEvent], contributions: [tiny.contribution], activate: () => ({contributions: {"agent.profiles": {"test.small.namer": defineProfile({id: "test.small.namer", version: "1", name: "取名", description: "测试用", system: "你取名。", pluginExtensions: {exclude: ["session-meta"]}})}}})})]};
        const twoModels = {
            "nbook.models/providers": [{id: "local", kind: "custom", name: "本机", baseUrl: endpoint.baseUrl, api: "openai-completions", auth: "none", models: [{id: "big", enabled: true, contextWindow: 32_000}, {id: "small", enabled: true, contextWindow: 32_000}]}],
            "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? "local/big" : id === "tiny" ? "local/small" : null}))},
        };
        const w = await world([smallPlugin], twoModels);
        expect(w.service.profiles()).toContainEqual(expect.objectContaining({key: "test.small.namer", hidden: true}));
        const session = await createSession(w, "test.small.namer");
        const sent = endpoint.requests.length;
        endpoint.script("好");
        await say(session, "取个名");
        expect(endpoint.requests[sent]!.model).toBe("small");

        const overridden = await world([smallPlugin], {...twoModels, "nbook.agent/profileSettings": {"test.small.namer": {role: "main"}}});
        const other = await createSession(overridden, "test.small.namer");
        const next = endpoint.requests.length;
        endpoint.script("好");
        await say(other, "取个名");
        expect(endpoint.requests[next]!.model).toBe("big");
    });
});

describe("会话", () => {
    /** 会话锁还被持有吗：另开一个存储去打开它。 */
    async function locked(w: AgentWorld, id: string): Promise<boolean> {
        const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
        const opened = await store.open(id);
        if (!opened.ok) return opened.code === "session-busy";
        await store.close(opened.value);
        return false;
    }

    test("输出 5、6：同时到达的打开得到同一个会话；空闲 30 秒后关闭，视图下次调用时重新打开", async () => {
        const w = await world([profilesPlugin({count: 0})]);
        const session = await createSession(w);
        expect(await locked(w, session.id)).toBe(true);
        w.settings.clock.advance(IDLE_CLOSE_MS);
        await waitUntil("空闲后关闭", async () => !(await locked(w, session.id)));

        // 关闭之后拿着的视图照样能用；两个视图同时打开只开一次（否则后一个撞锁得 session-busy）。
        const other = w.service.session(session.id);
        const [a, b] = await Promise.all([session.snapshot(), other.snapshot()]);
        expect([a.sessionId, b.sessionId]).toEqual([session.id, session.id]);
        expect(await locked(w, session.id)).toBe(true);
    });

    test("输出 6：运行中不关闭；订阅期间不关闭，取消后才开始空闲计时", async () => {
        const w = await world([profilesPlugin({count: 0})]);
        const session = await createSession(w);
        const unsubscribe = session.subscribe(() => undefined);
        // 订阅取会话是异步的；之后再来的一次调用结算时，排在它前面的订阅已经接上。
        await session.snapshot();
        w.settings.clock.advance(IDLE_CLOSE_MS * 2);
        expect(await locked(w, session.id)).toBe(true);
        unsubscribe();
        w.settings.clock.advance(IDLE_CLOSE_MS);
        await waitUntil("取消订阅后空闲关闭", async () => !(await locked(w, session.id)));
    });

    test("输出 14：停止时还在建的会话也会被关上、锁放掉；停止之后服务的每个入口都得 unavailable", async () => {
        let entered!: () => void;
        const mounting = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slow = agentProfile("test.slow.profile", {name: "慢", description: "测试用", tools: {required: [], optional: []}});
        const plugin: PluginDefinition = {id: "test.slow", entries: [defineEntry({id: "server", location: "server", activationEvents: [slow.activationEvent], contributions: [slow.contribution], activate: () => ({contributions: {"agent.profiles": {"test.slow.profile": defineProfile({id: "test.slow.profile", version: "1", name: "慢", description: "测试用", mount: async () => {
            entered();
            await gate;
        }})}}})})]};
        const w = await world([plugin]);
        const creating = w.service.create({profile: "test.slow.profile"});
        await mounting;
        worlds.splice(worlds.indexOf(w), 1);
        const closing = w.close();
        release();
        await closing;
        const created = await creating;
        const id = created.ok ? created.value.id : null;
        if (id !== null) expect(await locked(w, id)).toBe(false);
        for (const call of [() => w.service.list(), () => w.service.profiles(), () => w.service.running(), () => w.service.session("x")]) {
            expect(() => call()).toThrow(expect.objectContaining({code: "unavailable"}));
        }
    });

    test("输出 14：停止时运行中的会话按 interrupted 关闭，之后的调用得 unavailable", async () => {
        const w = await world([profilesPlugin({count: 0})]);
        const session = await createSession(w);
        const hold = endpoint.hold();
        const sent = await session.send({commandId: cid(), input: {text: "长一点"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("no run");
        await hold.arrived;
        worlds.splice(worlds.indexOf(w), 1);
        const closing = w.close();
        hold.release();
        await closing;
        await expect(w.service.create({profile: WRITER})).rejects.toMatchObject({code: "unavailable"});
        const store = createJsonlStore({root: join(w.stateRoot, "agent", "sessions")});
        const opened = await store.open(session.id);
        if (!opened.ok) throw new Error(opened.code);
        const ended = opened.value.events.filter((event) => event.type === "runEnded").map((event) => (event.data as {reason: string}).reason);
        await store.close(opened.value);
        expect(ended).toEqual(["interrupted"]);
    });
});

describe("运行保护的接线（docs/specs/agent/run-guards.md）", () => {
    /** 手动时钟上的运行：推进时钟直到它结束。 */
    async function finish(w: AgentWorld, session: SessionApi, text: string) {
        const sent = await session.send({commandId: cid(), input: {text}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        let result: Awaited<ReturnType<SessionApi["waitRun"]>> | null = null;
        void session.waitRun(sent.value.runId).then((value) => {
            result = value;
        });
        await waitUntil("运行结束", () => {
            w.settings.clock.advance(1000);
            return result !== null;
        });
        return result!;
    }
    const providers = (activations = {count: 0}) => [profilesPlugin(activations), toolsPlugin(activations)];

    test("验收 3、输出 1：新会话默认装着两个扩展", async () => {
        const session = await createSession(await world(providers()));
        const active = (await session.snapshot()).extensions.filter((item) => item.id.endsWith("-guard")).map((item) => [item.id, item.status]).sort();
        expect(active).toEqual([["nbook.agent.cost-guard", "active"], ["nbook.agent.loop-guard", "active"]]);
    });

    test("输出 2：缺省重发一次失败的请求；modelRetries 是 0 时不重发", async () => {
        const w = await world(providers());
        const session = await createSession(w);
        const before = endpoint.requests.length;
        endpoint.script({status: 503}, "好了");
        expect(await finish(w, session, "问")).toMatchObject({reason: "completed", text: "好了"});
        expect(endpoint.requests.length - before).toBe(2);

        const off = await world(providers(), {"nbook.agent/modelRetries": 0});
        const offSession = await createSession(off);
        const offBefore = endpoint.requests.length;
        endpoint.script({status: 503});
        expect((await finish(off, offSession, "问")).reason).toBe("error");
        expect(endpoint.requests.length - offBefore).toBe(1);
    });

    test("卡死超时读模型服务的设置：等第一个事件超时按 network 失败", async () => {
        const w = await world(providers(), {"nbook.agent/modelRetries": 0, "nbook.models/streamFirstEventTimeoutSeconds": 1});
        const session = await createSession(w);
        const hold = endpoint.hold();
        try {
            expect((await finish(w, session, "问")).error).toMatchObject({kind: "network", code: "first-event-timeout"});
        } finally {
            hold.release();
        }
    });

    test("设置读真实的值：循环阈值、费用上限", async () => {
        const w = await world(providers(), {"nbook.agent/toolLoopThreshold": 1, "nbook.agent/maxCost": 1});
        const session = await createSession(w);
        endpoint.script({tool: "test__tools__echo", args: {text: "同样"}}, {tool: "test__tools__echo", args: {text: "同样"}});
        const result = await finish(w, session, "问");
        expect(result.error).toMatchObject({code: "tool-call-loop"});
        // 本机端点的模型没有单价：设了上限就要提示一次。
        const events = (await session.log({afterSeq: 0, limit: 100_000})).events;
        expect(events.filter((event) => event.type === "nbook.agent.cost-guard/costUnpriced")).toHaveLength(1);
    });
});
