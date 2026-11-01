/**
 * 发起任务与停止、撤回的余下场景（docs/specs/agent/sessions.md 输出 10–14，contributions.md 输出 2、3）：真实服务端内核、真实远程
 * 链路，模型是本机的 OpenAI 兼容端点。测试名里的编号是 sessions.md（“会话”）与 contributions.md（“贡献”）的输出条目与场景。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteLink} from "@notnotype/nb-runtime/remote";
import {Type} from "typebox";

import {defineExtension, defineProfile} from "@notnotype/nb-harness/kernel";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {agentKey, taskSessionId} from "./shared/contracts";
import {agentExtension, agentProfile} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "tasks");
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

const SOLVER = "test.tasks.solver";
const OTHER = "test.tasks.other";

/** 两个要交回答案的 Profile（会话头带结果的 schema，内核生成 `yield` 收尾工具）。 */
const tasksPlugin: PluginDefinition = (() => {
    const profiles = [SOLVER, OTHER].map((key) => agentProfile(key, {name: key, description: "测试用", tools: {required: [], optional: []}}));
    const result = {mode: "required" as const, schema: Type.Object({answer: Type.String()})};
    return {id: "test.tasks", entries: [defineEntry({id: "server", location: "server", activationEvents: profiles.map((item) => item.activationEvent), contributions: profiles.map((item) => item.contribution), activate: () => ({contributions: {"agent.profiles": Object.fromEntries([SOLVER, OTHER].map((key) => [key, defineProfile({id: key, version: "1", name: key, description: "测试用", system: "算出答案后交回。", result})]))}})})]};
})();

async function world(options: {readonly plugins?: PluginDefinition[]; readonly withoutModels?: boolean} = {}): Promise<AgentWorld> {
    counter += 1;
    const created = await agentWorld(join(root, `w${String(counter)}`), {plugins: [tasksPlugin, ...(options.plugins ?? [])], userSettings: localModelSettings(endpoint.baseUrl), ...(options.withoutModels === true ? {withoutModels: true} : {})});
    worlds.push(created);
    return created;
}

describe("发起任务", () => {
    test("会话输出 10、场景 3：startTask 在运行结束前就返回；runResult 给出收尾工具交回的答案；agentKey 的 result 等到运行结束", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const hold = endpoint.hold();
        endpoint.script({tool: "yield", args: {answer: "四十二"}});
        const taskId = randomUUID();
        const started = await client.startTask({taskId, profile: SOLVER, input: {text: "六乘七"}});
        expect(started).toMatchObject({ok: true, value: {sessionId: taskSessionId(taskId)}});
        if (!started.ok) throw new Error("start failed");
        expect(await client.runResult({sessionId: started.value.sessionId, runId: started.value.runId})).toEqual({ok: true, value: null});
        hold.release();
        const result = await waitUntil("运行结束", async () => {
            const read = await client.runResult({sessionId: started.value.sessionId, runId: started.value.runId});
            return read.ok ? read.value : null;
        });
        expect(result).toMatchObject({reason: "finished", result: {via: "tool", value: {answer: "四十二"}, valid: true}});

        endpoint.script({tool: "yield", args: {answer: "九"}});
        const local = await w.service.startTask({taskId: randomUUID(), profile: SOLVER, input: {text: "三乘三"}});
        if (!local.ok) throw new Error(local.code);
        expect(await local.result).toMatchObject({reason: "finished", result: {value: {answer: "九"}}});
    });

    test("会话输出 11：同一个 taskId 重发得到同一个结果；会话已建、没来得及发的重发补上；参数或输入不同得 task-conflict", async () => {
        const w = await world();
        const {client} = await w.window("a");
        const taskId = randomUUID();
        endpoint.script({tool: "yield", args: {answer: "一"}});
        const first = await client.startTask({taskId, profile: SOLVER, input: {text: "算"}});
        const again = await client.startTask({taskId, profile: SOLVER, input: {text: "算"}});
        expect(again).toEqual(first);
        expect(await client.startTask({taskId, profile: OTHER, input: {text: "算"}})).toMatchObject({ok: false, code: "task-conflict"});
        expect(await client.startTask({taskId, profile: SOLVER, input: {text: "换个问题"}})).toMatchObject({ok: false, code: "task-conflict"});
        expect(await client.startTask({taskId: "not-a-uuid", profile: SOLVER, input: {text: "算"}})).toMatchObject({ok: false, code: "invalid-input"});

        // 上次只建了会话：这次补上 send。
        const half = randomUUID();
        const created = await w.service.create({profile: SOLVER, id: taskSessionId(half)});
        expect(created.ok).toBe(true);
        endpoint.script({tool: "yield", args: {answer: "二"}});
        expect(await client.startTask({taskId: half, profile: SOLVER, input: {text: "算"}})).toMatchObject({ok: true, value: {sessionId: taskSessionId(half)}});
    });

    test("会话输出 11、场景 3：写请求发出后断线得 unknown-outcome，重连后同一个 taskId 重发得到同一个结果", async () => {
        const w = await world();
        let armed = false;
        const wrapLink = (link: RemoteLink): RemoteLink => ({
            send: (frame) => link.send(frame),
            // 武装后丢掉下一次结果、再断线：请求已经到了服务端、做完了，窗口却不知道结果。
            onFrame: (listener) => link.onFrame((value) => {
                if (armed && (value as {type?: string}).type === "result") {
                    armed = false;
                    link.close();
                    return;
                }
                listener(value);
            }),
            onClose: (listener) => link.onClose(listener),
            close: () => link.close(),
        });
        const {client, window} = await w.window("a", {wrapLink});
        const taskId = randomUUID();
        endpoint.script({tool: "yield", args: {answer: "三"}});
        armed = true;
        expect(await client.startTask({taskId, profile: SOLVER, input: {text: "算"}})).toMatchObject({ok: false, code: "unknown-outcome"});
        expect(await window.reconnect()).toMatchObject({ok: true});
        const retried = await client.startTask({taskId, profile: SOLVER, input: {text: "算"}});
        expect(retried).toMatchObject({ok: true, value: {sessionId: taskSessionId(taskId)}});
        const listed = await w.service.list({background: false});
        expect(listed.ok && listed.value.filter((entry) => entry.id === taskSessionId(taskId))).toHaveLength(1);
    });

    test("会话输出 12：background 写进会话头，列表缺省不列", async () => {
        const w = await world();
        const taskId = randomUUID();
        endpoint.script({tool: "yield", args: {answer: "四"}});
        const started = await w.service.startTask({taskId, profile: SOLVER, input: {text: "算"}, background: true});
        if (!started.ok) throw new Error(started.code);
        await started.result;
        const shown = await w.service.list();
        const hidden = await w.service.list({background: true});
        expect(shown.ok && shown.value.some((entry) => entry.id === started.sessionId)).toBe(false);
        expect(hidden.ok && hidden.value.map((entry) => entry.id)).toEqual([started.sessionId]);
    });
});

