/**
 * 窗口运行实例的启动与状态（runtime.browser-host 启动序列第 2–5 步）：取引导集合，连上内核 RPC 端口，按集合登记
 * 本外壳构建进去的浏览器插件，激活 `nbook.workbench` 并解析它交出的根界面。登记插件之前先把内置插件随构建的消息目录与
 * 引导目录索引列出的第三方目录登记进翻译引擎；目录取不到或坏了只记成该插件的目录问题，窗口照常启动。解析到根界面之前窗口不是 ready，
 * 界面据此只在工作台与失败页之间二选一，不出现半个工作台。首连先于建立运行实例：插件激活时远程服务已可用。
 * 可用之后链路断开只把 ready 标成离线并退避重连；服务端已换进程时转入只能刷新的 `server-restarted`，绑定的项目
 * 代次已结束时转入 `project-gone`。地址栏指定了项目时首连同时绑定它，绑定结果随 ready 给出，并以本地能力
 * `windowProjectKey` 交给本窗口的插件；整页导航同样以本地能力 `windowNavigationKey` 交出。
 *
 * 不依赖 Vue 与 DOM：连接对象、页面事件目标、console 与时钟由装配方传入，界面经 `onChange` 订阅状态。
 */

import type {StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticInput, DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {parseCatalog} from "@notnotype/nb-runtime/plugin-manifest";
import type {MessageCatalog, PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {Value} from "typebox/value";

import {definitionAt} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {manifestFormat, NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {thirdPartyDefinitionsFor} from "nbook/plugin-platform/shared/definitions";
import {pluginCatalogUrl, pluginFileUrl} from "nbook/plugin-platform/shared/plugin-files";
import type {PluginProblem} from "nbook/plugin-platform/shared/types";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";
import {createPluginCodeHost, pageDocument} from "nbook/plugin-platform/web/plugin-code";
import type {PluginCodeHost, PluginDocument, PluginLink} from "nbook/plugin-platform/web/plugin-code";
import {attachPluginStyles} from "nbook/plugin-platform/web/styles";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {workbenchRootKey} from "nbook/plugins/workbench/web/contracts";
import type {WorkbenchRoot} from "nbook/plugins/workbench/web/contracts";
import {BROWSER_PROTOCOL_VERSION, BrowserBootstrapSchema, declaredProtocolVersion} from "nbook/shared/browser-bootstrap";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";
import {clockKey, windowConnectionKey, windowNavigationKey, windowPluginFilesKey, windowPluginsKey, windowRescueKey} from "nbook/shared/host";
import type {WindowPluginFiles} from "nbook/shared/host";
import type {RescuedText, WindowRescue} from "nbook/shared/host";
import type {WindowConnection, WindowConnectionState, WindowNavigation} from "nbook/shared/host";
import {windowTextKey} from "nbook/shared/window-text";
import type {WindowText} from "nbook/shared/window-text";
import {windowProjectKey} from "nbook/shared/projects";
import type {WindowProject} from "nbook/shared/projects";

import {browserHostPlugins, browserPluginDefinitions, builtinBrowserPlugins, isBrowserHostPlugin} from "../plugins";
import {builtinPluginAssets, builtinPluginCatalogs} from "../plugins";
import type {BrowserHostPluginFactory, BrowserHostPluginId, BrowserPluginContext, BuiltinCatalogs} from "../plugins";
import {BrowserRuntimeHost} from "./browser-host";
import type {BrowserHost, PageLifecycleTarget} from "./browser-host";
import {ConnectionError} from "./connection";
import type {Connection, RpcEndpoint} from "./connection";
import {createRemoteSession} from "./remote-session";
import {createHostTextEngine} from "./text-engine";
import {createWindowPlugins} from "./window-plugins";
import type {RemoteSession} from "./remote-session";

/** `connection-failed` 与 `project-unavailable` 可以原地重试；其余要刷新页面。 */
export type WindowFailure = "connection-failed" | "project-unavailable" | "incompatible" | "startup-failed" | "server-restarted" | "project-gone";

export type WindowState =
    | {readonly status: "idle" | "closed"}
    /** `projectTitle`：引导给出的作品显示名，加载页显示它；还没取到、没有绑定项目或服务端拿不到时为 null。 */
    | {readonly status: "starting"; readonly projectTitle: string | null}
    /** `connection` 是远程服务链路：断开时界面保留、标注离线，重连成功后回到 online。 */
    | {readonly status: "ready"; readonly instanceId: string; readonly root: WorkbenchRoot; readonly connection: "online" | "offline"; readonly project: WindowProject["project"]}
    /**
     * connection-failed 可以原地重试；其余要刷新页面（换外壳，或与新的服务端进程重新握手）才可能恢复。`rescued` 是
     * 转入终态时插件交出的未保存正文。
     */
    | {readonly status: WindowFailure; readonly reason: string; readonly rescued?: ReadonlyArray<RescuedText>};

export type ReadyWindowState = Extract<WindowState, {status: "ready"}>;

export interface BrowserWindowOptions {
    readonly connection: Connection;
    readonly page: PageLifecycleTarget;
    readonly console: DiagnosticsConsole;
    /** 整页导航：以本地能力 `windowNavigationKey` 交给需要它的插件，例如“打开项目”“重新载入”。 */
    readonly navigation: WindowNavigation;
    /** 地址栏 `project` 参数（短名或 id）：首连时请求绑定它；没有则窗口不绑定项目。 */
    readonly project?: string | null;
    /**
     * 本外壳构建进去的浏览器插件、普通插件的定义与宿主适配器的工厂；缺省按产品清单与 `plugins.ts` 的两张表。
     * 测试经这里换入自己的插件，产品代码不含测试分支。
     */
    readonly builtin?: ReadonlyArray<PluginDescriptor>;
    readonly definitions?: Readonly<Record<string, PluginDefinition>>;
    readonly hostPlugins?: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>>;
    /** 内置插件随构建的消息目录；缺省按 `plugins.ts` 的 `builtinPluginCatalogs`。 */
    readonly builtinCatalogs?: Readonly<Record<string, BuiltinCatalogs>>;
    /** 客户端身份（`client-identity.ts`），随握手发给服务端；缺省每个窗口各取一个随机值，不跨刷新。 */
    readonly clientIdentity?: string;
    /** 重连退避与远程调用超时的时钟；缺省系统时钟。 */
    readonly clock?: RuntimeClock;
    /** 窗口的翻译引擎；缺省建一个从 zh-CN 起步的（测试与不关心语言的外壳用）。 */
    readonly text?: WindowText;
    /**
     * 第三方插件浏览器入口代码的装载与样式表所在的文档；缺省用页面的 `document`（`plugin-code.ts`）。没有第三方浏览器入口
     * 时用不到。
     */
    readonly document?: PluginDocument;
    /**
     * 宿主模块表（`plugin-modules.ts` 的 `hostModules`）。由页面入口给出：它导入 nb-ui 与 SDK 的浏览器部分，窗口宿主的
     * 代码不直接引用它，在 Bun 里测试与类型检查时不必加载这些组件。没有给出时第三方浏览器入口激活失败。
     */
    readonly pluginModules?: () => Promise<Readonly<Record<string, unknown>>>;
}

export interface BrowserWindow {
    readonly state: WindowState;
    onChange(listener: (state: WindowState) => void): () => void;
    /** 首次启动，或在连接失败后重试；其它状态下不重新启动。并发调用共享同一次启动。 */
    start(): Promise<void>;
    /** 结束窗口：之后不再启动；已建立的运行实例按依赖逆序停止。 */
    stop(): Promise<StopResult>;
    /** 窗口的翻译引擎：作为窗口能力交给插件，挂载界面时注入每个 Vue 根（docs/specs/ui/i18n.md）。 */
    readonly text: WindowText;
}

/**
 * 缺少或入口激活失败就不能挂载界面：工作台交出根界面，诊断要先于其它插件可用，工作台的命令面板与键位依赖命令系统，
 * 命令系统的 `when` 读公开状态。其余插件的入口失败只影响该入口，窗口照常就绪。
 */
const REQUIRED_PLUGINS = ["runtime.diagnostics", "nbook.state", "nbook.commands", "nbook.workbench"];

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
    const builtinCatalogs = options.builtinCatalogs ?? builtinPluginCatalogs;
    const navigation: WindowNavigation = Object.freeze({
        navigateDocument: (href: string) => options.navigation.navigateDocument(href),
        reloadDocument: () => options.navigation.reloadDocument(),
        openExternal: (href: string) => options.navigation.openExternal(href),
        currentUrl: () => options.navigation.currentUrl(),
        replaceUrl: (href: string) => options.navigation.replaceUrl(href),
    });
    const clock = options.clock ?? systemClock;
    const text = options.text ?? createHostTextEngine({locale: "zh-CN"});
    const clientIdentity = options.clientIdentity ?? crypto.randomUUID();
    const adapter = new BrowserRuntimeHost();
    const listeners = new Set<(state: WindowState) => void>();
    let state: WindowState = {status: "idle"};
    let host: BrowserHost | null = null;
    let session: RemoteSession | null = null;
    let starting: Promise<void> | null = null;
    let closed = false;
    /** 第三方插件的样式表：窗口登记插件时加入，窗口结束时移除。 */
    let styles: ReadonlyArray<PluginLink> = [];
    let codeHost: PluginCodeHost | null = null;
    /** 装载器在第一个第三方入口激活时才建：用不到它的窗口（测试里没有 DOM）不碰 `document`。 */
    const code = (): (() => PluginCodeHost) => () => {
        const document = options.document ?? pageDocument();
        if (document === undefined) throw new Error("没有页面文档，装载不了第三方插件的代码");
        const modules = options.pluginModules;
        if (modules === undefined) throw new Error("这个窗口没有宿主模块表，装载不了第三方插件的代码");
        codeHost ??= createPluginCodeHost({document, modules, registryGlobal: NEUROBOOK_PROFILE.registryGlobal});
        return codeHost;
    };

    const setState = (next: WindowState): void => {
        state = next;
        for (const listener of listeners) listener(next);
    };

    const boot = async (): Promise<void> => {
        setState({status: "starting", projectTitle: null});
        let raw: unknown;
        try {
            raw = await options.connection.bootstrap(options.project ?? null);
        } catch (error) {
            if (!closed) setState({status: "connection-failed", reason: describe(error)});
            return;
        }
        if (closed) return;
        let selected: SelectedPlugin[];
        let endpoint: RpcEndpoint;
        let projectTitle: string | null;
        let catalogIndex: BrowserBootstrap["catalogs"];
        try {
            ({selected, endpoint, projectTitle, catalogIndex} = selectPlugins(raw, builtin, definitions, hostPlugins));
        } catch (error) {
            if (!(error instanceof BootstrapRejected)) throw error;
            setState({status: error.kind, reason: error.message});
            return;
        }
        // 绑定项目时握手可能要等项目子进程启动几秒：这段时间加载页显示书名。
        if (projectTitle !== null && options.project !== undefined && options.project !== null) setState({status: "starting", projectTitle});

        const instanceId = crypto.randomUUID();
        const rescue = createRescue((error) => store.record({level: "warn", event: "browser-host.rescue.failed", message: "抢救未保存正文的提供者抛错", error}));
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
                if (next === "online" || next === "offline") {
                    setState({...state, connection: next});
                    return;
                }
                // 插件停止之前先收集未保存的正文：停止之后它们就随插件一起没了。
                const rescued = rescue.collect();
                setState(rescued.length === 0 ? {status: next, reason: reason ?? next} : {status: next, reason: reason ?? next, rescued});
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
        const project: WindowProject["project"] = node.binding === null ? null : {id: node.binding.id, name: node.binding.name, title: projectTitle ?? node.binding.name, generation: node.binding.generation};
        try {
            const context: BrowserPluginContext = {store, console: options.console};
            const observers = mechanismObservers(store);
            const windowPlugins = createWindowPlugins(() => host?.application.plugins ?? null, (error) => store.record({level: "warn", event: "browser-host.plugins-listener.failed", message: "入口状态的监听抛错", error}));
            // 目录先于插件登记：入口激活、界面挂载时文字已经在引擎里。取不到的只成为问题，不让这一步失败。
            const catalogProblems = await loadCatalogs({index: catalogIndex, builtin: builtinCatalogs, connection: options.connection, text, record: (input) => void store.record(input)});
            windowPlugins.catalogProblems(catalogProblems);
            if (closed) {
                current.close();
                return;
            }
            // 登记看的是定义里的 id，引导集合与必需插件看的是表项的 id：两者不一致时不装，否则会装进集合之外的插件。
            const builtinDefinitions = selected.flatMap((plugin) => (plugin.kind === "definition" ? [plugin.definition] : []));
            const thirdPartyPlugins = selected.flatMap((plugin) => (plugin.kind === "third-party" ? [plugin] : []));
            const loadCode = code();
            const pluginFiles: WindowPluginFiles = {
                fileUrl: (id, path) => {
                    const third = thirdPartyPlugins.find((plugin) => plugin.id === id);
                    return third === undefined ? builtinPluginAssets[id]?.[path] ?? null : pluginFileUrl(third.files, path);
                },
            };
            const thirdParty = new Map(thirdPartyDefinitionsFor("browser", thirdPartyPlugins.map((plugin) => ({
                manifest: plugin.manifest,
                load: (entry, activation) => loadCode().activateOf({plugin: plugin.id, entry: entry.id, url: pluginFileUrl(plugin.files, entry.main), signal: activation.signal}),
            })), {builtin: builtinDefinitions, record: (input) => void store.record(input), unregistrableEvent: "browser-host.plugin.unregistrable"}).map((definition) => [definition.id, definition]));
            const plugins = selected.flatMap((plugin) => {
                // 引导集合里的第三方插件都在浏览器有入口或顶层声明（服务端按 `pluginsAt("browser")` 选），这里总能取到。
                if (plugin.kind === "third-party") return thirdParty.get(plugin.id) ?? [];
                const definition = plugin.kind === "host" ? plugin.factory(context) : plugin.definition;
                if (definition.id !== plugin.id) throw new Error(`浏览器插件 ${plugin.id} 的装配定义是插件 ${definition.id}`);
                return [definition];
            });
            styles = attachPluginStyles(thirdPartyPlugins, options.document ?? pageDocument(), {dataset: NEUROBOOK_PROFILE.styleDataset, record: (input) => void store.record(input), failedEvent: "browser-host.plugin.style-failed"});
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
                        {id: "window.text", key: windowTextKey, create: () => text},
                        {id: "window.plugins", key: windowPluginsKey, create: () => windowPlugins.capability},
                        {id: "window.plugin-files", key: windowPluginFilesKey, create: () => pluginFiles},
                        {id: "window.rescue", key: windowRescueKey, create: () => rescue.capability},
                    ],
                    plugins,
                    requiredPlugins: REQUIRED_PLUGINS,
                    // 窗口启动不等第三方插件的 onStartup 入口（runtime/application.md）。
                    backgroundStartupPlugins: selected.filter((plugin) => plugin.kind === "third-party").map((plugin) => plugin.id),
                    satisfies: pluginVersionSatisfies,
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
                    observers: {...observers, plugins: {diagnosticRecorded: (diagnostic) => {
                        observers.plugins?.diagnosticRecorded?.(diagnostic);
                        windowPlugins.diagnosticRecorded(diagnostic);
                    }}},
                    remote: node,
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
        text,
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
            for (const link of styles) link.remove();
            styles = [];
            return result;
        },
    };
}

/**
 * 按引导响应选出要登记的插件。协议版本先于结构校验：新版本的服务端可能改了结构，此时应提示刷新而不是报格式错误。
 * 服务端启用了本外壳没有的内置插件（发布者是保留的发布者），或构建里有的插件版本不同，说明外壳与服务端不是同一次构建，刷新即可
 * 对齐。构建里没有的其它插件是第三方插件，按引导带来的描述登记（docs/specs/runtime/browser-host.md 输出 2、4）。
 */
type SelectedPlugin =
    | {readonly id: string; readonly kind: "definition"; readonly definition: PluginDefinition}
    /** 构建里没有、按引导带来的清单登记的插件；`files` 是插件文件 URL 的前缀。窗口启动不等它们的 onStartup 入口。 */
    | {readonly id: string; readonly kind: "third-party"; readonly manifest: PluginManifest; readonly files: string}
    | {readonly id: string; readonly kind: "host"; readonly factory: BrowserHostPluginFactory};

function selectPlugins(
    raw: unknown,
    builtin: ReadonlyArray<PluginDescriptor>,
    definitions: Readonly<Record<string, PluginDefinition>>,
    hostPlugins: Readonly<Record<BrowserHostPluginId, BrowserHostPluginFactory>>,
): {readonly selected: SelectedPlugin[]; readonly endpoint: RpcEndpoint; readonly projectTitle: string | null; readonly catalogIndex: BrowserBootstrap["catalogs"]} {
    const version = declaredProtocolVersion(raw);
    if (version !== null && version !== BROWSER_PROTOCOL_VERSION) {
        throw new BootstrapRejected("incompatible", `服务端的引导协议版本是 ${String(version)}，本页面是 ${String(BROWSER_PROTOCOL_VERSION)}`);
    }
    if (!Value.Check(BrowserBootstrapSchema, raw)) throw new BootstrapRejected("startup-failed", "引导响应的结构不符合协议");
    const selected: SelectedPlugin[] = [];
    for (const plugin of raw.plugins) {
        if (selected.some((item) => item.id === plugin.id)) throw new BootstrapRejected("startup-failed", `引导集合中插件重复：${plugin.id}`);
        const local = builtin.find((item) => item.id === plugin.id);
        if (local === undefined) {
            // 内置插件（发布者是保留的发布者）本页面没有：外壳与服务端不是同一次构建，刷新即可对齐。
            if (manifestFormat.isBuiltinId(plugin.id)) throw new BootstrapRejected("incompatible", `本页面没有服务端启用的浏览器插件 ${plugin.id}@${plugin.version}`);
            // 第三方插件不在构建里：按引导带来的清单登记（入口的代码在激活时经插件文件端点取回）。清单服务端已校验过，这里用
            // 同一个清单格式再读一遍，读不过说明外壳与服务端不是同一次构建。
            const read = manifestFormat.read(plugin.manifest);
            if (read.status !== "valid" || read.manifest.id !== plugin.id || read.manifest.version !== plugin.version) {
                throw new BootstrapRejected("incompatible", `服务端给的第三方插件 ${plugin.id}@${plugin.version} 的清单本页面读不了`);
            }
            if (plugin.files === undefined) throw new BootstrapRejected("incompatible", `服务端给的第三方插件 ${plugin.id}@${plugin.version} 没有文件地址`);
            selected.push({id: plugin.id, kind: "third-party", manifest: read.manifest, files: plugin.files});
            continue;
        }
        if (local.version !== plugin.version) {
            throw new BootstrapRejected("incompatible", `本页面构建的插件 ${plugin.id} 是 ${local.version}，服务端启用的是 ${plugin.version}`);
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
    return {selected, endpoint: raw.rpc, projectTitle: raw.project?.title ?? null, catalogIndex: raw.catalogs};
}

type CatalogProblem = Extract<PluginProblem, {kind: "catalog-unavailable"}>;

/** 取一种语言的目录：取到并合规时是目录，否则是问题（端点 404、内容不合规、连不上或端点出错）。只接住连接错误，别的照常抛。 */
async function fetchCatalog(connection: Connection, plugin: string, prefix: string, locale: string): Promise<{readonly ok: true; readonly catalog: MessageCatalog} | {readonly ok: false; readonly problem: CatalogProblem}> {
    const problem = (reason: CatalogProblem["reason"], detail: string | null) => ({ok: false as const, problem: {kind: "catalog-unavailable" as const, plugin, location: "browser", locale, reason, detail}});
    let body: string;
    try {
        body = await connection.catalog(pluginCatalogUrl(prefix, locale));
    } catch (error) {
        if (!(error instanceof ConnectionError)) throw error;
        return error.status === 404 ? problem("not-found", null) : problem("fetch-failed", error.message);
    }
    const parsed = parseCatalog(body);
    if (parsed.ok) return {ok: true, catalog: parsed.catalog};
    const [first] = parsed.problems;
    const more = parsed.problems.length > 1 ? `，另有 ${String(parsed.problems.length - 1)} 处` : "";
    return problem("invalid", first === undefined ? null : `${first.path === "" ? "" : `${first.path}：`}${first.message}${more}`);
}

/**
 * 把消息目录登记进翻译引擎（docs/specs/runtime/browser-host.md 输出 2）：内置插件的随构建，第三方的按引导目录索引经目录端点
 * 取，各插件、各语言并行。一个插件取到几种语言就登记几种，一种都没取到时不登记，文字按回退链显示。返回没取到的那些，每条
 * 另记一条诊断。
 */
async function loadCatalogs(options: {
    readonly index: BrowserBootstrap["catalogs"];
    readonly builtin: Readonly<Record<string, BuiltinCatalogs>>;
    readonly connection: Connection;
    readonly text: WindowText;
    readonly record: (input: DiagnosticInput) => void;
}): Promise<PluginProblem[]> {
    for (const [plugin, {source, catalogs}] of Object.entries(options.builtin)) options.text.register(plugin, catalogs, source);
    const results = await Promise.all(options.index.map(async (entry) => {
        const fetched = await Promise.all(entry.locales.map(async (locale) => [locale, await fetchCatalog(options.connection, entry.plugin, entry.prefix, locale)] as const));
        const catalogs: Record<string, MessageCatalog> = {};
        const problems: CatalogProblem[] = [];
        for (const [locale, result] of fetched) {
            if (result.ok) catalogs[locale] = result.catalog;
            else problems.push(result.problem);
        }
        if (Object.keys(catalogs).length > 0) options.text.register(entry.plugin, catalogs, entry.source);
        return problems;
    }));
    const problems = results.flat();
    for (const problem of problems) {
        options.record({level: "warn", event: "browser-host.plugin.catalog-failed", message: `插件 ${problem.plugin} 的 ${problem.locale} 消息目录没有取到，文字按回退链显示`, data: {plugin: problem.plugin, locale: problem.locale, reason: problem.reason, detail: problem.detail}});
    }
    return problems;
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

/** 一个窗口实例的抢救提供者表：提供者抛错只记诊断，不挡住其它提供者与终态页。 */
function createRescue(report: (error: unknown) => void): {readonly capability: WindowRescue; collect(): RescuedText[]} {
    const providers = new Set<() => ReadonlyArray<RescuedText>>();
    return {
        capability: {
            register: (provider) => {
                providers.add(provider);
                return () => {
                    providers.delete(provider);
                };
            },
        },
        collect: () => {
            const rescued: RescuedText[] = [];
            for (const provider of [...providers]) {
                try {
                    rescued.push(...provider());
                } catch (error) {
                    report(error);
                }
            }
            return rescued;
        },
    };
}
