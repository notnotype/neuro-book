/**
 * `nbook.storage` 三端入口（docs/specs/storage/persistence.md 场景 1–4、6–8）：服务端、项目与浏览器都是真实的
 * 内核实例，经进程内链路连到服务端路由，分区是真实临时目录上的 SQLite。项目实例在本进程里起（它的入口代码与
 * 项目子进程里的相同）；真实项目子进程里的 project 分区由 `server-storage.test.ts` 覆盖。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";

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
import {collectServiceKeys} from "nbook/shared/service-keys";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, RecordHandle, RecordSnapshot, StorageService} from "nbook/shared/storage";

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

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-storage", "storage-plugin");
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
    /** 起一个浏览器窗口；`bound` 为 false 时不绑定项目。`reconnect` 像窗口的重连那样换一条链路再握手。 */
    window(id: string, client: string, options?: {readonly bound?: boolean}): Promise<{readonly app: Application; reconnect(): Promise<unknown>}>;
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
        {keys: collectServiceKeys(hubPlugins), plugins: hubPlugins, gates: [], remote: hubNode, delegation},
    );
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
                {keys: collectServiceKeys(plugins), plugins, gates: [], remote: node, delegation},
            );
            const pair = createLinkPair();
            router.accept(pair.right, {expect: descriptor});
            expect(await node.connect(pair.left)).toEqual({ok: true});
            expect(await app.startup).toMatchObject({status: "available", failures: []});
            return app;
        },
        window: async (id, client, options = {}) => {
            const bound = options.bound ?? true;
            const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: bound ? {project: "book"} : null});
            const pair = createLinkPair();
            router.accept(pair.right);
            expect(await node.connect(pair.left)).toEqual({ok: true});
            const project = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
            const plugins = [createStorageBrowserPlugin({storage: storageKey, windowProject: windowProjectKey}), consumer("app.notes", "browser", seen, id), consumer("app.other", "browser", seen, id)];
            const app = createApplication(
                {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    keys: collectServiceKeys(plugins, [windowProjectKey]),
                    capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project})}],
                    plugins,
                    gates: [],
                    remote: node,
                    delegation,
                },
            );
            expect(await app.startup).toMatchObject({status: "available", failures: []});
            return {
                app,
                reconnect: async () => {
                    const again = createLinkPair();
                    router.accept(again.right);
                    return node.connect(again.left);
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

describe("Spec storage.persistence 场景 1：本地直用与经代理访问同一个命名空间", () => {
    it("user 记录：服务端插件直接写，浏览器里的同一插件经代理读到；反过来也一样", async () => {
        const w = await world();
        await w.window("browser-1", "profile-1");
        const server = await opened(storageOf(w, "app.notes", "hub"), notes);
        const browser = await opened(storageOf(w, "app.notes", "browser-1"), notes);

        const written = await server.save({text: "服务端写"}, {expect: null});
        expect(written).toEqual({ok: true, revision: "1"});
        expect(await browser.read()).toEqual({status: "ok", value: {text: "服务端写"}, revision: "1"});

        expect(await browser.save({text: "窗口写"}, {expect: "1"})).toEqual({ok: true, revision: "2"});
        expect(await server.read()).toEqual({status: "ok", value: {text: "窗口写"}, revision: "2"});
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

        await server.save({text: "服务端写"}, {expect: null});
        expect(await project.read()).toEqual({status: "ok", value: {text: "服务端写"}, revision: "1"});
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
        await server.save({text: "一"}, {expect: null});

        const seen: Array<RecordSnapshot<{text: string}>> = [];
        const watcher = await opened(storageOf(w, "app.notes", "browser-1"), notes);
        expect(await watcher.subscribe((snapshot) => seen.push(snapshot))).toMatchObject({ok: true});
        await waitUntil("收到当前快照", () => seen.length === 1 || null);
        expect(seen[0]).toEqual({status: "ok", value: {text: "一"}, revision: "1"});

        await server.save({text: "二"}, {expect: "1"});
        await (await opened(storageOf(w, "app.notes", "browser-3"), notes)).save({text: "三"}, {expect: "2"});
        await waitUntil("收到两次写入", () => seen.length === 3 || null);
        expect(seen.map((snapshot) => (snapshot.status === "ok" ? snapshot.value.text : snapshot.status))).toEqual(["一", "二", "三"]);
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
        expect(await server.save({text: "y"}, {expect: "1"})).toMatchObject({ok: false, code: "unavailable"});
    });
});
