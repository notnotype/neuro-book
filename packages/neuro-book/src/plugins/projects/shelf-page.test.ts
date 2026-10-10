/**
 * 书架页的模型（docs/specs/workbench/bookshelf.md 输出 9–17 与“状态与转换”）：真实的服务端与浏览器内核实例经进程内链路
 * 相连，书架的远程服务由服务端上一个按合同实现的测试提供方给出（可以按用例让它失败或扣住响应；产品的服务端实现由
 * `projects.test.ts` 与 e2e 验收）。选择服务用真实的命令面板宿主，刷新间隔用注入时钟。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {ref} from "vue";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt, delegatingPlugins} from "nbook/manifest";
import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {createPaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import type {PaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import {projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingsService} from "nbook/shared/settings";
import {browserHostPlugins} from "nbook/web/plugins";

import {descriptor as projectsDescriptor} from "./plugin";
import {librarySetting, projectsRemoteContract} from "./shared/contracts";
import type {ShelfItem} from "./shared/shelf";
import type {ShelfSort} from "./web/shelf-format";
import {continueUrl, createShelfPage, SHELF_REFRESH_MS} from "./web/shelf-page";
import type {ShelfPage} from "./web/shelf-page";
import type {ShelfView} from "./web/shelf-preferences";

const silentConsole = {error: () => undefined};

let tmp = "";
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "shelf-page");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function item(id: string, title: string, extra: Partial<ShelfItem> = {}): ShelfItem {
    return {
        id, name: id, title, description: null, color: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
        ...extra,
    };
}

/** 测试提供方的脚本：每次 `shelf` 调用先取当时的作品快照，再按 `holds` 等放行，所以能制造“先发的响应后到”。 */
interface Script {
    items: ShelfItem[];
    failShelf: "registry-invalid" | null;
    /** 为真时每次 `shelf` 调用登记一个待放行的 Promise。 */
    holding: boolean;
    holds: PromiseWithResolvers<void>[];
    shelfCalls: number;
    running: Set<string>;
}

function shelfProvider(script: Script): PluginDefinition {
    let counter = 0;
    const fresh = (title: string, path: string): ShelfItem => {
        counter += 1;
        return item(`new-${String(counter)}`, title, {path});
    };
    return {
        id: "test.shelf",
        entries: [{
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            remoteProvides: [projectsRemoteContract],
            activate: () => ({remote: [provideRemote(projectsRemoteContract, () => ({
                methods: {
                    list: async () => ({ok: true, value: script.items.map(({id, name, path, state}) => ({id, name, path, state, generation: null}))}),
                    register: async ({path}) => {
                        if (path.includes("nowhere")) return {ok: false as const, code: "register-failed" as const, detail: {reason: "invalid-path", detail: `目录不存在：${path}`}};
                        const created = fresh(path.split("/").pop() ?? path, path);
                        script.items = [...script.items, created];
                        return {ok: true, value: {id: created.id, name: created.name, path}};
                    },
                    shelf: async () => {
                        script.shelfCalls += 1;
                        const snapshot = [...script.items];
                        if (script.holding) {
                            const hold = Promise.withResolvers<void>();
                            script.holds.push(hold);
                            await hold.promise;
                        }
                        if (script.failShelf !== null) return {ok: false as const, code: script.failShelf, detail: {detail: "登记表坏了"}};
                        return {ok: true as const, value: snapshot};
                    },
                    create: async ({title, parent}) => {
                        if (title === "重名") return {ok: false as const, code: "exists" as const, detail: {path: `${parent}/重名`}};
                        const created = fresh(title, `${parent}/${title}`);
                        script.items = [...script.items, created];
                        return {ok: true, value: {id: created.id, name: created.name, path: created.path}};
                    },
                    update: async ({id, title, description, color}) => {
                        const current = script.items.find((entry) => entry.id === id);
                        if (current === undefined) return {ok: false as const, code: "unknown-project" as const, detail: {detail: id}};
                        if (title === "") return {ok: false as const, code: "invalid-metadata" as const, detail: {field: "title", detail: "不能为空"}};
                        const next = {...current, title: title === undefined ? current.title : title, description: description === undefined ? current.description : description, color: color === undefined ? current.color : color};
                        script.items = script.items.map((entry) => (entry.id === id ? next : entry));
                        return {ok: true, value: {id, title: next.title, description: next.description, color: next.color}};
                    },
                    unregister: async ({id}) => {
                        if (script.running.has(id)) return {ok: false as const, code: "project-running" as const, detail: {state: "running" as const}};
                        const current = script.items.find((entry) => entry.id === id);
                        if (current === undefined) return {ok: false as const, code: "unknown-project" as const, detail: {detail: id}};
                        script.items = script.items.filter((entry) => entry.id !== id);
                        return {ok: true, value: {id, name: current.name}};
                    },
                },
            }))]}),
        }],
    };
}

