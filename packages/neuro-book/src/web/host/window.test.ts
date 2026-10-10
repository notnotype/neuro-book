/**
 * 窗口运行实例（runtime.browser-host 场景 1、2、4、6、8、9 与引导失败的各类呈现）：同进程启动的真实后端、真实
 * fetch 与 WebSocket、真实工作台与诊断插件；页面事件目标是 EventTarget，重连退避用手动时钟。
 *
 * 协议版本不同、结构错误、缺少必需插件这几种响应，真实后端不会给出，由一个只回引导接口的 Bun 服务给出；
 * 它的正文正是要验证的异常输入，真实后端的响应在 `src/server/browser-bootstrap.test.ts` 按同一 schema 校验。
 * 要把测试插件放进引导集合时也用它，RPC 端点指向真实后端（或指向转发到真实后端的 TCP 代理，用来制造断线）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {defineComponent, h} from "vue";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {PluginDescriptor} from "nbook/manifest";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {errorResponse} from "nbook/plugins/http/backend/dispatch";
import {manifestServerPlugins} from "nbook/server/plugins";
import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {startServer} from "nbook/server/start";
import type {RunningServer} from "nbook/server/start";
import {createProjectRegistry} from "nbook/server/projects/registry";
import {killSpawnedProjects, observed, PROJECT_FIXTURE_ENTRY, trackedProjectOutput} from "nbook/server/testing/projects";
import {helloFrame, openRawRpcSocket} from "nbook/server/testing/rpc-client";
import {startTcpProxy} from "nbook/server/testing/tcp-proxy";
import {createRemoteProbePlugin, newRemoteProbeState} from "nbook/server/testing/test-plugins";
import type {RemoteProbeState} from "nbook/server/testing/test-plugins";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";
import {clockKey, windowConnectionKey} from "nbook/shared/host";
import type {WindowConnectionState} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import type {WindowProject} from "nbook/shared/projects";
import {projectProbeContract, remoteProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {browserHostPlugins, browserPluginDefinitions, builtinBrowserPlugins} from "../plugins";
import {createConnection} from "./connection";
import {createBrowserWindow} from "./window";
import type {BrowserWindowOptions, WindowState} from "./window";

/** 引导桩里的 RPC 端点：结构合法即可，这些用例在连 RPC 之前就失败。 */
const STUB_RPC = {port: 1, path: "/"};

let tmp = "";
let backend: RunningServer;
let probe: RemoteProbeState;
let sequence = 0;

/** 窗口的诊断出口写 console；测试里收下而不打印。 */
const quietConsole: DiagnosticsConsole = {error: () => undefined};

/** 同进程后端；带测试插件 `test.remote-probe`，浏览器测试插件经它验证远程调用。 */
function backendAt(port: number, state: RemoteProbeState = newRemoteProbeState()): RunningServer {
    sequence += 1;
    const stateRoot = join(tmp, `state-${String(sequence)}`);
    return startServer({
        config: {host: "127.0.0.1", port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        plugins: (context) => [...manifestServerPlugins(context), createRemoteProbePlugin(state)],
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
}

function rpcOf(server: RunningServer): {readonly port: number; readonly path: string} {
    return {port: Number(new URL(server.rpcUrl).port), path: "/"};
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-window", "browser-window");
    probe = newRemoteProbeState();
    backend = backendAt(0, probe);
    await backend.ready;
});

afterAll(async () => {
    backend.requestStop("test:done");
    await backend.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function openWindow(options: Partial<BrowserWindowOptions> & {readonly url?: string} = {}) {
    const page = new EventTarget();
    const browserWindow = createBrowserWindow({connection: createConnection(options.url ?? backend.url!), page, console: quietConsole, clientIdentity: "profile-test", navigateDocument: () => undefined, ...options});
    return {browserWindow, page};
}

/** 只回引导接口的服务，给出真实后端不会给的响应。 */
function serveBootstrap(respond: () => Response): {readonly url: string; stop(): void} {
    const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => (new URL(request.url).pathname === BROWSER_BOOTSTRAP_PATH ? respond() : new Response(null, {status: 404}))});
    return {url: server.url.href, stop: () => server.stop(true)};
}

function failureOf(state: WindowState): {status: string; reason: string} | null {
    return "reason" in state ? {status: state.status, reason: state.reason} : null;
}

/** 测试插件贡献的页面组件；这里只比较身份，不渲染。 */
const TestPage = defineComponent({name: "TestPage", setup: () => () => h("p", "测试页面")});

/** 浏览器入口在启动时向 `workbench.pages` 贡献一个页面的测试插件。 */
function pagePlugin(id: string, path: string): {descriptor: PluginDescriptor; definition: PluginDefinition} {
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        definition: {
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                contributions: [{capability: "workbench.pages", id: path, declaration: {path, title: id}}],
                activate: () => ({contributions: {"workbench.pages": {[path]: {load: async () => TestPage}}}}),
            }],
        },
    };
}

