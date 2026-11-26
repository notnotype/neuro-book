/**
 * eval 工具（docs/specs/agent/eval.md；测试名里的编号是它的输出条目与验收场景）：真实服务端内核装 `nbook.files`、`nbook.agent`，
 * 真实的内核子进程，模型是本机的 OpenAI 兼容端点，脚本化地调 eval；断言落在工具结果、嵌套调用的事件与真实进程上。
 * 单元时限与空闲回收在场地的手动时钟上：要它们到点就推时钟。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, realpath, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {JsonValue, LogEvent, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {IDLE_CLOSE_MS} from "@notnotype/nb-harness/kit/sessions";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {userFilesContract} from "nbook/plugins/files/shared/contracts";
import type {ChangesMessage, FileChange} from "nbook/plugins/files/shared/contracts";

import {EVAL_IDLE_MS} from "./backend/eval/tool";
import {agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let commands = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
/** 测试插件的远程入口：订阅 `user://` 的变更用。 */
let remote: ActivationContext["remote"] | null = null;
/** 关闭过的会话（`PROBE` 的实现被释放时记下）。 */
const closedSessions: string[] = [];
const cid = () => `e-${String((commands += 1))}`;

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "eval");
    endpoint = fakeEndpoint();
    // 服务端在这个进程里：内核继承的就是它的环境（eval.md 输出 10）。
    process.env.NBOOK_EVAL_TEST_SENTINEL = "present";
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
    closedSessions.splice(0);
});
afterAll(async () => {
    endpoint.stop();
    delete process.env.NBOOK_EVAL_TEST_SENTINEL;
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const YOLO = "test.eval.yolo";
const ASK = "test.eval.ask";
/** 带上代码里不能调的几个工具（eval.md 输出 19）。 */
const WIDE = "test.eval.wide";
/** 声明了 `returns`、却交回不符的结构的工具（eval.md 输出 7）。 */
const SHAPE = "test.eval.shape";
/** 只给有人在窗口前的会话的工具（contributions.md 输出 4），装到所有 Profile。 */
const FRONT = "test.eval.front";
/** 声明了 `errors` 的工具：按参数交回带不同 `details` 的失败（eval.md 输出 8）。 */
const FAILS = "test.eval.fails";
/** 代码里调一次它，这个会话打开期间就有它的实现；会话关闭时实现被释放，记下会话 id（看会话真的关了）。 */
const PROBE = "test.eval.probe";
const TOOLS = ["nbook.agent.eval", "nbook.agent.read", "nbook.agent.write", "nbook.agent.shell", SHAPE, FAILS, PROBE];
const WIDE_TOOLS = [...TOOLS, "nbook.agent.spawn", "nbook.agent.send", "nbook.agent.answer", "nbook.agent.switch-mode"];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function testPlugin(): PluginDefinition {
    const toolsOf = (key: string) => (key === WIDE ? WIDE_TOOLS : TOOLS);
    const profiles = [YOLO, ASK, WIDE].map((key) => agentProfile(key, {name: key, description: "测试用", tools: {required: toolsOf(key), optional: []}}));
    const shape = agentTool(SHAPE, {description: "交回一个数", parameters: {type: "object", properties: {}}, version: "1", effect: "read", providerName: "shape", returns: {type: "object", properties: {n: {type: "number"}}, required: ["n"]}});
    const shapeTool: AgentToolImplementation = {create: () => ({execute: async () => ({text: "数好了", details: {n: "不是数"}})})};
    const fails = agentTool(FAILS, {description: "按 kind 失败", parameters: {type: "object", properties: {kind: {type: "string"}}, required: ["kind"]}, version: "1", effect: "read", providerName: "fails", errors: {busy: {type: "object", properties: {retryAfter: {type: "number"}}, required: ["retryAfter"]}}});
    const failures: Readonly<Record<string, {readonly code: string; readonly text: string; readonly details: JsonValue}>> = {
        ok: {code: "busy", text: "忙", details: {retryAfter: 3}},
        bad: {code: "busy", text: "忙", details: {retryAfter: "三秒"}},
        big: {code: "busy", text: "忙", details: {retryAfter: 3, log: "字".repeat(3000)}},
        undeclared: {code: "other", text: "别的", details: {retryAfter: 3}},
    };
    const failsTool: AgentToolImplementation = {create: () => ({execute: async (args) => ({status: "error" as const, ...failures[(args as {kind: string}).kind]!})})};
    const front = agentTool(FRONT, {description: "前台才有", parameters: {type: "object", properties: {}}, version: "1", effect: "read", providerName: "front", defaultForAll: true, foreground: true});
    const frontTool: AgentToolImplementation = {create: () => ({execute: async () => "在前台"})};
    const probe = agentTool(PROBE, {description: "什么也不做", parameters: {type: "object", properties: {}}, version: "1", effect: "read", providerName: "probe"});
    const probeTool: AgentToolImplementation = {create: (context) => ({execute: async () => "在", dispose: () => void closedSessions.push(context.sessionId)})};
    return {id: "test.eval", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", ...profiles.map((item) => item.activationEvent), shape.activationEvent, fails.activationEvent, front.activationEvent, probe.activationEvent],
        contributions: [...profiles.map((item) => item.contribution), shape.contribution, fails.contribution, front.contribution, probe.contribution],
        activate: (context) => {
            remote = context.remote;
            return {contributions: {
                "agent.profiles": Object.fromEntries([YOLO, ASK, WIDE].map((key) => [key, defineProfile({id: key, version: "1", name: key, description: "测试用", system: "测试。", tools: {required: toolsOf(key)}})])),
                "agent.tools": {[SHAPE]: shapeTool, [FAILS]: failsTool, [FRONT]: frontTool, [PROBE]: probeTool},
            }};
        },
    })]};
}

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[YOLO]: {approvalMode: "yolo"}, [WIDE]: {approvalMode: "yolo"}, [ASK]: {approvalMode: "ask"}}}});
    worlds.push(created);
    return created;
}

