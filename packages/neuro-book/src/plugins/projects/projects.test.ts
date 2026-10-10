/**
 * `nbook.projects`：服务端入口的远程服务接在真实的项目管理器与登记表上（必要时起真实的项目子进程），书架读真实的 Storage
 * user 分区（SQLite）与真实的用户层配置；“打开项目”由真实的浏览器内核实例经命令服务执行、经进程内链路调用它，选择走
 * 真实的命令面板宿主（选择模式），整页导航经宿主能力 `windowNavigationKey`。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 10、13–15、17、18 条与场景 11、18。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {Application} from "@notnotype/nb-runtime/application";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {ref} from "vue";

import {definitionAt} from "nbook/manifest";
import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {settingsBackendPlugin} from "nbook/plugins/settings/backend/plugin";
import {descriptor as settingsDescriptor} from "nbook/plugins/settings/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {createPartition} from "nbook/plugins/storage/backend/partition";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {quickPickKey} from "nbook/plugins/workbench/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/shared/contracts";
import {createPaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import type {PaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import {PROJECT_IDENTITY_FILE} from "nbook/server/projects/identity";
import {createProjectRegistry} from "nbook/server/projects/registry";
import {GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness, ProjectHarnessPaths} from "nbook/server/testing/projects";
import {windowNavigationKey} from "nbook/shared/host";
import {textOf} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {windowProjectKey} from "nbook/shared/projects";
import {browserHostPlugins, browserPluginDefinitions} from "nbook/web/plugins";

import {projectsBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {librarySetting, projectsRemoteContract} from "./shared/contracts";
import type {ProjectStatsSnapshot} from "./shared/contracts";
import {PROJECT_STATS_RECORD} from "./shared/stats-record";
import {openProject} from "./web/open-project";
import type {OpenProjectHost} from "./web/open-project";
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

/**
 * 服务端装着 `nbook.projects` 的服务端入口，连同它依赖的真实 Storage 与配置（按产品清单的装配，带 `nbook.projects` 声明的
 * 作品目录设置）；浏览器是另一个真实内核实例，不绑定项目。`prepare` 在服务端实例起来之前预置状态根（见 `projectHarness`）。
 */
