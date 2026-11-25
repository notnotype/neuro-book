/**
 * `nbook.projects`：服务端入口的远程服务接在真实的项目管理器与登记表上（必要时起真实的项目子进程），书架读真实的 Storage
 * user 分区（SQLite）与真实的用户层配置；“打开项目”由真实的浏览器内核实例经命令服务执行、经进程内链路调用它，选择走
 * 真实的命令面板宿主（选择模式），整页导航经宿主能力 `windowNavigationKey`。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 10、13–15、17、18 条与场景 11、18。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {createDispatcher, HttpAdmission, RouteTable, validateRouteContribution} from "@notnotype/nb-host/testing";
import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {Application} from "@notnotype/nb-runtime/application";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Hono} from "hono";
import {ref} from "vue";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {settingsBackendPlugin} from "nbook/plugins/settings/backend/plugin";
import {descriptor as settingsDescriptor} from "nbook/plugins/settings/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {createPartition} from "nbook/plugins/storage/backend/partition";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {notificationsKey, quickPickKey} from "nbook/plugins/workbench/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/shared/contracts";
import {createPaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import {createNotifications} from "nbook/plugins/workbench/web/notifications";
import type {PaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import {PROJECT_IDENTITY_FILE} from "nbook/server/projects/identity";
import {createProjectRegistry} from "nbook/server/projects/registry";
import {GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked} from "nbook/server/testing/projects";
import type {ProjectHarness, ProjectHarnessPaths} from "nbook/server/testing/projects";
import {windowNavigationKey} from "nbook/shared/host";
import {textOf} from "nbook/shared/localized-text";
import type {DisplayLocale, TextResolver} from "nbook/shared/localized-text";
import {windowProjectKey} from "nbook/shared/projects";
import type {WindowProject} from "nbook/shared/projects";
import {RESUME_PATH} from "nbook/shared/resume-path";
import {browserHostPlugins, browserPluginDefinitions} from "nbook/web/plugins";

import {projectsBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {librarySetting, projectsRemoteContract, startupOpenSetting} from "./shared/contracts";
import {LAST_OPENED_RECORD} from "./shared/last-opened-record";
import type {ProjectStatsSnapshot} from "./shared/contracts";
import {PROJECT_STATS_RECORD} from "./shared/stats-record";
import {openProject} from "./web/open-project";
import type {OpenProjectHost} from "./web/open-project";
import {projectsBrowserPlugin} from "./web/plugin";
import {projectsCatalogs} from "./web/text";
import {textIn} from "nbook/shared/testing/text";

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
async function setup(prepare?: (paths: ProjectHarnessPaths) => Promise<void>): Promise<{readonly h: ProjectHarness; readonly projects: RemoteUse<typeof projectsRemoteContract>; readonly store: DiagnosticsStore; readonly get: (path: string) => Promise<Response>}> {
    // 服务端插件都以诊断为依赖图的根；这里的诊断只进内存，不写文件也不打印。
    const silent = {error: () => undefined};
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}});
    const diagnostics = createDiagnosticsPlugin({location: "server", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    // `http.routes` 的接收者与分发器是 `nbook.http` 的真实实现（不监听端口）：插件交出的路由经它按 `/api/<插件 id>/` 分发。
    const routes = new RouteTable();
    const http: PluginDefinition = {id: "nbook.http", contributionPoints: [{id: HTTP_ROUTES_POINT, implementation: "required", validate: validateRouteContribution}], entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], receives: [HTTP_ROUTES_POINT], activate: () => ({receivers: {[HTTP_ROUTES_POINT]: routes.receiver()}})})]};
    const h = await projectHarness(tmp, {
        plugins: [diagnostics, http, storageBackendPlugin, definitionAt("server", settingsDescriptor, settingsBackendPlugin), definitionAt("server", descriptor, projectsBackendPlugin)],
        ...(prepare === undefined ? {} : {prepare}),
    });
    const admission = new HttpAdmission({productName: "NeuroBook"});
    admission.ready();
    const dispatch = createDispatcher({admission, routes, hostRoutes: new Hono(), staticFiles: null, reportError: () => undefined, allowOrigin: () => false});
    // 服务端地址以斜杠结尾（`Bun.serve().url.href`），壳与命令行按 `new URL(RESUME_PATH, 地址)` 拼：这里用同样的拼法。
    const get = async (path: string): Promise<Response> => {
        const response = await dispatch(new Request(new URL(path, "http://127.0.0.1:4217/").href, {redirect: "manual"}));
        // 读完响应体准入才算请求结束。
        await response.arrayBuffer();
        return response;
    };
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
    return {h, projects: remote!.use(projectsRemoteContract), store, get};
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
async function commandWindow(h: ProjectHarness, host: PaletteHost, navigations: string[], project: WindowProject["project"] = null): Promise<{readonly commands: CommandService; readonly app: Application}> {
    let commands: CommandService | null = null;
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "browser-2"}});
    const node = createRemoteNode({instance: {id: "browser-2", kind: "browser", role: "client", project: null, client: "profile-2"}});
    const settings = standaloneSettings("browser", tmp, {windowProject: false});
    const app = createApplication(
        {identity: {location: "browser", instanceId: "browser-2"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: (href: string) => navigations.push(href), reloadDocument: () => undefined, openExternal: () => "opened" as const, currentUrl: () => "http://localhost/", replaceUrl: () => undefined})},
                {id: "test.quick-pick", key: quickPickKey, create: (): QuickPick => ({pick: (request) => host.openPick(request)})},
                // 书架页把失败通知交给工作台的通知服务；这里没有工作台插件，用真实的通知队列顶替。
                {id: "test.notifications", key: notificationsKey, create: () => createNotifications((message) => store.record({level: "warn", event: "workbench.notifications", message}), projectsTextIn("zh-CN"))},
                {id: "window.project", key: windowProjectKey, create: () => ({project})},
                ...settings.capabilities,
            ],
            plugins: [browserHostPlugins["runtime.diagnostics"]!({store, console: silentConsole}), statePlugin, storageBrowserPlugin, ...settings.plugins, commandsPlugin, projectsBrowserPlugin, commandReader((service) => {
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

/** 用 `nbook.projects` 的目录把声明与界面文字解析成某种语言的字符串（窗口里这是翻译端口的事）。 */
const projectsTextIn = (locale: DisplayLocale): TextResolver => textIn(locale, {"nbook.projects": projectsCatalogs.catalogs});

