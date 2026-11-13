/**
 * 在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）：同进程、真实认领的服务端加测试插件，经宿主接口
 * `GET /api/runtime/work` 看结果；项目的那一份走真实的项目子进程。入口停止时撤下登记用真实内核核对。项目管理器逐项目收口的
 * 各种失败见 `projects/manager.test.ts`。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createApplication} from "nbook/application";
import {projectWorkText, RUNNING_WORK_PROBE_ID} from "nbook/project/testing/running-work-plugin";
import {runningWorkKey} from "nbook/shared/host";
import type {RunningWorkItem} from "nbook/shared/host";
import {RUNNING_WORK_PATH, RunningWorkReportSchema} from "nbook/shared/running-work";
import type {RunningWorkReport} from "nbook/shared/running-work";
import {Value} from "typebox/value";

import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {manifestServerPlugins} from "./plugins";
import {createProjectRegistry} from "./projects/registry";
import {createRunningWork} from "./running-work";
import type {RunningServer} from "./start";
import {startClaimedServer} from "./testing/claimed-server";
import {killSpawnedProjects, leaseOf, observed, PROJECT_FIXTURE_ENTRY, trackedProjectOutput} from "./testing/projects";
import {createTestPlugin} from "./testing/test-plugins";

let tmp = "";
let counter = 0;
const servers = new Set<RunningServer>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-running-work", "running-work");
});

afterEach(async () => {
    for (const server of servers) {
        server.requestStop("test:cleanup");
        await server.stopped;
    }
    servers.clear();
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 测试插件登记过的报告方各自的 release，按登记顺序。 */
interface WorkPluginState {
    readonly releases: Array<() => void>;
}

/** 服务端插件：激活时按顺序登记 `reporters`。 */
function workPlugin(id: string, reporters: ReadonlyArray<() => ReadonlyArray<RunningWorkItem>>, state: WorkPluginState = {releases: []}): PluginDefinition {
    return {
        id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: runningWorkKey}],
            activate: (context) => {
                const work = context.services.require(runningWorkKey);
                for (const reporter of reporters) state.releases.push(work.register(reporter));
                return {};
            },
        })],
    };
}

function config(name: string) {
    const stateRoot = join(tmp, name);
    return {host: "127.0.0.1", port: 0, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS};
}

