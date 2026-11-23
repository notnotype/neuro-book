/**
 * `nbook.agent` 作为后台任务清单的提供方（docs/specs/agent/jobs.md 输出 20、sessions.md 输出 30）：真实内核、会话存储、任务中心与
 * `nbook.tasks`，本机假端点；行从窗口的 `nbook.tasks/tasks` 远程读，和视图看到的是同一份。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {RunResult, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {tasksBackendPlugin} from "nbook/plugins/tasks/backend/plugin";
import {descriptor as tasksDescriptor} from "nbook/plugins/tasks/plugin";
import {tasksContract} from "nbook/plugins/tasks/shared/contracts";
import type {ListedRow, RowGroup, RowsPayload} from "nbook/plugins/tasks/shared/contracts";

import {ADHOC_PROFILE, MAIN_PROFILE} from "./shared/contracts";
import {agentText} from "./shared/text";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, Scripted} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "task-rows");
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

const cid = () => crypto.randomUUID();
const ALL = {project: null, all: true} as const;
const FOCUS = "nbook.agent.focus-session";

function ok<T>(result: {readonly ok: boolean; readonly value?: T; readonly code?: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
}

/** 起一个装了 `nbook.tasks` 的场地、主创会话与一个窗口的清单客户端。 */
async function open(settings: Readonly<Record<string, unknown>> = {}) {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {plugins: [definitionAt("server", tasksDescriptor, tasksBackendPlugin)], userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/modelRetries": 0, ...settings}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    const {client, remote} = await w.window("tasks");
    return {w, parent: created.value, client, tasks: remote.use(tasksContract)};
}

type Tasks = Awaited<ReturnType<typeof open>>["tasks"];
type SessionGroup = Extract<RowGroup, {kind: "session"}>;

const groupOf = (payload: RowsPayload, session: string): SessionGroup | undefined => payload.groups.find((group): group is SessionGroup => group.kind === "session" && group.session === session);

/** 等清单里这个会话的块满足条件，交回它（推送有节流，这里直接读）。 */
async function waitGroup(tasks: Tasks, session: string, description: string, check: (group: SessionGroup) => boolean): Promise<SessionGroup> {
    let found: SessionGroup | undefined;
    await waitUntil(description, async () => {
        found = groupOf(ok(await tasks.rows(ALL)), session);
        return found !== undefined && check(found);
    });
    return found!;
}

/** 父会话这一轮：先排好回复，发话、等运行收口。 */
async function turn(session: SessionApi, text: string, replies: readonly Scripted[]): Promise<RunResult> {
    endpoint.script(...replies);
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    return session.waitRun(sent.value.runId);
}

const adhoc = (prompt: string, extra: Readonly<Record<string, unknown>> = {}) => ({tool: "agent_spawn", args: {profile: ADHOC_PROFILE, prompt, initial: {role: "设定核对员"}, ...extra}});
const keyOf = (row: ListedRow | null): string => row!.key;

describe("后台任务的行（jobs.md 输出 20）", () => {
    test("后台命令一行：种类“命令”、在跑、不是前台、算进后台件数；从清单停下交回已受理，回执进了会话之后不再列", async () => {
        const {parent, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        await turn(parent, "跑", [{tool: "shell", args: {command: "echo 开始; sleep 30", async: true}}, "好"]);
        const group = await waitGroup(tasks, parent.id, "命令那一行", (next) => next.rows.length === 1);
        // 父会话这一轮已经收口：没有组头，块的“打开”来自行的归属。
        expect(group).toMatchObject({head: null, open: {plugin: "nbook.agent", target: {command: FOCUS, args: {sessionId: parent.id}}}});
        expect(group.rows[0]).toMatchObject({kind: "nbook.agent.shell", kindLabel: agentText("tasks.kind.shell"), state: "running", foreground: false, stoppable: true, open: null});
        expect(group.rows[0]!.title).toContain("sleep 30");
        expect(ok(await tasks.own({})).background.count).toBe(1);
        expect(ok(await tasks.stop({key: keyOf(group.rows[0]!)}))).toEqual({outcome: "accepted"});
        // 用户停的不唤起父会话：回执进了缓冲区（提醒已受理），这一行就不列了。
        await waitUntil("这一块消失", async () => groupOf(ok(await tasks.rows(ALL)), parent.id) === undefined);
        expect(ok(await tasks.own({})).background.count).toBe(0);
    });

    test("前台子代理等你批准：任务那一行等你处理、前台、不算后台件数，可打开子会话；父会话的组头写“正在回复”；子会话不另出行", async () => {
        const {w, parent, client, tasks} = await open();
        endpoint.scriptFor("改人物卡", {tool: "write", args: {path: "user://a.md", content: "x"}}, "改好了");
        endpoint.script(adhoc("改人物卡"), "好");
        const sent = await parent.send({commandId: cid(), input: {text: "派"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        const group = await waitGroup(tasks, parent.id, "任务那一行等你处理", (next) => next.rows.some((row) => row.state === "waiting"));
        const child = ok(await client.tree({sessionId: parent.id}))[0]!;
        expect(group.waiting).toBe(true);
        expect(group.head).toMatchObject({kind: "nbook.agent.session", state: "running", message: agentText("tasks.replying"), foreground: true, stoppable: true});
        expect(group.head!.key).toContain(`session:${parent.id}:${sent.value.runId}`);
        expect(group.rows).toHaveLength(1);
        expect(group.rows[0]).toMatchObject({kind: "nbook.agent.agent", kindLabel: agentText("tasks.kind.agent"), state: "waiting", message: agentText("tasks.approval"), foreground: true, open: {command: FOCUS, args: {sessionId: child.id}}});
        expect(ok(await tasks.own({})).background.count).toBe(0);
        ok(await client.resolve({sessionId: child.id, commandId: cid(), id: child.pending![0]!.id, decision: "allow"}));
        await parent.waitRun(sent.value.runId);
        await waitUntil("都收口后整块消失", async () => groupOf(ok(await tasks.rows(ALL)), parent.id) === undefined);
        expect(w.work.collect().items).toEqual([]);
    });

    test("后台子代理向父 Agent 提问：任务那一行仍是在跑，进展写“在问：…”，算进后台件数", async () => {
        const {parent, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {agents: {added: [MAIN_PROFILE], removed: []}}}});
        endpoint.scriptFor("按大纲起草", {tool: "ask", args: {questions: [{question: "要几章？", options: [{label: "三章"}, {label: "五章"}]}]}}, "按三章写完了。");
        await turn(parent, "派", [{tool: "agent_spawn", args: {profile: MAIN_PROFILE, prompt: "按大纲起草", async: true}}, "好"]);
        const group = await waitGroup(tasks, parent.id, "任务停在提问上", (next) => next.rows.some((row) => row.kind === "nbook.agent.agent" && JSON.stringify(row.message).includes("tasks.asking")));
        const row = group.rows.find((item) => item.kind === "nbook.agent.agent")!;
        expect(row).toMatchObject({state: "running", foreground: false, message: {key: "tasks.asking", ns: "nbook.agent"}});
        expect(JSON.stringify(row.message)).toContain("要几章？");
        expect(ok(await tasks.own({})).background.count).toBeGreaterThanOrEqual(1);
    });
});

describe("行的大小（background-tasks.md 输出 19）", () => {
    test("命令的最后一行很长、满是控制字符：这一行照样列出、可停、算进后台件数，进展去掉控制字符", async () => {
        const {parent, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        // 420 个 U+0001 再接“ OK”，一次写出（进展按时间节流，分两次写只报得到第一块）：编码成 JSON 一个控制字符占 6 字节，不裁的话
        // 整行超过 2 KiB 被清单丢掉。
        await turn(parent, "跑", [{tool: "shell", args: {command: "printf '%s OK\\n' \"$(head -c 420 /dev/zero | tr '\\0' '\\1')\"; sleep 30", async: true}}, "好"]);
        const group = await waitGroup(tasks, parent.id, "带着最后一行", (next) => next.rows.some((row) => typeof row.message === "string" && row.message.includes("OK")));
        const row = group.rows[0]!;
        expect(row.message).toBe(" OK");
        expect(row.stoppable).toBe(true);
        expect(ok(await tasks.own({})).background.count).toBe(1);
        expect(ok(await tasks.stop({key: row.key}))).toEqual({outcome: "accepted"});
    });

    test("命令本身很长（400 个汉字，没有控制字符）：标题按编码后的大小裁短、末尾加省略号，这一行照样列出", async () => {
        const {parent, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        await turn(parent, "跑", [{tool: "shell", args: {command: `sleep 30 # ${"长".repeat(400)}`, async: true}}, "好"]);
        const group = await waitGroup(tasks, parent.id, "命令那一行", (next) => next.rows.length === 1);
        const title = group.rows[0]!.title as string;
        expect(title.startsWith("sleep 30 # 长")).toBe(true);
        expect(title.endsWith("…")).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(title), "utf8")).toBeLessThanOrEqual(600);
        expect(ok(await tasks.stop({key: group.rows[0]!.key}))).toEqual({outcome: "accepted"});
    });
});

describe("会话的行（sessions.md 输出 30）", () => {
    test("根会话自己等你回答：组头是等你处理，进展写“等你回答”", async () => {
        const {parent, tasks} = await open();
        endpoint.script({tool: "ask", args: {questions: [{question: "要几章？", options: [{label: "三章"}, {label: "五章"}]}]}});
        const sent = await parent.send({commandId: cid(), input: {text: "写大纲"}});
        if (!sent.ok) throw new Error(JSON.stringify(sent));
        const group = await waitGroup(tasks, parent.id, "组头等你回答", (next) => next.head?.state === "waiting");
        expect(group.head).toMatchObject({message: agentText("tasks.question"), stoppable: true});
        expect(group.waiting).toBe(true);
    });

    test("根会话在跑时一行组头，按运行定址；从清单停下后变成“有留着的话等你放行”、不可停，旧行的键得 row-gone；在跑的工作不报留着的话", async () => {
        const {w, parent, tasks} = await open();
        const request = endpoint.hold();
        const sent = await parent.send({commandId: cid(), input: {text: "写一段"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await request.arrived;
        expect((await parent.enqueue({commandId: cid(), input: {text: "再写一段"}, mode: "followup"})).ok).toBe(true);
        const running = await waitGroup(tasks, parent.id, "组头", (next) => next.head !== null);
        expect(running.head).toMatchObject({kind: "nbook.agent.session", kindLabel: agentText("tasks.kind.session"), state: "running", message: agentText("tasks.replying"), foreground: true, stoppable: true, open: {command: FOCUS, args: {sessionId: parent.id}}});
        expect(running.head!.key).toContain(`session:${parent.id}:${sent.value.runId}`);
        expect(ok(await tasks.own({})).background.count).toBe(0);
        expect(ok(await tasks.stop({key: keyOf(running.head)}))).toEqual({outcome: "accepted"});
        request.release();
        const held = await waitGroup(tasks, parent.id, "留着的话", (next) => next.head?.message !== undefined && JSON.stringify(next.head.message) === JSON.stringify(agentText("tasks.held")));
        expect(held.head).toMatchObject({state: "waiting", stoppable: false});
        expect(held.head!.key).toContain(`session:${parent.id}:held-`);
        expect(held.waiting).toBe(true);
        expect(await tasks.stop({key: keyOf(running.head)})).toMatchObject({ok: false, code: "row-gone"});
        expect(w.work.collect().items).toEqual([]);

        // 放行、再停一次：又是留着的话，但是另一行（输出 19：同一代里不复用已经消失的行 id）。
        const again = endpoint.hold();
        expect((await parent.resume({commandId: cid()})).ok).toBe(true);
        await again.arrived;
        expect((await parent.enqueue({commandId: cid(), input: {text: "第三段"}, mode: "followup"})).ok).toBe(true);
        const second = await waitGroup(tasks, parent.id, "第二次运行的组头", (next) => next.head?.state === "running");
        expect(ok(await tasks.stop({key: keyOf(second.head)}))).toEqual({outcome: "accepted"});
        again.release();
        const heldAgain = await waitGroup(tasks, parent.id, "又留着话", (next) => next.head !== null && next.head.key.includes(":held-"));
        expect(heldAgain.head!.key).not.toBe(held.head!.key);
    });

    test("有归属的会话（调用方是 Workflow 的也算根）不出会话的行；它起的后台命令照常出行、可停，子代理任务出行但不可停；块没有组头、标题与打开取它的根", async () => {
        const {w, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        const created = await w.service.create({profile: MAIN_PROFILE, owner: {id: "bot-1"}, caller: {kind: "workflow", id: "wf-1", callId: "step-1"}});
        if (!created.ok) throw new Error(created.code);
        const bot = created.value;
        const request = endpoint.hold();
        const sent = await bot.send({commandId: cid(), input: {text: "在吗"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await request.arrived;
        // 在跑也不出组头：读两遍，第二遍时运行早已被会话表看到。
        await waitUntil("会话表看到它在跑", () => w.work.collect().items.length === 1);
        expect(groupOf(ok(await tasks.rows(ALL)), bot.id)).toBeUndefined();
        request.release();
        await bot.waitRun(sent.value.runId);
        await turn(bot, "跑", [{tool: "shell", args: {command: "sleep 30", async: true}}, "好"]);
        const group = await waitGroup(tasks, bot.id, "命令那一行", (next) => next.rows.length === 1);
        // 有调用方的会话不生成标题（builtin-profiles.md）：块的标题是“未命名”。
        expect(group).toMatchObject({head: null, title: agentText("tasks.untitled"), open: {plugin: "nbook.agent", target: {command: FOCUS, args: {sessionId: bot.id}}}});
        expect(ok(await tasks.stop({key: keyOf(group.rows[0]!)}))).toEqual({outcome: "accepted"});

        // 它派的子代理：以用户身份停会把子会话排着的话变成用户留着的，而这棵树不出会话行，所以不可停（同决定 7）。
        const child = endpoint.holdFor("翻查人物卡");
        await turn(bot, "派", [adhoc("翻查人物卡", {async: true}), "好"]);
        await child.arrived;
        const withAgent = await waitGroup(tasks, bot.id, "子代理那一行", (next) => next.rows.some((row) => row.kind === "nbook.agent.agent"));
        expect(withAgent.rows.find((row) => row.kind === "nbook.agent.agent")).toMatchObject({state: "running", stoppable: false});
        child.release();
    });

    test("子会话在跑、没有子代理任务跟着它这次运行时出一行“子会话”，归属根会话（有任务跟着时不另出，见前台子代理等你批准那条）", async () => {
        const {w, parent, client, tasks} = await open();
        endpoint.scriptFor("查清末邮政", "查到了。");
        // 前台派发：结果由这次调用交回，没有回执，父会话不会被唤起再开一次运行。
        await turn(parent, "派", [adhoc("查清末邮政"), "好"]);
        const child = ok(await client.tree({sessionId: parent.id}))[0]!.id;
        expect(groupOf(ok(await tasks.rows(ALL)), parent.id)).toBeUndefined();
        // 用户直接在子会话里发话：没有任务跟着这次运行。
        const request = endpoint.holdFor("查清末邮政");
        const sent = await w.service.session(child).send({commandId: cid(), input: {text: "再查一下邮票"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await request.arrived;
        const group = await waitGroup(tasks, parent.id, "子会话那一行", (next) => next.rows.length === 1);
        expect(group.head).toBeNull();
        expect(group.rows[0]).toMatchObject({kind: "nbook.agent.subsession", kindLabel: agentText("tasks.kind.subsession"), state: "running", foreground: true, stoppable: true, open: {command: FOCUS, args: {sessionId: child}}});
        expect(group.rows[0]!.key).toContain(`session:${child}:${sent.value.runId}`);
        // 停下之前排一句：停下后它成了留着的话，子会话这一行随之变成“有留着的话等你放行”、不可停。
        expect((await w.service.session(child).enqueue({commandId: cid(), input: {text: "顺便查邮戳"}, mode: "followup"})).ok).toBe(true);
        expect(ok(await tasks.stop({key: keyOf(group.rows[0]!)}))).toEqual({outcome: "accepted"});
        request.release();
        const held = await waitGroup(tasks, parent.id, "子会话留着话", (next) => next.rows.some((row) => row.key.includes(`session:${child}:held-`)));
        expect(held.rows[0]).toMatchObject({kind: "nbook.agent.subsession", state: "waiting", message: agentText("tasks.held"), stoppable: false});
    });
});
