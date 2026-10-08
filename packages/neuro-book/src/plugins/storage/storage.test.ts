/**
 * `nbook.storage` 三端入口（docs/specs/storage/persistence.md 场景 1–4、6–8）：服务端、项目与浏览器都是真实的
 * 内核实例，经进程内链路连到服务端路由，分区是真实临时目录上的 SQLite。项目实例在本进程里起（它的入口代码与
 * 项目子进程里的相同）；真实项目子进程里的 project 分区由 `project-child.test.ts` 覆盖。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {windowProjectKey} from "nbook/shared/projects";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, RecordHandle, RecordSnapshot, StorageService, WriteResult} from "nbook/shared/storage";

import {createStorageServerPlugin} from "./server/plugin";
import {storageKey, userStorageContract} from "./shared/contracts";
import {createStorageBrowserPlugin} from "./web/plugin";

const Text = Type.Object({text: Type.String()}, {additionalProperties: false});
const notes = defineRecord({key: "notes", scope: "user", locality: "shared", version: 1, schema: Text});
const prefs = defineRecord({key: "prefs", scope: "user", locality: "local", version: 1, schema: Text});
const board = defineRecord({key: "board", scope: "project", locality: "shared", version: 1, schema: Text});
const draft = defineRecord({key: "draft", scope: "project", locality: "local", version: 1, schema: Text});

let tmp = "";
let counter = 0;
/** 当前用例起的应用与路由。用例结束（含失败）后逆序停应用、再关路由，全部收口后再核对都正常关闭。 */
const apps: Application[] = [];
const routers: RemoteRouter[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-storage", "storage-plugin");
});

afterEach(async () => {
    const stops = [];
    for (const app of apps.splice(0).reverse()) stops.push(await app.stop());
    for (const router of routers.splice(0)) router.close();
    for (const stop of stops) expect(stop).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 测试插件：每个位置一个入口，启动即激活，把拿到的 Storage 服务与激活上下文交给测试。 */
interface Seen {
    readonly storage: StorageService;
    readonly context: ActivationContext;
}

function consumer(id: string, location: string, seen: Map<string, Seen>, instance: string): PluginDefinition {
    return {
        id,
        entries: [{
            id: location,
            location,
            activationEvents: ["onStartup"],
            dependencies: [{key: storageKey}],
            activate: (context) => {
                seen.set(`${id}@${instance}`, {storage: context.services.require(storageKey), context});
                return {};
            },
        }],
    };
}

function silentDiagnostics(location: string, instanceId: string): PluginDefinition {
    const silent = {error: () => undefined};
    return createDiagnosticsPlugin({location, store: createDiagnosticsStore({identity: {location, instanceId}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
}

interface World {
    readonly seen: Map<string, Seen>;
    readonly router: RemoteRouter;
    readonly hub: Application;
    readonly userPath: string;
    readonly projectPath: string;
    /** 起一个项目实例（第 `generation` 代），经路由登记。 */
    project(generation: number): Promise<Application>;
    /**
     * 起一个浏览器窗口；`bound` 为 false 时不绑定项目。`disconnect` 关掉当前链路（断线），`reconnect` 像窗口的重连
     * 那样换一条链路再握手。
     */
    window(id: string, client: string, options?: {readonly bound?: boolean}): Promise<{readonly app: Application; disconnect(): void; reconnect(): Promise<unknown>}>;
    /** 结束项目代次：路由关闭绑定它的窗口链路，之后按原代次重连为 project-gone。 */
    endProject(): void;
}

async function world(): Promise<World> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const userPath = join(root, "state", "storage", "user.sqlite");
    const projectPath = join(root, "Book", ".nbook", "storage.sqlite");
    const seen = new Map<string, Seen>();
    const delegation = (plugin: string): boolean => plugin === "nbook.storage";

    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const hubPlugins = [silentDiagnostics("server", "hub"), createStorageServerPlugin({location: "server", storage: storageKey, path: userPath}), consumer("app.notes", "server", seen, "hub"), consumer("app.other", "server", seen, "hub")];
    const hub = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: hubPlugins, gates: [], remote: hubNode, delegation},
    );
    apps.push(hub);
    expect(await hub.startup).toMatchObject({status: "available", failures: []});

    let generation = 1;
    let running = true;
    let revoke = new AbortController();
    const router = createRemoteRouter(hubNode, {
        bindProject: async (request) => {
            if ("generation" in request && (!running || request.generation !== generation)) return {ok: false, reason: "project-gone", message: "项目代次已结束"};
            return {ok: true, binding: {id: "P", name: "book", generation}, revoked: revoke.signal, release: () => undefined};
        },
    });
    routers.push(router);

    return {
        seen,
        router,
        hub,
        userPath,
        projectPath,
        project: async (next) => {
            generation = next;
            running = true;
            revoke = new AbortController();
            const descriptor: InstanceDescriptor = {id: `project:P#${String(next)}`, kind: "project", role: "project", project: {id: "P", generation: next}, client: null};
            const node = createRemoteNode({instance: descriptor});
            const plugins = [silentDiagnostics("project", descriptor.id), createStorageServerPlugin({location: "project", storage: storageKey, path: projectPath}), consumer("app.notes", "project", seen, descriptor.id)];
            const app = createApplication(
                {identity: {location: "project", instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {plugins, gates: [], remote: node, delegation},
            );
            apps.push(app);
            const pair = createLinkPair();
            router.accept(pair.right, {expect: descriptor});
            expect(await node.connect(pair.left)).toEqual({ok: true});
            expect(await app.startup).toMatchObject({status: "available", failures: []});
            return app;
        },
        window: async (id, client, options = {}) => {
            const bound = options.bound ?? true;
            const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: bound ? {project: "book"} : null});
            let pair = createLinkPair();
            router.accept(pair.right);
            expect(await node.connect(pair.left)).toEqual({ok: true});
            const project = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
            const plugins = [createStorageBrowserPlugin({storage: storageKey, windowProject: windowProjectKey}), consumer("app.notes", "browser", seen, id), consumer("app.other", "browser", seen, id)];
            const app = createApplication(
                {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project})}],
                    plugins,
                    gates: [],
                    remote: node,
                    delegation,
                },
            );
            apps.push(app);
            expect(await app.startup).toMatchObject({status: "available", failures: []});
            return {
                app,
                disconnect: () => pair.left.close(),
                reconnect: async () => {
                    pair = createLinkPair();
                    router.accept(pair.right);
                    return node.connect(pair.left);
                },
            };
        },
        endProject: () => {
            running = false;
            revoke.abort();
        },
    };
}

