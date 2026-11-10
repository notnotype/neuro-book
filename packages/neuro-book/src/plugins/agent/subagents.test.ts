/**
 * 子代理（docs/specs/agent/subagents.md）。测试名里的编号是那份 Spec 的输出条目与验收场景。
 */
import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {JsonValue, LogEvent, RunResult, SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {subagentsSection} from "./backend/subagents/prompt";
import {SessionRelations} from "./backend/subagents/relations";
import {ADHOC_PROFILE, MAIN_PROFILE, SESSION_TITLE_PROFILE} from "./shared/contracts";
import type {ProfileEntry} from "./shared/contracts";
import {AGENT_MODES_EXTENSION} from "./shared/permissions";
import {profileAgents} from "./shared/profile-agents";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, Scripted} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

describe("白名单", () => {
    test("声明的加用户加的、减用户去掉的；推荐只留仍在白名单里的", () => {
        expect(profileAgents({allowed: ["a", "b"], recommended: ["a", "b"]}, {added: ["c"], removed: ["a"]})).toEqual({allowed: ["b", "c"], recommended: ["b"]});
        expect(profileAgents(undefined, undefined)).toEqual({allowed: [], recommended: []});
        expect(profileAgents(undefined, {added: ["user.x"], removed: []})).toEqual({allowed: ["user.x"], recommended: []});
    });
});

describe("提示词里的“可派的子代理”", () => {
    const entry = (key: string, name: string, agents?: ProfileEntry["agents"]): ProfileEntry => ({key, name, description: `${name}的说明`, source: "nbook.agent", status: "ok", ...(agents === undefined ? {} : {agents})});
    const catalog = [
        entry("main", "主创", {allowed: ["helper", "checker"], recommended: ["helper"]}),
        entry("helper", "临时帮手"),
        entry("checker", "设定核对"),
    ];
    const deps = (binding?: {added: string[]; removed: string[]}) => ({catalog: () => catalog, binding: () => binding});
    const noShapes = {get: () => undefined};

    test("输出 20：推荐的写名字、说明与形状，其余写名字与说明", () => {
        const shapes = {get: (key: string) => (key === "helper" ? {initial: {type: "object"}, result: {type: "string"}} : undefined)};
        const section = subagentsSection("main", true, deps(), shapes)!;
        expect(section).toContain("helper（临时帮手）：临时帮手的说明");
        expect(section).toContain(`初始输入（initial）：${JSON.stringify({type: "object"})}`);
        expect(section).toContain(`结果（交回时调用 yield）：${JSON.stringify({type: "string"})}`);
        expect(section).toContain("checker（设定核对）：设定核对的说明");
        expect(section.indexOf("helper")).toBeLessThan(section.indexOf("checker"));
    });

    test("输出 20：没有 agent_spawn、白名单为空时没有这一节；用户去掉之后不再写", () => {
        expect(subagentsSection("main", false, deps(), noShapes)).toBeNull();
        expect(subagentsSection("helper", true, deps(), noShapes)).toBeNull();
        expect(subagentsSection("main", true, deps({added: [], removed: ["helper", "checker"]}), noShapes)).toBeNull();
        expect(subagentsSection("main", true, deps({added: [], removed: ["helper"]}), noShapes)).not.toContain("helper");
    });
});

describe("会话关系", () => {
    const child = (id: string, parent: string, extra: {origin?: string; invocation?: string} = {}) => ({id, caller: {kind: "session" as const, id: parent, callId: `call-${id}`, ...(extra.invocation === undefined ? {} : {invocation: extra.invocation})}, ...(extra.origin === undefined ? {} : {origin: extra.origin})});

    test("深度、祖先、后代、根；fork 出来的标出来；Workflow 发起的不算父子", () => {
        const relations = new SessionRelations();
        relations.load([{id: "root"}, child("a", "root", {invocation: "inv-a"}), child("b", "a"), child("c", "a"), child("b2", "a", {origin: "b"}), {id: "wf", caller: {kind: "workflow", id: "flow", callId: "x"}}]);
        expect(relations.depthOf("root")).toBe(0);
        expect(relations.depthOf("b")).toBe(2);
        expect(relations.ancestorsOf("b")).toEqual(["a", "root"]);
        expect(relations.rootOf("c")).toBe("root");
        expect(relations.descendantsOf("root")).toEqual(["a", "b", "c", "b2"]);
        expect(relations.isForked("b2")).toBe(true);
        expect(relations.callOf("a")).toEqual({callId: "call-a", invocation: "inv-a"});
        expect(relations.parentOf("wf")).toBeNull();
    });

    test("扫描结果不盖掉扫描期间已经登记的；会话头成环时不死循环", () => {
        const relations = new SessionRelations();
        relations.register(child("a", "p2"));
        relations.load([child("a", "p1"), child("x", "y"), child("y", "x")]);
        expect(relations.parentOf("a")).toBe("p2");
        expect(relations.childrenOf("p1")).toEqual([]);
        expect(relations.ancestorsOf("x")).toEqual(["y"]);
        expect(relations.depthOf("x")).toBe(1);
    });
});