interface World {
    readonly h: ProjectHarness;
    readonly script: Script;
    readonly clock: ManualClock;
    readonly remote: RemoteUse<typeof projectsRemoteContract>;
    readonly settings: SettingsService;
    readonly palette: PaletteHost;
    readonly navigations: string[];
    readonly reports: string[];
    readonly view: ReturnType<typeof ref<ShelfView>>;
    readonly sort: ReturnType<typeof ref<ShelfSort>>;
    popup: "opened" | "blocked";
    page(): ShelfPage;
    /** 同一条链路上的往返：它回来时，之前发出的 `shelf` 请求都已到达提供方。 */
    barrier(): Promise<void>;
}

async function world(initial: ShelfItem[], options: {readonly failShelf?: Script["failShelf"]} = {}): Promise<World> {
    const script: Script = {items: initial, failShelf: options.failShelf ?? null, holding: false, holds: [], shelfCalls: 0, running: new Set()};
    const silent = {error: () => undefined};
    const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    // 服务端另装配置后端（作品目录设置写在用户层；时钟由 harness 提供）；`nbook.projects` 的声明式贡献让两端都认识这项设置。
    const h = await projectHarness(tmp, {plugins: [diagnostics, shelfProvider(script), ...standaloneSettings("server", tmp).plugins, definitionAt("server", projectsDescriptor, {id: projectsDescriptor.id, entries: []})]});

    let captured: {remote: ActivationContext["remote"]; settings: SettingsService} | null = null;
    const standalone = standaloneSettings("browser", tmp);
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "browser-shelf"}});
    const node = createRemoteNode({instance: {id: "browser-shelf", kind: "browser", role: "client", project: null, client: "profile-shelf"}});
    const app: Application = createApplication(
        {identity: {location: "browser", instanceId: "browser-shelf"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [...standalone.capabilities],
            // 读出配置服务与远程上下文的入口顶着 `nbook.projects` 的身份：配置只让声明它的插件写。
            plugins: [browserHostPlugins["nbook.diagnostics"]!({store, console: silentConsole}), statePlugin, ...standalone.plugins, definitionAt("browser", projectsDescriptor, {
                id: projectsDescriptor.id,
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: settingsKey}], activate: (context) => {
                    captured = {remote: context.remote, settings: context.services.require(settingsKey)};
                    return {};
                }}],
            })],
            gates: [],
            remote: node,
            // 配置的写入经代理（浏览器核心替调用方写用户层），与产品窗口相同的允许清单。
            delegation: (plugin) => delegatingPlugins.includes(plugin),
        },
    );
    const pair = createLinkPair();
    h.router.accept(pair.right);
    expect(await node.connect(pair.left)).toEqual({ok: true});
    expect(await app.startup).toMatchObject({status: "available", failures: []});
    closers.push(async () => {
        await app.stop();
        await h.parent.stop();
    });

    const locale = ref<DisplayLocale>("zh-CN");
    const palette = createPaletteHost({locale, commands: createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
        throw error;
    }})});
    const clock = new ManualClock();
    const navigations: string[] = [];
    const reports: string[] = [];
    const view = ref<ShelfView>("spines");
    const sort = ref<ShelfSort>("title");
    const remote = captured!.remote.use(projectsRemoteContract);
    const result: World = {
        h, script, clock, remote, settings: captured!.settings, palette, navigations, reports, view, sort,
        popup: "opened",
        page: () => {
            const page = createShelfPage({
                remote,
                clock,
                locale: () => locale.value,
                preferences: {view, sort, setView: (next) => {
                    view.value = next;
                }, setSort: (next) => {
                    sort.value = next;
                }},
                settings: captured!.settings,
                quickPick: {pick: (request) => palette.openPick(request)},
                navigation: {navigateDocument: (href) => navigations.push(href), reloadDocument: () => undefined, openExternal: () => result.popup},
                report: (event, message) => reports.push(`${event}: ${message}`),
            });
            closers.push(async () => page.dispose());
            return page;
        },
        barrier: async () => {
            expect((await remote.list({})).ok).toBe(true);
        },
    };
    return result;
}

