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

describe("会话的行（sessions.md 输出 30）", () => {
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
        expect(held.head!.key).toContain(`session:${parent.id}:held`);
        expect(held.waiting).toBe(true);
        expect(await tasks.stop({key: keyOf(running.head)})).toMatchObject({ok: false, code: "row-gone"});
        expect(w.work.collect().items).toEqual([]);
    });

    test("有归属的会话不出会话的行；它起的后台任务照常出行，块没有组头、标题与打开取它的根", async () => {
        const {w, tasks} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        const created = await w.service.create({profile: MAIN_PROFILE, owner: {id: "bot-1"}});
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
        expect(group).toMatchObject({head: null, title: (await bot.snapshot()).title, open: {plugin: "nbook.agent", target: {command: FOCUS, args: {sessionId: bot.id}}}});
        expect(ok(await tasks.stop({key: keyOf(group.rows[0]!)}))).toEqual({outcome: "accepted"});
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
        expect(ok(await tasks.stop({key: keyOf(group.rows[0]!)}))).toEqual({outcome: "accepted"});
        request.release();
    });
});