/** 工作台激活时抛错的定义表：窗口必须停在失败状态，而不是挂载半个工作台。 */
const brokenWorkbench: BrowserWindowOptions["definitions"] = {
    ...browserPluginDefinitions,
    "nbook.workbench": {
        id: "nbook.workbench",
        entries: [{id: "browser", location: "browser", activate: () => {
            throw new Error("工作台激活失败（测试注入）");
        }}],
    },
};

describe("窗口运行实例", () => {
    it("引导成功：工作台激活并交出根界面后才 ready（场景 1）", async () => {
        const {browserWindow} = openWindow();
        const seen: string[] = [];
        browserWindow.onChange((state) => seen.push(state.status));
        await browserWindow.start();
        expect(seen).toEqual(["starting", "ready"]);
        const state = browserWindow.state;
        expect(state).toMatchObject({status: "ready", connection: "online"});
        const pages = state.status === "ready" ? state.root.pages() : [];
        expect(pages.map((page) => page.path)).toEqual(["/"]);
        expect(await pages[0]?.load()).toBeDefined();
        await browserWindow.stop();
        expect(browserWindow.state.status).toBe("closed");
    });

    it("服务端连不上：可重试的连接失败，没有运行实例；服务端起来后重试成功（场景 2）", async () => {
        const probe = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()});
        const port = probe.port as number;
        await probe.stop(true);
        const {browserWindow} = openWindow({url: `http://127.0.0.1:${String(port)}/`});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("connection-failed");

        const late = backendAt(port);
        await late.ready;
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("ready");
        await browserWindow.stop();
        late.requestStop("test:done");
        await late.stopped;
    }, 20_000);

    it("服务端返回 503：同样是可重试的连接失败，原因带上状态码与错误码", async () => {
        const stub = serveBootstrap(() => errorResponse(503, "stopping", "NeuroBook 正在关闭。"));
        const {browserWindow} = openWindow({url: stub.url});
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("connection-failed");
        expect(failure?.reason).toContain("503");
        expect(failure?.reason).toContain("stopping");
        stub.stop();
    });

    it("协议版本不同：提示刷新，先于结构校验", async () => {
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION + 1, shape: "未来的结构"}));
        const {browserWindow} = openWindow({url: stub.url});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("incompatible");
        expect(failureOf(browserWindow.state)?.reason).toContain(`协议版本是 ${String(BROWSER_PROTOCOL_VERSION + 1)}`);
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("incompatible");
        stub.stop();

        // 版本号不是整数就不算声明了版本，按结构不符合协议处理（断线重连取引导时同一判定）。
        const malformed = serveBootstrap(() => Response.json({protocolVersion: String(BROWSER_PROTOCOL_VERSION + 1)}));
        const second = openWindow({url: malformed.url});
        await second.browserWindow.start();
        expect(failureOf(second.browserWindow.state)?.status).toBe("startup-failed");
        malformed.stop();
    });

    it("服务端启用了本页面没有的插件版本：提示刷新", async () => {
        const builtin = builtinBrowserPlugins.map((plugin) => (plugin.id === "nbook.workbench" ? {...plugin, version: "9.9.9"} : plugin));
        const {browserWindow} = openWindow({builtin});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("incompatible");
        expect(failureOf(browserWindow.state)?.reason).toContain("nbook.workbench");
    });

    it("结构不合法或缺少必需插件：启动失败", async () => {
        for (const body of [
            {protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: STUB_RPC, revision: "r", plugins: "nbook.workbench"},
            {protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: STUB_RPC, revision: "r", plugins: [{id: "nbook.diagnostics", version: "0.1.0"}]},
        ]) {
            const stub = serveBootstrap(() => Response.json(body));
            const {browserWindow} = openWindow({url: stub.url});
            await browserWindow.start();
            expect(failureOf(browserWindow.state)?.status).toBe("startup-failed");
            stub.stop();
        }
    });

    it("引导集合里没有命令系统：启动失败并指名 nbook.commands（工作台的面板与键位依赖它）", async () => {
        const plugins = builtinBrowserPlugins.filter((plugin) => plugin.id !== "nbook.commands").map(({id, version}) => ({id, version}));
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: STUB_RPC, revision: "r", plugins}));
        const {browserWindow} = openWindow({url: stub.url});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("startup-failed");
        expect(failureOf(browserWindow.state)?.reason).toContain("nbook.commands");
        stub.stop();
    });

    it("工作台激活失败：启动失败并带原因，不 ready，也不能原地重试", async () => {
        const {browserWindow} = openWindow({definitions: brokenWorkbench});
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("startup-failed");
        expect(failure?.reason).toContain("工作台激活失败（测试注入）");
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("startup-failed");
    });

    it("宿主适配器的工厂抛错：同样是启动失败，不停在 starting", async () => {
        const {browserWindow} = openWindow({hostPlugins: {"nbook.diagnostics": () => {
            throw new Error("诊断装配失败（测试注入）");
        }}});
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("startup-failed");
        expect(failure?.reason).toContain("诊断装配失败（测试注入）");
    });

    it("定义表的表项与定义的插件 id 不一致：启动失败并指名两个 id，错配的定义不激活", async () => {
        const optional = {id: "nbook.optional", version: "0.1.0", locations: ["browser"] as const};
        const plugins = [...builtinBrowserPlugins, optional].map(({id, version}) => ({id, version}));
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpcOf(backend), revision: "r", plugins}));
        const activated: string[] = [];
        const {browserWindow} = openWindow({
            url: stub.url,
            builtin: [...builtinBrowserPlugins, optional],
            definitions: {...browserPluginDefinitions, "nbook.optional": {
                id: "example.rogue",
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: () => {
                    activated.push("example.rogue");
                    return {};
                }}],
            }},
        });
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("startup-failed");
        expect(failure?.reason).toContain("nbook.optional");
        expect(failure?.reason).toContain("example.rogue");
        expect(activated).toEqual([]);
        stub.stop();
    });

    it("只有顶层声明的插件：引导集合列出它，窗口登记它的声明而不需要定义；描述写了浏览器入口却没有定义仍启动失败", async () => {
        // test.notes-owner 定义一个只有声明的贡献点并在激活时读声明；test.notes 没有任何入口，只在描述里声明一条。
        const seen: {listed: string[] | null} = {listed: null};
        const owner = {
            descriptor: {id: "test.notes-owner", version: "0.1.0", locations: ["browser"] as const},
            definition: {
                id: "test.notes-owner",
                contributionPoints: [{id: "test.notes", implementation: "none" as const, validate: () => null}],
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context: ActivationContext) => {
                    seen.listed = context.declarations.list("test.notes").map((declaration) => `${declaration.plugin}:${declaration.id}`);
                    return {};
                }}],
            } satisfies PluginDefinition,
        };
        const declarationOnly: PluginDescriptor = {id: "test.notes", version: "0.1.0", locations: [], contributions: [{capability: "test.notes", id: "test.notes/first", declaration: {}}]};
        const builtin = [...builtinBrowserPlugins, owner.descriptor, declarationOnly];
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpcOf(backend), revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
        const {browserWindow} = openWindow({url: stub.url, builtin, definitions: {...browserPluginDefinitions, [owner.descriptor.id]: owner.definition}});
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("ready");
        expect(seen.listed).toEqual(["test.notes:test.notes/first"]);
        await browserWindow.stop();

        const missing = {...declarationOnly, locations: ["browser"] as const};
        const {browserWindow: broken} = openWindow({url: stub.url, builtin: [...builtinBrowserPlugins, owner.descriptor, missing], definitions: {...browserPluginDefinitions, [owner.descriptor.id]: owner.definition}});
        await broken.start();
        expect(failureOf(broken.state)).toMatchObject({status: "startup-failed", reason: expect.stringContaining("test.notes")});
        stub.stop();
    });

    it("宿主适配器的表只收适配器：普通插件放进去编译不过", () => {
        const options: Partial<BrowserWindowOptions> = {
            // @ts-expect-error 普通插件的定义是常量，不能经宿主适配器的工厂取宿主上下文
            hostPlugins: {"nbook.diagnostics": browserHostPlugins["nbook.diagnostics"], "nbook.commands": () => browserPluginDefinitions["nbook.commands"]!},
        };
        expect(options.hostPlugins).toBeDefined();
    });

    it("非必需插件的入口激活失败：只影响该入口，窗口照常 ready", async () => {
        const optional = {id: "nbook.optional", version: "0.1.0", locations: ["browser"] as const};
        const plugins = [...builtinBrowserPlugins, optional].map(({id, version}) => ({id, version}));
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpcOf(backend), revision: "r", plugins}));
        const {browserWindow} = openWindow({
            url: stub.url,
            builtin: [...builtinBrowserPlugins, optional],
            definitions: {...browserPluginDefinitions, "nbook.optional": {
                id: "nbook.optional",
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: () => {
                    throw new Error("可选入口激活失败（测试注入）");
                }}],
            }},
        });
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("ready");
        await browserWindow.stop();
        stub.stop();
    });

    it("其它插件贡献的页面在窗口 ready 时已在页面表里；两个插件贡献同一路径时都被拒绝，留给服务端的路径被拒绝，窗口照常 ready", async () => {
        const extra = [pagePlugin("test.page", "/probe"), pagePlugin("test.dup-a", "/dup"), pagePlugin("test.dup-b", "/dup"), pagePlugin("test.api", "/api/probe")];
        const builtin = [...builtinBrowserPlugins, ...extra.map((plugin) => plugin.descriptor)];
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpcOf(backend), revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
        const {browserWindow} = openWindow({
            url: stub.url,
            builtin,
            definitions: {...browserPluginDefinitions, ...Object.fromEntries(extra.map((plugin) => [plugin.descriptor.id, plugin.definition]))},
        });
        await browserWindow.start();
        const state = browserWindow.state;
        const pages = state.status === "ready" ? state.root.pages() : [];
        expect(pages.map((page) => page.path)).toEqual(["/", "/probe"]);
        expect(await pages[1]?.load()).toBe(TestPage);
        await browserWindow.stop();
        stub.stop();
    });

    it("两个窗口互相独立：一个卸载或失败，另一个仍 ready，服务端不停止（场景 4）", async () => {
        const a = openWindow();
        const b = openWindow();
        const broken = openWindow({definitions: brokenWorkbench});
        await Promise.all([a.browserWindow.start(), b.browserWindow.start(), broken.browserWindow.start()]);
        expect(broken.browserWindow.state.status).toBe("startup-failed");
        expect(a.browserWindow.state.status).toBe("ready");

        a.page.dispatchEvent(new Event("pagehide"));
        await waitUntil("窗口 A 卸载后关闭", () => a.browserWindow.state.status === "closed");
        expect(b.browserWindow.state.status).toBe("ready");
        expect((await fetch(new URL("/api/runtime/health", backend.url!))).status).toBe(200);
        await b.browserWindow.stop();
    });
});