const ready = (page: ShelfPage) => waitUntil("书架就绪", () => page.status.value === "ready");

describe("Spec bookshelf 取数与刷新", () => {
    it("可见时取数并每 30 秒刷新；隐藏时停止；窗口焦点刷新一次；在途时合并", async () => {
        const w = await world([item("a", "甲"), item("b", "乙")]);
        const page = w.page();
        expect(page.status.value).toBe("loading");
        page.setVisible(true);
        await ready(page);
        expect(page.items.value.map((entry) => entry.title)).toEqual(["甲", "乙"]);
        expect(page.now.value).toBe(new Date(0).toISOString());
        expect(w.script.shelfCalls).toBe(1);

        w.clock.advance(SHELF_REFRESH_MS - 1);
        await w.barrier();
        expect(w.script.shelfCalls).toBe(1);
        w.clock.advance(1);
        await waitUntil("定时刷新", () => w.script.shelfCalls === 2);

        page.setVisible(false);
        w.clock.advance(SHELF_REFRESH_MS * 2);
        await w.barrier();
        expect(w.script.shelfCalls).toBe(2);
        page.focused();
        await w.barrier();
        expect(w.script.shelfCalls).toBe(2);

        // 扣住响应：期间的两次焦点只算在途的那一次。
        w.script.holding = true;
        page.setVisible(true);
        await waitUntil("请求到达", () => w.script.holds.length === 1);
        page.focused();
        page.focused();
        await w.barrier();
        expect(w.script.shelfCalls).toBe(3);
        w.script.holding = false;
        w.script.holds[0]!.resolve();
        await waitUntil("响应回来", () => w.script.shelfCalls === 3 && page.now.value !== new Date(0).toISOString());
    });

    it("强制刷新作废在途的响应：先发的响应后到也不覆盖新数据", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.holding = true;
        void page.refresh();
        await waitUntil("第一次请求到达", () => w.script.holds.length === 1);
        w.script.items = [item("a", "甲"), item("b", "乙")];
        void page.refresh(true);
        await waitUntil("第二次请求到达", () => w.script.holds.length === 2);
        w.script.holding = false;
        w.script.holds[1]!.resolve();
        await waitUntil("新数据", () => page.items.value.length === 2);
        w.script.holds[0]!.resolve();
        await w.barrier();
        expect(page.items.value.length).toBe(2);
    });

    it("刷新失败保留数据并提示（带重试）；重试成功后提示消失；首次取数失败为整页出错", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.failShelf = "registry-invalid";
        await page.refresh(true);
        expect(page.status.value).toBe("ready");
        expect(page.items.value.length).toBe(1);
        expect(page.notice.value).toEqual({kind: "refresh", text: "书架没有更新：registry-invalid：登记表坏了", retry: true});
        expect(w.reports).toEqual(["projects.shelf-failed: 取书架失败：registry-invalid"]);
        w.script.failShelf = null;
        await page.refresh(true);
        expect(page.notice.value).toBeNull();

        const broken = await world([], {failShelf: "registry-invalid"});
        const first = broken.page();
        first.setVisible(true);
        await waitUntil("整页出错", () => first.status.value === "error");
        expect(first.error.value).toBe("书架没取到：registry-invalid：登记表坏了");
    });

    it("卸载后在途的响应不改变状态", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        w.script.holding = true;
        page.setVisible(true);
        await waitUntil("请求到达", () => w.script.holds.length === 1);
        page.dispose();
        w.script.holds[0]!.resolve();
        await w.barrier();
        expect(page.status.value).toBe("loading");
    });
});