function storageOf(w: World, plugin: string, instance: string): StorageService {
    const found = w.seen.get(`${plugin}@${instance}`);
    if (found === undefined) throw new Error(`没有 ${plugin}@${instance}`);
    return found.storage;
}

async function opened<T>(storage: StorageService, record: RecordDefinition<T>, resource?: string): Promise<RecordHandle<T>> {
    const result = await storage.open(record, resource);
    if (!result.ok) throw new Error(`打开 ${record.key} 失败：${result.code} ${result.detail}`);
    return result.handle;
}

function revisionOf(snapshot: RecordSnapshot<unknown>): string | null {
    return snapshot.status === "error" ? null : snapshot.revision;
}

/** 成功写入得到的 revision；revision 对调用方不透明，只拿来做下一次的 `expect`。 */
function saved(result: WriteResult): string {
    if (!result.ok) throw new Error(`期望写入成功，得到 ${result.code}：${result.detail}`);
    return result.revision;
}

function textOf(snapshot: RecordSnapshot<{text: string}>): string {
    return snapshot.status === "ok" ? snapshot.value.text : snapshot.status;
}

describe("Spec storage.persistence 场景 1：本地直用与经代理访问同一个命名空间", () => {
    it("user 记录：服务端插件直接写，浏览器里的同一插件经代理读到；反过来也一样", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        const browser = await opened(storageOf(w, "app.notes", "browser-1"), notes);

        const written = saved(await server.save({text: "服务端写"}, {expect: null}));
        expect(await browser.read()).toEqual({status: "ok", value: {text: "服务端写"}, revision: written});

        const again = saved(await browser.save({text: "窗口写"}, {expect: written}));
        expect(await server.read()).toEqual({status: "ok", value: {text: "窗口写"}, revision: again});
    });

    it("project 记录：项目实例里的插件直接写，浏览器里的同一插件经代理读到；反过来也一样", async () => {
        const w = await world();
        await w.project(1);
        await w.window("browser-1", "profile-1");
        const project = await opened(storageOf(w, "app.notes", "project:P#1"), board);
        const browser = await opened(storageOf(w, "app.notes", "browser-1"), board);

        expect(await project.save({text: "项目写"}, {expect: null})).toMatchObject({ok: true});
        expect(await browser.read()).toMatchObject({status: "ok", value: {text: "项目写"}});
        const current = await browser.read();
        expect(await browser.save({text: "窗口写"}, {expect: revisionOf(current)})).toMatchObject({ok: true});
        expect(await project.read()).toMatchObject({status: "ok", value: {text: "窗口写"}});
    });

    it("项目实例里的插件打开 user 记录：经服务端，与服务端插件同一命名空间", async () => {
        const w = await world();
        await w.project(1);
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        const project = await opened(storageOf(w, "app.notes", "project:P#1"), notes);

        const written = saved(await server.save({text: "服务端写"}, {expect: null}));
        expect(await project.read()).toEqual({status: "ok", value: {text: "服务端写"}, revision: written});
    });
});