/** 浏览器测试插件 `test.remote-caller` 观察到的远程服务结果。 */
interface CallerRecord {
    echo: RemoteResult<unknown> | null;
    instances: RemoteResult<ReadonlyArray<{readonly id: string; readonly client: string | null}>> | null;
    readonly ticks: number[];
    resyncs: number;
    readonly ends: string[];
    /** 宿主能力 `windowConnectionKey`：激活时的状态，加上之后的每次变化。 */
    readonly connection: WindowConnectionState[];
    /** 宿主能力 `clockKey` 交出的时钟。 */
    clock: RuntimeClock | null;
}

/**
 * 启动时经远程服务调用服务端探针：`echo` 一次、查一次在线实例、订阅 `ticks`，并发出一个不等结果的 `hold`
 * （名字由测试给出，用来观察窗口关闭后服务端收到的终止）。
 */
function remoteCaller(record: CallerRecord, holdName: string | null = null): {descriptor: PluginDescriptor; definition: PluginDefinition} {
    const id = "test.remote-caller";
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        definition: {
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: windowConnectionKey}, {key: clockKey}],
                activate: async (context) => {
                    const link = context.services.require(windowConnectionKey);
                    record.connection.push(link.state());
                    link.onChange((state) => record.connection.push(state));
                    record.clock = context.services.require(clockKey);
                    const atServer = context.remote.use(remoteProbeContract);
                    record.echo = await atServer.echo({});
                    record.instances = await context.remote.instances();
                    await atServer.events.ticks.subscribe({}, (payload) => record.ticks.push(payload.n), {
                        onResync: () => {
                            record.resyncs += 1;
                        },
                        onEnd: (reason) => record.ends.push(reason),
                    });
                    if (holdName !== null) void atServer.hold({name: holdName});
                    return {};
                },
            }],
        },
    };
}