describe("Spec bookshelf 动作", () => {
    it("打开、在新窗口打开（被拦截时提示）、继续写作与进入工作台", async () => {
        const w = await world([item("a", "甲", {stats: {freshness: "stale", computedAt: "2026-10-10T00:00:00.000Z", words: 10, files: 1, unreadable: 0, today: null, last: {address: "project://第一章.md", label: "第一章", at: "2026-10-10T00:00:00.000Z", excerpt: "……"}}}), item("b", "乙")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        page.open("b");
        page.continueWriting("a");
        page.continueWriting("b");
        page.enterWorkbench();
        expect(w.navigations).toEqual(["/?project=b", continueUrl("a", "project://第一章.md"), "/?project=b", "/workbench"]);
        expect(continueUrl("a", "project://第一章.md")).toBe("/?project=a&open=project%3A%2F%2F%E7%AC%AC%E4%B8%80%E7%AB%A0.md&at=end");
        page.openInNewWindow("a");
        expect(page.notice.value).toBeNull();
        w.popup = "blocked";
        page.openInNewWindow("a");
        expect(page.notice.value).toMatchObject({kind: "popup", retry: false});
        page.dismissNotice();
        expect(page.notice.value).toBeNull();
    });

    it("移出书架：成功后选中相邻的一部；正在打开的被拒并说明", async () => {
        const w = await world([item("a", "Alpha"), item("b", "Beta"), item("c", "Gamma")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        page.select("b");
        expect(await page.remove("b")).toEqual({ok: true});
        expect(page.items.value.map((entry) => entry.id)).toEqual(["a", "c"]);
        // 按书名排序，Beta 的下一部是 Gamma；Gamma 是末尾，移出后回到上一部 Alpha。
        expect(page.activeId.value).toBe("c");
        expect(await page.remove("c")).toEqual({ok: true});
        expect(page.activeId.value).toBe("a");

        w.script.running.add("a");
        const refused = await page.remove("a");
        expect(refused).toMatchObject({ok: false, message: expect.stringContaining("正在打开")});
        expect(page.items.value.map((entry) => entry.id)).toEqual(["a"]);
    });

    it("新建：没设作品目录时先经选择服务选目录，成功后记住；同名目录已存在时带原因；修改信息后书架随之更新", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        expect(w.settings.get(librarySetting)).toBe("");

        // 没设作品目录：先问目录；取消就不新建。
        const cancelled = page.createTarget();
        const asked = await waitUntil("进入选择模式", () => w.palette.pick.value);
        expect(asked.items).toEqual([]);
        w.palette.closePalette();
        w.palette.closed();
        expect(await cancelled).toBeNull();

        const choosing = page.createTarget();
        const request = await waitUntil("再次进入选择模式", () => (w.palette.pick.value !== null && w.palette.pick.value !== asked ? w.palette.pick.value : null));
        w.palette.choosePick({kind: "text", text: "/home/writer/books"});
        w.palette.closed();
        const target = await choosing;
        expect(target).toEqual({parent: "/home/writer/books", remember: true});
        expect(request.title).toEqual(asked.title);

        expect(await page.create({title: "重名", description: "", color: null}, target!)).toMatchObject({ok: false, message: expect.stringContaining("同名目录已存在")});
        expect(await page.create({title: "新书", description: "一句话", color: null}, target!)).toEqual({ok: true});
        expect(page.items.value.map((entry) => entry.title)).toEqual(["甲", "新书"]);
        expect(page.activeId.value).toBe(page.items.value[1]!.id);
        expect(w.reports).toEqual([]);
        expect(page.notice.value).toBeNull();
        await waitUntil("作品目录记住", () => w.settings.get(librarySetting) === "/home/writer/books");
        expect(await page.createTarget()).toEqual({parent: "/home/writer/books", remember: false});

        expect(await page.update("a", {title: "甲二", description: "改过", color: "#7a4b3a"})).toEqual({ok: true});
        expect(page.items.value[0]).toMatchObject({title: "甲二", description: "改过", color: "#7a4b3a"});
        expect(await page.update("a", {title: "", description: "", color: null})).toEqual({ok: false, message: "书名不合规：不能为空"});
    });

    it("加入已有目录：登记失败带着原因重新打开输入；成功后出现在书架上并被选中", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        const adding = page.addExisting();
        const first = await waitUntil("进入输入", () => w.palette.pick.value);
        expect(first.items).toEqual([]);
        w.palette.choosePick({kind: "text", text: "/nowhere"});
        w.palette.closed();
        const retry = await waitUntil("带原因重开", () => (w.palette.pick.value !== null && w.palette.pick.value !== first ? w.palette.pick.value : null));
        expect(retry.title).toMatchObject({"zh-CN": "加入已有目录：登记失败（路径无效或不存在）"});
        w.palette.choosePick({kind: "text", text: "/home/writer/books/Old"});
        w.palette.closed();
        await adding;
        expect(page.items.value.map((entry) => entry.title)).toEqual(["甲", "Old"]);
        expect(page.activeId.value).toBe(page.items.value[1]!.id);
    });
});
