/**
 * `nbook.projects`：服务端入口的远程服务接在真实的项目管理器与登记表上（必要时起真实的项目子进程）；“打开项目”
 * 由真实的浏览器内核实例经命令服务执行、经进程内链路调用它，选择走真实的命令面板宿主（选择模式），整页导航经
 * 宿主能力 `windowNavigationKey`。行为合同见 docs/specs/runtime/projects.md 输出第 10 条与场景 11。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {Application} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {quickPickKey} from "nbook/plugins/workbench/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/shared/contracts";
import {createPaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import type {PaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {windowNavigationKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {browserHostPlugins, browserPluginDefinitions} from "nbook/web/plugins";

import {projectsBackendPlugin} from "./backend/plugin";
import {projectsRemoteContract} from "./shared/contracts";
import {openProject} from "./web/open-project";
import {projectsBrowserPlugin} from "./web/plugin";

const silentConsole = {error: () => undefined};

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "projects-plugin");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 服务端装着 `nbook.projects` 的服务端入口；浏览器是另一个真实内核实例，不绑定项目。 */
async function setup(): Promise<{readonly h: ProjectHarness; readonly projects: RemoteUse<typeof projectsRemoteContract>}> {
    // 服务端插件都以诊断为依赖图的根；这里的诊断只进内存，不写文件也不打印。
    const silent = {error: () => undefined};
    const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const h = await projectHarness(tmp, {plugins: [diagnostics, projectsBackendPlugin]});
    let remote: ActivationContext["remote"] | null = null;
    const node = createRemoteNode({instance: {id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}});
    const app = createApplication(
        {identity: {location: "browser", instanceId: "browser-1"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            plugins: [{id: "app.window", entries: [{id: "main", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                remote = context.remote;
                return {};
            }}]}],
            gates: [],
            remote: node,
        },
    );
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    expect(await app.startup).toMatchObject({status: "available"});
    return {h, projects: remote!.use(projectsRemoteContract)};
}

/** 拿到命令服务的测试插件：依赖命令服务，借此把它交给测试。 */
function commandReader(onService: (service: CommandService) => void): PluginDefinition {
    return {id: "test.command-reader", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: commandServiceKey}], activate: (context) => {
        onService(context.services.require(commandServiceKey));
        return {};
    }}]};
}

/**
 * 装着产品 `nbook.commands` 与 `nbook.projects` 浏览器入口的窗口实例，连到 `h` 的路由。工作台的选择服务要挂上
 * 命令面板（DOM）才有宿主，这里用同一个真实的面板宿主顶替它；整页导航记在宿主能力上（产品里是 `location.assign`）。
 */
async function commandWindow(h: ProjectHarness, host: PaletteHost, navigations: string[]): Promise<{readonly commands: CommandService; readonly app: Application}> {
    let commands: CommandService | null = null;
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "browser-2"}});
    const node = createRemoteNode({instance: {id: "browser-2", kind: "browser", role: "client", project: null, client: "profile-2"}});
    const app = createApplication(
        {identity: {location: "browser", instanceId: "browser-2"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: (href: string) => navigations.push(href)})},
                {id: "test.quick-pick", key: quickPickKey, create: (): QuickPick => ({pick: (request) => host.openPick(request)})},
            ],
            plugins: [browserHostPlugins["nbook.diagnostics"]!({store, console: silentConsole}), commandsPlugin, projectsBrowserPlugin, commandReader((service) => {
                commands = service;
            })],
            gates: [],
            remote: node,
        },
    );
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    return {commands: commands!, app};
}

async function directory(name: string): Promise<string> {
    const path = join(tmp, "dirs", name);
    await mkdir(path, {recursive: true});
    return path;
}

describe("Spec projects 输出 10：nbook.projects/projects", () => {
    it("列出已登记项目（短名、目录路径、运行状态，不含子进程信息）；登记新目录；登记失败带原因", async () => {
        const {h, projects} = await setup();
        expect(await projects.list({})).toEqual({ok: true, value: [{id: h.project.id, name: "book", path: h.project.path, state: "stopped", generation: null}]});

        const lease = leaseOf(await h.manager.acquire("book", "window"));
        expect(await projects.list({})).toMatchObject({ok: true, value: [{name: "book", state: "running", generation: 1}]});
        lease.release();

        const second = await directory("Second Book");
        expect(await projects.register({path: second})).toEqual({ok: true, value: {id: expect.any(String), name: "second-book", path: second}});
        expect(await projects.register({path: join(tmp, "dirs", "missing")})).toMatchObject({ok: false, code: "register-failed", detail: {reason: "invalid-path"}});
        const listed = await projects.list({});
        expect(listed.ok && listed.value.map((project) => project.name)).toEqual(["book", "second-book"]);
    });
});