function newRecord(): CallerRecord {
    return {echo: null, instances: null, ticks: [], resyncs: 0, ends: [], connection: [], clock: null};
}

/** 引导集合加上 `test.remote-caller`，RPC 端点由 `rpc()` 给出（每次引导时取，可以随测试改变）。 */
function callerWindow(record: CallerRecord, rpc: () => {readonly port: number; readonly path: string}, options: {readonly clock?: ManualClock; readonly holdName?: string} = {}) {
    const caller = remoteCaller(record, options.holdName ?? null);
    const builtin = [...builtinBrowserPlugins, caller.descriptor];
    const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpc(), revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
    const opened = openWindow({url: stub.url, builtin, definitions: {...browserPluginDefinitions, [caller.descriptor.id]: caller.definition}, clock: options.clock});
    return {...opened, stub};
}

/** 以一个 TUI 客户端的身份向服务端查当前在线的实例 id。 */
async function onlineInstances(server: RunningServer): Promise<string[]> {
    sequence += 1;
    const id = `tui-${String(sequence)}`;
    const socket = openRawRpcSocket(server.rpcUrl);
    await socket.opened;
    socket.send(helloFrame({id, kind: "tui", role: "client", project: null, client: null}));
    await socket.next((frame) => frame.type === "welcome");
    socket.send({type: "request", id: "list", target: "server", contract: "runtime/instances", version: 1, method: "list", effect: "read", input: {},
        $nbConsumer: {instanceId: id, location: "tui", client: null, plugin: null, entry: null, generation: null, via: null}, $nbChain: []});
    const result = await socket.next((frame) => frame.type === "result");
    socket.socket.close();
    return ((result.outcome as {value: Array<{id: string}>}).value).map((instance) => instance.id);
}

