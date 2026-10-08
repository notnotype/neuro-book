/**
 * 多实例的配置测试场地：服务端（带路由、状态根）、项目 `book` 的实例（经进程内链路登记）与浏览器窗口（可断线重连），
 * 每个实例都装真实的诊断与 `nbook.settings`，配置文件落在 `root` 下的真实目录。帧经 JSON 编解码，与产品里的 Bun IPC、
 * WebSocket 一样。全部实例共用一个手动时钟（首个快照的截止、文件变化的合并）；窗口的连接状态随断线与重连变化，
 * 与浏览器宿主一样。调用方把要测的插件交给各实例；`close()` 逆序停实例、再关路由。只由测试使用。
 */

import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {clockKey, stateRootKey, windowConnectionKey} from "nbook/shared/host";
import type {WindowConnection, WindowConnectionState} from "nbook/shared/host";
import {currentProjectKey, windowProjectKey} from "nbook/shared/projects";

import {settingsBackendPlugin} from "../backend/plugin";
import {settingsBrowserPlugin} from "../web/plugin";

export interface WorldWindow {
    readonly app: Application;
    /** 关掉当前链路（断线），连接状态转为离线。 */
    disconnect(): void;
    /** 像窗口的重连那样换一条链路再握手；成功后连接状态转为在线。 */
    reconnect(): Promise<unknown>;
}

export interface SettingsWorld {
    readonly clock: ManualClock;
    readonly hub: Application;
    readonly userFile: string;
    readonly projectFile: string;
    diagnostics(instanceId: string): DiagnosticsStore;
    project(generation: number, plugins: ReadonlyArray<PluginDefinition>): Promise<Application>;
    /** `connected: false`：链路建好后、实例激活前就断开（首次订阅失败）。 */
    window(id: string, plugins: ReadonlyArray<PluginDefinition>, options?: {readonly bound?: boolean; readonly connected?: boolean}): Promise<WorldWindow>;
    close(): Promise<ReadonlyArray<StopResult>>;
}

export interface SettingsWorldOptions {
    /** 服务端给出状态根之前等它：服务端的配置入口激活因此挂起，用来验证首个快照的截止。 */
    readonly hubGate?: Promise<void>;
}

const DELEGATION = (plugin: string): boolean => plugin === "nbook.settings";

export async function settingsWorld(root: string, hubPlugins: ReadonlyArray<PluginDefinition>, options: SettingsWorldOptions = {}): Promise<SettingsWorld> {
    const apps: Application[] = [];
    const stores = new Map<string, DiagnosticsStore>();
    const clock = new ManualClock();
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

    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}, clock});
    const hub = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "host.state-root", key: stateRootKey, create: async () => {
                    await options.hubGate;
                    return {path: join(root, "state")};
                }},
                {id: "host.clock", key: clockKey, create: () => clock},
            ],
            plugins: [diagnosticsFor("server", "hub"), settingsBackendPlugin, ...hubPlugins],
            gates: [],
            remote: hubNode,
            delegation: DELEGATION,
        },
    );
    apps.push(hub);
    // 有闸门时不等服务端启动完：测试要在它挂起期间起窗口。
    if (options.hubGate === undefined) {
        const startup = await hub.startup;
        if (startup.status !== "available" || startup.failures.length > 0) {
            for (const app of apps.splice(0)) await app.stop();
            throw new Error(`服务端没有正常启动：${JSON.stringify(startup)}`);
        }
    }

    let generation = 1;
    const router = createRemoteRouter(hubNode, {
        bindProject: async (request) => {
            if ("generation" in request && request.generation !== generation) return {ok: false, reason: "project-gone", message: "项目代次已结束"};
            return {ok: true, binding: {id: "P", name: "book", generation}, revoked: new AbortController().signal, release: () => undefined};
        },
    });

    return {
        clock,
        hub,
        userFile: join(root, "state", "settings.json"),
        projectFile: join(root, "Book", ".nbook", "settings.json"),
        diagnostics: (instanceId) => {
            const store = stores.get(instanceId);
            if (store === undefined) throw new Error(`没有实例 ${instanceId}`);
            return store;
        },
        project: async (next, plugins) => {
            generation = next;
            const descriptor: InstanceDescriptor = {id: `project:P#${String(next)}`, kind: "project", role: "project", project: {id: "P", generation: next}, client: null};
            const node = createRemoteNode({instance: descriptor, clock});
            const current = {id: "P", name: "book", generation: next, root: join(root, "Book")};
            const app = createApplication(
                {identity: {location: "project", instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    capabilities: [
                        {id: "project.current", key: currentProjectKey, create: () => current},
                        {id: "host.clock", key: clockKey, create: () => clock},
                    ],
                    plugins: [diagnosticsFor("project", descriptor.id), settingsBackendPlugin, ...plugins],
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
        window: async (id, plugins, windowOptions = {}) => {
            const bound = windowOptions.bound ?? true;
            const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client: `client-${id}`}, bind: bound ? {project: "book"} : null, clock});
            let pair = createLinkPair();
            router.accept(pair.right);
            const connected = await node.connect(pair.left);
            if (!connected.ok) throw new Error(`窗口 ${id} 连不上路由：${JSON.stringify(connected)}`);
            const link = linkState();
            link.set("online");
            if (windowOptions.connected === false) {
                pair.left.close();
                link.set("offline");
            }
            const project = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
            const app = await started(createApplication(
                {identity: {location: "browser", instanceId: id, client: `client-${id}`}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {
                    capabilities: [
                        {id: "window.project", key: windowProjectKey, create: () => ({project})},
                        {id: "window.connection", key: windowConnectionKey, create: () => link.connection},
                        {id: "clock", key: clockKey, create: () => clock},
                    ],
                    plugins: [diagnosticsFor("browser", id), settingsBrowserPlugin, ...plugins],
                    gates: [],
                    remote: node,
                    delegation: DELEGATION,
                },
            ));
            return {
                app,
                disconnect: () => {
                    pair.left.close();
                    link.set("offline");
                },
                reconnect: async () => {
                    pair = createLinkPair();
                    router.accept(pair.right);
                    const result = await node.connect(pair.left);
                    if (result.ok) link.set("online");
                    return result;
                },
            };
        },
        close: async () => {
            const results: StopResult[] = [];
            for (const app of apps.splice(0).reverse()) results.push(await app.stop());
            router.close();
            return results;
        },
    };
}

function linkState(): {readonly connection: WindowConnection; set(state: WindowConnectionState): void} {
    let current: WindowConnectionState = "offline";
    const listeners = new Set<(state: WindowConnectionState) => void>();
    return {
        connection: {
            state: () => current,
            onChange: (listener) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        },
        set: (state) => {
            if (state === current) return;
            current = state;
            for (const listener of [...listeners]) listener(state);
        },
    };
}
