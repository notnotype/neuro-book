/**
 * 报给宿主的在跑的工作（docs/specs/agent/sessions.md 输出 20）：真实内核、真实会话存储与本机假端点，经宿主能力
 * `runningWorkKey` 的真实登记表取（`AgentWorld.work`）。`tiny` 角色没绑定，标题由兜底取第一句话写下。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

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
    root = await createTestTmpRoot("neuro-book-agent", "running-work");
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
const PLUGIN = "nbook.agent";

async function open(settings: Readonly<Record<string, unknown>> = {}): Promise<{readonly w: AgentWorld; readonly parent: SessionApi}> {
    counter += 1;
    const w = await agentWorld(join(root, `w${String(counter)}`), {userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/modelRetries": 0, ...settings}});
    worlds.push(w);
    const created = await w.service.create({profile: MAIN_PROFILE});
    if (!created.ok) throw new Error(created.code);
    return {w, parent: created.value};
}

/** 发话但不等运行收口，交回运行 id。 */
async function send(session: SessionApi, text: string): Promise<string> {
    const sent = await session.send({commandId: cid(), input: {text}});
    if (!sent.ok || sent.value.runId === null) throw new Error(JSON.stringify(sent));
    return sent.value.runId;
}

async function turn(session: SessionApi, text: string, replies: readonly Scripted[]): Promise<void> {
    endpoint.script(...replies);
    await session.waitRun(await send(session, text));
}

/** 等兜底标题写下：运行收口之后才写，之后的断言要拿它。 */
async function titled(session: SessionApi, title: string): Promise<void> {
    await waitUntil(`标题写成 ${title}`, async () => (await session.snapshot()).title === title);
}

const adhoc = (prompt: string) => ({tool: "agent_spawn", args: {profile: ADHOC_PROFILE, prompt, initial: {role: "设定核对员"}, async: true}});

describe("sessions.md 输出 20：在跑的工作", () => {
    test("运行中的会话报一项；还没起名的写“未命名”；空闲的不报；在等用户的写“在等你处理”；改标题之后立即是新标题", async () => {
        const {w, parent} = await open();
        endpoint.script("好");
        const first = endpoint.hold();
        const runId = await send(parent, "起个头");
        await first.arrived;
        expect(w.work.collect()).toEqual({items: [{plugin: PLUGIN, text: agentText("work.session.untitledRunning")}], failed: []});
        first.release();
        await parent.waitRun(runId);
        await titled(parent, "起个头");
        expect(w.work.collect()).toEqual({items: [], failed: []});

        // 缺省审批模式下写文件要问用户：会话停在审批上。
        endpoint.script({tool: "write", args: {path: "user://a.md", content: "x"}}, "写好了");
        await send(parent, "写一下");
        const waiting = {plugin: PLUGIN, text: agentText("work.session.waiting", {title: "起个头"})};
        await waitUntil("会话等审批", () => JSON.stringify(w.work.collect().items) === JSON.stringify([waiting]));

        expect((await parent.setTitle({commandId: cid(), title: "第一章"})).ok).toBe(true);
        expect(w.work.collect().items).toEqual([{plugin: PLUGIN, text: agentText("work.session.waiting", {title: "第一章"})}]);
    });

    test("后台会话在跑也报", async () => {
        const {w} = await open();
        const created = await w.service.create({profile: MAIN_PROFILE, background: true});
        if (!created.ok) throw new Error(created.code);
        endpoint.script("好");
        const held = endpoint.hold();
        await send(created.value, "在后台整理");
        await held.arrived;
        expect(w.work.collect().items).toEqual([{plugin: PLUGIN, text: agentText("work.session.untitledRunning")}]);
        held.release();
    });

    test("会话已空闲、后台命令还在跑：只报这条命令", async () => {
        const {w, parent} = await open({"nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}});
        await turn(parent, "跑", [{tool: "shell", args: {command: "sleep 30", async: true}}, "好"]);
        expect(w.work.collect().items).toEqual([{plugin: PLUGIN, text: agentText("work.job.shell", {command: "sleep 30"})}]);
    });

    test("根会话本轮已结束、两个子代理还在跑：根报一项（带根的标题），两个子代理各报一项", async () => {
        const {w, parent} = await open();
        endpoint.scriptFor("慢慢查甲", "甲查完了");
        endpoint.scriptFor("慢慢查乙", "乙查完了");
        const holdA = endpoint.holdFor("慢慢查甲");
        const holdB = endpoint.holdFor("慢慢查乙");
        await turn(parent, "派", [{tools: [adhoc("慢慢查甲"), adhoc("慢慢查乙")]}, "派出去了"]);
        await Promise.all([holdA.arrived, holdB.arrived]);
        await titled(parent, "派");

        expect(w.work.collect()).toEqual({
            items: [
                {plugin: PLUGIN, text: agentText("work.session.running", {title: "派"})},
                {plugin: PLUGIN, text: agentText("work.job.agent", {name: "慢慢查甲"})},
                {plugin: PLUGIN, text: agentText("work.job.agent", {name: "慢慢查乙"})},
            ],
            failed: [],
        });
        holdA.release();
        holdB.release();
    });
});