function readyOf(state: WindowState): Extract<WindowState, {status: "ready"}> {
    if (state.status !== "ready") throw new Error(`窗口不是 ready：${state.status}`);
    return state;
}

describe("窗口的远程服务链路（场景 6、8、9）", () => {
    it("首连成功后 ready 且在线：浏览器插件经远程服务调用服务端插件，提供方看到本窗口实例；握手带客户端身份", async () => {
        const record = newRecord();
        const {browserWindow, stub} = callerWindow(record, () => rpcOf(backend));
        await browserWindow.start();
        const ready = readyOf(browserWindow.state);
        expect(ready.connection).toBe("online");
        expect(record.echo).toEqual({ok: true, value: {instanceId: ready.instanceId, location: "browser", plugin: "test.remote-caller", entry: "browser", generation: 1}});
        expect(record.instances?.ok ? record.instances.value.find((instance) => instance.id === ready.instanceId) : record.instances).toMatchObject({client: "profile-test"});
        expect(record.connection).toEqual(["online"]);
        await browserWindow.stop();
        stub.stop();
    });

    it("RPC 端口连不上：可重试的连接失败，没有运行实例；端口可用后重试成功", async () => {
        const closedPort = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()});
        const unreachable = {port: closedPort.port!, path: "/"};
        await closedPort.stop(true);
        let rpc = unreachable;
        const record = newRecord();
        const {browserWindow, stub} = callerWindow(record, () => rpc);
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("connection-failed");
        expect(record.echo).toBeNull();

        rpc = rpcOf(backend);
        await browserWindow.start();
        expect(readyOf(browserWindow.state).connection).toBe("online");
        await browserWindow.stop();
        stub.stop();
    });

    it("握手以 wire-version 被拒：版本不一致，要刷新", async () => {
        // 只会回拒绝帧的 RPC 端口：拒绝帧的形状跨 wire 版本不变，任何版本的服务端都这样回。
        const rejecting = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request, server) => (server.upgrade(request) ? undefined : new Response(null, {status: 426})),
            websocket: {message: (socket) => {
                socket.send(JSON.stringify({type: "reject", reason: "wire-version", message: "wire 协议版本 1 与本端 2 不兼容"}));
                socket.close();
            }},
        });
        const {browserWindow, stub} = callerWindow(newRecord(), () => ({port: rejecting.port!, path: "/"}));
        await browserWindow.start();
        expect(failureOf(browserWindow.state)).toEqual({status: "incompatible", reason: "wire 协议版本 1 与本端 2 不兼容"});
        stub.stop();
        await rejecting.stop(true);
    });

    it("链路断开转离线、界面保留；退避重连回到在线，订阅收到 onResync 且之后的事件到达", async () => {
        const proxy = startTcpProxy({host: "127.0.0.1", port: rpcOf(backend).port});
        const clock = new ManualClock();
        const record = newRecord();
        const {browserWindow, stub} = callerWindow(record, () => ({port: proxy.port, path: "/"}), {clock});
        await browserWindow.start();
        const ready = readyOf(browserWindow.state);
        await waitUntil("探针收到订阅", () => probe.sinks.size > 0);
        await fetch(new URL("/api/test.remote-probe/tick", backend.url!), {method: "POST"});
        await waitUntil("收到第一个事件", () => record.ticks.length === 1);

        proxy.drop();
        await waitUntil("窗口标注离线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "offline");
        expect(readyOf(browserWindow.state).instanceId).toBe(ready.instanceId);
        expect(readyOf(browserWindow.state).root).toBe(ready.root);

        clock.advance(500);
        await waitUntil("重连回到在线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "online");
        await waitUntil("订阅重建并收到 onResync", () => record.resyncs === 1);
        await fetch(new URL("/api/test.remote-probe/tick", backend.url!), {method: "POST"});
        await waitUntil("重连后的事件到达", () => record.ticks.length === 2);
        expect(record.ends).toEqual([]);

        // 重连成功后退避从头开始：再断一次，仍是 0.5 秒后重连。
        proxy.drop();
        await waitUntil("再次离线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "offline");
        clock.advance(500);
        await waitUntil("再次回到在线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "online");
        // 插件经宿主能力看到同样的变化，拿到的时钟就是窗口的时钟。
        expect(record.connection).toEqual(["online", "offline", "online", "offline", "online"]);
        expect(record.clock).toBe(clock);
        await browserWindow.stop();
        stub.stop();
        proxy.stop();
    }, 20_000);

    it("服务端换了进程：窗口转为服务端已重启，之后不再重连；旧服务端停止时先关插件，订阅以 provider-stopped 结束", async () => {
        const clock = new ManualClock();
        const first = backendAt(0);
        await first.ready;
        const httpPort = Number(new URL(first.url!).port);
        let server = first;
        const record = newRecord();
        const {browserWindow, stub} = callerWindow(record, () => rpcOf(server), {clock});
        await browserWindow.start();
        expect(readyOf(browserWindow.state).connection).toBe("online");

        first.requestStop("test:restart");
        await first.stopped;
        await waitUntil("窗口标注离线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "offline");
        server = backendAt(httpPort);
        await server.ready;
        clock.advance(500);
        await waitUntil("窗口转为服务端已重启", () => browserWindow.state.status === "server-restarted");
        // 服务端停止序列先关插件、后断链路：订阅在断线前已按提供方停止结束，重启识别时没有剩下的远程订阅。
        expect(record.ends).toEqual(["provider-stopped"]);

        clock.advance(60_000);
        expect(browserWindow.state.status).toBe("server-restarted");
        await browserWindow.stop();
        stub.stop();
        server.requestStop("test:done");
        await server.stopped;
    }, 20_000);

    it("窗口卸载（刷新）：旧窗口发出、仍在执行的请求在服务端收到终止；新窗口是新的实例", async () => {
        const holdName = `refresh-${String(Date.now())}`;
        const first = callerWindow(newRecord(), () => rpcOf(backend), {holdName});
        await first.browserWindow.start();
        const oldInstance = readyOf(first.browserWindow.state).instanceId;
        await waitUntil("hold 已在服务端执行", () => probe.holds.has(holdName));

        expect(await onlineInstances(backend)).toContain(oldInstance);

        first.page.dispatchEvent(new Event("pagehide"));
        await waitUntil("旧窗口关闭", () => first.browserWindow.state.status === "closed");
        await waitUntil("服务端的 hold 收到终止", () => probe.holds.get(holdName)?.aborted === true);
        await waitUntil("旧窗口的链路关闭，服务端不再列出它", async () => !(await onlineInstances(backend)).includes(oldInstance));

        const second = callerWindow(newRecord(), () => rpcOf(backend));
        await second.browserWindow.start();
        expect(readyOf(second.browserWindow.state).instanceId).not.toBe(oldInstance);
        await second.browserWindow.stop();
        first.stub.stop();
        second.stub.stop();
        // 提供方收到终止后仍在等放行；放行它，后端停止时的排空才不必等它。
        probe.holds.get(holdName)?.release("done");
    }, 20_000);
});

// ---------- 项目绑定（runtime.browser-host 场景 10、11） ----------

interface ProjectRecordOfWindow {
    echo: RemoteResult<unknown> | null;
    bound: WindowProject["project"] | undefined;
    resyncs: number;
    readonly ends: string[];
    remote: ActivationContext["remote"] | null;
}

/** 启动时经 `project` 目标调用项目探针、订阅它的事件，并读本窗口绑定的项目（宿主的本地能力）。 */
function projectCaller(record: ProjectRecordOfWindow): {descriptor: PluginDescriptor; definition: PluginDefinition} {
    const id = "test.project-caller";
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        definition: {
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: windowProjectKey}],
                activate: async (context) => {
                    record.bound = context.services.require(windowProjectKey).project;
                    record.remote = context.remote;
                    const atProject = context.remote.use(projectProbeContract);
                    record.echo = await atProject.echo({});
                    await atProject.events.ticks.subscribe({}, () => undefined, {
                        onResync: () => {
                            record.resyncs += 1;
                        },
                        onEnd: (reason) => record.ends.push(reason),
                    });
                    return {};
                },
            }],
        },
    };
}

