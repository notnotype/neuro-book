/**
 * 窗口运行实例的启动与状态（runtime.browser-host 启动序列第 2–4 步）：取引导集合，按集合登记本外壳构建进去的
 * 浏览器插件，激活 `nbook.workbench` 并解析它交出的根界面。解析到根界面之前窗口不是 ready，界面据此只在
 * 工作台与失败页之间二选一，不出现半个工作台。
 *
 * 不依赖 Vue 与 DOM：连接对象、页面事件目标与 console 由装配方传入，界面经 `onChange` 订阅状态。
 */

import type {StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency} from "@notnotype/nb-runtime/diagnostics";
import {Value} from "typebox/value";

import type {PluginDescriptor} from "nbook/manifest";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {workbenchRootKey} from "nbook/plugins/workbench/web/contracts";
import type {WorkbenchRoot} from "nbook/plugins/workbench/web/contracts";
import {BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema} from "nbook/shared/browser-bootstrap";
import {collectServiceKeys} from "nbook/shared/service-keys";

import {browserPluginFactories, builtinBrowserPlugins} from "../plugins";
import type {BrowserPluginFactory} from "../plugins";
import {BrowserRuntimeHost} from "./browser-host";
import type {BrowserHost, PageLifecycleTarget} from "./browser-host";
import type {Connection} from "./connection";

export type WindowFailure = "connection-failed" | "incompatible" | "startup-failed";

export type WindowState =
    | {readonly status: "idle" | "starting" | "closed"}
    | {readonly status: "ready"; readonly instanceId: string; readonly root: WorkbenchRoot}
    /** connection-failed 可以原地重试；其余两种要刷新页面（换外壳或换服务端）才可能恢复。 */
    | {readonly status: WindowFailure; readonly reason: string};

export type ReadyWindowState = Extract<WindowState, {status: "ready"}>;

export interface BrowserWindowOptions {
    readonly connection: Connection;
    readonly page: PageLifecycleTarget;
    readonly console: DiagnosticsConsole;
    /** 本外壳构建进去的浏览器插件及其工厂；缺省按产品清单。测试经这里换入自己的插件，产品代码不含测试分支。 */
    readonly builtin?: ReadonlyArray<PluginDescriptor>;
    readonly factories?: Readonly<Record<string, BrowserPluginFactory>>;
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
 * 缺少或入口激活失败就不能挂载界面：工作台交出根界面，诊断要先于其它插件可用。其余插件的入口失败只影响该入口，
 * 窗口照常就绪。
 */
const REQUIRED_PLUGINS = ["nbook.diagnostics", "nbook.workbench"];

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
    const factories = options.factories ?? browserPluginFactories;
    const adapter = new BrowserRuntimeHost();
    const listeners = new Set<(state: WindowState) => void>();
    let state: WindowState = {status: "idle"};
    let host: BrowserHost | null = null;
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
        try {
            selected = selectPlugins(raw, builtin, factories);
        } catch (error) {
            if (!(error instanceof BootstrapRejected)) throw error;
            setState({status: error.kind, reason: error.message});
            return;
        }

        const instanceId = crypto.randomUUID();
        const store = createDiagnosticsStore({identity: {location: "browser", instanceId}});
        let root: WorkbenchRoot | null = null;
        try {
            const plugins = selected.map(({factory}) => factory({store, console: options.console}));
            host = adapter.start({
                instanceId,
                page: options.page,
                emergency: recordingEmergency(store, (report) => {
                    Reflect.apply(options.console.error, options.console, [JSON.stringify({emergency: report})]);
                }),
                manifest: {
                    keys: collectServiceKeys(plugins, [workbenchRootKey]),
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
                },
            });
            const application = host.application;
            // 页面卸载或显式停止后，这个实例对应的 ready 状态失效；更晚的启动尝试有自己的 instanceId，不受影响。
            void application.stopped.then(() => {
                if (state.status === "ready" && state.instanceId === instanceId) setState({status: "closed"});
            });
            const startup = await application.startup;
            if (closed) return;
            if (startup.status !== "available" || root === null) {
                throw new Error(startup.failures.map((failure) => `${failure.source}：${failure.error?.message ?? failure.reason}`).join("；") || `运行实例 ${startup.status}`);
            }
            setState({status: "ready", instanceId, root});
        } catch (error) {
            store.record({level: "error", event: "browser-host.startup.failed", message: "窗口运行实例启动失败", error});
            await host?.destroy();
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
            if (closed || (state.status !== "idle" && state.status !== "connection-failed")) return Promise.resolve();
            starting = boot().finally(() => {
                starting = null;
            });
            return starting;
        },
        async stop() {
            closed = true;
            setState({status: "closed"});
            return host === null ? {status: "closed"} : host.destroy();
        },
    };
}

/**
 * 按引导响应选出要登记的插件。协议版本先于结构校验：新版本的服务端可能改了结构，此时应提示刷新而不是报格式错误。
 * 服务端启用了本外壳没有的插件或版本不同，说明外壳与服务端不是同一次构建，刷新即可对齐。
 */
interface SelectedPlugin {
    readonly id: string;
    readonly factory: BrowserPluginFactory;
}

function selectPlugins(raw: unknown, builtin: ReadonlyArray<PluginDescriptor>, factories: Readonly<Record<string, BrowserPluginFactory>>): SelectedPlugin[] {
    if (typeof raw === "object" && raw !== null && "protocolVersion" in raw && typeof raw.protocolVersion === "number"
        && raw.protocolVersion !== BROWSER_PROTOCOL_VERSION) {
        throw new BootstrapRejected("incompatible", `服务端的引导协议版本是 ${String(raw.protocolVersion)}，本页面是 ${String(BROWSER_PROTOCOL_VERSION)}`);
    }
    if (!Value.Check(BrowserBootstrapSchema, raw)) throw new BootstrapRejected("startup-failed", "引导响应的结构不符合协议");
    const selected: SelectedPlugin[] = [];
    for (const plugin of raw.plugins) {
        if (selected.some((item) => item.id === plugin.id)) throw new BootstrapRejected("startup-failed", `引导集合中插件重复：${plugin.id}`);
        const local = builtin.find((item) => item.id === plugin.id);
        if (local === undefined || local.version !== plugin.version) {
            throw new BootstrapRejected("incompatible", `本页面没有服务端启用的浏览器插件 ${plugin.id}@${plugin.version}`);
        }
        const factory = factories[plugin.id];
        if (factory === undefined) throw new BootstrapRejected("startup-failed", `浏览器插件 ${plugin.id} 没有装配工厂`);
        selected.push({id: plugin.id, factory});
    }
    for (const id of REQUIRED_PLUGINS) {
        if (!selected.some((item) => item.id === id)) throw new BootstrapRejected("startup-failed", `引导集合缺少必需插件 ${id}`);
    }
    return selected;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
