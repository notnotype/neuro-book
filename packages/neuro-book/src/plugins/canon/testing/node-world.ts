/**
 * 进程内的世界场地：服务端路由、项目 `book` 的实例（装真实的 `nbook.canon` 项目入口：世界宿主、分段日志、锁与活页夹监视）
 * 与浏览器窗口（装 `nbook.canon` 的浏览器入口），全在本进程里，经进程内链路相连。帧经 JSON 编解码，与产品里的 Bun IPC、
 * WebSocket 一样。
 *
 * 与 `harness.ts` 的分工：那边的项目实例是真实的子进程（`bun:test` 专用，起子进程用 Bun 的接口），这里不起子进程，所以在
 * Vitest（Node）里也能用，组件测试拿它接真实的世界客户端。断线、项目结束这些路径由场地真实造出来：`disconnect()` 关掉窗口
 * 的链路，`endProject()` 停项目实例。只由测试使用，不含断言。
 */

import {join} from "node:path";

import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {currentProjectKey, windowProjectKey} from "nbook/shared/projects";

import {canonProjectPlugin} from "../backend/plugin";
import {canonClientKey} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import {descriptor} from "../plugin";
import {canonBrowserPlugin} from "../web/plugin";

export interface CanonNodeWindow {
    readonly canon: CanonClient;
    /** 关掉窗口的链路（网络断开），窗口实例不停。 */
    disconnect(): void;
    close(): Promise<void>;
}

export interface CanonNodeWorld {
    /** 项目目录（活页夹与世界日志都在它下面）。 */
    readonly project: string;
    /** 绑定 `book` 的窗口；`extra` 是窗口里另装的插件（例如要测的界面入口）。 */
    window(id: string, extra?: readonly PluginDefinition[]): Promise<CanonNodeWindow>;
    /** 停项目实例：窗口的订阅收到 `ended`，之后的调用得到路由的失败。 */
    endProject(): Promise<void>;
    /** 停窗口、项目实例与服务端，逆序。 */
    close(): Promise<void>;
}

type Identity = Parameters<typeof createApplication>[0];

const silent = {error: () => undefined};
const diagnosticsFor = (location: string, instanceId: string): PluginDefinition =>
    createDiagnosticsPlugin({location, store: createDiagnosticsStore({identity: {location, instanceId}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
const identity = (location: string, instanceId: string, client?: string): Identity => ({identity: {location, instanceId, ...(client === undefined ? {} : {client})}, stopSignal: new AbortController().signal, emergency: () => undefined} as Identity);

async function started(app: Application, apps: Application[], what: string): Promise<Application> {
    apps.push(app);
    const startup = await app.startup;
    if (startup.status !== "available" || startup.failures.length > 0) throw new Error(`${what}没有正常启动：${JSON.stringify(startup)}`);
    return app;
}

/** 在 `root` 下建项目目录 `Book` 并打开世界；第一次读要等世界打开（调用方按 `status` 或事件等）。 */
export async function canonNodeWorld(root: string): Promise<CanonNodeWorld> {
    const apps: Application[] = [];
    const project = join(root, "Book");
    const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    await started(createApplication(identity("server", "hub"), {plugins: [diagnosticsFor("server", "hub")], gates: [], remote: hubNode}), apps, "服务端");

    // 绑定从不撤销：撤销会让路由直接关掉窗口的链路，测的就成了断线；项目结束时窗口看到的是订阅结束（`endProject`）。
    let projectEnded = false;
    const router = createRemoteRouter(hubNode, {
        bindProject: async () => (projectEnded ? {ok: false, reason: "project-gone", message: "项目已结束"} : {ok: true, binding: {id: "P", name: "book", generation: 1}, revoked: new AbortController().signal, release: () => undefined}),
    });

    const instance: InstanceDescriptor = {id: "project:P#1", kind: "project", role: "project", project: {id: "P", generation: 1}, client: null};
    const projectNode = createRemoteNode({instance});
    const projectApp = createApplication(identity("project", instance.id), {
        capabilities: [{id: "project.current", key: currentProjectKey, create: () => ({id: "P", name: "book", generation: 1, root: project})}],
        plugins: [diagnosticsFor("project", instance.id), definitionAt("project", descriptor, canonProjectPlugin)],
        gates: [],
        remote: projectNode,
    });
    const projectPair = createLinkPair();
    router.accept(projectPair.right, {expect: instance});
    const connected = await projectNode.connect(projectPair.left);
    if (!connected.ok) throw new Error(`项目实例连不上路由：${JSON.stringify(connected)}`);
    await started(projectApp, apps, "项目实例");

    return {
        project,
        window: async (id, extra = []) => {
            const client = `client-${id}`;
            const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: {project: "book"}});
            const pair = createLinkPair();
            router.accept(pair.right);
            const bound = await node.connect(pair.left);
            if (!bound.ok) throw new Error(`窗口 ${id} 连不上路由：${JSON.stringify(bound)}`);
            const binding = node.binding!;
            let canon: CanonClient | null = null;
            const app = await started(createApplication(identity("browser", id, client), {
                capabilities: [{id: "window.project", key: windowProjectKey, create: () => ({project: {id: binding.id, name: binding.name, generation: binding.generation}})}],
                plugins: [
                    definitionAt("browser", descriptor, canonBrowserPlugin),
                    ...extra,
                    {id: "test.canon-user", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}], activate: (context) => {
                        canon = context.services.require(canonClientKey);
                        return {};
                    }}]},
                ],
                gates: [],
                remote: node,
            }), apps, `窗口 ${id}`);
            return {
                canon: canon!,
                disconnect: () => pair.left.close(),
                close: async () => {
                    apps.splice(apps.indexOf(app), 1);
                    await app.stop();
                    pair.left.close();
                },
            };
        },
        endProject: async () => {
            const index = apps.indexOf(projectApp);
            if (index < 0) return;
            apps.splice(index, 1);
            projectEnded = true;
            await projectApp.stop();
            projectPair.left.close();
        },
        close: async () => {
            for (const app of apps.splice(0).reverse()) await app.stop();
            projectPair.left.close();
        },
    };
}
