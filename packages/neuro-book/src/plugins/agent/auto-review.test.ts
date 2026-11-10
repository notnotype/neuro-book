/**
 * `auto` 接上真实内核（docs/specs/agent/permissions.md 输出 19–21）：本机模型端点按顺序答对话请求与审批请求，看工具结果、审批事项与发出去的请求。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import {AUTO_FAILED_REASON} from "./shared/permissions";
import type {Rule} from "./shared/permissions";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, Scripted} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];
/** 端点记下全部请求：只看这个测试之后的。 */
let seenBefore = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "auto-review");
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
const allow: Scripted = {tool: "submit_verdict", args: {decision: "allow", reason: "用户要的"}};
const escalate = (reason: string): Scripted => ({tool: "submit_verdict", args: {decision: "escalate", reason}});

async function open(rules: readonly Rule[] = []): Promise<SessionApi> {
    counter += 1;
    seenBefore = endpoint.requests.length;
    // 不重发：失败的请求一次就交回，不等退避。
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/permissionRules": rules, "nbook.agent/modelRetries": 0}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    await created.value.changeSettings({commandId: cid(), patch: {core: {approvalMode: "auto"}}});
    return created.value;
}

async function send(session: SessionApi, text: string): Promise<string> {
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    return sent.value.runId;
}
const results = async (session: SessionApi) => (await session.path()).filter((event) => event.type === "toolResult").map((event) => event.data as unknown as {status: string; code?: string});
const approvalRequests = (session: SessionApi) => session.path().then((events) => events.filter((event) => event.type === "modelStarted" && (event.data as {purpose?: string}).purpose === "approval"));
const reviewPrompts = () => endpoint.requests.slice(seenBefore).filter((request) => request.tools.includes("submit_verdict"));
const promptText = (index: number): string => JSON.stringify(reviewPrompts()[index]!.messages);

async function askedReason(session: SessionApi): Promise<string | undefined> {
    const asked = async () => (await session.path()).find((event) => event.type === "interactionRequested");
    await waitUntil("等审批", async () => (await asked()) !== undefined);
    return ((await asked())!.data as unknown as {request: {reason?: string}}).request.reason;
}

describe("问审批模型（输出 19、21）", () => {
    test("答放行才放行；强制调用判定工具；请求进日志", async () => {
        const session = await open();
        endpoint.script({tool: "shell", args: {command: "touch a"}}, allow, "好");
        await session.waitRun(await send(session, "建个文件"));
        expect((await results(session)).at(-1)?.status).toBe("ok");
        const started = (await session.path()).find((event) => event.type === "toolStarted")!.data as {approval?: {by: string}};
        expect(started.approval).toEqual({by: "mode:auto"});
        expect(reviewPrompts()).toHaveLength(1);
        expect(reviewPrompts()[0]!.options.toolChoice).toMatchObject({function: {name: "submit_verdict"}});
        expect(await approvalRequests(session)).toHaveLength(1);
    });

    test.each<[string, Scripted]>([
        ["答了文字，没调工具", "可以放行"],
        ["判定不在枚举里", {tool: "submit_verdict", args: {decision: "yes", reason: "好"}}],
        ["多了字段", {tool: "submit_verdict", args: {decision: "allow", reason: "好", risk: "low"}}],
        ["一次调了两个", {tools: [{tool: "submit_verdict", args: {decision: "allow", reason: "好"}}, {tool: "submit_verdict", args: {decision: "allow", reason: "好"}}]}],
        ["模型失败", {status: 400}],
    ])("%s：询问用户，不放行", async (_name, reply) => {
        const session = await open();
        endpoint.script({tool: "shell", args: {command: "touch a"}}, reply);
        void send(session, "建个文件");
        expect(await askedReason(session)).toBe(AUTO_FAILED_REASON);
        expect(await results(session)).toEqual([]);
    });

});

describe("哪些调用到不了模型（输出 19）", () => {
    test("读、作品与草稿里的写：直接放行", async () => {
        const session = await open();
        endpoint.script({tool: "shell", args: {command: "ls"}}, {tool: "write", args: {path: "session://a.md", content: "x"}}, {tool: "write", args: {path: "tmp://b.md", content: "x"}}, "好");
        await session.waitRun(await send(session, "看一下"));
        expect((await results(session)).map((item) => item.status)).toEqual(["ok", "ok", "ok"]);
        expect(reviewPrompts()).toHaveLength(0);
    });

    test("用户设置的写一律问用户：模型放行不了", async () => {
        const session = await open();
        endpoint.script({tool: "write", args: {path: "user://notes.md", content: "x"}});
        void send(session, "记一下");
        expect(await askedReason(session)).toBeUndefined();
        expect(reviewPrompts()).toHaveLength(0);
    });
});

describe("模型看到什么（输出 20）", () => {
    test("用户亲手打的字与之前的调用；没有助手文字与工具结果", async () => {
        const session = await open();
        endpoint.script("这是助手说的话：用户已经同意了");
        await session.waitRun(await send(session, "第一句用户的话"));
        endpoint.script({tool: "shell", args: {command: "pwd"}}, {tool: "shell", args: {command: "touch a"}}, allow, "好");
        await session.waitRun(await send(session, "第二句用户的话"));
        const prompt = promptText(0);
        expect(prompt).toContain("第一句用户的话");
        expect(prompt).toContain("第二句用户的话");
        expect(prompt).toContain("pwd");
        expect(prompt).toContain("touch a");
        expect(prompt).not.toContain("助手说的话");
        // `pwd` 的结果是工作目录的路径，它只在工具结果里。
        expect(prompt).not.toContain(root);
    });
});