function newProjectRecord(): ProjectRecordOfWindow {
    return {echo: null, bound: undefined, resyncs: 0, ends: [], remote: null};
}

/** 带项目的同进程后端：登记好的项目 `book`，项目子进程跑项目宿主的测试入口（带探针）；宽限期用手动时钟。 */
async function projectBackend(): Promise<{readonly server: RunningServer; readonly grace: ManualClock; readonly root: string}> {
    sequence += 1;
    const root = join(tmp, `projects-${String(sequence)}`);
    const stateRoot = join(root, "state");
    await mkdir(join(root, "Book"), {recursive: true});
    const registered = await createProjectRegistry({stateRoot, cwd: root}).register(join(root, "Book"));
    if (!registered.ok) throw new Error(registered.detail);
    const grace = new ManualClock();
    const forward = trackedProjectOutput(observed<string>());
    const server = startServer({
        config: {host: "127.0.0.1", port: 0, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: {graceMs: 1000, startMs: 10_000, stopMs: 10_000}},
        plugins: (context) => [...manifestServerPlugins(context), createRemoteProbePlugin()],
        process: new EventEmitter(),
        writeFatal: () => undefined,
        projectEntry: PROJECT_FIXTURE_ENTRY,
        projectEnv: {...process.env, NBOOK_TEST_PLUGINS: remoteProbeDescriptor.id},
        projectOutput: {stdout: forward, stderr: forward},
        projectClock: grace,
    });
    projectServers.add(server);
    await server.ready;
    return {server, grace, root};
}