async function open(w: AgentWorld, profile = YOLO): Promise<{readonly session: SessionApi; readonly home: string}> {
    const created = await w.service.create({profile});
    if (!created.ok) throw new Error(created.code);
    const home = join(w.stateRoot, "agent", "sessions", created.value.id, "home");
    await mkdir(home, {recursive: true});
    return {session: created.value, home};
}

interface Result {
    readonly tool: string;
    readonly text: string;
    readonly status: string;
    readonly code?: string;
    readonly images?: readonly unknown[];
    readonly details?: {readonly artifact?: string};
}

const results = (events: readonly LogEvent[]): Result[] => events.filter((event) => event.type === "toolResult").map((event) => event.data as unknown as Result);

/** 模型在一条回复里调这几段代码，不等运行结束；交回运行 id。 */
async function start(session: SessionApi, ...cells: ReadonlyArray<Readonly<Record<string, unknown>>>): Promise<string> {
    endpoint.script({tools: cells.map((args) => ({tool: "eval", args}))}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "跑代码"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    return sent.value.runId;
}

/** 模型在一条回复里调这几段代码；交回这一轮的 eval 结果。 */
async function evals(session: SessionApi, ...cells: ReadonlyArray<Readonly<Record<string, unknown>>>): Promise<Result[]> {
    const before = results(await session.path()).length;
    await session.waitRun(await start(session, ...cells));
    return results(await session.path()).slice(before);
}

/** 一个单元的结果（一条回复只调一次 eval）。 */
async function one(session: SessionApi, cell: Readonly<Record<string, unknown>>): Promise<Result> {
    return (await evals(session, cell))[0]!;
}

async function pending(session: SessionApi, other?: string): Promise<{id: string}> {
    return waitUntil("有等用户的事项", async () => {
        const status = (await session.snapshot()).status as {state: string; pending?: {id: string}[]};
        return status.state === "waiting" ? (status.pending?.find((item) => item.id !== other) ?? null) : null;
    }, {timeoutMs: 20_000});
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** 代码写下的标记文件出现了：单元已经跑到那一步。 */
const reached = (path: string) => waitUntil(`代码写了 ${path}`, async () => ((await stat(path).catch(() => null)) === null ? null : true), {timeoutMs: 20_000});

const pidsIn = (text: string): number[] => [...text.matchAll(/pid (\d+)/gu)].map((match) => Number(match[1]));

/**
 * 等会话因空闲关闭（这次打开期间代码里要调过 `tool.probe`），交回推了多久。会话在运行结束、状态变成空闲之后才排关闭的计时，所以先等状态
 * 变成空闲，再边推时钟边等。推的时间也算进内核的空闲计时，推满 30 分钟就不再是“关闭期间内核还在”的场景，这时直接失败。
 */
async function closeIdle(w: AgentWorld, session: SessionApi): Promise<number> {
    await waitUntil("会话的运行结束了", async () => ((await session.snapshot()).status as {state: string}).state === "idle" ? true : null);
    let advanced = 0;
    await waitUntil("会话关闭了", () => {
        if (closedSessions.includes(session.id)) return true;
        if (advanced + IDLE_CLOSE_MS >= EVAL_IDLE_MS) throw new Error("推了快 30 分钟会话还没关");
        w.settings.clock.advance(IDLE_CLOSE_MS);
        advanced += IDLE_CLOSE_MS;
        return null;
    }, {intervalMs: 50});
    return advanced;
}

describe("eval", () => {
    test("输出 1、12、验收 1：同一条回复里两个 eval：第一个读三章统计、定义函数，第二个接着算；回退之后内核重置，结果第一行写明", async () => {
        const w = await world();
        const {session, home} = await open(w);
        for (const [name, length] of [["第一章", 3], ["第二章", 5], ["第三章", 7]] as const) await writeFile(join(home, `${name}.md`), "雨".repeat(length));
        const [define, use] = await evals(session, {code: "const counts = {}; for (const n of ['一', '二', '三']) counts[n] = (await tool.read({path: `session://第${n}章.md`})).content.length; function add(a) { return a + counts['二'] + counts['三'] }"}, {code: "add(30)"});
        expect(define!.status).toBe("ok");
        expect(use!.text).toBe("42");
        const target = (await session.rewindTargets()).find((item) => item.kind === "after-turn");
        await session.rewind({commandId: cid(), to: target!.id});
        const after = await one(session, {code: "typeof add"});
        expect(after.text.split("\n")[0]).toContain("内核已重置（回退或切分支）");
        expect(after.text).toContain("undefined");
    });

    test("输入：参数严格校验，缺 code、多余的参数、timeout 越界或不是整数的都不执行；只重置时 code 可以为空", async () => {
        const w = await world();
        const {session} = await open(w);
        const refused = await evals(session, {}, {code: "globalThis.ran = 1", extra: 1}, {code: "globalThis.ran = 1", timeout: 0}, {code: "globalThis.ran = 1", timeout: 3601}, {code: "globalThis.ran = 1", timeout: 1.5}, {code: "typeof ran", timeout: 3600});
        expect(refused.map((result) => result.code ?? result.status)).toEqual(["invalid-arguments", "invalid-arguments", "invalid-arguments", "invalid-arguments", "invalid-arguments", "ok"]);
        expect(refused.at(-1)!.text).toBe("undefined");
    });

    test("输出 1、2：顶层 return、for await、undefined 不显示、没有输出时写明；值按 inspect 深度 6；顶层 import、bun: 与包名按工作目录解析", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(join(home, "node_modules", "nb-eval-pkg"), {recursive: true});
        await writeFile(join(home, "node_modules", "nb-eval-pkg", "package.json"), JSON.stringify({name: "nb-eval-pkg", main: "index.js"}));
        await writeFile(join(home, "node_modules", "nb-eval-pkg", "index.js"), "module.exports = 41;\n");
        const cells = await evals(session,
            {code: "if (true) return 5\n6"},
            {code: "for await (const x of (async function* () { yield 1; yield 2 })()) console.log(x)\nundefined"},
            {code: "let quiet = 1"},
            {code: "({a: {b: {c: {d: {e: {f: {g: {h: 1}}}}}}}})"},
            {code: "import {basename} from \"node:path\";\nimport {Database} from \"bun:sqlite\";\n[basename('/甲/乙.md'), typeof Database].join()"},
            {code: "const viaRequire = require('nb-eval-pkg'); const viaImport = await import('nb-eval-pkg'); [viaRequire, viaImport.default].join()"},
        );
        expect(cells.map((cell) => cell.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
        expect(cells[0]!.text).toBe("5");
        expect(cells[1]!.text).toBe("1\n2");
        expect(cells[2]!.text).toBe("（没有输出）");
        expect(cells[3]!.text).toContain("g: [Object]");
        expect(cells[3]!.text).toContain("f: {");
        expect(cells[4]!.text).toBe("乙.md,function");
        expect(cells[5]!.text).toBe("41,41");
    });

    test("输出 3：代码抛错时保留之前的输出，写错误与这段代码里的帧；有 export、声明了内核的名字的不执行", async () => {
        const w = await world();
        const {session} = await open(w);
        const [thrown, exported, shadowed, after] = await evals(session,
            {code: "console.log('前面')\nthrow new Error('坏了')"},
            {code: "globalThis.ran = 1; export const a = 1"},
            {code: "globalThis.ran = 1; const tool = 1"},
            {code: "typeof ran"},
        );
        expect(thrown!.code).toBe("code-error");
        expect(thrown!.text.startsWith("前面\n")).toBe(true);
        expect(thrown!.text).toContain("坏了");
        expect(thrown!.text).toMatch(/cell-\d+\.js:2/u);
        expect(thrown!.text).not.toContain("kernel-entry");
        expect([exported!.code, shadowed!.code]).toEqual(["code-error", "code-error"]);
        expect(after!.text).toBe("undefined");
    });

    test("输出 8：声明了 errors 的码，ToolCallError 带照声明校验过的 details；不合格、超过 8 KB 的不带并在说明末尾写明、记诊断；没声明的码不带", async () => {
        const w = await world();
        const {session} = await open(w);
        const code = [
            "const seen = [];",
            "for (const kind of ['ok', 'bad', 'big', 'undeclared']) { try { await tool.fails({kind}) } catch (e) { seen.push({kind, code: e.code, has: 'details' in e, details: e.details, message: e.message}) } }",
            "JSON.stringify(seen)",
        ].join("\n");
        expect(JSON.parse((await one(session, {code})).text)).toEqual([
            {kind: "ok", code: "busy", has: true, details: {retryAfter: 3}, message: "忙"},
            {kind: "bad", code: "busy", has: false, message: "忙（失败详情不符合声明的形状，没有附上）"},
            {kind: "big", code: "busy", has: false, message: "忙（失败详情超过 8 KB，没有附上）"},
            {kind: "undeclared", code: "other", has: false, message: "别的"},
        ]);
        const dropped = w.settings.diagnostics("hub").query({}).records.filter((record) => record.event === "agent.eval-error-details-dropped");
        expect(dropped.map((record) => (record.data as {code: string}).code)).toEqual(["busy", "busy"]);
    });

    test("contributions.md 输出 4：声明 foreground 的工具，代码里也只在有人在窗口前的会话能调；后台会话里得 unknown-tool", async () => {
        const w = await world();
        const {session} = await open(w);
        const code = "let got; try { got = await tool.front() } catch (e) { got = e.code }\ngot";
        expect((await one(session, {code})).text).toBe("在前台");
        endpoint.script({tool: "eval", args: {code}}, "好");
        const started = await w.service.startTask({taskId: crypto.randomUUID(), profile: YOLO, input: {text: "跑代码"}, background: true});
        if (!started.ok) throw new Error(started.code);
        await started.result;
        expect(results(await w.service.session(started.sessionId).path()).map((result) => result.text)).toEqual(["unknown-tool"]);
    });

    test("输出 4：代码里调的工具交回的图并进结果（带着宽高）；一个单元至多 8 张，多的写明", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await writeFile(join(home, "图.png"), Buffer.from(PNG, "base64"));
        const [fromTool, many] = await evals(session,
            {code: "await tool.read({path: 'session://图.png'}); '读了'"},
            {code: `for (let i = 0; i < 9; i++) display({data: "${PNG}", mime: "image/png"}); display({data: new Uint8Array(Buffer.from("${PNG}", "base64")), mime: "image/png"}); "画好了"`},
        );
        expect(fromTool!.images).toEqual([expect.objectContaining({width: expect.any(Number), height: expect.any(Number)})]);
        expect(many!.images).toHaveLength(8);
        expect(many!.text).toContain("另有 2 张图没有附上");
    });

    test("输出 5：没 await 的嵌套调用结算之后才交结果，它的事件写在父调用的结果之前", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await writeFile(join(home, "章.md"), "正文");
        expect((await one(session, {code: "tool.read({path: 'session://章.md'}); '交了'"})).text).toBe("交了");
        const types = (await session.path()).filter((event) => event.type === "nestedToolResult" || event.type === "toolResult").map((event) => event.type === "toolResult" ? (event.data as {tool: string}).tool : `nested ${(event.data as {status: string}).status}`);
        expect(types).toEqual(["nested ok", "nbook.agent.eval"]);
    });

    test("输出 7、8、9：没声明 returns 的交回文字；交回的结构不符得 returns-mismatch；ToolCallError 带工具名与说明；传不过去的参数得 invalid-arguments", async () => {
        const w = await world();
        const {session} = await open(w);
        const code = [
            "const seen = [typeof await tool.write({path: 'session://a.md', content: '正文'})];",
            "try { await tool.shape() } catch (e) { seen.push(e.name, e.tool, e.code, e.message.length > 0) }",
            "for (const args of [{path: 'session://a.md', f: () => 1}, {path: 'session://a.md', n: NaN}]) { try { await tool.read(args) } catch (e) { seen.push(e.code) } }",
            "seen.join()",
        ].join("\n");
        expect((await one(session, {code})).text).toBe("string,ToolCallError,shape,returns-mismatch,true,invalid-arguments,invalid-arguments");
    });

    test("副作用与数据、resources.md 输出 17：代码里写的文件，来源是各自的嵌套调用，同一个父调用的写入成一组、标题是 eval", async () => {
        const w = await world();
        const {session} = await open(w);
        const messages: ChangesMessage[] = [];
        const subscribed = await remote!.use(userFilesContract).events.changes.subscribe({}, (message) => messages.push(message));
        expect(subscribed.ok).toBe(true);
        await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));
        await one(session, {code: "await tool.write({path: 'user://甲.md', content: '甲'}); await tool.write({path: 'user://乙.md', content: '乙'})"});
        const nested = (await session.path()).filter((event) => event.type === "nestedToolResult").map((event) => (event.data as {id: string}).id);
        const events = (): FileChange[] => messages.flatMap((message) => (message.kind === "batch" ? message.events : [])).filter((event) => ["甲.md", "乙.md"].includes(event.path));
        await waitUntil("两条变更", () => events().length === 2);
        expect(events().map((event) => (event.source.kind === "agent" ? event.source.entry : null)).sort()).toEqual([...nested].sort());
        expect(new Set(events().map((event) => event.group?.id)).size).toBe(1);
        expect(events()[0]?.group?.title).toBe("nbook.agent.eval");
    });

    test("builtin-tools.md 输出 30：代码里读目录与图片交回对象；模型直接调 read 的结果不带结构化的值", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await writeFile(join(home, "图.png"), Buffer.from(PNG, "base64"));
        const read = await one(session, {code: "const dir = await tool.read({path: 'session://'}); const img = await tool.read({path: 'session://图.png'}); [dir.kind, dir.entries.some((entry) => entry.endsWith('/图.png')), dir.more, img.kind, img.mime.startsWith('image/'), img.width, img.height].join()"});
        expect(read.text).toBe("directory,true,false,image,true,1,1");
        endpoint.script({tool: "read", args: {path: "session://图.png"}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "读图"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await session.waitRun(sent.value.runId);
        const direct = results(await session.path()).at(-1)!;
        expect(direct.tool).toBe("nbook.agent.read");
        expect(direct.details).toBeUndefined();
    });

    test("输出 6 到 8、18、验收 2：询问模式下 eval 的审批不能记；代码里的写入再问一次、带来源，拒绝之后代码接住 ToolCallError 接着跑", async () => {
        const w = await world();
        const {session} = await open(w, ASK);
        endpoint.script({tool: "eval", args: {code: "let why; try { await tool.write({path: 'session://a.md', content: '正文'}) } catch (e) { why = [e.name, e.status, e.code] } why"}}, "好");
        const sent = await session.send({commandId: cid(), input: {text: "写"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        const first = await pending(session);
        const asked = (await session.path()).filter((event) => event.type === "interactionRequested").map((event) => event.data as {id: string; request: {tool: string; remember?: unknown}; within?: unknown});
        expect(asked.at(-1)!.request.tool).toBe("nbook.agent.eval");
        expect(asked.at(-1)!.request.remember).toBe(false);
        expect((await session.resolve({commandId: cid(), id: first.id, decision: "allow-session"})).ok).toBe(false);
        await session.resolve({commandId: cid(), id: first.id, decision: "allow"});
        const second = await pending(session, first.id);
        const nested = (await session.path()).filter((event) => event.type === "interactionRequested").map((event) => event.data as {request: {tool: string}; within?: {tool: string}}).at(-1)!;
        expect(nested.request.tool).toBe("nbook.agent.write");
        expect(nested.within?.tool).toBe("nbook.agent.eval");
        await session.resolve({commandId: cid(), id: second.id, decision: "deny"});
        await session.waitRun(sent.value.runId);
        const events = await session.path();
        expect(results(events).at(-1)!.text).toBe("[ 'ToolCallError', 'denied', 'user-denied' ]");
        expect(events.filter((event) => event.type === "nestedToolResult").map((event) => (event.data as {status: string}).status)).toEqual(["denied"]);
    });

    test("输出 14、13、验收 3：死循环到时限（缺省 30 秒）：内核与它起的子进程都结束，已有的输出保留、写明重置；下一次调用提示超时重置", async () => {
        const w = await world();
        const {session, home} = await open(w);
        const runId = await start(session, {code: `globalThis.kept = 1; const child = Bun.spawn(['sleep', '300']); console.log('pid ' + child.pid); await Bun.write(${JSON.stringify(join(home, "looping"))}, '1'); while (true) {}`});
        await reached(join(home, "looping"));
        w.settings.clock.advance(30_000);
        await session.waitRun(runId);
        const stuck = results(await session.path()).at(-1)!;
        expect(stuck.code).toBe("timeout");
        expect(stuck.text).toContain("超过 30 秒的时限，内核已结束并重置");
        const [pid] = pidsIn(stuck.text);
        await waitUntil("代码起的子进程也结束了", () => (alive(pid!) ? null : true));
        const next = await one(session, {code: "typeof kept"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（超时）");
        expect(next.text).toContain("undefined");
    }, 30_000);

    test("输出 14：等审批的时间不算进时限；工具执行的时间算，到时先结算在途的嵌套调用，它的结果写在父调用之前", async () => {
        const w = await world();
        const asking = await open(w, ASK);
        const waited = await start(asking.session, {code: "await tool.write({path: 'session://a.md', content: '正文'}); '写好了'", timeout: 1});
        const evalAsked = await pending(asking.session);
        await asking.session.resolve({commandId: cid(), id: evalAsked.id, decision: "allow"});
        const writeAsked = await pending(asking.session, evalAsked.id);
        w.settings.clock.advance(5_000);
        await asking.session.resolve({commandId: cid(), id: writeAsked.id, decision: "allow"});
        await asking.session.waitRun(waited);
        expect(results(await asking.session.path()).at(-1)).toMatchObject({status: "ok", text: "写好了"});

        const {session, home} = await open(w);
        const runId = await start(session, {code: `await tool.shell({command: 'touch started; sleep 30'}); '跑完了'`, timeout: 1});
        await reached(join(home, "started"));
        w.settings.clock.advance(1_000);
        await session.waitRun(runId);
        const events = (await session.path()).filter((event) => event.type === "nestedToolResult" || event.type === "toolResult");
        expect(events.map((event) => event.type)).toEqual(["nestedToolResult", "toolResult"]);
        expect((events[1]!.data as unknown as Result).code).toBe("timeout");
    }, 30_000);

    test("输出 15、11、12：运行被停止：结果码 aborted，已有的输出保留；下一次调用提示被停止", async () => {
        const w = await world();
        const {session, home} = await open(w);
        const runId = await start(session, {code: `globalThis.kept = 1; console.log('开始'); await Bun.write(${JSON.stringify(join(home, "looping"))}, '1'); while (true) {}`});
        await reached(join(home, "looping"));
        await session.abort({commandId: cid()});
        await session.waitRun(runId);
        // 停下的那一轮没用上的回复（“好”）不能串到下一轮。
        endpoint.reset();
        const stopped = results(await session.path()).at(-1)!;
        expect(stopped).toMatchObject({status: "error", code: "aborted"});
        expect(stopped.text).toContain("开始");
        const next = await one(session, {code: "typeof kept"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（被停止）");
        expect(next.text).toContain("undefined");
    }, 30_000);

    test("输出 11、12、13：reset: true 先重置（code 可以为空）；下一次提示主动重置", async () => {
        const w = await world();
        const {session} = await open(w);
        const [, onlyReset, after, , withCode] = await evals(session,
            {code: "globalThis.r = 1"},
            {reset: true, code: ""},
            {code: "typeof r"},
            {code: "globalThis.r = 2"},
            {reset: true, code: "typeof r"},
        );
        expect(onlyReset!.text).toBe("内核已重置。");
        for (const result of [after!, withCode!]) {
            expect(result.text.split("\n")[0]).toContain("内核已重置（主动重置）");
            expect(result.text).toContain("undefined");
        }
    });

    test("输出 11、12、13：30 分钟没有调用时内核结束，最后一次是没执行的语法错误也一样；下一次提示空闲", async () => {
        const w = await world();
        const {session} = await open(w);
        const [pid] = pidsIn((await one(session, {code: "globalThis.k = 1; 'pid ' + process.pid"})).text);
        expect((await one(session, {code: "const = 1"})).code).toBe("code-error");
        w.settings.clock.advance(EVAL_IDLE_MS);
        await waitUntil("空闲的内核结束了", () => (alive(pid!) ? null : true));
        // 当场知道的重置给会话发一条不带唤起的提醒（eval.md），下一次结果第一行照旧写（说两遍）。
        await waitUntil("重置的提醒待发", async () => (await session.snapshot()).notices.some((item) => item.text.includes("eval 的内核已重置（空闲）")));
        expect((await session.snapshot()).notices.find((item) => item.text.includes("eval 的内核已重置"))).toMatchObject({wake: false});
        const next = await one(session, {code: "typeof k"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（空闲）");
        expect(next.text).toContain("undefined");
        // 新内核起来时撤回还没取走的提醒：撤回在送达的队列里，和这次结果交回没有先后。
        await waitUntil("提醒撤回了", async () => (await session.snapshot()).notices.length === 0);
    });

    test("eval.md：两次调用之间内核进程被外部杀掉，当场发提醒；下一次结果第一行照旧写", async () => {
        const w = await world();
        const {session} = await open(w);
        const [pid] = pidsIn((await one(session, {code: "'pid ' + process.pid"})).text);
        process.kill(pid!, "SIGKILL");
        await waitUntil("意外退出的提醒待发", async () => (await session.snapshot()).notices.some((item) => item.text.includes("eval 的内核已重置（意外退出）")));
        const next = await one(session, {code: "1 + 1"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（意外退出）");
    });

    test("输出 11、12：全服务端的内核超过 8 个时，最久没用的那个结束；那个会话下一次提示被回收", async () => {
        const w = await world();
        const sessions: SessionApi[] = [];
        const pids: number[] = [];
        for (let index = 0; index < 9; index += 1) {
            const {session} = await open(w);
            sessions.push(session);
            pids.push(pidsIn((await one(session, {code: "globalThis.k = 1; 'pid ' + process.pid"})).text)[0]!);
        }
        await waitUntil("最久没用的内核结束了", () => (alive(pids[0]!) ? null : true));
        expect(pids.slice(1).every(alive)).toBe(true);
        await waitUntil("被回收的提醒待发", async () => (await sessions[0]!.snapshot()).notices.some((item) => item.text.includes("eval 的内核已重置（被回收）")));
        const next = await one(sessions[0]!, {code: "typeof k"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（被回收）");
    }, 60_000);

    test("输出 11、12：分叉出的会话从新内核开始并提示", async () => {
        const w = await world();
        const {session} = await open(w);
        await one(session, {code: "globalThis.f = 1"});
        const forked = await session.fork({commandId: cid()});
        if (!forked.ok) throw new Error(forked.code);
        const copy = w.service.session(forked.value.sessionId);
        const next = await one(copy, {code: "typeof f"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（服务重启或分叉）");
        expect(next.text).toContain("undefined");
    });

    test("输出 11、12、时序与寿命：会话关闭不结束内核，再打开、叶子没动时接着用；关闭期间空闲到点，内核与它起的子进程结束，再打开时提示空闲", async () => {
        const w = await world();
        const {session} = await open(w);
        const pids = pidsIn((await one(session, {code: "await tool.probe({}); globalThis.kept = 41; const child = Bun.spawn(['sleep', '300']); 'pid ' + process.pid + ' pid ' + child.pid"})).text);
        expect(pids).toHaveLength(2);
        await closeIdle(w, session);
        expect(pids.every(alive)).toBe(true);
        const reopened = w.service.session(session.id);
        const again = await one(reopened, {code: "await tool.probe({}); kept + 1"});
        expect(again.text).toBe("42");
        // 关闭不改空闲的截止：从最后一个单元结束算 30 分钟（这期间只有用例推时钟）。差 1 毫秒时再打开，变量还在；
        // 再关一次、正好推到截止，内核与子进程结束。
        closedSessions.splice(0);
        let advanced = await closeIdle(w, reopened);
        w.settings.clock.advance(EVAL_IDLE_MS - advanced - 1);
        const before = w.service.session(session.id);
        expect((await one(before, {code: "await tool.probe({}); kept"})).text).toBe("41");
        closedSessions.splice(0);
        advanced = await closeIdle(w, before);
        w.settings.clock.advance(EVAL_IDLE_MS - advanced);
        await waitUntil("关闭期间空闲的内核与子进程结束了", () => (pids.some(alive) ? null : true));
        // 会话关着也照发提醒（eval.md 输出 20）：再打开时它已在待发里。
        const closed = w.service.session(session.id);
        await waitUntil("关着时照发的提醒", async () => (await closed.snapshot()).notices.some((item) => item.text.includes("eval 的内核已重置（空闲）")));
        const after = await one(closed, {code: "typeof kept"});
        expect(after.text.split("\n")[0]).toContain("内核已重置（空闲）");
        expect(after.text).toContain("undefined");
    });

    test("输出 11、12：会话关闭之后回退，再调时内核重置并提示回退", async () => {
        const w = await world();
        const {session} = await open(w);
        const [pid] = pidsIn((await one(session, {code: "await tool.probe({}); globalThis.kept = 1; 'pid ' + process.pid"})).text);
        await one(session, {code: "kept += 1"});
        await closeIdle(w, session);
        const reopened = w.service.session(session.id);
        const target = (await reopened.rewindTargets()).find((item) => item.kind === "after-turn");
        await reopened.rewind({commandId: cid(), to: target!.id});
        const after = await one(reopened, {code: "typeof kept"});
        expect(after.text.split("\n")[0]).toContain("内核已重置（回退或切分支）");
        expect(alive(pid!)).toBe(false);
    });

    test("输出 11、12：换了 Profile 之后再调，内核重置并提示；换走又换回来、中间没调的也一样", async () => {
        const w = await world();
        const {session} = await open(w);
        const [pid] = pidsIn((await one(session, {code: "globalThis.p = 1; 'pid ' + process.pid"})).text);
        for (const profile of [WIDE, YOLO]) expect((await session.changeProfile({commandId: cid(), profile})).ok).toBe(true);
        const next = await one(session, {code: "typeof p"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（换了 Profile）");
        expect(next.text).toContain("undefined");
        expect(alive(pid!)).toBe(false);
    });

    test("输出 13、时序与寿命：服务端停止时结束全部内核与它们起的子进程，会话关闭之后留着的也一样", async () => {
        const w = await world();
        const {session} = await open(w);
        const pids = pidsIn((await one(session, {code: "await tool.probe({}); const child = Bun.spawn(['sleep', '300']); 'pid ' + process.pid + ' pid ' + child.pid"})).text);
        await closeIdle(w, session);
        expect(pids.every(alive)).toBe(true);
        worlds.splice(worlds.indexOf(w), 1);
        await w.close();
        await waitUntil("内核与子进程都结束了", () => (pids.some(alive) ? null : true));
    });

    test("输出 10、验收 4：工作目录与布局变量同 shell，继承服务端的环境，不读工作目录里的 .env", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await writeFile(join(home, ".env"), "NBOOK_EVAL_TEST_DOTENV=local\n");
        const real = await realpath(home);
        const seen = await one(session, {code: "JSON.stringify([process.env.NBOOK_EVAL_TEST_SENTINEL, process.env.NBOOK_EVAL_TEST_DOTENV ?? null, process.cwd(), process.env.NBOOK_SESSION])"});
        expect(JSON.parse(seen.text)).toEqual(["present", null, real, real]);
    });

    test("输出 4：display 的图片附在结果里", async () => {
        const w = await world();
        const {session} = await open(w);
        const shown = await one(session, {code: `display({data: "${PNG}", mime: "image/png"}); "画好了"`});
        expect(shown.text).toContain("画好了");
        expect(shown.images).toHaveLength(1);
    });

    test("输出 15、11、13：代码里 process.exit(0) 也算意外退出，它起的子进程一起结束；被信号杀掉时写信号与内核错误流的最后一段；下一次调用提示", async () => {
        const w = await world();
        const {session} = await open(w);
        const [exited, killed] = await evals(session,
            {code: "const child = Bun.spawn(['sleep', '300']); require('node:fs').writeSync(1, 'pid ' + child.pid + '\\n'); process.exit(0)"},
            {code: "require('node:fs').writeSync(2, '错误流的尾巴\\n'); process.kill(process.pid, 'SIGKILL')"},
        );
        expect(exited!.code).toBe("kernel-exited");
        expect(exited!.text).toContain("退出码 0");
        const [orphan] = pidsIn(exited!.text);
        await waitUntil("意外退出的内核起的子进程也结束了", () => (alive(orphan!) ? null : true));
        expect(killed!.code).toBe("kernel-exited");
        expect(killed!.text).toContain("信号 SIGKILL");
        expect(killed!.text.split("内核的错误输出最后一段：\n")[1]).toContain("错误流的尾巴");
        const next = await one(session, {code: "1 + 1; 'pid ' + process.pid"});
        expect(next.text.split("\n")[0]).toContain("内核已重置（意外退出）");
        // 两次调用之间内核被外部杀掉：同样提示意外退出。
        const [between] = pidsIn(next.text);
        process.kill(between!, "SIGKILL");
        await waitUntil("内核被外部杀掉了", () => (alive(between!) ? null : true));
        const revived = await one(session, {code: "'pid ' + process.pid"});
        expect(revived.text.split("\n")[0]).toContain("内核已重置（意外退出）");
        // 这次跑在新起的内核里：PID 换了，且活着。
        const [idle] = pidsIn(revived.text);
        expect(idle).not.toBe(between);
        expect(alive(idle!)).toBe(true);
        // 被外部杀掉之后又到了空闲的点：原因仍是意外退出。
        process.kill(idle!, "SIGKILL");
        await waitUntil("内核被外部杀掉了", () => (alive(idle!) ? null : true));
        w.settings.clock.advance(EVAL_IDLE_MS);
        const last = await one(session, {code: "1 + 3"});
        expect(last.text.split("\n")[0]).toContain("内核已重置（意外退出）");
    });

    test("副作用与数据：结果超出窗口时全文另存，结果里写着全文的地址", async () => {
        const w = await world();
        const {session, home} = await open(w);
        const long = await one(session, {code: "console.log('行'.repeat(100_000)); '完'"});
        expect(long.text).toContain("全文：");
        const artifact = long.details?.artifact;
        expect(long.text).toContain(`全文：${String(artifact)}`);
        expect((await readFile(join(home, "artifacts", artifact!.split("/").at(-1)!), "utf8")).length).toBeGreaterThan(100_000);
    });

    test("输出 16：给模型的说明写明要 await、失败抛 ToolCallError、unknown 先核对、只重试失败的那一步、内核会重置", async () => {
        const w = await world();
        const {session} = await open(w);
        await one(session, {code: "1"});
        const description = endpoint.requests.at(-1)!.descriptions.eval!;
        for (const phrase of ["await", "ToolCallError", "unknown", "只重试失败的那一步", "内核已重置"]) expect(description).toContain(phrase);
    });

    test("输出 19、builtin-tools.md 输出 29：代码里调的 shell 不能转后台、同步的照常；eval 自己、派子代理三件与切换模式不能调；拼错的工具名列出能用的", async () => {
        const w = await world();
        const {session} = await open(w, WIDE);
        const code = [
            "const seen = [(await tool.shell({command: 'echo 同步'})).includes('同步')];",
            "for (const run of [() => tool.shell({command: 'echo hi', async: true}), () => tool.eval({code: '1'}), () => tool.agent_spawn({}), () => tool.agent_send({}), () => tool.agent_answer({}), () => tool.switch_mode({}), () => tool.shel({})]) { try { await run() } catch (e) { seen.push(e.code) } }",
            "seen.join()",
        ].join("\n");
        expect((await one(session, {code})).text).toBe("true,async-in-code,invoke-not-allowed,invoke-not-allowed,invoke-not-allowed,invoke-not-allowed,invoke-not-allowed,unknown-tool");
    });

    test("输出 3：语法错误不起内核，原因写明位置", async () => {
        const w = await world();
        const {session} = await open(w);
        const broken = await one(session, {code: "const a = ;"});
        expect(broken.code).toBe("code-error");
        expect(broken.text).toContain("第 1 行");
    });
});