describe("Spec projects 场景 11：打开项目", () => {
    /** 真实的命令面板宿主作为选择服务；`opened` 等它进入选择模式（流程里先要经远程服务读登记表），返回这次的请求。 */
    async function picker(): Promise<{readonly host: PaletteHost; readonly opened: (match?: (title: string) => boolean) => Promise<NonNullable<PaletteHost["pick"]["value"]>>}> {
        const host = createPaletteHost({commands: createCommandRegistry({contextKeys: {}, context: () => ({}), report: (error) => {
            throw error;
        }})});
        return {host, opened: (match = () => true) => waitUntil("进入选择模式", () => (host.pick.value !== null && match(host.pick.value.title) ? host.pick.value : null))};
    }

    /** 像面板那样提交：选中、关闭，再报告关闭完成。 */
    function submit(host: PaletteHost, result: Parameters<PaletteHost["choosePick"]>[0] | "cancel"): void {
        if (result === "cancel") host.closePalette();
        else host.choosePick(result);
        host.closed();
    }

    it("经命令服务执行“打开项目”：列出已登记项目，选中后经宿主能力整页导航到 /?project=<短名>", async () => {
        const {h} = await setup();
        const {host, opened} = await picker();
        const navigations: string[] = [];
        const {commands, app} = await commandWindow(h, host, navigations);
        const running = commands.execute("nbook.project.open");

        const request = await opened();
        expect(request.items).toEqual([{id: "book", label: "book", detail: expect.stringContaining("Book")}]);
        submit(host, {kind: "item", id: "book"});
        expect(await running).toEqual({ok: true, value: null});
        expect(navigations).toEqual(["/?project=book"]);
        expect((await app.stop()).status).toBe("closed");
    });

    it("输入目录路径：先登记再导航；登记失败带着原因重新选择，取消则什么也不做", async () => {
        const {h, projects} = await setup();
        const {host, opened} = await picker();
        const navigations: string[] = [];
        const fresh = await directory("Fresh");

        const registering = openProject(projects, {pick: (request) => host.openPick(request)}, (url) => navigations.push(url));
        await opened();
        submit(host, {kind: "text", text: join(tmp, "dirs", "nowhere")});
        expect((await opened((title) => title.includes("登记失败"))).title).toContain("目录不存在");
        submit(host, {kind: "text", text: fresh});
        expect(await registering).toEqual({ok: true, value: null});
        expect(navigations).toEqual(["/?project=fresh"]);
        expect(await h.manager.registry.resolve("fresh")).toMatchObject({ok: true, value: {path: fresh}});

        const cancelled = openProject(projects, {pick: (request) => host.openPick(request)}, (url) => navigations.push(url));
        await opened();
        submit(host, "cancel");
        expect(await cancelled).toEqual({ok: true, value: null});
        expect(navigations).toEqual(["/?project=fresh"]);
    });
});

describe("Spec projects 输出 10：命令登记", () => {
    it("产品的浏览器插件装配后，“打开项目”在本窗口的命令表里（人类可见、当前可用）", async () => {
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "window-1"}});
        let commands: CommandService | null = null;
        const plugins = [
            browserHostPlugins["nbook.diagnostics"]!({store, console: silentConsole}),
            ...["nbook.commands", "nbook.workbench", "nbook.projects"].map((id) => browserPluginDefinitions[id]!),
            commandReader((service) => {
                commands = service;
            }),
        ];
        const app = createApplication(
            {identity: {location: "browser", instanceId: "window-1"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [
                    {id: "window.project", key: windowProjectKey, create: () => ({project: null})},
                    {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: () => undefined})},
                ],
                plugins,
                requiredPlugins: ["nbook.diagnostics", "nbook.commands", "nbook.workbench"],
                gates: [],
            },
        );
        expect(await app.startup).toMatchObject({status: "available", failures: []});
        expect(commands!.get("nbook.project.open")).toMatchObject({ok: true, value: {source: "nbook.projects", title: {"zh-CN": "打开项目"}}});
        expect(commands!.isEnabled("nbook.project.open")).toEqual({ok: true, value: true});
        await app.stop();
    });
});