const projectServers = new Set<RunningServer>();

afterEach(async () => {
    for (const server of projectServers) {
        server.requestStop("test:cleanup");
        await server.stopped;
    }
    projectServers.clear();
    killSpawnedProjects();
});

/** 引导集合加上 `test.project-caller`；地址栏的项目由 `project` 给出。 */
function projectWindow(server: RunningServer, record: ProjectRecordOfWindow, options: {readonly project: string; readonly rpc?: () => {readonly port: number; readonly path: string}; readonly clock?: ManualClock}) {
    const caller = projectCaller(record);
    const builtin = [...builtinBrowserPlugins, caller.descriptor];
    const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: options.rpc?.() ?? rpcOf(server), revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
    const opened = openWindow({url: stub.url, builtin, definitions: {...browserPluginDefinitions, [caller.descriptor.id]: caller.definition}, project: options.project, clock: options.clock});
    return {...opened, stub};
}

describe("窗口绑定项目（场景 10、11）", () => {
    it("按地址栏的项目绑定：ready 带项目代次，插件经 project 目标到达项目实例并读到绑定；两个窗口共用同一代次", async () => {
        const {server} = await projectBackend();
        const first = newProjectRecord();
        const second = newProjectRecord();
        const one = projectWindow(server, first, {project: "book"});
        const two = projectWindow(server, second, {project: "book"});
        await Promise.all([one.browserWindow.start(), two.browserWindow.start()]);

        const ready = readyOf(one.browserWindow.state);
        expect(ready.project).toMatchObject({name: "book", generation: 1});
        expect(readyOf(two.browserWindow.state).project).toEqual(ready.project);
        expect(first.bound).toEqual(ready.project);
        expect(first.echo).toMatchObject({ok: true, value: {project: {name: "book", generation: 1}, caller: {instanceId: ready.instanceId, plugin: "test.project-caller"}}});
        expect(second.echo).toMatchObject({ok: true, value: {project: {generation: 1}}});
        await one.browserWindow.stop();
        await two.browserWindow.stop();
        one.stub.stop();
        two.stub.stop();
    }, 20_000);

    it("项目未登记：可重试的无法打开项目，没有运行实例；登记后重试成功", async () => {
        const {server, root} = await projectBackend();
        const record = newProjectRecord();
        const {browserWindow, stub} = projectWindow(server, record, {project: "later"});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)).toMatchObject({status: "project-unavailable", reason: expect.stringContaining("later")});
        expect(record.bound).toBeUndefined();

        await mkdir(join(root, "later"), {recursive: true});
        expect(await server.projects.registry.register(join(root, "later"))).toMatchObject({ok: true});
        await browserWindow.start();
        expect(readyOf(browserWindow.state).project).toMatchObject({name: "later", generation: 1});
        await browserWindow.stop();
        stub.stop();
    }, 20_000);

    it("宽限期内断线重连：同一代次，订阅收到 onResync", async () => {
        const {server} = await projectBackend();
        const proxy = startTcpProxy({host: "127.0.0.1", port: rpcOf(server).port});
        const clock = new ManualClock();
        const record = newProjectRecord();
        const {browserWindow, stub} = projectWindow(server, record, {project: "book", rpc: () => ({port: proxy.port, path: "/"}), clock});
        await browserWindow.start();
        const project = readyOf(browserWindow.state).project;

        proxy.drop();
        await waitUntil("窗口标注离线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "offline");
        await waitUntil("项目进入宽限期", () => server.projects.running(project!.id)?.state === "idle-grace");
        clock.advance(500);
        await waitUntil("重连回到在线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "online");
        await waitUntil("订阅重建并收到 onResync", () => record.resyncs === 1);
        expect(server.projects.running(project!.id)).toEqual({generation: 1, state: "running"});
        expect(record.ends).toEqual([]);
        await browserWindow.stop();
        stub.stop();
        proxy.stop();
    }, 20_000);

    it("超过宽限期再重连：窗口转为项目已关闭，订阅以 project-gone 结束，不改投新代次", async () => {
        const {server, grace} = await projectBackend();
        const proxy = startTcpProxy({host: "127.0.0.1", port: rpcOf(server).port});
        const clock = new ManualClock();
        const record = newProjectRecord();
        const {browserWindow, stub} = projectWindow(server, record, {project: "book", rpc: () => ({port: proxy.port, path: "/"}), clock});
        await browserWindow.start();
        const project = readyOf(browserWindow.state).project!;

        proxy.drop();
        await waitUntil("项目进入宽限期", () => server.projects.running(project.id)?.state === "idle-grace");
        grace.advance(1000);
        await waitUntil("宽限期满后项目子进程退出", () => server.projects.running(project.id) === null);
        clock.advance(500);
        await waitUntil("窗口转为项目已关闭", () => browserWindow.state.status === "project-gone");
        expect(record.ends).toEqual(["project-gone"]);
        expect(server.projects.running(project.id)).toBeNull();
        clock.advance(10_000);
        expect(browserWindow.state.status).toBe("project-gone");
        stub.stop();
        proxy.stop();
    }, 20_000);

    it("项目子进程崩溃：路由关闭窗口链路，重连得到项目已关闭", async () => {
        const {server} = await projectBackend();
        const clock = new ManualClock();
        const record = newProjectRecord();
        const {browserWindow, stub} = projectWindow(server, record, {project: "book", clock});
        await browserWindow.start();
        readyOf(browserWindow.state);

        void record.remote!.use(projectProbeContract).crash({code: 70});
        await waitUntil("窗口标注离线", () => browserWindow.state.status === "ready" && browserWindow.state.connection === "offline");
        clock.advance(500);
        await waitUntil("窗口转为项目已关闭", () => browserWindow.state.status === "project-gone");
        stub.stop();
    }, 20_000);
});