// ====================================================================
// 真实内核、真实会话存储，本机假端点：父会话的回复走全局队列，子会话按它的 prompt 各取各的（`scriptFor`）。
// ====================================================================

let root = "";
let endpoint: FakeEndpoint;
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "subagents");
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

interface ToolResultData {
    readonly callId: string;
    readonly tool: string;
    readonly text: string;
    readonly status: string;
    readonly code?: string;
    readonly details?: {readonly sessionId?: string; readonly jobId?: string; readonly runId?: string; readonly invocation?: string; readonly status?: string; readonly line?: string; readonly result?: JsonValue; readonly scope?: string; readonly jobs?: readonly {readonly jobId: string}[]};
}

/** 起一个场地与主创会话；模型请求失败不重发（出错的子代理一次就收口）。 */
async function open(settings: Readonly<Record<string, unknown>> = {}): Promise<{readonly w: AgentWorld; readonly parent: SessionApi}> {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/modelRetries": 0, ...settings}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    return {w, parent: created.value};
}

const toolResults = async (session: SessionApi, tool?: string): Promise<ToolResultData[]> => (await session.path()).filter((event) => event.type === "toolResult").map((event) => event.data as unknown as ToolResultData).filter((data) => tool === undefined || data.tool === tool);

/** 父会话这一轮：先排好父会话的回复，发话、等运行收口。 */
async function turn(session: SessionApi, text: string, replies: readonly Scripted[]): Promise<RunResult> {
    endpoint.script(...replies);
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    return session.waitRun(sent.value.runId);
}

const adhoc = (prompt: string, extra: Readonly<Record<string, unknown>> = {}) => ({tool: "agent_spawn", args: {profile: ADHOC_PROFILE, prompt, initial: {role: "设定核对员"}, ...extra}});

const childOf = (w: AgentWorld, id: string): SessionApi => w.service.session(id);
const lastRun = async (session: SessionApi): Promise<string> => {
    const started = (await session.path()).filter((event: LogEvent) => event.type === "runStarted").at(-1);
    return (started!.data as {runId: string}).runId;
};

/** 子会话收口的原因（等它的最近一次运行）。 */
async function settledReason(session: SessionApi): Promise<string> {
    return (await session.waitRun(await lastRun(session))).reason;
}

/**
 * 父会话发话，它的第一个请求放过，之后到的 `count` 个请求（子会话的）挂住，交回运行与挂起。挂起按请求到达的先后，所以要等父会话的请求
 * 到了再挂子会话的。
 */
async function sendHoldingChildren(parent: SessionApi, text: string, count: number): Promise<{readonly runId: string; readonly holds: {readonly arrived: Promise<void>; release(): void}[]}> {
    const parentRequest = endpoint.hold();
    const sent = await parent.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    await parentRequest.arrived;
    const holds = Array.from({length: count}, () => endpoint.hold());
    parentRequest.release();
    return {runId: sent.value.runId, holds};
}