describe("Spec storage.persistence 输出 1：打开时核对分区库", () => {
    it("user 库不是 SQLite：服务端插件直接打开与浏览器经代理打开都为 io-error，库文件不变", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        await mkdir(dirname(w.userPath), {recursive: true});
        await writeFile(w.userPath, "不是 SQLite");

        expect(await storageOf(w, "app.notes", "hub").open(notes)).toMatchObject({ok: false, code: "io-error"});
        expect(await storageOf(w, "app.notes", "browser-1").open(notes)).toMatchObject({ok: false, code: "io-error"});
        expect(await readFile(w.userPath, "utf8")).toBe("不是 SQLite");
    });
});

describe("Spec storage.persistence 场景 2：插件隔离", () => {
    it("两个插件的同名记录互不可见；插件直接调用远程服务也只到自己的命名空间", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        await (await opened(storageOf(w, "app.notes", "browser-1"), notes)).save({text: "notes 的"}, {expect: null});

        const other = await opened(storageOf(w, "app.other", "browser-1"), notes);
        expect(await other.read()).toEqual({status: "missing", revision: null});
        expect(await other.save({text: "other 的"}, {expect: null})).toMatchObject({ok: true});
        expect(await (await opened(storageOf(w, "app.notes", "hub"), notes)).read()).toMatchObject({status: "ok", value: {text: "notes 的"}});

        // 绕过 Storage 服务、以自己的身份直接调用 nbook.storage/user：拥有者按调用方身份取 owner，仍是 app.other。
        const direct = w.seen.get("app.other@browser-1")!.context.remote.use(userStorageContract);
        expect(await direct.read({record: notes.descriptor, resource: ""})).toMatchObject({ok: true, value: {status: "ok", value: {text: "other 的"}}});
    });
});

describe("Spec storage.persistence 场景 3：客户端分区与位置限制", () => {
    it("local 记录按客户端身份分开：两个客户端各一份，同一客户端的两个窗口共用一份", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        await w.window("browser-2", "profile-2");
        await w.window("browser-3", "profile-1");

        await (await opened(storageOf(w, "app.notes", "browser-1"), prefs)).save({text: "一号客户端"}, {expect: null});
        expect(await (await opened(storageOf(w, "app.notes", "browser-2"), prefs)).read()).toEqual({status: "missing", revision: null});
        expect(await (await opened(storageOf(w, "app.notes", "browser-3"), prefs)).read()).toMatchObject({status: "ok", value: {text: "一号客户端"}});
    });

    it("服务端与项目实例打开 local 记录为 no-client；服务端插件与没有绑定项目的窗口打开 project 记录为 no-project", async () => {
        const w = await world();
        await w.project(1);
        await w.window("browser-9", "profile-9", {bound: false});

        expect(await storageOf(w, "app.notes", "hub").open(prefs)).toMatchObject({ok: false, code: "no-client"});
        expect(await storageOf(w, "app.notes", "project:P#1").open(draft)).toMatchObject({ok: false, code: "no-client"});
        expect(await storageOf(w, "app.notes", "hub").open(board)).toMatchObject({ok: false, code: "no-project"});
        expect(await storageOf(w, "app.notes", "browser-9").open(board)).toMatchObject({ok: false, code: "no-project"});
    });
});