describe("停止与撤回", () => {
    test("会话输出 13：模型服务不在时会话照常建、能读，发请求以 no-model 失败", async () => {
        const w = await world({withoutModels: true});
        const created = await w.service.create({profile: SOLVER});
        if (!created.ok) throw new Error(created.code);
        expect((await created.value.snapshot()).readOnly).toBeNull();
        const sent = await created.value.send({commandId: "c1", input: {text: "在吗"}});
        const failed = sent.ok ? (sent.value.runId === null ? null : await created.value.waitRun(sent.value.runId)) : sent;
        expect(JSON.stringify(failed)).toContain("no-model");
    });

    test("贡献输出 2：新建会话时 Profile 依赖的扩展激活失败，建会话失败、详情带缺的依赖；别的会话不受影响", async () => {
        const needed = defineExtension({id: "test.broken.needed"});
        const note = agentExtension(needed.id);
        const broken: PluginDefinition = {id: "test.broken", entries: [defineEntry({id: "server", location: "server", activationEvents: [note.activationEvent], contributions: [note.contribution], activate: () => {
            throw new Error("provider failed");
        }})]};
        const dependent = agentProfile("test.broken-profiles.profile", {name: "依赖扩展", description: "测试用", tools: {required: [], optional: []}});
        const profiles: PluginDefinition = {id: "test.broken-profiles", entries: [defineEntry({id: "server", location: "server", activationEvents: [dependent.activationEvent], contributions: [dependent.contribution], activate: () => ({contributions: {"agent.profiles": {"test.broken-profiles.profile": defineProfile({id: "test.broken-profiles.profile", version: "1", name: "依赖扩展", description: "测试用", dependsOn: [needed]})}}})})]};
        const w = await world({plugins: [broken, profiles]});
        const failed = await w.service.create({profile: "test.broken-profiles.profile"});
        expect(failed).toMatchObject({ok: false, code: "profile-invalid"});
        expect(JSON.stringify((failed as {detail?: unknown}).detail)).toContain("test.broken.needed");
        expect(w.settings.diagnostics("hub").query({}).records.some((record) => record.event === "agent.extension-activation-failed")).toBe(true);
        expect((await w.service.create({profile: SOLVER})).ok).toBe(true);
    });

    test("贡献输出 3：扩展的提供方可以依赖 agentKey：建会话前 nbook.agent 已经激活，不成环，扩展照常装上", async () => {
        const looped = agentExtension("test.loop.ext");
        const loop: PluginDefinition = {id: "test.loop", entries: [defineEntry({id: "server", location: "server", activationEvents: [looped.activationEvent], dependencies: [{key: agentKey}], contributions: [looped.contribution], activate: () => ({contributions: {"agent.extensions": {"test.loop.ext": defineExtension({id: "test.loop.ext"})}}})})]};
        const w = await world({plugins: [loop]});
        const created = await w.service.create({profile: SOLVER});
        if (!created.ok) throw new Error(created.code);
        expect((await created.value.snapshot()).extensions.map((item) => item.id)).toContain("test.loop.ext");
    });
});