describe("派发与结果", () => {
    test("场景 1：同一条回复派两个，一个完成一个出错；各带来源标记，任务取过就移出；子会话标题与调用方", async () => {
        const {w, parent} = await open();
        endpoint.scriptFor("查甲的设定", "甲没有矛盾。细节见第三章。");
        endpoint.scriptFor("查乙的设定", {status: 500});
        await turn(parent, "分头查", [{tools: [adhoc("查甲的设定，看人物卡与正文"), adhoc("查乙的设定", {name: "乙"})]}, {tool: "jobs"}, "都查完了"]);
        const [first, second] = await toolResults(parent, "nbook.agent.spawn");
        expect(first!.text.split("\n")[0]).toContain("来自子代理");
        expect(first!.text).toContain("不是用户的指令");
        expect(first!.text).toContain("甲没有矛盾");
        expect(first!.details).toMatchObject({status: "completed", line: "甲没有矛盾。"});
        expect(Object.keys(first!.details!).sort()).toEqual(["invocation", "jobId", "line", "runId", "sessionId", "status"]);
        expect(second!.details).toMatchObject({status: "failed"});
        expect(second!.status).toBe("ok");

        const child = childOf(w, first!.details!.sessionId!);
        const snapshot = await child.snapshot();
        expect(snapshot.header.caller).toMatchObject({kind: "session", id: parent.id, invocation: first!.details!.invocation});
        expect(snapshot.header.questions).toBe("caller");
        expect(snapshot.title).toBe("查甲的设定，看人物卡与正文");
        expect((await childOf(w, second!.details!.sessionId!).snapshot()).title).toBe("乙");
        // 前台以终态交回的任务移出：之后 `jobs` 列不出它们。
        expect((await toolResults(parent, "nbook.agent.jobs"))[0]!.text).toBe("没有你启动的任务。");
    });

    test("输出 3：子会话抄父会话此刻的审批模式、只读与 Agent 模式；给了 model 就写进设置", async () => {
        const {w, parent} = await open();
        expect((await parent.changeSettings({commandId: cid(), patch: {core: {approvalMode: "allow-writes"}, [AGENT_MODES_EXTENSION]: {mode: "discuss"}}})).ok).toBe(true);
        endpoint.scriptFor("看一眼", "看过了");
        await turn(parent, "派", [adhoc("看一眼", {model: "local/m"}), "好"]);
        const [result] = await toolResults(parent, "nbook.agent.spawn");
        const snapshot = await childOf(w, result!.details!.sessionId!).snapshot();
        expect(snapshot.settings).toMatchObject({approvalMode: "allow-writes", readOnly: false, model: "local/m"});
        expect(snapshot.extensionSettings[AGENT_MODES_EXTENSION]?.mode).toBe("discuss");
    });

    test("输出 7：结构化结果交回 yield 的值；async 派出立即以 running 返回，wait 取到；agent_send 续用登记新任务", async () => {
        const {w, parent} = await open();
        const schema = {type: "object", properties: {count: {type: "integer"}}, required: ["count"]};
        endpoint.scriptFor("数一数人物", {tool: "yield", args: {count: 3}}, {tool: "yield", args: {count: 4}});
        await turn(parent, "派", [adhoc("数一数人物", {outputSchema: schema, async: true}), {tool: "wait"}, "好"]);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        expect(spawned!.details).toMatchObject({status: "running"});
        const [waited] = await toolResults(parent, "nbook.agent.wait");
        expect(waited!.text).toContain("来自子代理");
        expect(waited!.text).toContain("合 schema");
        expect(waited!.text).toContain("\"count\": 3");
        expect(waited!.details?.jobs?.[0]?.jobId).toBe(spawned!.details!.jobId);

        const child = spawned!.details!.sessionId!;
        await turn(parent, "再派", [{tool: "agent_send", args: {id: child, message: "再数一次"}}, "好"]);
        const [sent] = await toolResults(parent, "nbook.agent.send");
        expect(sent!.details).toMatchObject({status: "completed", result: {count: 4}, sessionId: child});
        expect(sent!.details!.jobId).not.toBe(spawned!.details!.jobId);
        expect((await childOf(w, child).snapshot()).header.result).toEqual({mode: "required", schema});
    });
});

