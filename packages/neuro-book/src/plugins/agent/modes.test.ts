/**
 * Agent 模式接上真实内核（docs/specs/agent/modes.md 的验收）：闸门、提示、`switch_mode` 与时序。真实工具，本机模型端点指定一次回复里的调用。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import {AGENT_MODES_EXTENSION, MODE_ASK_REASON} from "./shared/permissions";
import type {AgentMode, ModeSwitchAnswer, ModeSwitchRequest, Rule} from "./shared/permissions";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "modes");
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
type Approval = "ask" | "allow-writes" | "yolo";

async function open(mode: AgentMode, approval: Approval = "ask", settings: Readonly<Record<string, unknown>> = {}): Promise<SessionApi> {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), ...settings}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    const changed = await created.value.changeSettings({commandId: cid(), patch: {core: {approvalMode: approval}, [AGENT_MODES_EXTENSION]: {mode}}});
    expect(changed.ok).toBe(true);
    return created.value;
}

const results = async (session: SessionApi): Promise<{status: string; code?: string; text: string; tool: string}[]> => (await session.path()).filter((event) => event.type === "toolResult").map((event) => event.data as never);

async function callTool(session: SessionApi, tool: string, args: Readonly<Record<string, unknown>>) {
    const before = (await results(session)).length;
    endpoint.script({tool, args}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "做"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    await session.waitRun(sent.value.runId);
    return (await results(session))[before]!;
}

/** 模型这一步发这些调用；不等结束。交回 runId。 */
async function reply(session: SessionApi, tools: readonly {tool: string; args: Readonly<Record<string, unknown>>}[]): Promise<string> {
    endpoint.script(tools.length === 1 ? tools[0]! : {tools: [...tools]}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "做"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    return sent.value.runId;
}

interface Asked {
    readonly id: string;
    readonly kind: string;
    readonly request: {readonly tool?: string; readonly data?: ModeSwitchRequest; readonly reason?: string};
}
async function nextAsked(session: SessionApi, known = new Set<string>()): Promise<Asked> {
    const find = async () => (await session.path()).filter((event) => event.type === "interactionRequested").map((event) => event.data as unknown as Asked).find((item) => !known.has(item.id));
    await waitUntil("等用户", async () => (await find()) !== undefined);
    return (await find())!;
}
const answer = (session: SessionApi, id: string, data: ModeSwitchAnswer) => session.resolve({commandId: cid(), id, decision: "answer", answer: {text: data.approved ? "批准" : "继续改", data: data as never}});

const modeOf = async (session: SessionApi): Promise<unknown> => (await session.snapshot()).extensionSettings[AGENT_MODES_EXTENSION]?.mode;

describe("闸门", () => {
    test("plan 加放行写入：读、只读命令、写草稿放行；别的写与命令拒绝，告诉模型切换", async () => {
        const session = await open("plan", "allow-writes");
        expect((await callTool(session, "write", {path: "session://plan.md", content: "计划"})).status).toBe("ok");
        expect((await callTool(session, "write", {path: "tmp://a.txt", content: "x"})).status).toBe("ok");
        expect((await callTool(session, "read", {path: "session://plan.md"})).status).toBe("ok");
        expect((await callTool(session, "shell", {command: "ls | wc -l"})).status).toBe("ok");
        expect((await callTool(session, "shell", {command: "echo hi > tmp://b.txt"})).status).toBe("ok");
        const blocked = await callTool(session, "shell", {command: "touch a"});
        expect(blocked).toMatchObject({status: "denied", code: "mode-blocked"});
        expect(blocked.text).toContain("switch_mode");
        expect((await callTool(session, "write", {path: "user://a.md", content: "x"})).code).toBe("mode-blocked");
        expect((await callTool(session, "shell", {command: "eval touch a"})).code).toBe("mode-blocked");
        // 没有作品时工作目录是会话目录，相对路径也落在草稿里。
        expect((await callTool(session, "shell", {command: "echo hi > a.txt"})).status).toBe("ok");
    });

    test("写草稿时的命令也要只读：cp 到临时目录算写", async () => {
        const session = await open("discuss", "yolo");
        expect((await callTool(session, "shell", {command: "cp a tmp://b"})).code).toBe("mode-blocked");
    });

    test("全部放行与放行规则都过不了闸门；拒绝规则先于闸门", async () => {
        const rules: Rule[] = [{tool: "shell", when: {type: "command", pattern: "touch *"}, action: "allow"}, {tool: "shell", when: {type: "command", pattern: "rm *"}, action: "deny"}];
        const session = await open("discuss", "yolo", {"nbook.agent/permissionRules": rules});
        expect((await callTool(session, "shell", {command: "touch a"})).code).toBe("mode-blocked");
        expect((await callTool(session, "shell", {command: "rm a"})).code).toBe("rule-denied");
    });

    test("配置成弹审批：写调用询问，放行规则与全部放行不免", async () => {
        const session = await open("plan", "yolo", {"nbook.agent/modeWriteAction": "ask", "nbook.agent/permissionRules": [{tool: "shell", action: "allow"}]});
        const runId = await reply(session, [{tool: "shell", args: {command: "touch a"}}]);
        const asked = await nextAsked(session);
        expect(asked.kind).toBe("approval");
        expect(asked.request.reason).toBe(MODE_ASK_REASON);
        await session.resolve({commandId: cid(), id: asked.id, decision: "deny"});
        await session.waitRun(runId);
    });

    test("normal 没有闸门", async () => {
        const session = await open("normal", "yolo");
        expect((await callTool(session, "shell", {command: "touch a"})).status).toBe("ok");
    });
});

describe("时序", () => {
    test("等审批时切到 discuss：放行过的调用按现在的模式重判", async () => {
        const session = await open("normal", "ask", {"nbook.agent/permissionRules": [{tool: "shell", when: {type: "command", pattern: "touch *"}, action: "allow"}]});
        const runId = await reply(session, [{tool: "shell", args: {command: "touch a"}}, {tool: "shell", args: {command: "mkdir b"}}]);
        const asked = await nextAsked(session);
        await session.changeSettings({commandId: cid(), patch: {[AGENT_MODES_EXTENSION]: {mode: "discuss"}}});
        await session.resolve({commandId: cid(), id: asked.id, decision: "allow"});
        await session.waitRun(runId);
        expect((await results(session)).map((item) => item.code)).toEqual(["mode-blocked", "mode-blocked"]);
    });

    test("同一回复先切模式再写：批准之后写按新模式被拦", async () => {
        const session = await open("normal", "yolo");
        const runId = await reply(session, [{tool: "switch_mode", args: {mode: "discuss"}}, {tool: "shell", args: {command: "touch a"}}]);
        const asked = await nextAsked(session);
        expect(asked.request.data).toMatchObject({kind: "mode-switch", from: "normal", to: "discuss"});
        await answer(session, asked.id, {approved: true});
        await session.waitRun(runId);
        expect((await results(session)).map((item) => item.code)).toEqual([undefined, "mode-blocked"]);
    });

    test("同一回复先写再切出：写是切换前判的，拒绝的不重判", async () => {
        await writePlanThenSwitch();
        async function writePlanThenSwitch(): Promise<void> {
            const session = await open("discuss", "yolo");
            const runId = await reply(session, [{tool: "shell", args: {command: "touch a"}}, {tool: "switch_mode", args: {mode: "normal"}}]);
            const asked = await nextAsked(session);
            await answer(session, asked.id, {approved: true});
            await session.waitRun(runId);
            expect((await results(session)).map((item) => item.code)).toEqual(["mode-blocked", undefined]);
            expect(await modeOf(session)).toBe("normal");
        }
    });
});

describe("switch_mode", () => {
    test("全部放行下也要用户答；拒绝时模式不变，附言交给模型", async () => {
        const session = await open("normal", "yolo");
        const runId = await reply(session, [{tool: "switch_mode", args: {mode: "plan"}}]);
        const asked = await nextAsked(session);
        expect(asked.kind).toBe("question");
        await answer(session, asked.id, {approved: false, note: "先别规划"});
        await session.waitRun(runId);
        expect((await results(session)).at(-1)?.text).toContain("先别规划");
        expect(await modeOf(session)).not.toBe("plan");
    });

    test("目标已是当前模式：直接返回，不问", async () => {
        const session = await open("plan");
        expect((await callTool(session, "switch_mode", {mode: "plan"})).text).toContain("已经是");
        expect((await session.path()).some((event) => event.type === "interactionRequested")).toBe(false);
    });

    test("退出 plan：向导拿到计划全文；批准同时改审批模式；结果带同一份计划；之后能写", async () => {
        const session = await open("plan");
        await callTool(session, "write", {path: "session://plan.md", content: "第一步\n第二步"});
        const runId = await reply(session, [{tool: "switch_mode", args: {mode: "normal"}}]);
        const asked = await nextAsked(session);
        expect(asked.request.data).toEqual({kind: "mode-switch", from: "plan", to: "normal", plan: "第一步\n第二步"});
        await answer(session, asked.id, {approved: true, approvalMode: "allow-writes"});
        await session.waitRun(runId);
        expect((await results(session)).at(-1)?.text).toContain("第一步\n第二步");
        expect(await modeOf(session)).toBe("normal");
        expect((await session.snapshot()).settings.approvalMode).toBe("allow-writes");
        expect((await callTool(session, "write", {path: "session://a.md", content: "x"})).status).toBe("ok");
    });

    test("同一回复先写计划再申请：向导里是新的", async () => {
        const session = await open("plan");
        const runId = await reply(session, [{tool: "write", args: {path: "session://plan.md", content: "新计划"}}, {tool: "switch_mode", args: {mode: "normal"}}]);
        const asked = await nextAsked(session);
        expect(asked.request.data?.plan).toBe("新计划");
        await answer(session, asked.id, {approved: false});
        await session.waitRun(runId);
    });

    test("没有计划或太长：失败并告诉模型，不问用户", async () => {
        const session = await open("plan");
        expect(await callTool(session, "switch_mode", {mode: "normal"})).toMatchObject({status: "error", code: "no-plan"});
        await callTool(session, "write", {path: "session://plan.md", content: "x".repeat(257 * 1024)});
        expect(await callTool(session, "switch_mode", {mode: "normal"})).toMatchObject({status: "error", code: "plan-too-large"});
        expect((await session.path()).some((event) => event.type === "interactionRequested")).toBe(false);
    });

    test("拒绝规则能禁掉它", async () => {
        const session = await open("normal", "ask", {"nbook.agent/permissionRules": [{tool: "switch_mode", action: "deny"}]});
        expect((await callTool(session, "switch_mode", {mode: "plan"})).code).toBe("rule-denied");
    });

    test("fork 带上模式", async () => {
        const session = await open("discuss");
        const forked = await session.fork({commandId: cid()});
        if (!forked.ok) throw new Error(forked.code);
        expect(await modeOf(worlds.at(-1)!.service.session(forked.value.sessionId))).toBe("discuss");
    });
});

describe("提示", () => {
    const lastUser = (): string => JSON.stringify(endpoint.requests.at(-1)?.messages);

    test("变了那轮完整的，之后短的；回到 normal 一句已退出，之后不写；工具集不变", async () => {
        const session = await open("plan");
        endpoint.script("一");
        await send(session);
        expect(lastUser()).toContain("现在是计划模式");
        const tools = JSON.stringify(endpoint.requests.at(-1)?.tools);
        endpoint.script("二");
        await send(session);
        expect(lastUser()).toContain("（计划模式");
        await session.changeSettings({commandId: cid(), patch: {[AGENT_MODES_EXTENSION]: {mode: "normal"}}});
        endpoint.script("三");
        await send(session);
        expect(lastUser()).toContain("已退出讨论或计划模式");
        expect(JSON.stringify(endpoint.requests.at(-1)?.tools)).toBe(tools);
        const before = lastUser().split("已退出讨论或计划模式").length;
        endpoint.script("四");
        await send(session);
        expect(lastUser().split("已退出讨论或计划模式").length).toBe(before);
    });

    test("从来都是 normal：不写", async () => {
        const session = await open("normal");
        endpoint.script("一");
        await send(session);
        expect(lastUser()).not.toContain("讨论或计划模式");
    });

    async function send(session: SessionApi): Promise<void> {
        const sent = await session.send({commandId: cid(), input: {text: "说"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
        await session.waitRun(sent.value.runId);
    }
});
