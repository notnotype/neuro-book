/**
 * 示例场景的场地：像产品宿主（`src/server/`、`src/project/`、`src/web/`）那样，把内置插件与示例插件装进运行实例，
 * 并给出宿主能力。只由场景测试使用，不含断言。
 *
 * 每个实例装的内置插件与产品宿主的定义表一致：诊断、`nbook.state`、`nbook.settings`、`nbook.storage`，服务端与窗口
 * 另有 `nbook.commands`。除了 `nbook.settings` 的服务端与项目入口（启动即读配置文件、开始监视），内置插件都不在启动
 * 时激活，有入口依赖它们、或有远程调用到达时才激活，所以场景只为用到的东西付出启动成本。
 *
 * 宿主能力：服务端给状态根（`<root>/state`，`nbook.storage` 的 user 分区与用户的 `settings.json` 都在它下面）与时钟；
 * 项目实例给当前项目（目录 `<root>/projects/<名>`）；窗口给它绑定的项目与连接状态。时钟是 `StageClock`，只在场景
 * 调用 `advance` 时前进；内置插件用的产品时钟（`clockKey`）与示例插件用的时钟（`hostClockKey`）是同一个。
 *
 * 跨实例：服务端带路由，项目实例与窗口经 `@notnotype/nb-runtime/remote/testing` 的进程内链路连上它，帧照样经 JSON
 * 编解码；产品里项目实例在子进程里经 Bun IPC 连接，窗口经 WebSocket 连接。窗口按项目名绑定项目此刻运行的那一代，
 * 同一项目上一代停完才能起下一代。示例不演示项目的打开、租约与宽限期（归 `src/server/projects/`）。
 *
 * `close()` 逆序停止全部实例（窗口与项目先于服务端），再关路由；场景在 `afterEach` 里调用它，失败的用例也收口。
 * 磁盘上的数据（SQLite）留在 `root` 下：同一个场地再起服务端，读到的是上一次写下的数据。
 */

import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application, CapabilityProvider, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {CloseResult} from "@notnotype/nb-runtime/lifecycle";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor, RemoteLink, RemoteNode, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";

import {definitionAt, delegatingPlugins} from "nbook/manifest";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {settingsBackendPlugin} from "nbook/plugins/settings/backend/plugin";
import {descriptor as settingsDescriptor} from "nbook/plugins/settings/plugin";
import {settingsBrowserCore} from "nbook/plugins/settings/web/plugin";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {clockKey, stateRootKey, windowConnectionKey} from "nbook/shared/host";
import {currentProjectKey, windowProjectKey} from "nbook/shared/projects";

import {hostClockKey} from "../shared/host";
import type {HostClock} from "../shared/host";

/** 场地的时钟：手动推进，并能数出插件还占着几个计时器（核对插件停止时有没有把它们还回来）。 */
export class StageClock implements HostClock {
    readonly #manual = new ManualClock();
    readonly #pending = new Set<object>();

    now(): number {
        return this.#manual.now();
    }

    schedule(callback: () => void, ms: number): () => void {
        const timer = {};
        this.#pending.add(timer);
        const cancel = this.#manual.schedule(() => {
            this.#pending.delete(timer);
            callback();
        }, ms);
        return () => {
            this.#pending.delete(timer);
            cancel();
        };
    }

    /** 前进 `ms` 毫秒，同步执行到点的回调。 */
    advance(ms: number): void {
        this.#manual.advance(ms);
    }

    /** 已登记、还没触发也没取消的计时器个数。 */
    pending(): number {
        return this.#pending.size;
    }
}

export interface InstanceOptions {
    /** 本实例要装的示例插件或测试插件；内置插件由场地按运行位置装上。 */
    readonly plugins: ReadonlyArray<PluginDefinition>;
    /**
     * 代理允许清单里另加的插件。产品第一版只允许内置插件以调用方身份代理（`src/manifest.ts` 的 `delegatingPlugins`），
     * 场地总是带上它们；示例要演示第三方插件的代理时在这里加。
     */
    readonly delegation?: ReadonlyArray<string>;
}

/** 一个项目：代次单调递增，同一时刻至多一代在运行。 */
interface Project {
    generation: number;
    /** 当前这一代；停止完成前不清空，下一代要等它停完才能起。 */
    current: {readonly app: Application; readonly link: RemoteLink; stopping: boolean} | null;
}

export class Stage {
    /** 宿主时钟；服务端实例默认把它作为能力给出。 */
    readonly clock = new StageClock();
    readonly #root: string;
    readonly #apps: Application[] = [];
    readonly #routers: RemoteRouter[] = [];
    readonly #projects = new Map<string, Project>();
    readonly #windows = new Map<string, {readonly node: RemoteNode; link: RemoteLink}>();
    readonly #diagnostics = new Map<string, DiagnosticsStore>();