describe("Spec storage.persistence 场景 4、6：条件保存与定义冲突经代理", () => {
    it("同一客户端的两个窗口以同一 revision 保存：一个成功，另一个 conflict", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        await w.window("browser-3", "profile-1");
        const first = await opened(storageOf(w, "app.notes", "browser-1"), prefs);
        const second = await opened(storageOf(w, "app.notes", "browser-3"), prefs);

        expect(await first.save({text: "先"}, {expect: null})).toMatchObject({ok: true});
        expect(await second.save({text: "后"}, {expect: null})).toMatchObject({ok: false, code: "conflict"});
    });

    it("同名记录的描述与拥有者已登记的不同：open 为 definition-conflict；资源 id 不合为 invalid-resource；值不合为 invalid-value", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        const storage = storageOf(w, "app.notes", "browser-1");
        await opened(storage, notes);

        const older = defineRecord({key: "notes", scope: "user", locality: "shared", version: 1, schema: Type.Object({body: Type.String()}, {additionalProperties: false})});
        expect(await storage.open(older)).toMatchObject({ok: false, code: "definition-conflict"});
        expect(await storage.open(notes, "task-1")).toMatchObject({ok: false, code: "invalid-resource"});
        const handle = await opened(storage, notes);
        expect(await handle.save({text: 1} as unknown as {text: string}, {expect: null})).toMatchObject({ok: false, code: "invalid-value"});
    });
});

describe("Spec storage.persistence 场景 7：订阅", () => {
    it("先收到当前快照，之后收到服务端与另一个窗口的写入", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        await w.window("browser-3", "profile-1");
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        const first = saved(await server.save({text: "一"}, {expect: null}));

        const seen: Array<RecordSnapshot<{text: string}>> = [];
        const watcher = await opened(storageOf(w, "app.notes", "browser-1"), notes);
        expect(await watcher.subscribe((snapshot) => seen.push(snapshot))).toMatchObject({ok: true});
        await waitUntil("收到当前快照", () => seen.length === 1 || null);
        expect(seen[0]).toEqual({status: "ok", value: {text: "一"}, revision: first});

        const second = saved(await server.save({text: "二"}, {expect: first}));
        await (await opened(storageOf(w, "app.notes", "browser-3"), notes)).save({text: "三"}, {expect: second});
        await waitUntil("收到两次写入", () => seen.length === 3 || null);
        expect(seen.map(textOf)).toEqual(["一", "二", "三"]);
    });

    it("浏览器经路由订阅 project 记录：先收到项目实例里的当前快照", async () => {
        const w = await world();
        await w.project(1);
        await w.window("browser-1", "profile-1");
        await (await opened(storageOf(w, "app.notes", "project:P#1"), board)).save({text: "订阅前"}, {expect: null});

        const seen: string[] = [];
        const browser = await opened(storageOf(w, "app.notes", "browser-1"), board);
        expect(await browser.subscribe((snapshot) => seen.push(textOf(snapshot)))).toMatchObject({ok: true});
        await waitUntil("收到当前快照", () => seen.length === 1 || null);
        expect(seen).toEqual(["订阅前"]);
    });

    it("断线后连回同一服务端：订阅重建，先收到断线期间写入后的当前快照，之后照常收到写入；订阅不结束", async () => {
        const w = await world();
        const window = await w.window("browser-1", "profile-1");
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        const before = saved(await server.save({text: "断线前"}, {expect: null}));
        const seen: string[] = [];
        const ended: string[] = [];
        const watcher = await opened(storageOf(w, "app.notes", "browser-1"), notes);
        expect(await watcher.subscribe((snapshot) => seen.push(textOf(snapshot)), {onEnd: (reason) => ended.push(reason)})).toMatchObject({ok: true});
        await waitUntil("收到当前快照", () => seen.length === 1 || null);

        window.disconnect();
        const during = saved(await server.save({text: "断线期间"}, {expect: before}));
        expect(await window.reconnect()).toEqual({ok: true});
        await waitUntil("重建后收到当前快照", () => seen.length === 2 || null);
        await server.save({text: "重连后"}, {expect: during});
        await waitUntil("收到重连后的写入", () => seen.length === 3 || null);

        expect(seen).toEqual(["断线前", "断线期间", "重连后"]);
        expect(ended).toEqual([]);
    });

    it("项目代次结束：经代理的 project 订阅结束；下一代项目实例读到磁盘上的值", async () => {
        const w = await world();
        const first = await w.project(1);
        const window = await w.window("browser-1", "profile-1");
        const browser = await opened(storageOf(w, "app.notes", "browser-1"), board);
        await browser.save({text: "留在磁盘上"}, {expect: null});
        const ended: string[] = [];
        expect(await browser.subscribe(() => undefined, {onEnd: (reason) => ended.push(reason)})).toMatchObject({ok: true});

        w.endProject();
        expect(await first.stop()).toMatchObject({status: "closed"});
        expect(await window.reconnect()).toMatchObject({ok: false, reason: "project-gone"});
        await waitUntil("订阅结束", () => ended.length > 0 || null);
        expect(ended).toEqual(["project-gone"]);

        await w.project(2);
        expect(await (await opened(storageOf(w, "app.notes", "project:P#2"), board)).read()).toMatchObject({status: "ok", value: {text: "留在磁盘上"}});
    });

    it("首快照的监听里就停了服务端：订阅只以 provider-stopped 结束一次，窗口随后停止不再结束它", async () => {
        const w = await world();
        const window = await w.window("browser-1", "profile-1");
        const watcher = await opened(storageOf(w, "app.notes", "browser-1"), notes);
        const ended: string[] = [];
        const hubStops: Array<Promise<unknown>> = [];
        const subscribed = await watcher.subscribe(() => {
            if (hubStops.length === 0) hubStops.push(w.hub.stop());
        }, {onEnd: (reason) => ended.push(reason)});

        expect(subscribed).toMatchObject({ok: true});
        expect(await hubStops[0]).toMatchObject({status: "closed"});
        await waitUntil("订阅结束", () => ended.length > 0 || null);
        expect(await window.app.stop()).toMatchObject({status: "closed"});
        expect(ended).toEqual(["provider-stopped"]);
    });
});