describe("提问与插话", () => {
    test("场景 3：子会话向调用方提问，agent_spawn 返回 question；agent_answer 之后同一个任务接着跑到完成", async () => {
        const {w, parent} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {agents: {added: [MAIN_PROFILE], removed: []}}}});
        endpoint.scriptFor("按大纲起草", {tool: "ask", args: {questions: [{question: "要几章？", options: [{label: "三章"}, {label: "五章"}]}]}}, "按三章写完了。");
        await turn(parent, "派", [{tool: "agent_spawn", args: {profile: MAIN_PROFILE, prompt: "按大纲起草"}}, "等它"]);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        expect(spawned!.details).toMatchObject({status: "question"});
        expect(spawned!.text).toContain("要几章？");
        const child = spawned!.details!.sessionId!;
        const question = /提问 (\S+)：/u.exec(spawned!.text)![1]!;

        await turn(parent, "答它", [{tool: "agent_answer", args: {id: child, question, answer: {text: "三章"}}}, "好"]);
        const [answered] = await toolResults(parent, "nbook.agent.answer");
        expect(answered!.details).toMatchObject({status: "completed", jobId: spawned!.details!.jobId, runId: spawned!.details!.runId});
        expect(answered!.text).toContain("按三章写完了。");
        const asked = await toolResults(childOf(w, child), "nbook.agent.ask-form");
        expect(asked[0]!.text).toBe("三章");
        // 同一个提问答过了：再答得 question-unknown。
        await turn(parent, "再答", [{tool: "agent_answer", args: {id: child, question, answer: {text: "五章"}}}, "好"]);
        expect((await toolResults(parent, "nbook.agent.answer"))[1]!.code).toBe("question-unknown");
    });

    test("场景 4：等子代理时用户插话，等待以 running 返回、插话送达；之后 wait 取到结果", async () => {
        const {parent} = await open();
        endpoint.scriptFor("慢慢查", "查完了，没问题。");
        endpoint.script(adhoc("慢慢查"), {tool: "wait"}, "好");
        const {runId, holds: [child]} = await sendHoldingChildren(parent, "派一个", 1);
        await child!.arrived;
        expect((await parent.send({commandId: cid(), input: {text: "顺便看看第二章"}, mode: "steer"})).ok).toBe(true);
        await waitUntil("等待以 running 返回", async () => (await toolResults(parent, "nbook.agent.spawn")).length === 1);
        child!.release();
        await parent.waitRun(runId);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        expect(spawned!.details).toMatchObject({status: "running"});
        expect(spawned!.text).toContain("插话");
        expect((await parent.path()).some((event) => event.type === "steer" && (event.data as {text: string}).text === "顺便看看第二章")).toBe(true);
        const [waited] = await toolResults(parent, "nbook.agent.wait");
        expect(waited!.text).toContain("查完了，没问题。");
    });
});

describe("中止与模式", () => {
    test("场景 5：父会话中止，前台的子代理立即以 aborted 返回并跟着中止；async 派出的照常跑；之后 agent_send 照常送达", async () => {
        const {w, parent} = await open();
        endpoint.scriptFor("前台的活", "作废的回复", "接着做完了。");
        endpoint.scriptFor("后台的活", "后台做完了。");
        endpoint.script({tools: [adhoc("前台的活"), adhoc("后台的活", {async: true})]});
        const {holds} = await sendHoldingChildren(parent, "派两个", 2);
        await Promise.all(holds.map((hold) => hold.arrived));
        expect((await parent.abort({commandId: cid()})).ok).toBe(true);
        const [foreground, background] = await toolResults(parent, "nbook.agent.spawn");
        expect(foreground!.details).toMatchObject({status: "aborted"});
        expect(foreground!.text).toContain(foreground!.details!.sessionId!);
        expect(background!.details).toMatchObject({status: "running"});
        for (const hold of holds) hold.release();
        expect(await settledReason(childOf(w, foreground!.details!.sessionId!))).toBe("aborted");
        expect(await settledReason(childOf(w, background!.details!.sessionId!))).toBe("completed");

        await turn(parent, "接着做", [{tool: "agent_send", args: {id: foreground!.details!.sessionId!, message: "接着做"}}, "好"]);
        const [resumed] = await toolResults(parent, "nbook.agent.send");
        expect(resumed!.details).toMatchObject({status: "completed"});
        expect(resumed!.text).toContain("接着做完了。");
    });

    test("场景 5：父会话在 plan 下派的子代理也在 plan，写作品被闸门拦下", async () => {
        const {w, parent} = await open();
        expect((await parent.changeSettings({commandId: cid(), patch: {core: {approvalMode: "allow-writes"}, [AGENT_MODES_EXTENSION]: {mode: "plan"}}})).ok).toBe(true);
        endpoint.scriptFor("改人物卡", {tool: "write", args: {path: "user://a.md", content: "x"}}, "写不了");
        await turn(parent, "派", [adhoc("改人物卡"), "好"]);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        const child = childOf(w, spawned!.details!.sessionId!);
        expect((await toolResults(child, "nbook.agent.write"))[0]).toMatchObject({code: "mode-blocked"});
    });

    test("场景 5：父会话切到 discuss 后 agent_send 先把子会话收紧；子会话的模式切换请求 agent_answer 答不了", async () => {
        const {w, parent} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {agents: {added: [MAIN_PROFILE], removed: []}}}});
        endpoint.scriptFor("先读一遍", "读完了", {tool: "switch_mode", args: {mode: "normal"}});
        await turn(parent, "派", [{tool: "agent_spawn", args: {profile: MAIN_PROFILE, prompt: "先读一遍"}}, "好"]);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        const id = spawned!.details!.sessionId!;
        expect((await parent.changeSettings({commandId: cid(), patch: {[AGENT_MODES_EXTENSION]: {mode: "discuss"}}})).ok).toBe(true);
        await turn(parent, "接着", [{tool: "agent_send", args: {id, message: "可以动手了", async: true}}, "好"]);
        const child = childOf(w, id);
        expect((await child.snapshot()).extensionSettings[AGENT_MODES_EXTENSION]?.mode).toBe("discuss");
        const asked = async () => (await child.path()).find((event) => event.type === "interactionRequested");
        await waitUntil("子会话申请切换模式", async () => (await asked()) !== undefined);
        const question = ((await asked())!.data as {id: string}).id;
        await turn(parent, "替它答", [{tool: "agent_answer", args: {id, question, answer: {text: "同意"}}}, "好"]);
        const [answered] = await toolResults(parent, "nbook.agent.answer");
        expect(answered).toMatchObject({code: "not-allowed"});
        expect(answered!.text).toContain("模式");
    });
});