    /** `root` 是场景自己的临时目录（`createTestTmpRoot`），由场景在结束时删除。 */
    constructor(root: string) {
        this.#root = root;
    }

    /**
     * 服务端实例与它的路由（实例 id `hub`）：项目实例与窗口经路由连上来。`clock: false` 时宿主不给时钟能力，演示依赖
     * 宿主能力的插件怎样受阻。
     */
    async server(options: InstanceOptions & {readonly clock?: boolean}): Promise<{readonly app: Application; readonly router: RemoteRouter}> {
        const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
        const capabilities: Capabilities = [
            {id: "host.state-root", key: stateRootKey, create: () => ({path: join(this.#root, "state")})},
            {id: "host.product-clock", key: clockKey, create: () => this.clock},
        ];
        if (options.clock !== false) capabilities.push({id: "host.clock", key: hostClockKey, create: () => this.clock});
        const app = await this.#start({location: "server", instanceId: "hub"}, [statePlugin, definitionAt("server", settingsDescriptor, settingsBackendPlugin), commandsPlugin, storageBackendPlugin], capabilities, options, node);
        const router = createRemoteRouter(node, {
            // 窗口按项目名绑定到它此刻运行的那一代。产品里由项目管理器负责（打开、租约、宽限期）；场地只按名字找。
            bindProject: async (request) => {
                const project = this.#projects.get(request.project);
                const live = project !== undefined && project.current !== null && !project.current.stopping;
                // 带代次的是重连：那一代不在了就是终态 project-gone，窗口不会转去绑定别的代次；首次按名字绑定时项目
                // 没在运行，才是可以重试的 project-unavailable。
                if ("generation" in request) {
                    if (!live || request.generation !== project.generation) {
                        return {ok: false, reason: "project-gone", message: `项目 ${request.project} 的第 ${String(request.generation)} 代已经结束`};
                    }
                } else if (!live) {
                    return {ok: false, reason: "project-unavailable", message: `项目 ${request.project} 没有打开`};
                }
                return {ok: true, binding: {id: request.project, name: request.project, generation: project.generation}, revoked: new AbortController().signal, release: () => undefined};
            },
        });
        this.#routers.push(router);
        return {app, router};
    }

    /** 起项目 `name` 的下一代实例（产品里是一个项目子进程），经路由登记。上一代要先 `await stopProject(name)`。 */
    async project(router: RemoteRouter, name: string, options: InstanceOptions): Promise<Application> {
        const project = this.#projects.get(name) ?? {generation: 0, current: null};
        if (project.current !== null) throw new Error(`项目 ${name} 的第 ${String(project.generation)} 代还没停止；先 await stopProject("${name}")`);
        this.#projects.set(name, project);
        project.generation += 1;
        const generation = project.generation;
        const descriptor: InstanceDescriptor = {id: `project:${name}#${String(generation)}`, kind: "project", role: "project", project: {id: name, generation}, client: null};
        const node = createRemoteNode({instance: descriptor});
        const link = createLinkPair();
        router.accept(link.right, {expect: descriptor});
        const connected = await node.connect(link.left);
        if (!connected.ok) throw new Error(`项目 ${name} 连不上服务端：${connected.reason}`);
        const current = {id: name, name, generation, root: join(this.#root, "projects", name)};
        const capabilities: Capabilities = [{id: "project.current", key: currentProjectKey, create: () => current}, {id: "host.product-clock", key: clockKey, create: () => this.clock}];
        const app = await this.#start({location: "project", instanceId: descriptor.id}, [statePlugin, definitionAt("project", settingsDescriptor, settingsBackendPlugin), storageBackendPlugin], capabilities, options, node);
        project.current = {app, link: link.left, stopping: false};
        return app;
    }

    /** 结束项目 `name` 正在运行的这一代：停止它的实例、断开它的链路（产品里是项目子进程退出）。 */
    async stopProject(name: string): Promise<StopResult> {
        const current = this.#projects.get(name)?.current ?? null;
        if (current === null || current.stopping) throw new Error(`项目 ${name} 没有在运行`);
        current.stopping = true;
        const result = await current.app.stop();
        current.link.close();
        this.#projects.get(name)!.current = null;
        return result;
    }

    /**
     * 浏览器窗口实例：先连上服务端的路由，再起运行实例。`client` 是客户端身份（同一浏览器的窗口共用）；`project`
     * 是窗口绑定的项目名（地址栏的 `/?project=`），不给时窗口不绑定项目。
     */
    async window(router: RemoteRouter, id: string, options: InstanceOptions & {readonly client?: string; readonly project?: string}): Promise<Application> {
        const client = options.client ?? "profile-1";
        const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client}, bind: options.project === undefined ? null : {project: options.project}});
        const link = createLinkPair();
        router.accept(link.right);
        const connected = await node.connect(link.left);
        if (!connected.ok) throw new Error(`窗口 ${id} 连不上服务端：${connected.reason}`);
        this.#windows.set(id, {node, link: link.left});
        const binding = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
        const capabilities: Capabilities = [
            {id: "window.project", key: windowProjectKey, create: () => ({project: binding})},
            {id: "window.product-clock", key: clockKey, create: () => this.clock},
            // 场地不演示窗口的断线恢复（场景直接重连节点），连接状态一直是在线。
            {id: "window.connection", key: windowConnectionKey, create: () => ({state: () => "online" as const, onChange: () => () => undefined})},
        ];
        return this.#start({location: "browser", instanceId: id, client}, [statePlugin, definitionAt("browser", settingsDescriptor, settingsBrowserCore), commandsPlugin, storageBrowserPlugin], capabilities, options, node);
    }

    /** 窗口 `id` 断线后换一条链路重连（产品里是浏览器的退避重连），返回握手结果。 */
    async reconnect(router: RemoteRouter, id: string): Promise<Awaited<ReturnType<RemoteNode["connect"]>>> {
        const window = this.#windows.get(id);
        if (window === undefined) throw new Error(`没有窗口 ${id}`);
        window.link.close();
        const link = createLinkPair();
        router.accept(link.right);
        window.link = link.left;
        return window.node.connect(link.left);
    }

    /**
     * 在 `app` 里另装一个插件，放在它自己的子作用域里并激活入口 `entry`；返回的 `stop()` 关掉这个作用域，也就停止了
     * 这个插件（产品里对应停用或卸载插件）。用来演示“调用方停止之后会怎样”。
     */
    async attach(app: Application, definition: PluginDefinition, entry: string): Promise<{stop(): Promise<CloseResult>}> {
        const scope = app.root.createChild(definition.id);
        scope.open();
        const registered = app.plugins.register(definition, {scope});
        if (registered.status !== "accepted") throw new Error(`插件 ${definition.id} 没有登记上：${JSON.stringify(registered)}`);
        const activated = await app.plugins.activate({plugin: definition.id, entry});
        if (activated.status !== "activated") throw new Error(`插件 ${definition.id} 的入口 ${entry} 没有激活：${JSON.stringify(activated)}`);
        return {stop: () => scope.close()};
    }

    /** 实例的诊断记录（按实例 id：服务端是 `hub`）。 */
    diagnostics(instanceId: string): DiagnosticsStore {
        const store = this.#diagnostics.get(instanceId);
        if (store === undefined) throw new Error(`没有实例 ${instanceId}`);
        return store;
    }

    /** 逆序停止全部实例（窗口与项目先于服务端），再关路由。之后可以在同一个 `root` 上重新起实例。 */
    async close(): Promise<ReadonlyArray<StopResult>> {
        const results: StopResult[] = [];
        for (const app of this.#apps.splice(0).reverse()) results.push(await app.stop());
        for (const router of this.#routers.splice(0)) router.close();
        this.#projects.clear();
        this.#windows.clear();
        return results;
    }

    async #start(
        identity: {readonly location: string; readonly instanceId: string; readonly client?: string},
        builtins: ReadonlyArray<PluginDefinition>,
        capabilities: Capabilities,
        options: InstanceOptions,
        remote: RemoteNode,
    ): Promise<Application> {
        const store = createDiagnosticsStore({identity});
        this.#diagnostics.set(identity.instanceId, store);
        // 诊断照常记进内存（场景可以查询），只是不输出到控制台。
        const silent = {error: () => undefined};
        const diagnostics = createDiagnosticsPlugin({location: identity.location, store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
        const delegation = new Set([...delegatingPlugins, ...(options.delegation ?? [])]);
        const app = createApplication(
            // 宿主给出的上下文：实例身份、停止来源、紧急输出。
            {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
            {capabilities, plugins: [diagnostics, ...builtins, ...options.plugins], gates: [], remote, delegation: (plugin) => delegation.has(plugin)},
        );
        this.#apps.push(app);
        const startup = await app.startup;
        if (startup.status !== "available" || startup.failures.length > 0) throw new Error(`实例 ${identity.instanceId} 没有正常启动：${JSON.stringify(startup)}`);
        return app;
    }
}

type Capabilities = CapabilityProvider[];