describe("Spec projects 场景 11：打开项目", () => {
    /** 面板与命令失败原因的显示语言；用例里切换它来验证文字在显示时才按语言取。 */
    const locale = ref<DisplayLocale>("zh-CN");
    /** 跟着 `locale` 变的解析器：每次解析时才读语言，与窗口的端口一样。 */
    const liveText: TextResolver = {t: (text) => projectsTextIn(locale.value).t(text), variants: (text) => projectsTextIn(locale.value).variants(text)};
    /** 真实的命令面板宿主作为选择服务；`opened` 等它进入选择模式（流程里先要经远程服务读登记表），返回这次的请求。 */
    async function picker(): Promise<{readonly host: PaletteHost; readonly opened: (match?: (title: string) => boolean) => Promise<NonNullable<PaletteHost["pick"]["value"]>>}> {
        const host = createPaletteHost({commands: createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
            throw error;
        }})});
        return {host, opened: (match = () => true) => waitUntil("进入选择模式", () => (host.pick.value !== null && match(projectsTextIn(locale.value).t(host.pick.value.title)) ? host.pick.value : null))};
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
            text: liveText,
            recordFailure: (reason, detail) => failures.push({reason, detail}),
        });

        const registering = openProject(openHost());
        await opened();
        submit(host, {kind: "text", text: join(tmp, "dirs", "nowhere")});
        const retry = await opened((title) => title.includes("登记失败"));
        expect(projectsTextIn("zh-CN").t(retry.title)).toBe("打开项目：登记失败（路径无效或不存在）");
        // 选择开着时换成英文：同一个请求按新语言显示，标题里没有服务端给的中文说明。
        locale.value = "en-US";
        expect(projectsTextIn(locale.value).t(retry.title)).toBe("Open Project: registration failed (the path is invalid or does not exist)");
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
    it("产品的浏览器插件装配后，“打开项目”“回到书架”与“欢迎”在本窗口的命令表里（人类可见、当前可用）；“回到书架”整页导航到 /", async () => {
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "window-1"}});
        let commands: CommandService | null = null;
        const navigations: string[] = [];
        const plugins = [
            browserHostPlugins["runtime.diagnostics"]!({store, console: silentConsole}),
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
                    {id: "window.navigation", key: windowNavigationKey, create: () => ({navigateDocument: (href: string) => navigations.push(href), reloadDocument: () => undefined, openExternal: () => "opened" as const, currentUrl: () => "http://localhost/", replaceUrl: () => undefined})},
                    ...standaloneSettings("browser", tmp, {windowProject: false}).capabilities,
                ],
                plugins,
                requiredPlugins: ["runtime.diagnostics", "nbook.commands", "nbook.workbench"],
                gates: [],
            },
        );
        expect(await app.startup).toMatchObject({status: "available", failures: []});
        // 标题省略，登记时补成约定键；显示时经目录取，所以断言解析后的文字。
        const open = commands!.get("nbook.project.open");
        expect(open).toMatchObject({ok: true, value: {source: "nbook.projects"}});
        expect(open.ok && projectsTextIn("zh-CN").t(open.value.title)).toBe("打开项目");
        expect(commands!.isEnabled("nbook.project.open")).toEqual({ok: true, value: true});
        // “帮助 > 欢迎”（bookshelf.md 的“欢迎页”）：命令在命令表里，人类可见。
        const welcome = commands!.get("nbook.help.welcome");
        expect(welcome).toMatchObject({ok: true, value: {source: "nbook.projects"}});
        expect(welcome.ok && projectsTextIn("zh-CN").t(welcome.value.title)).toBe("欢迎");
        // “回到书架”（commands.md 的“命令目录（项目）”）：工作台的作品下拉、标志与文件菜单执行它。
        const shelf = commands!.get("nbook.project.back-to-shelf");
        expect(shelf).toMatchObject({ok: true, value: {source: "nbook.projects", effect: "read"}});
        expect(shelf.ok && projectsTextIn("zh-CN").t(shelf.value.title)).toBe("回到书架");
        expect(await commands!.execute("nbook.project.back-to-shelf", {}, {source: "user"})).toEqual({ok: true, value: null});
        expect(navigations).toEqual(["/"]);
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
                    id: h.project.id, name: "book", path: h.project.path, state: "stopped", title: "长夜", description: null, color: "#336699", cover: null,
                    stats: {freshness: "stale", computedAt: "2026-10-09T08:30:00.000Z", words: 1200, files: 3, unreadable: 1, today: 200, last: snapshot({words: 0, baseline: 0, date: HARNESS_TODAY}).last},
                },
                {id: second.id, name: "second", path: second.path, state: "stopped", title: null, description: null, color: null, cover: null, stats: expect.objectContaining({freshness: "stale", words: 800, today: null})},
                {id: third.id, name: "third", path: third.path, state: "stopped", title: null, description: null, color: null, cover: null, stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null}},
            ],
        });
    });

    it("运行中的作品先 counting（带上次的快照）再 fresh；宽限期里按记录为 stale；停止时写下最后一次，停止后在书架上看得到", async () => {
        const {h, projects} = await setup(async (paths) => {
            writeStats(paths.stateRoot, [{id: paths.project.id, value: snapshot({words: 50, baseline: 20, date: HARNESS_TODAY})}]);
            // 足够多的文件让书架第一次问到时首扫还没完成。
            for (let chapter = 1; chapter <= 400; chapter += 1) await writeFile(join(paths.project.path, `第${String(chapter)}章.md`), "字".repeat(1000));
        });
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{state: "running", stats: {freshness: "counting", words: 50, today: 30}}]});
        const total = 400 * 1000;
        await waitUntil("统计完成", async () => {
            const shelf = await projects.shelf({});
            return shelf.ok && shelf.value[0]?.stats.freshness === "fresh" && shelf.value[0].stats.words === total;
        });

        await writeFile(join(h.project.path, "第1章.md"), "改了");
        await waitUntil("运行中的修改", async () => {
            const shelf = await projects.shelf({});
            return shelf.ok && shelf.value[0]?.stats.words === total - 1000 + 2;
        });
        lease.release();
        // 宽限期里按记录：首扫完成时写下的那份（距那次写入不到 30 秒，运行中的修改还没写）。
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{state: "idle-grace", stats: {freshness: "stale", words: total}}]});

        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{state: "stopped", stats: {freshness: "stale", words: total - 1000 + 2, last: {address: "project://第1章.md", excerpt: "改了"}}}]});
    }, 30_000);

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
    it("create：给了父目录就在它下面新建并登记；同名为 exists；没给父目录又没设作品目录时放进缺省作品目录", async () => {
        const {h, projects} = await setup();
        const parent = join(h.root, "library");
        await mkdir(parent);

        const created = await projects.create({title: "新书", description: "简介", parent});
        expect(created).toEqual({ok: true, value: {id: expect.any(String), name: "project", path: join(parent, "新书")}});
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{name: "book"}, {name: "project", title: "新书", description: "简介", stats: {freshness: "none"}}]});
        expect(await projects.create({title: "新书", parent})).toEqual({ok: false, code: "exists", detail: {path: join(parent, "新书")}});
        expect(await projects.create({title: "  ", parent})).toMatchObject({ok: false, code: "invalid-metadata", detail: {field: "title"}});

        expect(await projects.create({title: "没处放"})).toMatchObject({ok: true, value: {path: join(h.documents, "NeuroBook", "没处放")}});
        expect(await readdir(parent)).toEqual(["新书"]);
    });

    it("create 不给父目录：用作品目录设置，不存在就建出来；作品目录不是目录为 invalid-parent（带原因与解析后的路径）", async () => {
        let library = "";
        const {h, projects} = await setup(async (paths) => {
            library = join(paths.root, "my-library");
            await mkdir(library);
            await writeFile(join(paths.stateRoot, "settings.json"), JSON.stringify({[librarySetting.key]: library}));
        });
        expect(await projects.create({title: "第二部"})).toMatchObject({ok: true, value: {path: join(library, "第二部")}});

        await rm(library, {recursive: true});
        expect(await projects.create({title: "第三部"})).toMatchObject({ok: true, value: {path: join(library, "第三部")}});
        await rm(library, {recursive: true});
        await writeFile(library, "x");
        expect(await projects.create({title: "第四部"})).toMatchObject({ok: false, code: "invalid-parent", detail: {reason: "not-directory", detail: expect.stringContaining(library)}});
        expect(await h.manager.list()).toMatchObject({ok: true, value: [{name: "book"}, {name: "project"}, {name: "project-2"}]});
    });

    it("update：只改给出的字段，null 清除；不合规带字段名；未登记的 id 为 unknown-project", async () => {
        const {h, projects} = await setup();
        expect(await projects.update({id: h.project.id, title: "书名", description: "简介"})).toEqual({ok: true, value: {id: h.project.id, title: "书名", description: "简介", color: null, cover: null}});
        expect(await projects.update({id: h.project.id, description: null, color: "#0a0b0c"})).toEqual({ok: true, value: {id: h.project.id, title: "书名", description: null, color: "#0a0b0c", cover: null}});
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

describe("Spec projects 输出 19 到 21：作品目录、列目录与封面在书架上", () => {
    it("library：没设置时是文档目录下的 NeuroBook（default）；设了就是展开 ~ 后的设置值（setting）；create 不给父目录时把缺省目录建出来", async () => {
        const {h, projects} = await setup();
        expect(await projects.library({})).toEqual({ok: true, value: {path: join(h.documents, "NeuroBook"), source: "default"}});
        expect(await projects.create({title: "第一部"})).toMatchObject({ok: true, value: {path: join(h.documents, "NeuroBook", "第一部")}});
        expect(await readdir(join(h.documents, "NeuroBook"))).toEqual(["第一部"]);

        const {projects: configured, h: h2} = await setup(async (paths) => {
            await writeFile(join(paths.stateRoot, "settings.json"), JSON.stringify({[librarySetting.key]: "~/books"}));
        });
        expect(await configured.library({})).toEqual({ok: true, value: {path: join(h2.home, "books"), source: "setting"}});
        expect(await configured.create({title: "第二部"})).toMatchObject({ok: true, value: {path: join(h2.home, "books", "第二部")}});
    });

    it("browse：列子目录并标出作品与已在书架上的；隐藏目录不列；指向目录的链接按真实路径列，悬空的不列；path 省略时是作品目录，不存在时是它的上一级；~ 展开；不存在为 invalid-parent", async () => {
        const {h, projects} = await setup(async (paths) => {
            await mkdir(join(paths.home, "books", "drafts"), {recursive: true});
            await mkdir(join(paths.home, "books", ".hidden"), {recursive: true});
            await mkdir(join(paths.home, "books", "novel", ".nbook"), {recursive: true});
            await writeFile(join(paths.home, "books", "novel", ".nbook", "project.json"), JSON.stringify({schema: 1, id: "11111111-2222-4333-8444-555555555555", title: "北方以北"}));
            await writeFile(join(paths.home, "books", "a-file.txt"), "x");
            await mkdir(join(paths.home, "elsewhere", "real-book"), {recursive: true});
            await symlink(join(paths.home, "elsewhere", "real-book"), join(paths.home, "books", "linked"));
            await symlink(join(paths.home, "nowhere"), join(paths.home, "books", "broken"));
        });
        const registered = await projects.register({path: h.project.path});
        expect(registered).toMatchObject({ok: true});
        expect(await projects.browse({path: "~/books"})).toEqual({ok: true, value: {path: join(h.home, "books"), parent: h.home, entries: [
            {name: "drafts", path: join(h.home, "books", "drafts"), kind: "directory", title: null},
            {name: "linked", path: join(h.home, "elsewhere", "real-book"), kind: "directory", title: null},
            {name: "novel", path: join(h.home, "books", "novel"), kind: "project", title: "北方以北"},
        ]}});
        expect(await projects.browse({path: h.root})).toMatchObject({ok: true, value: {entries: expect.arrayContaining([{name: "Book", path: h.project.path, kind: "registered", title: null}])}});
        // 缺省作品目录还没建：从它的上一级（文档目录）开始。
        expect(await projects.browse({})).toMatchObject({ok: true, value: {path: h.documents, parent: h.home, entries: []}});
        expect(await projects.browse({path: join(h.home, "nowhere")})).toMatchObject({ok: false, code: "invalid-parent", detail: {reason: "invalid-path"}});
    });

    it("shelf：身份文件记了封面且文件在才带 cover（version 取修改时间）；记了但文件不在按没有并记诊断", async () => {
        const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const {h, projects, store} = await setup(async (paths) => {
            await writeFile(join(paths.project.path, PROJECT_IDENTITY_FILE), JSON.stringify({schema: 1, id: paths.project.id, cover: "cover.png"}));
            await writeFile(join(paths.project.path, "cover.png"), PNG);
        });
        const shelf = await projects.shelf({});
        expect(shelf).toMatchObject({ok: true, value: [{id: h.project.id, cover: {version: expect.stringMatching(/^\d+$/)}}]});
        await rm(join(h.project.path, "cover.png"));
        expect(await projects.shelf({})).toMatchObject({ok: true, value: [{id: h.project.id, cover: null}]});
        expect(events(store)).toContain("projects.shelf.cover-missing");
    });
});

describe("Spec projects 最近打开与启动时打开：opened 与 resume 路由", () => {
    const location = (response: Response) => ({status: response.status, location: response.headers.get("location")});

    it("没有记录时进书架；opened 之后进那部作品（按登记表当前的短名），后打开的覆盖先打开的；查询串丢弃；移出书架后进书架", async () => {
        let second: {readonly id: string; readonly path: string} | null = null;
        const {h, projects, get} = await setup(async (paths) => {
            second = await registerExtra(paths, "second");
        });
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
        expect(await projects.opened({id: h.project.id})).toEqual({ok: true, value: {}});
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: `/?project=${encodeURIComponent(h.project.name)}`});
        expect(await projects.opened({id: second!.id})).toEqual({ok: true, value: {}});
        expect(location(await get(`${RESUME_PATH}?project=${h.project.name}&x=1`))).toEqual({status: 302, location: "/?project=second"});
        expect(await projects.opened({id: "00000000-0000-4000-8000-000000000000"})).toMatchObject({ok: false, code: "unknown-project"});
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/?project=second"});
        expect(await projects.unregister({id: second!.id})).toMatchObject({ok: true});
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
    });

    it("窗口绑定了作品：浏览器入口记下它，之后经路由进它；没绑定的窗口不记", async () => {
        const {h, get} = await setup();
        const navigations: string[] = [];
        const palette = () => createPaletteHost({commands: createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
            throw error;
        }})});
        await commandWindow(h, palette(), navigations);
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
        await commandWindow(h, palette(), navigations, {id: h.project.id, name: h.project.name, title: h.project.name, generation: 1});
        expect(await waitUntil("记下了上次的作品", async () => ((await get(RESUME_PATH)).headers.get("location") === `/?project=${encodeURIComponent(h.project.name)}` ? true : undefined))).toBe(true);
    });

    it("设置为书架：有记录也进书架", async () => {
        const {h, projects, get} = await setup(async (paths) => {
            await writeFile(join(paths.stateRoot, "settings.json"), JSON.stringify({[startupOpenSetting.key]: "shelf"}));
        });
        expect(await projects.opened({id: h.project.id})).toEqual({ok: true, value: {}});
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
    });

    it("记录坏了：resume 进书架并记诊断；opened 覆盖坏记录，之后照常", async () => {
        const {h, projects, store, get} = await setup(async (paths) => {
            // 别的版本写下的记录：本插件读到 unsupported-version。
            const partition = createPartition({path: join(paths.stateRoot, "storage", "user.sqlite")});
            try {
                const newer = {...LAST_OPENED_RECORD.descriptor, version: 2};
                const registered = partition.register(descriptor.id, newer);
                if (!registered.ok) throw new Error(registered.detail);
                const written = partition.write({owner: descriptor.id, key: LAST_OPENED_RECORD.key, resource: "", client: ""}, newer, {kind: "save", value: {id: "x"}, expect: null});
                if (!written.ok) throw new Error(written.detail);
            } finally {
                partition.close();
            }
        });
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
        expect(events(store)).toContain("projects.resume-failed");
        expect(await projects.opened({id: h.project.id})).toEqual({ok: true, value: {}});
        expect(events(store)).toContain("projects.last-opened.record-damaged");
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: `/?project=${encodeURIComponent(h.project.name)}`});
    });

    it("登记表坏了：resume 进书架，opened 为 registry-invalid", async () => {
        const {h, projects, get} = await setup();
        expect(await projects.opened({id: h.project.id})).toEqual({ok: true, value: {}});
        await writeFile(join(h.stateRoot, "projects.json"), "{");
        expect(location(await get(RESUME_PATH))).toEqual({status: 302, location: "/"});
        expect(await projects.opened({id: h.project.id})).toMatchObject({ok: false, code: "registry-invalid"});
    });
});