describe("上限与失败", () => {
    test("场景 6：同一条回复派 3 个而上限是 2，恰有一个得 concurrency-limit{scope: session}，被拒的没有子会话", async () => {
        const {w, parent} = await open({"nbook.agent/subagentsPerSession": 2});
        for (const name of ["一", "二", "三"]) endpoint.scriptFor(`第${name}件`, "做完了");
        await turn(parent, "派三个", [{tools: ["一", "二", "三"].map((name) => adhoc(`第${name}件`))}, "好"]);
        const results = await toolResults(parent, "nbook.agent.spawn");
        const limited = results.filter((result) => result.code === "concurrency-limit");
        expect(limited).toHaveLength(1);
        expect(limited[0]!.details).toMatchObject({scope: "session"});
        const listed = await w.service.list();
        expect(listed.ok && listed.value.filter((entry) => entry.caller?.id === parent.id)).toHaveLength(2);
    });

    test("场景 6：深度超过 subagentDepth 得 depth-limit", async () => {
        const {w, parent} = await open({"nbook.agent/subagentDepth": 1, "nbook.agent/profileSettings": {[MAIN_PROFILE]: {agents: {added: [MAIN_PROFILE], removed: []}}}});
        endpoint.scriptFor("你再派一个", adhoc("孙子的活"), "派不了");
        await turn(parent, "派", [{tool: "agent_spawn", args: {profile: MAIN_PROFILE, prompt: "你再派一个"}}, "好"]);
        const [spawned] = await toolResults(parent, "nbook.agent.spawn");
        expect((await toolResults(childOf(w, spawned!.details!.sessionId!), "nbook.agent.spawn"))[0]).toMatchObject({code: "depth-limit"});
    });

    test("输出 1、9：派发的检查与续用的归属；失败都不建子会话", async () => {
        const {w, parent} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {agents: {added: [SESSION_TITLE_PROFILE], removed: []}}}});
        await turn(parent, "派", [{tools: [
            {tool: "agent_spawn", args: {profile: MAIN_PROFILE, prompt: "甲"}},
            {tool: "agent_spawn", args: {profile: "nope.profile", prompt: "乙"}},
            {tool: "agent_spawn", args: {profile: ADHOC_PROFILE, prompt: "丙"}},
            {tool: "agent_spawn", args: {profile: SESSION_TITLE_PROFILE, prompt: "丁", outputSchema: {type: "object"}}},
            {tool: "agent_send", args: {id: parent.id, message: "戊"}},
            {tool: "agent_send", args: {id: crypto.randomUUID(), message: "己"}},
        ]}, "好"]);
        expect((await toolResults(parent)).map((result) => result.code)).toEqual(["profile-not-allowed", "profile-not-found", "initial-invalid", "output-schema-fixed", "not-owner", "session-not-found"]);
        const listed = await w.service.list();
        expect(listed.ok && listed.value.filter((entry) => entry.caller !== undefined)).toEqual([]);
    });
});