describe("Spec storage.persistence 场景 8：生命周期", () => {
    it("服务端停止：Storage 入口关闭 user 分区（WAL 文件收回），之后已打开的句柄为 unavailable", async () => {
        const w = await world();
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        await server.save({text: "x"}, {expect: null});
        expect(existsSync(`${w.userPath}-wal`)).toBe(true);

        expect(await w.hub.stop()).toMatchObject({status: "closed"});
        expect(existsSync(`${w.userPath}-wal`)).toBe(false);
        expect(await server.read()).toMatchObject({status: "error", code: "unavailable"});
        expect(await server.save({text: "y"}, {expect: null})).toMatchObject({ok: false, code: "unavailable"});
    });

    it("一条订阅的 onEnd 抛错：同一服务对象的其余订阅照样以 released 结束、不再收到写入；收口报告释放失败", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        const caller = w.seen.get("app.notes@hub")!;
        const handle = await opened(caller.storage, notes);
        const seen: string[] = [];
        const ended: string[] = [];
        await handle.subscribe(() => undefined, {
            onEnd: () => {
                throw new Error("结束回调抛错");
            },
        });
        await handle.subscribe((snapshot) => seen.push(textOf(snapshot)), {onEnd: (reason) => ended.push(reason)});

        // 关闭调用方入口这一代的激活作用域，等同于这个入口停止：它的 Storage 服务对象随之释放。
        expect(await caller.context.scope.parent!.close()).toMatchObject({status: "incomplete"});
        expect(ended).toEqual(["released"]);
        // 本地订阅的通知在写入时同步派发，写入返回时还没收到就是不会再收到。
        await (await opened(storageOf(w, "app.notes", "browser-1"), notes)).save({text: "调用方停止后"}, {expect: null});
        expect(seen).toEqual(["missing"]);
    });
});
