/**
 * NeuroBook 服务端的装配：启动与停止的顺序、回环与来源、准入与排空、退出码都在 nb-host 的 `startHostServer`
 * （docs/specs/runtime/server-host.md）；这里给 NeuroBook 的名字、插件表、宿主能力、宿主接口与两个扩展。
 *
 * 两个扩展的先后就是停止开头的先后：开发任务先 abort（与排空并行等它结束），项目管理器再停止接纳（排空期间不会再有项目被
 * 打开）。项目管理器在运行实例建立后的同一个同步段里建（项目实例是它的子实例）；路由的回调、宿主能力与宿主接口都晚绑定它。
 */

import {homedir} from "node:os";
import {join} from "node:path";

import {startHostServer} from "@notnotype/nb-host/server";
import type {DrainClock, ExitCode, HostServerExtension, ProcessEvents} from "@notnotype/nb-host/server";
import type {Application, StopResult} from "@notnotype/nb-runtime/application";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createPluginInventory, pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import {createPluginPackages, pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {installedPlugins, NO_PREPARED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {pluginProblems} from "nbook/plugin-platform/shared/problems";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import {productPlugins} from "nbook/manifest";
import {NEUROBOOK_PLATFORM, NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import type {PluginDescriptor} from "nbook/manifest";
import {clockKey, runningWorkKey, startupEnvKey, stateRootKey, userDirectoriesKey} from "nbook/shared/host";
import {projectsKey} from "nbook/shared/projects";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";

import {createBrowserBootstrapRoute} from "./browser-bootstrap";
import type {ServerConfig} from "./config";
import type {StateRootClaim} from "./instance";
import {createPluginCatalogsRoute, createPluginFilesRoute} from "./plugin-files";
import {createRunningWork, createRunningWorkRoute} from "./running-work";
import type {RunningWorkRegistry} from "./running-work";
import {startupEnv} from "./startup-env";
import {resolveUserDirectories} from "./user-directories";
import {HTTP_PLUGIN_ID, manifestServerPlugins} from "./plugins";
import type {ServerPluginContext} from "./plugins";
import {createProjectManager} from "./projects/manager";
import type {ProjectManager} from "./projects/manager";
import {createProjectRegistry} from "./projects/registry";
import type {ProjectRegistry} from "./projects/registry";

export interface StartServerOptions {
    readonly config: ServerConfig;
    /**
     * 已认领的状态根（`claimNeuroBook`，必须就是 `config.stateRoot`）。本函数接管它：就绪时发布地址，停止开始时标记，
     * 停止结算后或装配失败时放下。没有认领就起不了服务端，一个状态根只跑一个实例由此保证。
     */
    readonly claim: StateRootClaim;
    /** 本进程加载的清单；缺省是产品清单，开发入口另加开发清单。 */
    readonly manifest?: ReadonlyArray<PluginDescriptor>;
    /** 装配插件；缺省按清单。测试经这里加入自己的插件，产品代码不含测试分支。 */
    readonly plugins?: (context: ServerPluginContext) => ReadonlyArray<PluginDefinition>;
    /**
     * 本次启动的第三方插件，由进程入口在启动之前用 `prepareInstalledPlugins` 得出（它要取跨进程的锁，是异步的）。
     * 缺省没有第三方插件。
     */
    readonly prepared?: PluginsPreparation;
    readonly process?: ProcessEvents;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly stopInput?: NodeJS.ReadableStream | null;
    /** HTTP 与 RPC 排空的截止计时。 */
    readonly clock?: DrainClock;
    /** 项目宽限期与子进程启动、停止截止的计时；缺省系统时钟。 */
    readonly projectClock?: RuntimeClock;
    /** 项目宿主入口脚本；缺省是产品入口（见 `productProjectEntry`），开发入口与测试另给。 */
    readonly projectEntry?: string;
    /** 项目子进程的基础环境变量；缺省继承本进程。 */
    readonly projectEnv?: Readonly<Record<string, string | undefined>>;
    /** 项目子进程输出的去处（每行已加前缀与换行）；缺省本进程的标准输出与标准错误。 */
    readonly projectOutput?: {readonly stdout: (text: string) => void; readonly stderr: (text: string) => void};
    readonly onListening?: (url: string) => void;
    /** RPC 端口开始监听后报告地址（`ws://…/`）。 */
    readonly onRpcListening?: (url: string) => void;
    /** 致命通道，必须同步写完；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
    /**
     * 运行实例可用之后在后台做的开发任务，只由开发入口给出（样例作品，见 `dev/sample.ts`）。它拿到的是项目管理器用的同一个
     * 登记表实例，登记表仍只有一个写者。启动失败、或在可用之前已开始停止时不启动；停止序列开头 abort 它，与排空并行等它结束。
     */
    readonly devTask?: (context: {readonly registry: ProjectRegistry; readonly stateRoot: string}) => DevTask;
}

/** 后台开发任务的停止：abort 并等它结束（截止由任务自己定），完成后不再写任何东西。 */
export interface DevTask {
    stop(): Promise<void>;
}

export interface ServerStopOutcome {
    readonly exitCode: ExitCode;
    /** 停止中失败的步骤（HTTP 或 RPC 排空、插件关闭、项目子进程的停止）；为空表示停止完整。 */
    readonly failures: ReadonlyArray<unknown>;
    readonly result: StopResult;
}

export interface RunningServer {
    readonly application: Application;
    readonly projects: ProjectManager;
    /** 运行实例可用时完成；启动失败时拒绝（`ServerStartupError`）。 */
    readonly ready: Promise<void>;
    readonly stopped: Promise<ServerStopOutcome>;
    /** 监听成功后的地址；未监听为 null。 */
    readonly url: string | null;
    /** 内核 RPC 端口的地址（`ws://…/`）；返回时已在监听。 */
    readonly rpcUrl: string;
    /** 此刻已被接纳或在等就绪的请求数（HTTP 请求与 RPC 升级）。 */
    readonly activeRequests: number;
    requestStop(source: string): void;
}

/** 产品的项目宿主入口：打包产物里是与本文件同目录的 `project.js`（同一次 `build:server` 产出），源码里是 `src/project/main.ts`。 */
function productProjectEntry(): string {
    return import.meta.path.endsWith(".js") ? join(import.meta.dir, "project.js") : join(import.meta.dir, "..", "project", "main.ts");
}

export function startServer(options: StartServerOptions): RunningServer {
    const builtinManifest = options.manifest ?? productPlugins;
    // 第三方插件集合在启动前已确定，进程生命期内不变（docs/specs/runtime/plugin-install.md）。
    const prepared = options.prepared ?? NO_PREPARED_PLUGINS;
    const installed = installedPlugins(prepared.startup);
    const thirdPartyIds = new Set(installed.map((plugin) => plugin.id));
    const stateRoot = Object.freeze({path: options.config.stateRoot});
    // 文档目录要查文件系统，能力建立时才等它；主目录同步可得。
    const home = homedir();
    const userDirectories = resolveUserDirectories({platform: process.platform, env: process.env, home});
    const registry = createProjectRegistry({stateRoot: options.config.stateRoot, cwd: process.cwd(), home});

    // 运行实例与项目管理器在扩展的 attach 里才有：路由的回调与停止都只会在那之后用到它们。宿主能力不同：内核在建立运行实例的
    // 同步段里就开始启动激活，插件可能在那时解析它，所以它等管理器建好。
    let application: Application | null = null;
    let projects: ProjectManager | null = null;
    const projectsReady = Promise.withResolvers<ProjectManager>();
    const projectTitle = (reference: string): Promise<string | null> => (projects === null ? Promise.resolve(null) : projects.displayTitle(reference));
    // 在跑的工作的登记表要写诊断，诊断存储由 nb-host 建好后才经宿主接口与宿主能力的上下文交来（两处是同一个存储，先到的那处建）。
    let runningWork: RunningWorkRegistry | null = null;
    const runningWorkOf = (store: DiagnosticsStore): RunningWorkRegistry => (runningWork ??= createRunningWork((record) => void store.record(record)));

    const extensions: HostServerExtension[] = [];
    const makeDevTask = options.devTask;
    if (makeDevTask !== undefined) {
        let devTask: DevTask | null = null;
        extensions.push({
            ready: () => {
                devTask = makeDevTask({registry, stateRoot: options.config.stateRoot});
            },
            stopping: () => devTask?.stop() ?? Promise.resolve(),
        });
    }
    extensions.push({
        attach: (context) => {
            application = context.application;
            projects = createProjectManager({
                application: context.application,
                serverInstanceId: context.instanceId,
                router: context.router,
                registry,
                stateRoot: options.config.stateRoot,
                cwd: process.cwd(),
                entry: options.projectEntry ?? productProjectEntry(),
                ...options.config.projects,
                clock: options.projectClock,
                env: options.projectEnv,
                output: options.projectOutput,
                record: (record) => void context.store.record(record),
                installed,
            });
            projectsReady.resolve(projects);
        },
        stopping: () => {
            projects?.stopAdmission();
        },
        problems: () => projects?.shutdownProblems() ?? [],
    });

    const server = startHostServer({
        product: {name: NEUROBOOK_PROFILE.productName},
        platform: NEUROBOOK_PLATFORM,
        listen: {host: options.config.host, port: options.config.port, rpcPort: options.config.rpcPort, shiftPorts: options.config.shiftPorts, allowedOrigins: options.config.allowedOrigins},
        logDirectory: options.config.logDirectory,
        claim: options.claim,
        http: {
            id: HTTP_PLUGIN_ID,
            staticRoot: options.config.webRoot,
            hostRoutes: ({store, rpc}) => [
                createBrowserBootstrapRoute(builtinManifest, installed, rpc, projectTitle),
                createPluginFilesRoute(installed, (input) => store.record(input)),
                createPluginCatalogsRoute(installed, (input) => store.record(input)),
                createRunningWorkRoute(runningWorkOf(store), () => (projects === null ? Promise.resolve({items: [], failed: []}) : projects.work())),
            ],
        },
        plugins: (context) => {
            prepared.connectDiagnostics((record) => void context.store.record(record));
            const config = {...options.config, port: context.listen.port, rpcPort: context.listen.rpcPort};
            return (options.plugins ?? manifestServerPlugins)({config, manifest: builtinManifest, installed, store: context.store, rpc: context.rpc, hostPlugins: context.hostPlugins});
        },
        capabilities: (context) => [
            {id: "host.state-root", key: stateRootKey, create: () => stateRoot},
            {id: "host.startup-env", key: startupEnvKey, create: () => ({env: startupEnv})},
            {id: "host.user-directories", key: userDirectoriesKey, create: () => userDirectories},
            {id: "host.clock", key: clockKey, create: () => systemClock},
            {id: "host.running-work", key: runningWorkKey, create: () => runningWorkOf(context.store).provision},
            {
                id: "host.plugin-inventory",
                key: pluginInventoryKey,
                create: () => createPluginInventory({
                    root: join(options.config.stateRoot, "plugins"),
                    profile: NEUROBOOK_PROFILE,
                    builtin: builtinManifest.map(({id, version}) => ({id, version})),
                    startup: prepared.startup,
                    record: (record) => void context.store.record(record),
                    // 插件页列表时才调用，那时运行实例已经建好：本实例（服务端）此刻的入口失败、受阻与被拒的贡献。
                    problems: () => (application === null ? [] : pluginProblems(application.plugins.catalog(), "server")),
                }),
            },
            // 内置插件按插件 id 找第三方插件包里的目录（agent.skills 这类声明目录的贡献）；本次启动登记的插件，与文件端点同一份。
            {id: "host.plugin-packages", key: pluginPackagesKey, create: () => createPluginPackages(installed, NEUROBOOK_PROFILE.format)},
            {
                id: "host.projects",
                key: projectsKey,
                create: async () => (await projectsReady.promise).provision(),
            },
        ],
        // 第三方插件不是启动必需：它们失败只影响自己（docs/specs/runtime/plugin-manifest.md 的“失败与恢复”）；启动也不等
        // 它们的 onStartup 入口，插件代码挂住时服务端照常就绪（runtime/application.md）。
        requiredPlugins: (plugins) => plugins.filter((plugin) => !thirdPartyIds.has(plugin.id)).map((plugin) => plugin.id),
        backgroundStartupPlugins: [...thirdPartyIds],
        satisfies: pluginVersionSatisfies,
        router: {
            bindProject: (request, client) => (projects === null ? Promise.resolve({ok: false, reason: "project-unavailable", message: "服务端还没有就绪"}) : projects.bind(request, client)),
            projectAccess: (caller, id, generation) => projects?.access(caller, id, generation) ?? "denied",
        },
        extensions,
        readyInfo: () => ({plugins: {safeMode: prepared.startup.safeMode, items: prepared.startup.plugins.map(({id, version, state, notLoaded}) => ({id, version, state, notLoaded}))}}),
        process: options.process,
        signals: options.signals,
        stopInput: options.stopInput,
        clock: options.clock,
        onListening: options.onListening,
        onRpcListening: options.onRpcListening,
        writeFatal: options.writeFatal,
    });
    // attach 在 startHostServer 返回之前的同一个同步段里调用；走到这里项目管理器一定已经建好。
    const attached = (): ProjectManager => {
        if (projects === null) throw new Error("project manager was not attached");
        return projects;
    };
    const projectManager = attached();

    return {
        application: server.application,
        projects: projectManager,
        ready: server.ready,
        stopped: server.stopped,
        get url() {
            return server.url;
        },
        rpcUrl: server.rpcUrl,
        get activeRequests() {
            return server.activeRequests;
        },
        requestStop: (source) => server.requestStop(source),
    };
}
