/**
 * 书架页的模型（docs/specs/workbench/bookshelf.md 输出 9 到 17 与状态表）：真实的服务端实例与浏览器实例经进程内链路相连，
 * `nbook.projects/projects` 由一个按剧本回答的提供方顶替（书架页只看合同，服务端那头的真实实现在 projects.test.ts）；
 * 配置经真实的配置插件（用户层写在场地的状态根）；通知经真实的工作台通知队列；时钟注入，不按时长等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteUse} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {ref} from "vue";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {createNotifications} from "nbook/plugins/workbench/web/notifications";
import type {WindowNotifications} from "nbook/plugins/workbench/web/notifications";
import {projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import type {SettingsService} from "nbook/shared/settings";
import type {WindowText} from "nbook/shared/window-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";
import {browserHostPlugins} from "nbook/web/plugins";

import {descriptor as projectsDescriptor} from "./plugin";
import {librarySetting, projectsRemoteContract} from "./shared/contracts";
import {projectDirectoryName} from "./shared/directory-name";
import type {ShelfItem} from "./shared/shelf";
import {continueUrl, createShelfPage, SHELF_REFRESH_MS} from "./web/shelf-page";
import type {ShelfPage} from "./web/shelf-page";
import type {ShelfSort} from "./web/shelf-format";
import {projectsCatalogs} from "./web/text";
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
        id, name: id, title, description: null, color: null, cover: null, path: `/books/${id}`, state: "stopped",
        stats: {freshness: "none", computedAt: null, words: 0, files: 0, unreadable: 0, today: null, last: null},
        ...extra,
    };
}

/** 剧本：提供方按它回答；用例改它来制造失败、扣住响应、延迟写入。 */
interface Script {
    items: ShelfItem[];
    failShelf: "registry-invalid" | null;
    /** 为真时 `shelf` 扣住不回，直到对应的 hold 被 resolve。 */
    holding: boolean;
    holds: Array<PromiseWithResolvers<void>>;
    shelfCalls: number;
    /** `library()` 给出的作品目录（缺省来源）。 */
    library: string;
    /** 正在打开的作品：移出被拒。 */
    running: Set<string>;
    /**
     * 写操作的做法：null 立即做并回复；`after` 立即做、回复扣住到放行；`instead` 做与回复都扣住到放行。
     * 两种扣住都让页面等到超时得到 unknown-outcome，核对时一种能发现已做、一种发现没做。
     */
    delayWrite: null | "after" | "instead";
    writeHolds: Array<PromiseWithResolvers<void>>;
}

let fresh = 0;