async function started(name: string, plugins: ReadonlyArray<PluginDefinition>): Promise<RunningServer> {
    const server = await startClaimedServer({
        config: config(name),
        plugins: (context) => [...manifestServerPlugins(context), ...plugins],
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
    servers.add(server);
    await server.ready;
    return server;
}

/** 取宿主接口，核对应答形状就是页面校验用的那个。 */
async function fetchWork(server: RunningServer): Promise<RunningWorkReport> {
    const response = await fetch(new URL(RUNNING_WORK_PATH, server.url!));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(Value.Check(RunningWorkReportSchema, body)).toBe(true);
    return body as RunningWorkReport;
}

describe("Spec server-host 在跑的工作：服务端的登记", () => {
    it("按登记顺序列出，归属取自登记的插件，project 为 null；文字引用原样交回；同插件两次登记各一项，release 只撤自己那条", async () => {
        const state: WorkPluginState = {releases: []};
        const reference = {kind: "text", ns: "test.work-a", key: "work.check", params: {name: "第三章"}} as const;
        const server = await started("register", [
            workPlugin("test.work-a", [() => [{text: "检查第一章"}], () => [{text: reference}]], state),
            workPlugin("test.work-b", [() => [], () => [{text: {"zh-CN": "导出", "en-US": "Export"}}]]),
        ]);

        expect(await fetchWork(server)).toEqual({
            items: [
                {plugin: "test.work-a", project: null, text: "检查第一章"},
                {plugin: "test.work-a", project: null, text: reference},
                {plugin: "test.work-b", project: null, text: {"zh-CN": "导出", "en-US": "Export"}},
            ],
            failed: [],
        });

        state.releases[0]!();
        state.releases[0]!();
        expect((await fetchWork(server)).items.map((item) => item.text)).toEqual([reference, {"zh-CN": "导出", "en-US": "Export"}]);
    });

    it("报告方抛错或交回的不是工作项列表：这个插件进 failed（一次）并写诊断，别的照常列出", async () => {
        const server = await started("reporter-failed", [
            workPlugin("test.work-throws", [() => {
                throw new Error("报告方坏了");
            }, () => [{text: "同插件的另一项"}]]),
            workPlugin("test.work-malformed", [() => [{text: 42}] as unknown as ReadonlyArray<RunningWorkItem>]),
            workPlugin("test.work-ok", [() => [{text: "照常"}]]),
        ]);

        expect(await fetchWork(server)).toEqual({
            items: [{plugin: "test.work-throws", project: null, text: "同插件的另一项"}, {plugin: "test.work-ok", project: null, text: "照常"}],
            failed: [{plugin: "test.work-throws", project: null}, {plugin: "test.work-malformed", project: null}],
        });

        server.requestStop("test:done");
        expect((await server.stopped).exitCode).toBe(0);
        servers.delete(server);
        const log = (await readFile(join(config("reporter-failed").logDirectory, "server-current.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as {event: string; data: {$source: {plugin: string | null}}});
        expect(log.filter((line) => line.event === "runtime.work.reporter-failed").map((line) => line.data.$source.plugin)).toEqual(["test.work-throws", "test.work-malformed"]);
    });

    it("停止开始后宿主接口回 503", async () => {
        const hold = Promise.withResolvers<void>();
        const server = await started("stopping", [createTestPlugin("test.slow", hold.promise), workPlugin("test.work-a", [() => [{text: "检查"}]])]);
        const held = await fetch(new URL("/api/test.slow/hold", server.url!));
        expect(held.status).toBe(200);

        server.requestStop("test:stop");
        const response = await fetch(new URL(RUNNING_WORK_PATH, server.url!));
        expect(response.status).toBe(503);
        await response.body?.cancel();
        hold.resolve();
        await held.text();
        expect((await server.stopped).exitCode).toBe(0);
        servers.delete(server);
    });

    it("项目子进程登记的工作带项目 id 合进同一份应答", async () => {
        counter += 1;
        const root = join(tmp, `project-${String(counter)}`);
        await mkdir(join(root, "Book"), {recursive: true});
        const {stateRoot, logDirectory, ...rest} = config(`project-${String(counter)}/state`);
        const registered = await createProjectRegistry({stateRoot, cwd: root}).register(join(root, "Book"));
        if (!registered.ok) throw new Error(registered.detail);
        const forward = trackedProjectOutput(observed<string>());
        const server = await startClaimedServer({
            config: {...rest, stateRoot, logDirectory},
            plugins: (context) => [...manifestServerPlugins(context), workPlugin("test.work-a", [() => [{text: "服务端的"}]])],
            process: new EventEmitter(),
            writeFatal: () => undefined,
            projectEntry: PROJECT_FIXTURE_ENTRY,
            projectEnv: {...process.env, NBOOK_TEST_PLUGINS: RUNNING_WORK_PROBE_ID, NBOOK_TEST_PROJECT_FAULT: "none"},
            projectOutput: {stdout: forward, stderr: forward},
        });
        servers.add(server);
        await server.ready;
        leaseOf(await server.projects.acquire("book", "window-1"));

        expect(await fetchWork(server)).toEqual({
            items: [
                {plugin: "test.work-a", project: null, text: "服务端的"},
                {plugin: RUNNING_WORK_PROBE_ID, project: registered.project.id, text: projectWorkText("book")},
            ],
            failed: [],
        });
    }, 20_000);
});

describe("Spec server-host 在跑的工作：入口停止时撤下", () => {
    async function application(plugins: ReadonlyArray<PluginDefinition>, required: ReadonlyArray<string>) {
        const work = createRunningWork(() => undefined);
        const app = createApplication(
            {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {capabilities: [{id: "host.running-work", key: runningWorkKey, create: () => work.provision}], plugins, requiredPlugins: required, gates: []},
        );
        return {work, app, startup: await app.startup};
    }

    it("入口激活失败：它在失败前登记的报告方随门面撤下", async () => {
        const failing: PluginDefinition = {
            id: "test.work-fails",
            entries: [defineEntry({
                id: "server",
                location: "server",
                activationEvents: ["onStartup"],
                dependencies: [{key: runningWorkKey}],
                activate: (context) => {
                    context.services.require(runningWorkKey).register(() => [{text: "失败前登记的"}]);
                    throw new Error("激活失败");
                },
            })],
        };
        const {work, app} = await application([failing, workPlugin("test.work-ok", [() => [{text: "照常"}]])], ["test.work-ok"]);
        expect(work.collect()).toEqual({items: [{plugin: "test.work-ok", text: "照常"}], failed: []});
        await app.stop();
    });

    it("运行实例停止后不再有任何登记", async () => {
        const {work, app, startup} = await application([workPlugin("test.work-a", [() => [{text: "检查"}]])], ["test.work-a"]);
        expect(startup.status).toBe("available");
        expect(work.collect().items).toHaveLength(1);
        await app.stop();
        expect(work.collect()).toEqual({items: [], failed: []});
    });
});
