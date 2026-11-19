/**
 * eval 在项目会话里（docs/specs/agent/eval.md 输出 10、11、12）：项目同一个 id 换了目录之后，会话关闭期间留着的内核不再接着用。
 * 真实服务端实例、真实项目子进程与项目管理器（`server/testing/projects`），真实内核子进程，模型是本机的 OpenAI 兼容端点。
 * 会话的空闲关闭、项目子进程的停止与内核的空闲计时在同一个注入时钟上。
 */

import {afterAll, beforeAll, expect, test} from "bun:test";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {defineProfile} from "@notnotype/nb-harness/kernel";
import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {IDLE_CLOSE_MS} from "@notnotype/nb-harness/kit/sessions";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {descriptor as filesDescriptor} from "nbook/plugins/files/plugin";
import {modelsBackendPlugin} from "nbook/plugins/models/backend/plugin";
import {descriptor as modelsDescriptor} from "nbook/plugins/models/plugin";
import {settingsBackendPlugin} from "nbook/plugins/settings/backend/plugin";
import {descriptor as settingsDescriptor} from "nbook/plugins/settings/plugin";
import {alive, killSpawnedProjects, projectHarness} from "nbook/server/testing/projects";
import {startupEnvKey} from "nbook/shared/host";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {agentBackendPlugin} from "./backend/plugin";
import {EVAL_IDLE_MS} from "./backend/eval/tool";
import {descriptor as agentDescriptor} from "./plugin";
import {agentKey} from "./shared/contracts";
import type {AgentService} from "./shared/contracts";
import {agentProfile, agentTool} from "./shared/points";
import type {AgentToolImplementation} from "./shared/points";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";

const PROFILE = "test.eval-projects.profile";
/** 代码里调一次它，这次打开会话期间就有它的实现；会话关闭时实现被释放，记下会话 id（看会话真的关了）。 */
const PROBE = "test.eval-projects.probe";
const TOOLS = ["nbook.agent.eval", PROBE];

let root = "";
let endpoint: FakeEndpoint;

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "eval-projects");
    endpoint = fakeEndpoint();
});
afterAll(async () => {
    endpoint.stop();
    killSpawnedProjects();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

/** 测试插件：一个带 eval 的 Profile、探针工具，并把 Agent 服务与项目登记交给用例。 */
function testPlugin(closed: Set<string>, take: (agent: AgentService, projects: ProjectsService) => void): PluginDefinition {
    const profile = agentProfile(PROFILE, {name: PROFILE, description: "测试用", tools: {required: TOOLS, optional: []}});
    const probe = agentTool(PROBE, {description: "什么也不做", parameters: {type: "object", properties: {}}, version: "1", effect: "read", providerName: "probe"});
    const probeTool: AgentToolImplementation = {create: (session) => ({execute: async () => "在", dispose: () => void closed.add(session.sessionId)})};
    return {id: "test.eval-projects", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup", profile.activationEvent, probe.activationEvent],
        contributions: [profile.contribution, probe.contribution],
        dependencies: [{key: agentKey}, {key: projectsKey}],
        activate: (context) => {
            take(context.services.require(agentKey), context.services.require(projectsKey));
            return {contributions: {
                "agent.profiles": {[PROFILE]: defineProfile({id: PROFILE, version: "1", name: PROFILE, description: "测试用", system: "测试。", tools: {required: TOOLS}})},
                "agent.tools": {[PROBE]: probeTool},
            }};
        },
    })]};
}

/** 模型在一条回复里调一次 eval；交回它的结果。 */
async function evalOnce(session: SessionApi, code: string): Promise<{text: string; status: string}> {
    const before = (await session.path()).filter((event) => event.type === "toolResult").length;
    endpoint.script({tool: "eval", args: {code}}, "好");
    const sent = await session.send({commandId: crypto.randomUUID(), input: {text: "跑代码"}});
    if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
    await session.waitRun(sent.value.runId);
    const results = (await session.path()).filter((event) => event.type === "toolResult");
    expect(results).toHaveLength(before + 1);
    return results.at(-1)!.data as {text: string; status: string};
}

test("输出 11、12：项目换了目录之后再打开会话，留着的内核重置并提示工作目录变了，新内核在新目录里", async () => {
    const closed = new Set<string>();
    let agent: AgentService | null = null;
    let projects: ProjectsService | null = null;
    const silent = {error: () => undefined};
    const diagnostics = createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}});
    const h = await projectHarness(join(root, "move"), {
        plugins: [
            createDiagnosticsPlugin({location: "server", store: diagnostics, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
            definitionAt("server", settingsDescriptor, settingsBackendPlugin),
            definitionAt("server", filesDescriptor, filesBackendPlugin),
            definitionAt("server", modelsDescriptor, modelsBackendPlugin),
            definitionAt("server", agentDescriptor, agentBackendPlugin),
            testPlugin(closed, (a, p) => {
                agent = a;
                projects = p;
            }),
        ],
        capabilities: [{id: "host.startup-env", key: startupEnvKey, create: () => ({env: {}})}],
        prepare: async ({stateRoot}) => {
            await mkdir(stateRoot, {recursive: true});
            await writeFile(join(stateRoot, "settings.json"), JSON.stringify({...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[PROFILE]: {approvalMode: "yolo"}}}));
        },
    });
    let pid = 0;
    try {
        const created = await agent!.create({profile: PROFILE, project: h.project.id}, {asUser: true});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const first = JSON.parse((await evalOnce(session, "await tool.probe({}); globalThis.kept = 7; JSON.stringify([process.pid, process.env.NBOOK_PROJECT])")).text) as [number, string];
        pid = first[0];
        expect(first[1]).toBe(h.project.path);

        // 会话因空闲关闭、项目子进程随之停下，内核还在；推的时间也算进内核的空闲计时，推满 30 分钟就不是这个场景了。
        let advanced = 0;
        await waitUntil("会话关闭、项目停了", () => {
            if (closed.has(session.id) && h.manager.running(h.project.id) === null) return true;
            if (advanced + IDLE_CLOSE_MS >= EVAL_IDLE_MS) throw new Error("推了快 30 分钟会话与项目还没停");
            h.clock.advance(IDLE_CLOSE_MS);
            advanced += IDLE_CLOSE_MS;
            return null;
        }, {intervalMs: 100});
        expect(alive(pid)).toBe(true);

        const moved = join(h.root, "MovedBook");
        await rename(h.project.path, moved);
        const registered = await projects!.register(moved);
        expect(registered).toMatchObject({ok: true, project: {id: h.project.id, path: moved}});

        const after = await evalOnce(agent!.session(session.id, {asUser: true}), "JSON.stringify([process.cwd(), process.env.NBOOK_PROJECT, typeof kept])");
        const lines = after.text.split("\n");
        expect(lines[0]).toContain("内核已重置（工作目录变了）");
        expect(JSON.parse(lines[1]!)).toEqual([moved, moved, "undefined"]);
        expect(alive(pid)).toBe(false);
    } finally {
        await h.parent.stop();
        if (pid > 1 && alive(pid)) process.kill(-pid, "SIGKILL");
    }
}, 60_000);