/** 一个按剧本回答 `nbook.projects/projects` 的服务端插件。 */
function shelfProvider(script: Script): PluginDefinition {
    const newItem = (title: string, path: string): ShelfItem => {
        fresh += 1;
        return item(`new-${String(fresh)}`, title, {path});
    };
    const write = async <T>(apply: () => T): Promise<T> => {
        if (script.delayWrite === null) return apply();
        // after：做了但回复扣住（页面超时后核对能发现已做）；instead：回复与做都扣住（核对发现没做）。
        const done = script.delayWrite === "after" ? {value: apply()} : null;
        const hold = Promise.withResolvers<void>();
        script.writeHolds.push(hold);
        await hold.promise;
        return done === null ? apply() : done.value;
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
                    register: ({path}) => write(() => {
                        if (path.includes("nowhere")) return {ok: false as const, code: "register-failed" as const, detail: {reason: "invalid-path", detail: `目录不存在：${path}`}};
                        const created = newItem(path.split("/").filter((part) => part !== "").pop() ?? path, path);
                        script.items = [...script.items, created];
                        return {ok: true as const, value: {id: created.id, name: created.name, path}};
                    }),
                    library: async () => ({ok: true as const, value: {path: script.library, source: "default" as const}}),
                    revealLibrary: async () => ({ok: true as const, value: {}}),
                    browse: async ({path}) => ({ok: true as const, value: {path: path ?? script.library, parent: null, entries: [{name: "sub", path: `${path ?? script.library}/sub`, kind: "directory" as const, title: null}]}}),
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
                    create: ({title, parent}) => write(() => {
                        if (title === "重名") return {ok: false as const, code: "exists" as const, detail: {path: `${parent ?? ""}/重名`}};
                        // 与服务端一样：父目录加由书名生成的目录名。
                        const created = newItem(title, `${(parent ?? script.library).replace(/\/+$/u, "")}/${projectDirectoryName(title)}`);
                        script.items = [...script.items, created];
                        return {ok: true as const, value: {id: created.id, name: created.name, path: created.path}};
                    }),
                    update: ({id, title, description, color}) => write(() => {
                        const current = script.items.find((entry) => entry.id === id);
                        if (current === undefined) return {ok: false as const, code: "unknown-project" as const, detail: {detail: id}};
                        if (title === "") return {ok: false as const, code: "invalid-metadata" as const, detail: {field: "title", detail: "不能为空"}};
                        const next = {...current, title: title === undefined ? current.title : title, description: description === undefined ? current.description : description, color: color === undefined ? current.color : color};
                        script.items = script.items.map((entry) => (entry.id === id ? next : entry));
                        return {ok: true as const, value: {id, title: next.title, description: next.description, color: next.color, cover: null}};
                    }),
                    // 书架页不记“上次的作品”（窗口绑定了作品才记，见 web/plugin.ts）。
                    opened: () => Promise.resolve({ok: true as const, value: {}}),
                    unregister: ({id}) => write(() => {
                        if (script.running.has(id)) return {ok: false as const, code: "project-running" as const, detail: {state: "running" as const}};
                        const current = script.items.find((entry) => entry.id === id);
                        if (current === undefined) return {ok: false as const, code: "unknown-project" as const, detail: {detail: id}};
                        script.items = script.items.filter((entry) => entry.id !== id);
                        return {ok: true as const, value: {id, name: current.name}};
                    }),
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
    readonly notifications: WindowNotifications;
    /** 页面与通知共用的翻译引擎（严格模式）：切换语言看已发出的通知换不换文字。 */
    readonly text: WindowText;
    readonly navigations: string[];
    readonly reports: string[];
    readonly covers: Array<{readonly id: string; readonly name: string | null}>;
    readonly commands: string[];
    readonly view: ReturnType<typeof ref<ShelfView>>;
    readonly sort: ReturnType<typeof ref<ShelfSort>>;
    popup: "opened" | "blocked";
    coverFails: boolean;
    page(): ShelfPage;
    /** 同一条链路上的往返：它回来时，之前发出的 `shelf` 请求都已到达提供方。 */
    barrier(): Promise<void>;
    /** 当前通知的标题（没有标题时正文）。 */
    notices(): string[];
}

/** 测试里写操作加的超时：到时内核把已派发的写请求判为 unknown-outcome（docs/specs/runtime/plugin-channel.md）。 */
const WRITE_TIMEOUT_MS = 1_000;
const WRITE_METHODS = new Set(["register", "create", "update", "unregister"]);

/**
 * `writeTimeout` 为真时：浏览器内核用场地的手动时钟，页面发出的写操作带超时，推进时钟就得到 unknown-outcome；
 * 服务端那边的提供方按 `delayWrite` 决定做没做。
 */
async function world(initial: ShelfItem[], options: {readonly failShelf?: Script["failShelf"]; readonly writeTimeout?: boolean} = {}): Promise<World> {
    const script: Script = {items: initial, failShelf: options.failShelf ?? null, holding: false, holds: [], shelfCalls: 0, library: "/books", running: new Set(), delayWrite: null, writeHolds: []};
    const clock = new ManualClock();
    const silent = {error: () => undefined};
    const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    // 服务端另装配置后端（作品目录设置写在用户层；时钟由 harness 提供）；`nbook.projects` 的声明式贡献让两端都认识这项设置。
    const h = await projectHarness(tmp, {plugins: [diagnostics, shelfProvider(script), ...standaloneSettings("server", tmp).plugins, definitionAt("server", projectsDescriptor, {id: projectsDescriptor.id, entries: []})]});

    let captured: {remote: ActivationContext["remote"]; settings: SettingsService} | null = null;
    const standalone = standaloneSettings("browser", tmp);
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "browser-shelf"}});
    const node = createRemoteNode({instance: {id: "browser-shelf", kind: "browser", role: "client", project: null, client: "profile-shelf"}, ...(options.writeTimeout === true ? {clock} : {})});
    const app: Application = createApplication(
        {identity: {location: "browser", instanceId: "browser-shelf"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [...standalone.capabilities],
            // 读出配置服务与远程上下文的入口顶着 `nbook.projects` 的身份：配置只让声明它的插件写。
            plugins: [browserHostPlugins["runtime.diagnostics"]!({store, console: silentConsole}), statePlugin, ...standalone.plugins, definitionAt("browser", projectsDescriptor, {
                id: projectsDescriptor.id,
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: settingsKey}], activate: (context) => {
                    captured = {remote: context.remote, settings: context.services.require(settingsKey)};
                    return {};
                }}],
            })],
            gates: [],
            remote: node,
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

    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    engine.register("nbook.projects", projectsCatalogs.catalogs, projectsCatalogs.source);
    const text = engine.port;
    const reports: string[] = [];
    const notifications = createNotifications((message) => reports.push(message), text);
    closers.push(async () => notifications.dispose());
    const navigations: string[] = [];
    const covers: Array<{readonly id: string; readonly name: string | null}> = [];
    const commands: string[] = [];
    const view = ref<ShelfView>("cards");
    const sort = ref<ShelfSort>("title");
    const remote = captured!.remote.use(projectsRemoteContract);
    const timed = options.writeTimeout !== true ? remote : new Proxy(remote, {
        get: (target, name, receiver) => {
            const member = Reflect.get(target, name, receiver) as unknown;
            if (!WRITE_METHODS.has(String(name)) || typeof member !== "function") return member;
            return (input: unknown) => (member as (input: unknown, options: {readonly timeout: number}) => unknown).call(target, input, {timeout: WRITE_TIMEOUT_MS});
        },
    });
    const result: World = {
        h, script, clock, remote, settings: captured!.settings, notifications, text: engine, navigations, reports, covers, commands, view, sort,
        popup: "opened",
        coverFails: false,
        page: () => {
            const page = createShelfPage({
                remote: timed,
                clock,
                text,
                preferences: {view, sort, setView: (next) => {
                    view.value = next;
                }, setSort: (next) => {
                    sort.value = next;
                }},
                settings: captured!.settings,
                navigation: {navigateDocument: (href) => navigations.push(href), reloadDocument: () => undefined, openExternal: () => result.popup, currentUrl: () => "http://localhost/", replaceUrl: () => undefined},
                notifications,
                cover: {
                    upload: async (id, file) => {
                        if (result.coverFails) return {ok: false, code: "too-large", detail: "封面至多 5 MB"};
                        covers.push({id, name: file.name});
                        return {ok: true};
                    },
                    remove: async (id) => {
                        covers.push({id, name: null});
                        return {ok: true};
                    },
                },
                commands: {execute: async (id) => {
                    commands.push(id);
                    return id === "nbook.settings.switch-theme" ? {ok: true} : {ok: false, reason: "unknown-command"};
                }},
                report: (event, message) => reports.push(`${event}: ${message}`),
            });
            closers.push(async () => page.dispose());
            return page;
        },
        barrier: async () => {
            expect((await remote.list({})).ok).toBe(true);
        },
        // 队列里是文字值，通知栈显示时才翻（docs/specs/workbench/notifications.md 输出 9）；这里按同一个端口翻。
        notices: () => notifications.queue.notifications.value.map((notice) => text.t(notice.title ?? notice.message)),
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

    it("强制刷新碰上在途请求：不并发，作废它的响应、等它结束再发一次；期间再来的强制刷新并进这一次", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.holding = true;
        void page.refresh();
        await waitUntil("第一次请求到达", () => w.script.holds.length === 1);
        w.script.items = [item("a", "甲"), item("b", "乙")];
        const forced = page.refresh(true);
        expect(page.refresh(true)).toBe(forced);
        await w.barrier();
        // 同一时间至多一个请求在途：第二次要等第一次结束。
        expect(w.script.holds.length).toBe(1);
        expect(w.script.shelfCalls).toBe(2);
        w.clock.advance(1);
        w.script.holds[0]!.resolve();
        await waitUntil("第二次请求到达", () => w.script.holds.length === 2);
        // 第一次的响应已作废：数据与取数时刻都没变。
        expect(page.items.value.length).toBe(1);
        expect(page.now.value).toBe(new Date(0).toISOString());
        w.script.holding = false;
        w.script.holds[1]!.resolve();
        await forced;
        expect(page.items.value.length).toBe(2);
        expect(page.now.value).toBe(new Date(1).toISOString());
        expect(w.script.shelfCalls).toBe(3);
    });

    it("刷新失败保留数据并发常驻通知（带重试）；重试成功后通知收回；首次取数失败为整页出错", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.failShelf = "registry-invalid";
        await page.refresh(true);
        expect(page.status.value).toBe("ready");
        expect(page.items.value.length).toBe(1);
        expect(w.notifications.queue.notifications.value).toMatchObject([{duration: 0}]);
        const shown = () => w.notifications.queue.notifications.value.map((notice) => ({id: notice.id, title: w.text.port.t(notice.title ?? ""), message: w.text.port.t(notice.message), action: w.text.port.t(notice.action?.label ?? "")}));
        expect(shown()).toEqual([{id: expect.any(String), title: "书架没有更新", message: "取不到作品列表：registry-invalid：登记表坏了。显示的是上次的数据。", action: "重试"}]);
        // 通知交的是文字引用：切换语言后已显示的这一条换成英文，还是同一条；代入的原因是发通知时翻好的片段，不跟着换。
        const [before] = shown();
        w.text.setLocale("en-US");
        expect(shown()).toEqual([{id: before!.id, title: "The shelf was not refreshed", message: "Could not fetch the books: registry-invalid：登记表坏了. Showing the last data.", action: "Retry"}]);
        w.text.setLocale("zh-CN");
        expect(w.reports).toEqual(["projects.shelf-failed: 取书架失败：registry-invalid"]);
        // 再失败一次只换内容，不堆第二条。
        await page.refresh(true);
        expect(w.notices()).toEqual(["书架没有更新"]);
        w.script.failShelf = null;
        w.notifications.queue.notifications.value[0]!.action!.run();
        await waitUntil("通知收回", () => w.notices().length === 0);

        const broken = await world([], {failShelf: "registry-invalid"});
        const first = broken.page();
        first.setVisible(true);
        await waitUntil("整页出错", () => first.status.value === "error");
        expect(first.error.value).toBe("书架没取到：registry-invalid：登记表坏了");
        expect(broken.notices()).toEqual([]);
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
    it("打开、在新窗口打开（被拦截时通知）、继续写作；设置菜单的命令失败时通知", async () => {
        const w = await world([item("a", "甲", {stats: {freshness: "stale", computedAt: "2026-10-10T00:00:00.000Z", words: 10, files: 1, unreadable: 0, today: null, last: {address: "project://第一章.md", label: "第一章", at: "2026-10-10T00:00:00.000Z", excerpt: "……"}}}), item("b", "乙")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        page.open("b");
        page.continueWriting("a");
        page.continueWriting("b");
        expect(w.navigations).toEqual(["/?project=b", continueUrl("a", "project://第一章.md"), "/?project=b"]);
        expect(continueUrl("a", "project://第一章.md")).toBe("/?project=a&open=project%3A%2F%2F%E7%AC%AC%E4%B8%80%E7%AB%A0.md&at=end");
        page.openInNewWindow("a");
        expect(w.notices()).toEqual([]);
        w.popup = "blocked";
        page.openInNewWindow("a");
        expect(w.notices()).toEqual(["新标签页被拦截"]);

        await page.runCommand("nbook.settings.switch-theme");
        await page.runCommand("nbook.settings.nope");
        expect(w.commands).toEqual(["nbook.settings.switch-theme", "nbook.settings.nope"]);
        expect(w.notices().at(-1)).toContain("没有执行");
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

    it("作品目录与列目录经远程服务；新建在给定目录下，同名目录带字段名交回，成功后记住目录；修改信息后书架随之更新", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        expect(await page.library()).toEqual({path: "/books", source: "default"});
        expect(await page.browse(null)).toMatchObject({ok: true, value: {path: "/books", entries: [{name: "sub"}]}});
        // 作品目录没读到、位置框清空时宿主给的是空串：按省略处理，不发违反合同的空路径。
        expect(await page.browse("  ")).toMatchObject({ok: true, value: {path: "/books"}});
        expect(await page.browse("/home/writer")).toMatchObject({ok: true, value: {path: "/home/writer"}});

        expect(await page.create({title: "重名", description: "", color: null}, "/home/writer/books")).toMatchObject({ok: false, field: "title", message: expect.stringContaining("同名目录已存在")});
        const created = await page.create({title: "新书", description: "一句话", color: "#7a4b3a"}, "/home/writer/books");
        expect(created).toMatchObject({ok: true, id: expect.any(String)});
        expect(page.items.value.map((entry) => entry.title)).toEqual(["甲", "新书"]);
        expect(page.items.value[1]).toMatchObject({path: "/home/writer/books/新书", color: "#7a4b3a"});
        expect(page.activeId.value).toBe(page.items.value[1]!.id);
        expect(w.reports).toEqual([]);
        expect(w.notices()).toEqual([]);

        expect(w.settings.get(librarySetting)).toBe("");
        expect(await page.rememberLibrary("/home/writer/books")).toBe(true);
        await waitUntil("作品目录记住", () => w.settings.get(librarySetting) === "/home/writer/books");

        expect(await page.update("a", {title: "甲二", description: "改过", color: "#7a4b3a"})).toEqual({ok: true, id: "a"});
        expect(page.items.value[0]).toMatchObject({title: "甲二", description: "改过", color: "#7a4b3a"});
        expect(await page.update("a", {title: "", description: "", color: null})).toEqual({ok: false, field: "title", message: "书名不合规：不能为空"});
    });

    it("打开已有作品：登记失败的原因交回给选择器；成功后出现在书架上并被选中", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        expect(await page.addExisting("/nowhere")).toEqual({ok: false, message: "没有加入书架：路径无效或不存在"});
        expect(w.reports).toEqual(["projects.register-failed: 登记失败：invalid-path：目录不存在：/nowhere"]);
        expect(await page.addExisting("/home/writer/books/Old")).toEqual({ok: true});
        expect(page.items.value.map((entry) => entry.title)).toEqual(["甲", "Old"]);
        expect(page.activeId.value).toBe(page.items.value[1]!.id);
    });

    it("封面：上传与移除经封面传输，成功后刷新；失败发通知", async () => {
        const w = await world([item("a", "甲")]);
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        expect(await page.setCover("a", {kind: "keep"})).toBe(true);
        expect(await page.setCover("a", {kind: "set", file: new File([new Uint8Array([1])], "cover.png")})).toBe(true);
        expect(await page.setCover("a", {kind: "remove"})).toBe(true);
        expect(w.covers).toEqual([{id: "a", name: "cover.png"}, {id: "a", name: null}]);
        expect(w.script.shelfCalls).toBe(3);
        w.coverFails = true;
        expect(await page.setCover("a", {kind: "set", file: new File([new Uint8Array([1])], "big.png")})).toBe(false);
        expect(w.notices()).toEqual(["封面没有保存：封面至多 5 MB"]);
        expect(w.reports).toEqual(["projects.cover-failed: 封面上传失败：too-large：封面至多 5 MB"]);
    });
});

describe("Spec bookshelf 写操作的结果未知：重新取书架、按本次的目标核对", () => {
    /** 等服务端收到写请求（按 `delayWrite` 做或不做）后推进时钟，让页面拿到 unknown-outcome。 */
    async function timeOut(w: World, count: number): Promise<void> {
        await waitUntil("写请求到达", () => w.script.writeHolds.length === count);
        w.clock.advance(WRITE_TIMEOUT_MS);
    }
    const release = (w: World): void => {
        for (const hold of w.script.writeHolds) hold.resolve();
    };

    it("移出：目标不在了就算移出，仍选中相邻的一部；还在就提示没有移出、选中不变", async () => {
        const w = await world([item("a", "Alpha"), item("b", "Beta"), item("c", "Gamma")], {writeTimeout: true});
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        page.select("b");
        w.script.delayWrite = "after";
        const removing = page.remove("b");
        await timeOut(w, 1);
        expect(await removing).toEqual({ok: true});
        expect(page.items.value.map((entry) => entry.id)).toEqual(["a", "c"]);
        expect(page.activeId.value).toBe("c");

        w.script.delayWrite = "instead";
        const failing = page.remove("c");
        await timeOut(w, 2);
        expect(await failing).toMatchObject({ok: false, message: expect.stringContaining("没有移出书架")});
        expect(page.items.value.map((entry) => entry.id)).toEqual(["a", "c"]);
        expect(page.activeId.value).toBe("c");
        release(w);
    });

    it("修改信息：服务端上已是提交的值就算保存；不是就通知结果未知、书架仍是旧值", async () => {
        const w = await world([item("a", "Alpha")], {writeTimeout: true});
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.delayWrite = "after";
        const saving = page.update("a", {title: "Alpha 二", description: "改过", color: "#112233"});
        await timeOut(w, 1);
        expect(await saving).toEqual({ok: true, id: "a"});
        expect(page.items.value[0]).toMatchObject({title: "Alpha 二", description: "改过", color: "#112233"});

        w.script.delayWrite = "instead";
        const unknown = page.update("a", {title: "Alpha 三", description: "", color: null});
        await timeOut(w, 2);
        expect(await unknown).toEqual({ok: false, field: null, message: "保存的结果未知，书架已重新读取；显示的还是旧值就再试一次"});
        expect(w.notices()).toEqual(["保存的结果未知，书架已重新读取；显示的还是旧值就再试一次"]);
        expect(page.items.value[0]).toMatchObject({title: "Alpha 二", description: "改过"});
        release(w);
    });

    it("新建：本次父目录下由书名生成的目录在书架上才算成功，别的目录下的同名作品不算；打开已有作品：给的目录在书架上就算登记了", async () => {
        const w = await world([item("x", "新书", {path: "/elsewhere/新书"})], {writeTimeout: true});
        const page = w.page();
        page.setVisible(true);
        await ready(page);
        w.script.delayWrite = "instead";
        const unknown = page.create({title: "新书", description: "", color: null}, "/home/writer/books/");
        await timeOut(w, 1);
        expect(await unknown).toMatchObject({ok: false, field: null, message: expect.stringContaining("结果未知")});
        expect(page.activeId.value).toBeNull();

        w.script.delayWrite = "after";
        const created = page.create({title: "新书", description: "", color: null}, "/home/writer/books/");
        await timeOut(w, 2);
        expect(await created).toMatchObject({ok: true});
        const book = page.items.value.find((entry) => entry.path === "/home/writer/books/新书");
        expect(book).toBeDefined();
        expect(page.activeId.value).toBe(book!.id);

        const adding = page.addExisting("/home/writer/books/Old/");
        await timeOut(w, 3);
        expect(await adding).toEqual({ok: true});
        expect(page.activeId.value).toBe(page.items.value.find((entry) => entry.path === "/home/writer/books/Old/")!.id);

        w.script.delayWrite = "instead";
        const lost = page.addExisting("/home/writer/books/Newer");
        await timeOut(w, 4);
        expect(await lost).toMatchObject({ok: false, message: expect.stringContaining("登记没有完成")});
        release(w);
    });
});