async function setup(prepare?: (paths: ProjectHarnessPaths) => Promise<void>): Promise<{readonly h: ProjectHarness; readonly projects: RemoteUse<typeof projectsRemoteContract>; readonly store: DiagnosticsStore}> {
    // 服务端插件都以诊断为依赖图的根；这里的诊断只进内存，不写文件也不打印。
    const silent = {error: () => undefined};
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}});
    const diagnostics = createDiagnosticsPlugin({location: "server", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const h = await projectHarness(tmp, {
        plugins: [diagnostics, storageBackendPlugin, definitionAt("server", settingsDescriptor, settingsBackendPlugin), definitionAt("server", descriptor, projectsBackendPlugin)],
        ...(prepare === undefined ? {} : {prepare}),
    });
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
    return {h, projects: remote!.use(projectsRemoteContract), store};
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
    const settings = standaloneSettings("browser", tmp);
    const app = createApplication(
        {identity: {location: "browser", instanceId: "browser-2"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: (href: string) => navigations.push(href), reloadDocument: () => undefined, openExternal: () => "opened" as const})},
                {id: "test.quick-pick", key: quickPickKey, create: (): QuickPick => ({pick: (request) => host.openPick(request)})},
                ...settings.capabilities,
            ],
            plugins: [browserHostPlugins["nbook.diagnostics"]!({store, console: silentConsole}), statePlugin, ...settings.plugins, commandsPlugin, projectsBrowserPlugin, commandReader((service) => {
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

/** 服务端本地日期的写法（`YYYY-MM-DD`）；瑞典语区域的日期格式正好是它。 */
const localDay = (ms: number): string => new Date(ms).toLocaleDateString("sv-SE");

/** 场地的注入时钟从 0 开始：书架的“今天”是这一天。 */
const HARNESS_TODAY = localDay(0);

function snapshot(fields: {readonly words: number; readonly baseline: number; readonly date: string}): ProjectStatsSnapshot {
    return {
        computedAt: "2026-10-09T08:30:00.000Z",
        words: fields.words,
        files: 3,
        unreadable: 1,
        today: {date: fields.date, baseline: fields.baseline},
        last: {address: "project://第一卷/第一章.md", label: "第一章", at: "2026-10-09T08:29:00.000Z", excerpt: "风停了。"},
    };
}

/**
 * 以 `nbook.projects` 的身份直接往 user 分区写统计记录：服务端实例起来之前在 `prepare` 里写（产品里由项目实例经 Storage
 * 写入，写入方随统计切片）。
 */
function writeStats(stateRoot: string, records: ReadonlyArray<{readonly id: string; readonly value: ProjectStatsSnapshot}>): void {
    const partition = createPartition({path: join(stateRoot, "storage", "user.sqlite")});
    try {
        const registered = partition.register(descriptor.id, PROJECT_STATS_RECORD.descriptor);
        if (!registered.ok) throw new Error(registered.detail);
        for (const {id, value} of records) {
            const written = partition.write({owner: descriptor.id, key: PROJECT_STATS_RECORD.key, resource: id, client: ""}, PROJECT_STATS_RECORD.descriptor, {kind: "save", value, expect: null});
            if (!written.ok) throw new Error(written.detail);
        }
    } finally {
        partition.close();
    }
}

/** 在 `prepare` 里另登记一个项目目录（与场地的登记表写同一个文件）。 */
async function registerExtra(paths: ProjectHarnessPaths, name: string): Promise<{readonly id: string; readonly path: string}> {
    const path = join(paths.root, name);
    await mkdir(path, {recursive: true});
    const registered = await createProjectRegistry({stateRoot: paths.stateRoot, cwd: paths.root}).register(path);
    if (!registered.ok) throw new Error(registered.detail);
    return registered.project;
}

function events(store: DiagnosticsStore): string[] {
    return store.query({}).records.map((record) => record.event);
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
    /** 面板与命令失败原因的显示语言；用例里切换它来验证文字在显示时才按语言取。 */
    const locale = ref<DisplayLocale>("zh-CN");
    /** 真实的命令面板宿主作为选择服务；`opened` 等它进入选择模式（流程里先要经远程服务读登记表），返回这次的请求。 */
    async function picker(): Promise<{readonly host: PaletteHost; readonly opened: (match?: (title: string) => boolean) => Promise<NonNullable<PaletteHost["pick"]["value"]>>}> {
        const host = createPaletteHost({locale, commands: createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
            throw error;
        }})});
        return {host, opened: (match = () => true) => waitUntil("进入选择模式", () => (host.pick.value !== null && match(textOf(host.pick.value.title, locale.value)) ? host.pick.value : null))};
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

    it("输入目录路径：先登记再导航；登记失败带着按失败码给出的原因重新选择（显示时按当前语言，说明原文进诊断），取消则什么也不做", async () => {
        const {h, projects} = await setup();
        const {host, opened} = await picker();
        const navigations: string[] = [];
        const failures: Array<{reason: string; detail: string}> = [];
        const fresh = await directory("Fresh");
        const openHost = (): OpenProjectHost => ({
            remote: projects,
            quickPick: {pick: (request) => host.openPick(request)},
            navigateDocument: (url) => navigations.push(url),
            locale: () => locale.value,
            recordFailure: (reason, detail) => failures.push({reason, detail}),
        });

        const registering = openProject(openHost());
        await opened();
        submit(host, {kind: "text", text: join(tmp, "dirs", "nowhere")});
        const retry = await opened((title) => title.includes("登记失败"));
        expect(textOf(retry.title, "zh-CN")).toBe("打开项目：登记失败（路径无效或不存在）");
        // 选择开着时换成英文：同一个请求按新语言显示，标题里没有服务端给的中文说明。
        locale.value = "en-US";
        expect(textOf(retry.title, locale.value)).toBe("Open Project: registration failed (the path is invalid or does not exist)");
        locale.value = "zh-CN";
        expect(failures).toEqual([{reason: "invalid-path", detail: expect.stringContaining("nowhere")}]);
        submit(host, {kind: "text", text: fresh});
        expect(await registering).toEqual({ok: true, value: null});
        expect(navigations).toEqual(["/?project=fresh"]);
        expect(await h.manager.registry.resolve("fresh")).toMatchObject({ok: true, value: {path: fresh}});

        const cancelled = openProject(openHost());
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
            ...["nbook.state", "nbook.settings", "nbook.commands", "nbook.storage", "nbook.workbench", "nbook.projects"].map((id) => browserPluginDefinitions[id]!),
            commandReader((service) => {
                commands = service;
            }),
        ];
        const app = createApplication(
            {identity: {location: "browser", instanceId: "window-1"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [
                    {id: "window.project", key: windowProjectKey, create: () => ({project: null})},
                    {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: () => undefined, reloadDocument: () => undefined, openExternal: () => "opened" as const})},
                    ...standaloneSettings("browser", tmp, {windowProject: false}).capabilities,
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

describe("Spec projects 输出 17、18：书架（nbook.projects/projects 版本 2 的 shelf）", () => {
    it("停止的作品：有记录为 stale（带统计时间，今天的字数只在快照是今天时给出），没有记录为 none；作品信息来自身份文件", async () => {
        let second = {id: "", path: ""};
        let third = {id: "", path: ""};
        const {h, projects} = await setup(async (paths) => {
            second = await registerExtra(paths, "Second");
            third = await registerExtra(paths, "Third");
            writeStats(paths.stateRoot, [
                {id: paths.project.id, value: snapshot({words: 1200, baseline: 1000, date: HARNESS_TODAY})},
                {id: second.id, value: snapshot({words: 800, baseline: 900, date: "1969-01-01"})},
            ]);
        });
        expect(h.clock.now()).toBe(0);
        expect(await projects.update({id: h.project.id, title: "长夜", color: "#336699"})).toMatchObject({ok: true});

        const shelf = await projects.shelf({});
        expect(shelf).toEqual({
            ok: true,
            value: [
                {
                    id: h.project.id, name: "book", path: h.project.path, state: "stopped", title: "长夜", description: null, color: "#336699",
                    stats: {freshness: "stale", computedAt: "2026-10-09T08:30:00.000Z", words: 1200, files: 3, unreadable: 1, today: 200, last: snapshot({words: 0, baseline: 0, date: HARNESS_TODAY}).last},
                },
                {id: second.id, name: "second", path: second.path, state: "stopped", title: null, description: null, color: null, stats: expect.objectContaining({freshness: "stale", words: 800, today: null})},
                {id: third.id, name: "third", path: third.path, state: "stopped", title: null, description: null, color: null, stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null}},
            ],
        });
    });

    it("运行中的作品没有统计提供方（调用失败）：退回记录、为 stale 并记诊断；宽限期里同样按记录", async () => {
        const {h, projects, store} = await setup(async (paths) => {
            writeStats(paths.stateRoot, [{id: paths.project.id, value: snapshot({words: 50, baseline: 20, date: HARNESS_TODAY})}]);
        });
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));

        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{state: "running", stats: {freshness: "stale", words: 50, today: 30}}]});
        expect(events(store)).toContain("projects.shelf.live-unavailable");

        lease.release();
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{state: "idle-grace", stats: {freshness: "stale", words: 50}}]});
    });

    it("一部作品的身份文件坏了只影响它自己：作品信息为 null、统计照常，并记诊断；不合规的字段当作没有并记 project.metadata.invalid", async () => {
        let broken = {id: "", path: ""};
        let odd = {id: "", path: ""};
        const {h, projects, store} = await setup(async (paths) => {
            broken = await registerExtra(paths, "Broken");
            odd = await registerExtra(paths, "Odd");
            writeStats(paths.stateRoot, [{id: broken.id, value: snapshot({words: 10, baseline: 10, date: HARNESS_TODAY})}]);
        });
        expect(await projects.update({id: h.project.id, title: "好好的"})).toMatchObject({ok: true});
        await writeFile(join(broken.path, PROJECT_IDENTITY_FILE), "{");
        await writeFile(join(odd.path, PROJECT_IDENTITY_FILE), JSON.stringify({schema: 1, id: odd.id, title: "有名字", color: "RED"}));

        const shelf = await projects.shelf({});
        expect(shelf).toMatchObject({
            ok: true,
            value: [
                {id: h.project.id, title: "好好的", stats: {freshness: "none"}},
                {id: broken.id, title: null, description: null, color: null, stats: {freshness: "stale", words: 10, today: 0}},
                {id: odd.id, title: "有名字", color: null},
            ],
        });
        expect(events(store)).toEqual(expect.arrayContaining(["projects.shelf.identity-unreadable", "project.metadata.invalid"]));
    });

    it("登记表坏了：shelf 为 registry-invalid", async () => {
        const {h, projects} = await setup();
        await writeFile(join(h.stateRoot, "projects.json"), "{broken");
        expect(await projects.shelf({})).toMatchObject({ok: false, code: "registry-invalid"});
    });
});

