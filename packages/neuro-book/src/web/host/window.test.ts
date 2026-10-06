/**
 * 窗口运行实例（runtime.browser-host 场景 1、2、4 与引导失败的各类呈现）：同进程启动的真实后端、真实 fetch、
 * 真实工作台与诊断插件；页面事件目标是 EventTarget。
 *
 * 协议版本不同、结构错误、缺少必需插件这几种响应，真实后端不会给出，由一个只回引导接口的 Bun 服务给出；
 * 它的正文正是要验证的异常输入，真实后端的响应在 `src/server/browser-bootstrap.test.ts` 按同一 schema 校验。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineComponent, h} from "vue";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {PluginDescriptor} from "nbook/manifest";
import type {DiagnosticsConsole} from "nbook/plugins/diagnostics/web/console-exporter";
import {errorResponse} from "nbook/plugins/http/server/dispatch";
import {startServer} from "nbook/server/start";
import type {RunningServer} from "nbook/server/start";
import {BROWSER_BOOTSTRAP_PATH} from "nbook/shared/browser-bootstrap";

import {browserPluginFactories, builtinBrowserPlugins} from "../plugins";
import type {BrowserPluginFactory} from "../plugins";
import {createConnection} from "./connection";
import {createBrowserWindow} from "./window";
import type {BrowserWindowOptions, WindowState} from "./window";

let tmp = "";
let backend: RunningServer;
let sequence = 0;

/** 窗口的诊断出口写 console；测试里收下而不打印。 */
const quietConsole: DiagnosticsConsole = {error: () => undefined};

function backendAt(port: number): RunningServer {
    sequence += 1;
    const stateRoot = join(tmp, `state-${String(sequence)}`);
    return startServer({
        config: {host: "127.0.0.1", port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false},
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-window", "browser-window");
    backend = backendAt(0);
    await backend.ready;
});

afterAll(async () => {
    backend.requestStop("test:done");
    await backend.stopped;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function openWindow(options: Partial<BrowserWindowOptions> & {readonly url?: string} = {}) {
    const page = new EventTarget();
    const browserWindow = createBrowserWindow({connection: createConnection(options.url ?? backend.url!), page, console: quietConsole, ...options});
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
        const stub = serveBootstrap(() => Response.json({protocolVersion: 2, shape: "未来的结构"}));
        const {browserWindow} = openWindow({url: stub.url});
        await browserWindow.start();
        expect(failureOf(browserWindow.state)?.status).toBe("incompatible");
        expect(failureOf(browserWindow.state)?.reason).toContain("协议版本是 2");
        await browserWindow.start();
        expect(browserWindow.state.status).toBe("incompatible");
        stub.stop();
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
            {protocolVersion: 1, revision: "r", plugins: "nbook.workbench"},
            {protocolVersion: 1, revision: "r", plugins: [{id: "nbook.diagnostics", version: "0.1.0"}]},
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
        const stub = serveBootstrap(() => Response.json({protocolVersion: 1, revision: "r", plugins}));
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
        const stub = serveBootstrap(() => Response.json({protocolVersion: 1, revision: "r", plugins}));
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
        const stub = serveBootstrap(() => Response.json({protocolVersion: 1, revision: "r", plugins: builtin.map(({id, version}) => ({id, version}))}));
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
