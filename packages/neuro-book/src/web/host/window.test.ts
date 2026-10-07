/**
 * 窗口运行实例（runtime.browser-host 场景 1、2、4、6、8、9 与引导失败的各类呈现）：同进程启动的真实后端、真实
 * fetch 与 WebSocket、真实工作台与诊断插件；页面事件目标是 EventTarget，重连退避用手动时钟。
 *
 * 协议版本不同、结构错误、缺少必需插件这几种响应，真实后端不会给出，由一个只回引导接口的 Bun 服务给出；
 * 它的正文正是要验证的异常输入，真实后端的响应在 `src/server/browser-bootstrap.test.ts` 按同一 schema 校验。
 * 要把测试插件放进引导集合时也用它，RPC 端点指向真实后端（或指向转发到真实后端的 TCP 代理，用来制造断线）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {defineComponent, h} from "vue";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {PluginDescriptor} from "nbook/manifest";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {errorResponse} from "nbook/plugins/http/server/dispatch";
import {manifestServerPlugins} from "nbook/server/plugins";
import {startServer} from "nbook/server/start";
import type {RunningServer} from "nbook/server/start";
import {helloFrame, openRawRpcSocket} from "nbook/server/testing/rpc-client";
import {startTcpProxy} from "nbook/server/testing/tcp-proxy";
import {createRemoteProbePlugin, newRemoteProbeState} from "nbook/server/testing/test-plugins";
import type {RemoteProbeState} from "nbook/server/testing/test-plugins";
import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";
import {remoteProbeContract} from "nbook/shared/testing/remote-probe-contract";

import {browserPluginFactories, builtinBrowserPlugins} from "../plugins";
import type {BrowserPluginFactory} from "../plugins";
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
        config: {host: "127.0.0.1", port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, allowedOrigins: []},
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
    const browserWindow = createBrowserWindow({connection: createConnection(options.url ?? backend.url!), page, console: quietConsole, clientIdentity: "profile-test", ...options});
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
function pagePlugin(id: string, path: string): {descriptor: PluginDescriptor; factory: BrowserPluginFactory} {
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        factory: (): PluginDefinition => ({
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                contributions: [{capability: "workbench.pages", id: path, declaration: {path, title: id}}],
                activate: () => ({contributions: {"workbench.pages": {[path]: {load: async () => TestPage}}}}),
            }],
        }),
    };
}

/** 工作台激活时抛错的工厂表：窗口必须停在失败状态，而不是挂载半个工作台。 */
const brokenWorkbench: BrowserWindowOptions["factories"] = {
    ...browserPluginFactories,
    "nbook.workbench": (): PluginDefinition => ({
        id: "nbook.workbench",
        entries: [{id: "browser", location: "browser", activate: () => {
            throw new Error("工作台激活失败（测试注入）");
        }}],
    }),
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
        expect(((await pages[0]?.load()) as {name?: string} | undefined)?.name).toBe("EmptyWorkbench");
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
        const {browserWindow} = openWindow({factories: brokenWorkbench});
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("startup-failed");
        expect(failure?.reason).toContain("工作台激活失败（测试注入）");
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("startup-failed");
    });

    it("必需插件的工厂抛错：同样是启动失败，不停在 starting", async () => {
        const {browserWindow} = openWindow({factories: {...browserPluginFactories, "nbook.workbench": () => {
            throw new Error("工作台装配失败（测试注入）");
        }}});
        await browserWindow.start();
        const failure = failureOf(browserWindow.state);
        expect(failure?.status).toBe("startup-failed");
        expect(failure?.reason).toContain("工作台装配失败（测试注入）");
    });

    it("非必需插件的入口激活失败：只影响该入口，窗口照常 ready", async () => {
        const optional = {id: "nbook.optional", version: "0.1.0", locations: ["browser"] as const};
        const plugins = [...builtinBrowserPlugins, optional].map(({id, version}) => ({id, version}));
        const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpcOf(backend), revision: "r", plugins}));
        const {browserWindow} = openWindow({
            url: stub.url,
            builtin: [...builtinBrowserPlugins, optional],
            factories: {...browserPluginFactories, "nbook.optional": (): PluginDefinition => ({
                id: "nbook.optional",
                entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: () => {
                    throw new Error("可选入口激活失败（测试注入）");
                }}],
            })},
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
            factories: {...browserPluginFactories, ...Object.fromEntries(extra.map((plugin) => [plugin.descriptor.id, plugin.factory]))},
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
        const broken = openWindow({factories: brokenWorkbench});
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
}

/**
 * 启动时经远程服务调用服务端探针：`echo` 一次、查一次在线实例、订阅 `ticks`，并发出一个不等结果的 `hold`
 * （名字由测试给出，用来观察窗口关闭后服务端收到的终止）。
 */
function remoteCaller(record: CallerRecord, holdName: string | null = null): {descriptor: PluginDescriptor; factory: BrowserPluginFactory} {
    const id = "test.remote-caller";
    return {
        descriptor: {id, version: "0.1.0", locations: ["browser"]},
        factory: (): PluginDefinition => ({
            id,
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                activate: async (context) => {
                    const atServer = context.remote.use(remoteProbeContract).at("server");
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
        }),
    };
}

function newRecord(): CallerRecord {
    return {echo: null, instances: null, ticks: [], resyncs: 0, ends: []};
}

/** 引导集合加上 `test.remote-caller`，RPC 端点由 `rpc()` 给出（每次引导时取，可以随测试改变）。 */
function callerWindow(record: CallerRecord, rpc: () => {readonly port: number; readonly path: string}, options: {readonly clock?: ManualClock; readonly holdName?: string} = {}) {
    const caller = remoteCaller(record, options.holdName ?? null);
    const builtin = [...builtinBrowserPlugins, caller.descriptor];
    const stub = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: rpc(), revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
    const opened = openWindow({url: stub.url, builtin, factories: {...browserPluginFactories, [caller.descriptor.id]: caller.factory}, clock: options.clock});
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
        $nbConsumer: {instanceId: id, location: "tui", plugin: null, entry: null, generation: null, via: null}, $nbChain: []});
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
