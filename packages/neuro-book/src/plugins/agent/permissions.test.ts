/**
 * 权限规则接上真实内核（docs/specs/agent/permissions.md 的验收）：真实 `shell`、`write`，本机模型端点指定工具调用，看工具结果与审批事项。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MAIN_PROFILE} from "./shared/contracts";
import type {Rule} from "./shared/permissions";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "permissions");
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

async function open(rules: readonly Rule[], approval: Approval = "ask", settings: Readonly<Record<string, unknown>> = {}): Promise<SessionApi> {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/permissionRules": rules, ...settings}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    await created.value.changeSettings({commandId: cid(), patch: {core: {approvalMode: approval}}});
    return created.value;
}

interface Outcome {
    readonly status: string;
    readonly code?: string;
    readonly text: string;
}
const results = async (session: SessionApi): Promise<Outcome[]> => (await session.path()).filter((event) => event.type === "toolResult").map((event) => {
    const data = event.data as unknown as {status: string; code?: string; text?: string};
    return {status: data.status, ...(data.code === undefined ? {} : {code: data.code}), text: data.text ?? ""};
});

/** 模型调一次工具再说“好”；跑完交回这次的工具结果。不等审批：要问的用 `untilAsked`。 */
async function callTool(session: SessionApi, tool: string, args: Readonly<Record<string, unknown>>): Promise<Outcome> {
    const before = (await results(session)).length;
    endpoint.script({tool, args}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "做"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    await session.waitRun(sent.value.runId);
    return (await results(session))[before]!;
}

/** 模型调工具，等到它停在审批上，交回事项 id 与放行的办法。 */
async function untilAsked(session: SessionApi, tool: string, args: Readonly<Record<string, unknown>>): Promise<{readonly reason?: string; answer(decision: "allow" | "allow-session" | "deny"): Promise<void>}> {
    const known = new Set((await session.path()).filter((event) => event.type === "interactionRequested").map((event) => event.id));
    endpoint.script({tool, args}, "好");
    const sent = await session.send({commandId: cid(), input: {text: "做"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    const runId = sent.value.runId;
    const asked = async () => (await session.path()).find((event) => event.type === "interactionRequested" && !known.has(event.id));
    await waitUntil("等审批", async () => (await asked()) !== undefined);
    const event = (await asked())!;
    const data = event.data as unknown as {id: string; request: {reason?: string}};
    return {
        ...(data.request.reason === undefined ? {} : {reason: data.request.reason}),
        answer: async (decision) => {
            const resolved = await session.resolve({commandId: cid(), id: data.id, decision});
            expect(resolved.ok).toBe(true);
            await session.waitRun(runId);
        },
    };
}

const shell = (pattern: string, action: Rule["action"], reason?: string): Rule => ({tool: "shell", when: {type: "command", pattern}, action, ...(reason === undefined ? {} : {reason})});

describe("没有规则时按审批模式", () => {
    test("只读命令直接跑，复合命令里有写的要问；工具名按 id 也认", async () => {
        const session = await open([]);
        expect((await callTool(session, "shell", {command: "echo hi && ls | wc -l"})).status).toBe("ok");
        const asked = await untilAsked(session, "shell", {command: "echo hi && touch a"});
        await asked.answer("deny");
        expect((await results(session)).at(-1)).toMatchObject({status: "denied", code: "user-denied"});
    });

    test("写重定向不算只读；放行写入不放行执行", async () => {
        const session = await open([], "allow-writes");
        const asked = await untilAsked(session, "shell", {command: "echo hi > a.txt"});
        await asked.answer("allow");
        expect((await results(session)).at(-1)?.status).toBe("ok");
        expect((await callTool(session, "write", {path: "session://a.md", content: "x"})).status).toBe("ok");
    });

    test("看不懂的命令要问；全部放行下放行", async () => {
        const asking = await open([]);
        const asked = await untilAsked(asking, "shell", {command: "eval \"echo hi\""});
        await asked.answer("allow");
        const yolo = await open([], "yolo");
        expect((await callTool(yolo, "shell", {command: "eval \"echo hi\""})).status).toBe("ok");
    });
});

describe("规则", () => {
    test("拒绝规则拦住复合命令里的一条，全部放行也一样，理由交给模型", async () => {
        const session = await open([shell("git push *", "deny", "不要推送，先让用户看")], "yolo");
        const result = await callTool(session, "shell", {command: "echo hi && timeout 5 git push origin"});
        expect(result).toMatchObject({status: "denied", code: "rule-denied"});
        expect(result.text).toContain("不要推送，先让用户看");
    });

    test("放行规则免问，只放行规则写到的那一条", async () => {
        const session = await open([shell("touch *", "allow")]);
        expect((await callTool(session, "shell", {command: "touch a"})).status).toBe("ok");
        const asked = await untilAsked(session, "shell", {command: "touch b && mkdir c"});
        await asked.answer("deny");
    });

    test("询问规则连只读的也问，全部放行下放行；理由显示在审批上", async () => {
        const rules = [shell("cat *", "ask", "这个目录要看一眼")];
        const session = await open(rules);
        const asked = await untilAsked(session, "shell", {command: "cat /dev/null"});
        expect(asked.reason).toBe("这个目录要看一眼");
        await asked.answer("deny");
        const yolo = await open(rules, "yolo");
        expect((await callTool(yolo, "shell", {command: "cat /dev/null"})).status).toBe("ok");
    });

    test("参数关键词的规则不用写代码：写文件的内容里有这个词就拒绝", async () => {
        const session = await open([{tool: "write", when: {type: "arg", path: "content", op: "keywords", value: ["机密"]}, action: "deny"}], "yolo");
        expect((await callTool(session, "write", {path: "session://a.md", content: "这段是机密"})).code).toBe("rule-denied");
        expect((await callTool(session, "write", {path: "session://a.md", content: "公开"})).status).toBe("ok");
    });

    test("路径规则写单数地址：拦写不拦读；shell 的写重定向也按路径算", async () => {
        const session = await open([{tool: "*", when: {type: "path", glob: "session://秘密/**", access: "write"}, action: "deny"}], "yolo");
        expect((await callTool(session, "write", {path: "session://秘密/a.md", content: "x"})).code).toBe("rule-denied");
        expect((await callTool(session, "write", {path: "session://公开/a.md", content: "x"})).status).toBe("ok");
        expect((await callTool(session, "read", {path: "session://公开/a.md"})).status).toBe("ok");
        expect((await callTool(session, "shell", {command: "echo hi > session://秘密/b.md"})).code).toBe("rule-denied");
    });

    test("坏掉的规则：拒绝照样拦，放行不放", async () => {
        const denying = await open([{tool: "shell", when: {type: "没有这种"}, action: "deny"}], "yolo");
        expect((await callTool(denying, "shell", {command: "echo hi"})).code).toBe("rule-denied");
        const allowing = await open([{tool: "shell", when: {type: "没有这种"}, action: "allow"}]);
        const asked = await untilAsked(allowing, "shell", {command: "touch a"});
        await asked.answer("deny");
    });

    test("写用户文件永远问，放行写入与放行规则都不免", async () => {
        const session = await open([{tool: "write", action: "allow"}], "allow-writes");
        const asked = await untilAsked(session, "write", {path: "user://notes.md", content: "x"});
        await asked.answer("deny");
    });

    test("追加的只读命令免问", async () => {
        const session = await open([], "ask", {"nbook.agent/readOnlyCommands": ["touch a"]});
        expect((await callTool(session, "shell", {command: "touch a"})).status).toBe("ok");
    });
});

describe("本会话都批准", () => {
    test("批准过的工具之后不再问，拒绝规则还是拦", async () => {
        const session = await open([shell("rm *", "deny")]);
        const asked = await untilAsked(session, "shell", {command: "touch a"});
        await asked.answer("allow-session");
        expect((await callTool(session, "shell", {command: "touch b"})).status).toBe("ok");
        expect((await callTool(session, "shell", {command: "rm b"})).code).toBe("rule-denied");
    });
});
