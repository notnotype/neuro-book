/**
 * 窗口运行实例的启动与状态（runtime.browser-host 启动序列第 2–5 步）：取引导集合，连上内核 RPC 端口，按集合登记
 * 本外壳构建进去的浏览器插件，激活 `nbook.workbench` 并解析它交出的根界面。解析到根界面之前窗口不是 ready，
 * 界面据此只在工作台与失败页之间二选一，不出现半个工作台。首连先于建立运行实例：插件激活时远程服务已可用。
 * 可用之后链路断开只把 ready 标成离线并退避重连；服务端已换进程时转入只能刷新的 `server-restarted`，绑定的项目
 * 代次已结束时转入 `project-gone`。地址栏指定了项目时首连同时绑定它，绑定结果随 ready 给出，并以本地能力
 * `windowProjectKey` 交给本窗口的插件；整页导航同样以本地能力 `windowNavigationKey` 交出。
 *
 * 不依赖 Vue 与 DOM：连接对象、页面事件目标、console 与时钟由装配方传入，界面经 `onChange` 订阅状态。
 */

import type {StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {Value} from "typebox/value";

import {definitionAt, delegatingPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {workbenchRootKey} from "nbook/plugins/workbench/web/contracts";
import type {WorkbenchRoot} from "nbook/plugins/workbench/web/contracts";
import {BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema, declaredProtocolVersion} from "nbook/shared/browser-bootstrap";
import {clockKey, windowConnectionKey, windowNavigationKey} from "nbook/shared/host";
import type {WindowConnection, WindowConnectionState} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import type {WindowProject} from "nbook/shared/projects";

import {browserHostPlugins, browserPluginDefinitions, builtinBrowserPlugins, isBrowserHostPlugin} from "../plugins";
import type {BrowserHostPluginFactory, BrowserHostPluginId, BrowserPluginContext} from "../plugins";
import {BrowserRuntimeHost} from "./browser-host";
import type {BrowserHost, PageLifecycleTarget} from "./browser-host";
import type {Connection, RpcEndpoint} from "./connection";
import {createRemoteSession} from "./remote-session";
import type {RemoteSession} from "./remote-session";

/** `connection-failed` 与 `project-unavailable` 可以原地重试；其余要刷新页面。 */
export type WindowFailure = "connection-failed" | "project-unavailable" | "incompatible" | "startup-failed" | "server-restarted" | "project-gone";

export type WindowState =
    | {readonly status: "idle" | "starting" | "closed"}
    /** `connection` 是远程服务链路：断开时界面保留、标注离线，重连成功后回到 online。 */
    | {readonly status: "ready"; readonly instanceId: string; readonly root: WorkbenchRoot; readonly connection: "online" | "offline"; readonly project: WindowProject["project"]}
    /** connection-failed 可以原地重试；其余要刷新页面（换外壳，或与新的服务端进程重新握手）才可能恢复。 */
    | {readonly status: WindowFailure; readonly reason: string};

export type ReadyWindowState = Extract<WindowState, {status: "ready"}>;

export interface BrowserWindowOptions {
    readonly connection: Connection;
    readonly page: PageLifecycleTarget;
    readonly console: DiagnosticsConsole;
    /** 整页加载到 `href`（生产是 `location.assign`）：以本地能力交给需要整页导航的插件，例如“打开项目”。 */
    readonly navigateDocument: (href: string) => void;
    /** 地址栏 `project` 参数（短名或 id）：首连时请求绑定它；没有则窗口不绑定项目。 */
    readonly project?: string | null;
    /**
     * 本外壳构建进去的浏览器插件、普通插件的定义与宿主适配器的工厂；缺省按产品清单与 `plugins.ts` 的两张表。
     * 测试经这里换入自己的插件，产品代码不含测试分支。
     */
    readonly builtin?: ReadonlyArray<PluginDescriptor>;
    readonly definitions?: Readonly<Record<string, PluginDefinition>>;
    readonly hostPlugins?: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>>;
    /** 客户端身份（`client-identity.ts`），随握手发给服务端；缺省每个窗口各取一个随机值，不跨刷新。 */
    readonly clientIdentity?: string;
    /** 重连退避与远程调用超时的时钟；缺省系统时钟。 */
    readonly clock?: RuntimeClock;
}

export interface BrowserWindow {
    readonly state: WindowState;
    onChange(listener: (state: WindowState) => void): () => void;
    /** 首次启动，或在连接失败后重试；其它状态下不重新启动。并发调用共享同一次启动。 */
    start(): Promise<void>;
    /** 结束窗口：之后不再启动；已建立的运行实例按依赖逆序停止。 */
    stop(): Promise<StopResult>;
}

/**
 * 缺少或入口激活失败就不能挂载界面：工作台交出根界面，诊断要先于其它插件可用，工作台的命令面板与键位依赖命令系统，
 * 命令系统的 `when` 读公开状态。其余插件的入口失败只影响该入口，窗口照常就绪。
 */
const REQUIRED_PLUGINS = ["nbook.diagnostics", "nbook.state", "nbook.commands", "nbook.workbench"];

/** 引导集合不能用于本外壳；`kind` 决定界面给“刷新”还是只显示原因。 */
class BootstrapRejected extends Error {
    readonly kind: Exclude<WindowFailure, "connection-failed">;

    constructor(kind: Exclude<WindowFailure, "connection-failed">, message: string) {
        super(message);
        this.name = "BootstrapRejected";
        this.kind = kind;
    }
}

export function createBrowserWindow(options: BrowserWindowOptions): BrowserWindow {
    const builtin = options.builtin ?? builtinBrowserPlugins;
    const definitions = options.definitions ?? browserPluginDefinitions;
    const hostPlugins = options.hostPlugins ?? browserHostPlugins;
    const navigation = Object.freeze({navigateDocument: (href: string) => options.navigateDocument(href)});
    const clock = options.clock ?? systemClock;
    const clientIdentity = options.clientIdentity ?? crypto.randomUUID();
    const adapter = new BrowserRuntimeHost();
    const listeners = new Set<(state: WindowState) => void>();
    let state: WindowState = {status: "idle"};
    let host: BrowserHost | null = null;
    let session: RemoteSession | null = null;
    let starting: Promise<void> | null = null;
    let closed = false;

    const setState = (next: WindowState): void => {
        state = next;
        for (const listener of listeners) listener(next);
    };

    const boot = async (): Promise<void> => {
        setState({status: "starting"});
        let raw: unknown;
        try {
            raw = await options.connection.bootstrap();
        } catch (error) {
            if (!closed) setState({status: "connection-failed", reason: describe(error)});
            return;
        }
        if (closed) return;
        let selected: SelectedPlugin[];
        let endpoint: RpcEndpoint;
        try {
            ({selected, endpoint} = selectPlugins(raw, builtin, definitions, hostPlugins));
        } catch (error) {
            if (!(error instanceof BootstrapRejected)) throw error;
            setState({status: error.kind, reason: error.message});
            return;
        }

        const instanceId = crypto.randomUUID();
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId}});
        const link = createLinkState((error) => store.record({level: "warn", event: "browser-host.connection-listener.failed", message: "连接状态的监听抛错", error}));
        const node = createRemoteNode({
            instance: {id: instanceId, kind: "browser", role: "client", project: null, client: clientIdentity},
            bind: options.project === undefined || options.project === null ? null : {project: options.project},
            clock,
            observer: {diagnosticRecorded: (diagnostic) => store.record({level: "warn", event: `remote.${diagnostic.reason}`, message: "远程服务诊断", data: diagnostic})},
        });
        const current = createRemoteSession({
            connection: options.connection,
            node,
            clock,
            onState: (next, reason) => {
                if (next === "online" || next === "offline") link.set(next);
                // 只改写这一次启动的 ready；窗口已关闭或已换成别的状态时不再理会旧链路。
                if (state.status !== "ready" || state.instanceId !== instanceId) return;
                if (next === "online" || next === "offline") setState({...state, connection: next});
                else setState({status: next, reason: reason ?? next});
                if (next === "server-restarted" || next === "project-gone" || next === "incompatible") void host?.destroy();
            },
            onRetryFailed: (reason) => store.record({level: "info", event: "browser-host.reconnect.failed", message: "重连没有成功，稍后再试", data: {reason}}),
        });
        session = current;
        const first = await current.start(endpoint);
        if (!first.ok) {
            current.close();
            if (!closed) setState({status: first.failure, reason: first.reason});
            return;
        }
        if (closed) {
            current.close();
            return;
        }
        link.set("online");
        let root: WorkbenchRoot | null = null;
        // 首连之后绑定已定，窗口一生不变。
        const project: WindowProject["project"] = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, generation: node.binding.generation};
        try {
            const context: BrowserPluginContext = {store, console: options.console};
            // 登记看的是定义里的 id，引导集合与必需插件看的是表项的 id：两者不一致时不装，否则会装进集合之外的插件。
            const plugins = selected.map((plugin) => {
                const definition = plugin.kind === "host" ? plugin.factory(context) : plugin.definition;
                if (definition.id !== plugin.id) throw new Error(`浏览器插件 ${plugin.id} 的装配定义是插件 ${definition.id}`);
                return definition;
            });
            host = adapter.start({
                instanceId,
                client: clientIdentity,
                page: options.page,
                emergency: recordingEmergency(store, (report) => {
                    Reflect.apply(options.console.error, options.console, [JSON.stringify({emergency: report})]);
                }),
                manifest: {
                    capabilities: [
                        {id: "window.project", key: windowProjectKey, create: () => Object.freeze({project})},
                        {id: "window.navigation", key: windowNavigationKey, create: () => navigation},
                        {id: "window.connection", key: windowConnectionKey, create: () => link.connection},
                        {id: "clock", key: clockKey, create: () => clock},
                    ],
                    plugins,
                    requiredPlugins: REQUIRED_PLUGINS,
                    gates: [{
                        id: "workbench-root",
                        kind: "check",
                        dependencies: [{key: workbenchRootKey}],
                        async check({services}) {
                            const resolved = await services.resolve(workbenchRootKey);
                            if (resolved.status !== "resolved") throw new Error(resolved.reason);
                            root = resolved.instance;
                        },
                    }],
                    observers: mechanismObservers(store),
                    remote: node,
                    delegation: (plugin) => delegatingPlugins.includes(plugin),
                },
            });
            const application = host.application;
            // 页面卸载或显式停止后，这个实例对应的 ready 状态失效；更晚的启动尝试有自己的 instanceId，不受影响。
            // 链路在插件全部停止之后才关：插件停止时还要经它释放远程门面。
            void application.stopped.then(() => {
                current.close();
                if (state.status === "ready" && state.instanceId === instanceId) setState({status: "closed"});
            });
            const startup = await application.startup;
            if (closed) return;
            if (startup.status !== "available" || root === null) {
                throw new Error(startup.failures.map((failure) => `${failure.source}：${failure.error?.message ?? failure.reason}`).join("；") || `运行实例 ${startup.status}`);
            }
            setState({status: "ready", instanceId, root, connection: "online", project});
        } catch (error) {
            store.record({level: "error", event: "browser-host.startup.failed", message: "窗口运行实例启动失败", error});
            await host?.destroy();
            current.close();
            if (!closed) setState({status: "startup-failed", reason: describe(error)});
        }
    };

    return {
        get state() {
            return state;
        },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start() {
            if (starting !== null) return starting;
            if (closed || (state.status !== "idle" && state.status !== "connection-failed" && state.status !== "project-unavailable")) return Promise.resolve();
            starting = boot().finally(() => {
                starting = null;
            });
            return starting;
        },
        async stop() {
            closed = true;
            setState({status: "closed"});
            const result: StopResult = host === null ? {status: "closed"} : await host.destroy();
            session?.close();
            return result;
        },
    };
}

