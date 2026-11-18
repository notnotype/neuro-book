/**
 * eval 工具（docs/specs/agent/eval.md；测试名里的编号是它的输出条目与验收场景）：真实服务端内核装 `nbook.files`、`nbook.agent`，
 * 真实的内核子进程，模型是本机的 OpenAI 兼容端点，脚本化地调 eval；断言落在工具结果、嵌套调用的事件与真实进程上。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, realpath, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {LogEvent, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {agentProfile} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let commands = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
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
});
afterAll(async () => {
    endpoint.stop();
    delete process.env.NBOOK_EVAL_TEST_SENTINEL;
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const YOLO = "test.eval.yolo";
const ASK = "test.eval.ask";
const TOOLS = ["nbook.agent.eval", "nbook.agent.read", "nbook.agent.write", "nbook.agent.shell"];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function testPlugin(): PluginDefinition {
    const profiles = [YOLO, ASK].map((key) => agentProfile(key, {name: key, description: "测试用", tools: {required: TOOLS, optional: []}}));
    return {id: "test.eval", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", ...profiles.map((item) => item.activationEvent)],
        contributions: profiles.map((item) => item.contribution),
        activate: () => ({contributions: {"agent.profiles": Object.fromEntries([YOLO, ASK].map((key) => [key, defineProfile({id: key, version: "1", name: key, description: "测试用", system: "测试。", tools: {required: TOOLS}})]))}}),
    })]};
}

async function world(): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [testPlugin()], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[YOLO]: {approvalMode: "yolo"}, [ASK]: {approvalMode: "ask"}}}});
    worlds.push(created);
    return created;
}

async function open(w: AgentWorld, profile = YOLO): Promise<{readonly session: SessionApi; readonly home: string}> {
    const created = await w.service.create({profile});
    if (!created.ok) throw new Error(created.code);
    return {session: created.value, home: join(w.stateRoot, "agent", "sessions", created.value.id, "home")};
}

interface Result {
    readonly text: string;
    readonly status: string;
    readonly code?: string;
    readonly images?: readonly unknown[];
}

const results = (events: readonly LogEvent[]): Result[] => events.filter((event) => event.type === "toolResult").map((event) => event.data as unknown as Result);

/** 模型在一条回复里调这几段代码；交回这一轮的 eval 结果。 */
async function evals(session: SessionApi, ...cells: ReadonlyArray<Readonly<Record<string, unknown>>>): Promise<Result[]> {
    const before = results(await session.path()).length;
    endpoint.script({tools: cells.map((args) => ({tool: "eval", args}))}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "跑代码"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await session.waitRun(sent.value.runId);
    return results(await session.path()).slice(before);
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

describe("eval", () => {
    test("输出 1、12、验收 1：同一条回复里两个 eval 共用变量；回退之后内核重置，结果第一行写明", async () => {
        const w = await world();
        const {session} = await open(w);
        const [define, use] = await evals(session, {code: "const n = 2; function add(a) { return a + n }"}, {code: "add(40)"});
        expect(define!.status).toBe("ok");
        expect(use!.text).toBe("42");
        const target = (await session.rewindTargets()).find((item) => item.kind === "after-turn");
        await session.rewind({commandId: cid(), to: target!.id});
        const [after] = await evals(session, {code: "typeof add"});
        expect(after!.text.split("\n")[0]).toContain("内核已重置（回退或切分支）");
        expect(after!.text).toContain("undefined");
    });

    test("输出 7：代码里的 read 交回对象，原文不带地址头与行号，按 next 翻页（builtin-tools.md 的 read）", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "章.md"), "第一行\n第二行\n");
        const [result] = await evals(session, {code: "const first = await tool.read({path: 'session://章.md', limit: 1});\nconst rest = await tool.read({path: 'session://章.md', offset: first.next});\n[first.kind, first.content, first.more, rest.content, rest.more].join('|')"});
        expect(result!.text).toBe("text|第一行|true|第二行|false");
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

    test("输出 14、13、验收 3：死循环到时限：内核与它起的子进程都结束，已有的输出保留；下一次调用提示超时重置", async () => {
        const w = await world();
        const {session} = await open(w);
        const [stuck] = await evals(session, {code: "globalThis.kept = 1; const child = Bun.spawn(['sleep', '300']); console.log('child ' + child.pid); while (true) {}", timeout: 1});
        expect(stuck!.code).toBe("timeout");
        const pid = Number(/child (\d+)/u.exec(stuck!.text)?.[1]);
        expect(pid).toBeGreaterThan(0);
        await waitUntil("代码起的子进程也结束了", () => (alive(pid) ? null : true));
        const [next] = await evals(session, {code: "typeof kept"});
        expect(next!.text.split("\n")[0]).toContain("内核已重置（超时）");
        expect(next!.text).toContain("undefined");
    }, 30_000);

    test("输出 10、验收 4：工作目录与布局变量同 shell，继承服务端的环境，不读工作目录里的 .env", async () => {
        const w = await world();
        const {session, home} = await open(w);
        await mkdir(home, {recursive: true});
        await writeFile(join(home, ".env"), "NBOOK_EVAL_TEST_DOTENV=local\n");
        const real = await realpath(home);
        const [seen] = await evals(session, {code: "JSON.stringify([process.env.NBOOK_EVAL_TEST_SENTINEL, process.env.NBOOK_EVAL_TEST_DOTENV ?? null, process.cwd(), process.env.NBOOK_SESSION])"});
        expect(JSON.parse(seen!.text)).toEqual(["present", null, real, real]);
    });

    test("输出 4：display 的图片附在结果里", async () => {
        const w = await world();
        const {session} = await open(w);
        const [shown] = await evals(session, {code: `display({data: "${PNG}", mime: "image/png"}); "画好了"`});
        expect(shown!.text).toContain("画好了");
        expect(shown!.images).toHaveLength(1);
    });

    test("输出 15、11：代码里 process.exit(0) 也算意外退出；下一次调用提示", async () => {
        const w = await world();
        const {session} = await open(w);
        const [exited] = await evals(session, {code: "console.log('走了'); process.exit(0)"});
        expect(exited!.code).toBe("kernel-exited");
        expect(exited!.text).toContain("退出码 0");
        const [next] = await evals(session, {code: "1 + 1"});
        expect(next!.text.split("\n")[0]).toContain("内核已重置（意外退出）");
        expect(next!.text).toContain("2");
    });

    test("输出 19、builtin-tools.md 输出 29：代码里调的 shell 不能转后台；拼错的工具名列出能用的", async () => {
        const w = await world();
        const {session} = await open(w);
        const [refused] = await evals(session, {code: "let codes = []; for (const run of [() => tool.shell({command: 'echo hi', async: true}), () => tool.shel({})]) { try { await run() } catch (e) { codes.push(e.code) } } codes"});
        expect(refused!.text).toBe("[ 'async-in-code', 'unknown-tool' ]");
    });

    test("输出 3：语法错误不起内核，原因写明位置", async () => {
        const w = await world();
        const {session} = await open(w);
        const [broken] = await evals(session, {code: "const a = ;"});
        expect(broken!.code).toBe("code-error");
        expect(broken!.text).toContain("第 1 行");
    });
});