describe("Spec projects 输出 13–15、18：经远程服务新建、修改作品信息与移出书架", () => {
    it("create：给了父目录就在它下面新建并登记；同名为 exists；没给父目录又没设作品目录为 no-library", async () => {
        const {h, projects} = await setup();
        const parent = join(h.root, "library");
        await mkdir(parent);

        const created = await projects.create({title: "新书", description: "简介", parent});
        expect(created).toEqual({ok: true, value: {id: expect.any(String), name: "project", path: join(parent, "新书")}});
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{name: "book"}, {name: "project", title: "新书", description: "简介", stats: {freshness: "none"}}]});
        expect(await projects.create({title: "新书", parent})).toEqual({ok: false, code: "exists", detail: {path: join(parent, "新书")}});
        expect(await projects.create({title: "  ", parent})).toMatchObject({ok: false, code: "invalid-metadata", detail: {field: "title"}});

        expect(await projects.create({title: "没处放"})).toMatchObject({ok: false, code: "no-library"});
        expect(await readdir(parent)).toEqual(["新书"]);
    });

    it("create 不给父目录：用作品目录设置；作品目录不可用为 invalid-parent（带原因）", async () => {
        let library = "";
        const {h, projects} = await setup(async (paths) => {
            library = join(paths.root, "my-library");
            await mkdir(library);
            await writeFile(join(paths.stateRoot, "settings.json"), JSON.stringify({[librarySetting.key]: library}));
        });
        expect(await projects.create({title: "第二部"})).toMatchObject({ok: true, value: {path: join(library, "第二部")}});

        await rm(library, {recursive: true});
        expect(await projects.create({title: "第三部"})).toMatchObject({ok: false, code: "invalid-parent", detail: {reason: "invalid-path"}});
        expect(await h.manager.list()).toMatchObject({ok: true, value: [{name: "book"}, {name: "project"}]});
    });

    it("update：只改给出的字段，null 清除；不合规带字段名；未登记的 id 为 unknown-project", async () => {
        const {h, projects} = await setup();
        expect(await projects.update({id: h.project.id, title: "书名", description: "简介"})).toEqual({ok: true, value: {id: h.project.id, title: "书名", description: "简介", color: null}});
        expect(await projects.update({id: h.project.id, description: null, color: "#0a0b0c"})).toEqual({ok: true, value: {id: h.project.id, title: "书名", description: null, color: "#0a0b0c"}});
        expect(await projects.update({id: h.project.id, title: "书".repeat(81)})).toMatchObject({ok: false, code: "invalid-metadata", detail: {field: "title"}});
        expect(await projects.update({id: "00000000-0000-4000-8000-000000000000", title: "名"})).toMatchObject({ok: false, code: "unknown-project"});
    });

    it("unregister：打开着为 project-running（带状态）；宽限期满后移出，书架上没有它、目录不动", async () => {
        const {h, projects} = await setup();
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        expect(await projects.unregister({id: h.project.id})).toEqual({ok: false, code: "project-running", detail: {state: "running"}});

        lease.release();
        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(await projects.unregister({id: h.project.id})).toEqual({ok: true, value: {id: h.project.id, name: "book"}});
        expect(await projects.shelf({})).toEqual({ok: true, value: []});
        expect(await readdir(h.project.path)).toContain(".nbook");
    });
});