/**
 * 按引导响应选出要登记的插件。协议版本先于结构校验：新版本的服务端可能改了结构，此时应提示刷新而不是报格式错误。
 * 服务端启用了本外壳没有的插件或版本不同，说明外壳与服务端不是同一次构建，刷新即可对齐。
 */
type SelectedPlugin =
    | {readonly id: string; readonly kind: "definition"; readonly definition: PluginDefinition}
    | {readonly id: string; readonly kind: "host"; readonly factory: BrowserHostPluginFactory};

function selectPlugins(
    raw: unknown,
    builtin: ReadonlyArray<PluginDescriptor>,
    definitions: Readonly<Record<string, PluginDefinition>>,
    hostPlugins: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>>,
): {readonly selected: SelectedPlugin[]; readonly endpoint: RpcEndpoint} {
    const version = declaredProtocolVersion(raw);
    if (version !== null && version !== BROWSER_PROTOCOL_VERSION) {
        throw new BootstrapRejected("incompatible", `服务端的引导协议版本是 ${String(version)}，本页面是 ${String(BROWSER_PROTOCOL_VERSION)}`);
    }
    if (!Value.Check(BrowserBootstrapSchema, raw)) throw new BootstrapRejected("startup-failed", "引导响应的结构不符合协议");
    const selected: SelectedPlugin[] = [];
    for (const plugin of raw.plugins) {
        if (selected.some((item) => item.id === plugin.id)) throw new BootstrapRejected("startup-failed", `引导集合中插件重复：${plugin.id}`);
        const local = builtin.find((item) => item.id === plugin.id);
        if (local === undefined || local.version !== plugin.version) {
            throw new BootstrapRejected("incompatible", `本页面没有服务端启用的浏览器插件 ${plugin.id}@${plugin.version}`);
        }
        if (isBrowserHostPlugin(plugin.id)) {
            selected.push({id: plugin.id, kind: "host", factory: hostPlugins[plugin.id]});
            continue;
        }
        // 没有浏览器入口的插件只登记描述里的顶层声明（runtime/plugin-manifest.md 输出 11）。
        const definition = definitions[plugin.id];
        if (local.locations.includes("browser") && definition === undefined) throw new BootstrapRejected("startup-failed", `浏览器插件 ${plugin.id} 没有装配定义`);
        try {
            selected.push({id: plugin.id, kind: "definition", definition: definitionAt("browser", local, definition)});
        } catch (error) {
            throw new BootstrapRejected("startup-failed", describe(error));
        }
    }
    for (const id of REQUIRED_PLUGINS) {
        if (!selected.some((item) => item.id === id)) throw new BootstrapRejected("startup-failed", `引导集合缺少必需插件 ${id}`);
    }
    return {selected, endpoint: raw.rpc};
}

/** 一次启动的链路状态与交给插件的只读视图；监听抛错交给 `report`，不影响其它监听与链路。 */
function createLinkState(report: (error: unknown) => void): {readonly connection: WindowConnection; set(next: WindowConnectionState): void} {
    let current: WindowConnectionState = "offline";
    const listeners = new Set<(state: WindowConnectionState) => void>();
    return {
        connection: Object.freeze({
            state: () => current,
            onChange(listener: (state: WindowConnectionState) => void): () => void {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        }),
        set(next) {
            if (next === current) return;
            current = next;
            for (const listener of [...listeners]) {
                try {
                    listener(next);
                } catch (error) {
                    report(error);
                }
            }
        },
    };
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
