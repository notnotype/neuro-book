/**
 * 多实例的 Storage 测试场地：服务端（带路由、提供状态根）、项目 `book` 的实例（经进程内链路登记，可按代次重起）与
 * 浏览器窗口（可断线重连），每个实例都装真实的诊断与 `nbook.storage`，库落在 `root` 下的真实 SQLite。帧经 JSON
 * 编解码，与产品里的 Bun IPC、WebSocket 一样。调用方把要测的插件交给各实例；`close()` 逆序停实例、再关路由。
 * 只由测试使用。
 */

import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {stateRootKey} from "nbook/shared/host";
import {currentProjectKey, windowProjectKey} from "nbook/shared/projects";

import {storageBackendPlugin} from "../backend/plugin";
import {storageBrowserPlugin} from "../web/plugin";

export interface WorldWindow {
    readonly app: Application;
    /** 关掉当前链路（断线）。 */
    disconnect(): void;
    /** 像窗口的重连那样换一条链路再握手，返回握手结果。 */
    reconnect(): Promise<unknown>;
}

export interface StorageWorld {
    readonly router: RemoteRouter;
    readonly hub: Application;
    readonly userPath: string;
    readonly projectPath: string;
    /** 实例的诊断记录（按实例 id）。 */
    diagnostics(instanceId: string): DiagnosticsStore;
    /** 起项目 `book` 的第 `generation` 代实例，经路由登记。 */
    project(generation: number, plugins: ReadonlyArray<PluginDefinition>): Promise<Application>;
    /** 起一个浏览器窗口；`bound` 为 false 时不绑定项目。 */
    window(id: string, client: string, plugins: ReadonlyArray<PluginDefinition>, options?: {readonly bound?: boolean}): Promise<WorldWindow>;
    /** 结束项目代次：路由关闭绑定它的窗口链路，之后按原代次重连为 project-gone。 */
    endProject(): void;
    /** 逆序停全部实例，再关路由。 */
    close(): Promise<ReadonlyArray<StopResult>>;
}

const DELEGATION = (plugin: string): boolean => plugin === "nbook.storage";

export async function storageWorld(root: string, hubPlugins: ReadonlyArray<PluginDefinition>): Promise<StorageWorld> {
    const apps: Application[] = [];
    const stores = new Map<string, DiagnosticsStore>();
    const diagnosticsFor = (location: string, instanceId: string): PluginDefinition => {
        const silent = {error: () => undefined};
        const store = createDiagnosticsStore({identity: {location, instanceId}});
        stores.set(instanceId, store);
        return createDiagnosticsPlugin({location, store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    };
    const started = async (app: Application): Promise<Application> => {
        apps.push(app);
        const startup = await app.startup;
        if (startup.status !== "available" || startup.failures.length > 0) throw new Error(`实例没有正常启动：${JSON.stringify(startup)}`);
        return app;
    };

    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    // 服务端没起来时调用方拿不到场地、调不了 close，这里自己收口再抛。
    const hub = await started(createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [{id: "host.state-root", key: stateRootKey, create: () => ({path: join(root, "state")})}],
            plugins: [diagnosticsFor("server", "hub"), storageBackendPlugin, ...hubPlugins],
            gates: [],
            remote: hubNode,
            delegation: DELEGATION,
        },
    )).catch(async (error: unknown) => {
        for (const app of apps.splice(0)) await app.stop();
        throw error;
    });

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
        router,
        hub,
        userPath: join(root, "state", "storage", "user.sqlite"),
        projectPath: join(root, "Book", ".nbook", "storage.sqlite"),
        diagnostics: (instanceId) => {
            const store = stores.get(instanceId);
            if (store === undefined) throw new Error(`没有实例 ${instanceId}`);
            return store;
        },
        project: async (next, plugins) => {
            generation = next;
            running = true;
            revoke = new AbortController();
            const descriptor: InstanceDescriptor = {id: `project:P#${String(next)}`, kind: "project", role: "project", project: {id: "P", generation: next}, client: null};
            const node = createRemoteNode({instance: descriptor});
            const current = {id: "P", name: "book", generation: next, root: join(root, "Book")};
            const app = createApplication(
                {identity: {location: "project", instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    capabilities: [{id: "project.current", key: currentProjectKey, create: () => current}],
                    plugins: [diagnosticsFor("project", descriptor.id), storageBackendPlugin, ...plugins],
                    gates: [],
                    remote: node,
                    delegation: DELEGATION,
                },
            );
            const pair = createLinkPair();
            router.accept(pair.right, {expect: descriptor});
            const connected = await node.connect(pair.left);
            if (!connected.ok) throw new Error(`项目实例连不上路由：${JSON.stringify(connected)}`);
            return started(app);
        },
        window: async (id, client, plugins, options = {}) => {
            const bound = options.bound ?? true;
            const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: bound ? {project: "book"} : null});
            let pair = createLinkPair();
            router.accept(pair.right);
            const connected = await node.connect(pair.left);
            if (!connected.ok) throw new Error(`窗口 ${id} 连不上路由：${JSON.stringify(connected)}`);
            const project = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
            const app = await started(createApplication(
                {identity: {location: "browser", instanceId: id, client}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project})}],
                    plugins: [diagnosticsFor("browser", id), storageBrowserPlugin, ...plugins],
                    gates: [],
                    remote: node,
                    delegation: DELEGATION,
                },
            ));
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
        close: async () => {
            const results: StopResult[] = [];
            for (const app of apps.splice(0).reverse()) results.push(await app.stop());
            router.close();
            return results;
        },
    };
}
