/**
 * 窗口界面的挂载（runtime.browser-host 启动序列第 5 步）：任何时刻容器里要么是宿主页，要么是完整的页面。
 * 窗口、内核与工作台插件都是真的；连接对象返回符合协议的引导响应（真实后端的响应在 window.test.ts 里），
 * 这里要控制的是“先失败、再成功”的时序。页面切换后通知仍在（workbench.notifications 验收 2）也在这里验：
 * 队列与工作台入口同寿，两个页面各挂一个视口。
 */

import {ConnectionError} from "@notnotype/nb-host/web";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {RemoteLink, RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {describe, expect, it, vi} from "vitest";
import {createMemoryHistory} from "vue-router";

import type {PluginDescriptor} from "nbook/manifest";
import {notificationsKey} from "nbook/plugins/workbench/shared/contracts";
import type {NotificationInput, Notifications} from "nbook/plugins/workbench/shared/contracts";
import {BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";

import type {Connection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import {mountWindowUi} from "./mount";
import {browserPluginDefinitions, builtinBrowserPlugins} from "./plugins";

const bootstrapOf = (plugins: ReadonlyArray<PluginDescriptor>) => ({protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: {port: 1, path: "/"}, revision: "r", plugins: plugins.map(({id, version}) => ({id, version})), catalogs: []});

/**
 * 服务端一侧：真实的内核路由，一个路由代表一个服务端进程（各有自己的 boot）。RPC 链路用内核的进程内链路（与
 * WebSocket 链路同一套 JSON 编解码）：这里验证的是界面挂载与状态呈现，真实 WebSocket 由 window.test.ts 与 e2e 覆盖。
 */
function serverProcess(): RemoteRouter {
    return createRemoteRouter(createRemoteNode({instance: {id: "server", kind: "server", role: "hub", project: null, client: null}}));
}

/** 连接对象：前 `failures` 次引导请求失败、之后成功；RPC 连到 `server.current` 这个服务端进程，`links` 是窗口一侧的链路。 */
function connection(plugins: ReadonlyArray<PluginDescriptor>, failures = 0, server = {current: serverProcess()}): Connection & {readonly links: RemoteLink[]} {
    let calls = 0;
    const links: RemoteLink[] = [];
    return {
        links,
        async bootstrap() {
            calls += 1;
            if (calls <= failures) throw new ConnectionError("无法连接服务端", null);
            return bootstrapOf(plugins);
        },
        async openRemote() {
            const pair = createLinkPair();
            server.current.accept(pair.right);
            links.push(pair.left);
            return pair.left;
        },
        // 引导的目录索引为空，窗口不会来取；取了说明索引变了，照服务端没有这份目录回答。
        async catalog() {
            throw new ConnectionError("没有这份消息目录", 404);
        },
        // 这些用例不发关闭前询问，不会来取。
        async work() {
            throw new ConnectionError("没有在跑的工作接口", 404);
        },
    };
}

interface TestPlugin {
    readonly descriptor: PluginDescriptor;
    readonly definition: PluginDefinition;
}

/** 贡献一个加载必然失败的页面的插件。 */
const brokenPage: TestPlugin = {
    descriptor: {id: "test.broken-page", version: "0.1.0", locations: ["browser"]},
    definition: {
        id: "test.broken-page",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: "workbench.pages", id: "/broken", declaration: {path: "/broken", title: "坏页面"}}],
            activate: () => ({contributions: {"workbench.pages": {"/broken": {load: async () => {
                throw new Error("页面模块加载失败（测试注入）");
            }}}}}),
        }],
    },
};

/** 经工作台的通知服务发通知的插件：激活时取到服务，测试在页面挂好之后经 `notify` 发。 */
function notifier(): TestPlugin & {notify(input: NotificationInput): void} {
    let service: Notifications | null = null;
    return {
        descriptor: {id: "test.notifier", version: "0.1.0", locations: ["browser"]},
        definition: {
            id: "test.notifier",
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: notificationsKey}],
                activate: (context) => {
                    service = context.services.require(notificationsKey);
                    return {};
                },
            }],
        },
        notify: (input) => {
            if (service === null) throw new Error("test.notifier 没有激活");
            service.notify(input);
        },
    };
}

async function mountAt(path: string, options: {failures?: number; plugins?: ReadonlyArray<TestPlugin>; clock?: ManualClock; server?: {current: RemoteRouter}} = {}) {
    const extra = options.plugins ?? [];
    const builtin = [...builtinBrowserPlugins, ...extra.map((plugin) => plugin.descriptor)];
    const definitions = {...browserPluginDefinitions, ...Object.fromEntries(extra.map((plugin) => [plugin.descriptor.id, plugin.definition]))};
    const remote = connection(builtin, options.failures, options.server);
    const browserWindow = createBrowserWindow({connection: remote, page: new EventTarget(), console: {error: () => undefined}, navigation: {navigateDocument: () => undefined, reloadDocument: () => undefined, openExternal: () => "opened", currentUrl: () => "http://localhost/", replaceUrl: () => undefined}, builtin, definitions, clock: options.clock});
    await browserWindow.start();
    const container = document.createElement("div");
    const history = createMemoryHistory();
    history.replace(path);
    const reloads: string[] = [];
    await mountWindowUi({browserWindow, container, history, navigateDocument: () => undefined, reloadDocument: () => reloads.push("reload")});
    return {browserWindow, container, history, reloads, links: remote.links};
}

describe("窗口界面的挂载", () => {
    it("窗口已就绪：按页面表挂载当前路径的页面，带上窗口状态", async () => {
        const {browserWindow, container} = await mountAt("/");
        expect(container.querySelector("[data-workbench-root]")?.getAttribute("data-window-state")).toBe("ready");
        expect(container.querySelector("[data-browser-host-status]")).toBeNull();
        await browserWindow.stop();
    });

    it("连接失败：先只有宿主页；重试成功后换成页面，宿主页不留下", async () => {
        const {browserWindow, container} = await mountAt("/", {failures: 1});
        expect(container.querySelector("[data-browser-host-status]")?.getAttribute("data-browser-host-status")).toBe("connection-failed");
        expect(container.querySelector("[data-workbench-root]")).toBeNull();
        (container.querySelector("button") as HTMLButtonElement).click();
        await vi.waitFor(() => expect(container.querySelector("[data-workbench-root]")).not.toBeNull());
        expect(container.querySelector("[data-browser-host-status]")).toBeNull();
        await browserWindow.stop();
    });

    it("`/` 页挂着命令宿主：Ctrl+Shift+P 打开命令面板（入口命令是工作台向 nbook.commands 的贡献）", async () => {
        const {browserWindow} = await mountAt("/");
        // 命令宿主是异步组件，模块加载完、渲染后才挂键位监听：按到面板出现为止。Vitest 首次转换 nb-ui 与 reka
        // 要一两秒，截止时间放宽到 10 秒。
        await vi.waitFor(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "P", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
            expect(document.body.querySelector('[role="combobox"]')).not.toBeNull();
        }, {timeout: 10_000});
        await browserWindow.stop();
    });

    it("远程服务链路断开：页面保留、标注离线并浮出横幅；重连后横幅收起", async () => {
        const clock = new ManualClock();
        const {browserWindow, container, links} = await mountAt("/", {clock});
        const root = (): Element | null => container.querySelector("[data-workbench-root]");
        expect(root()?.getAttribute("data-rpc-state")).toBe("online");
        expect(container.querySelector(".nb-offline-banner")).toBeNull();
        const page = root();

        links[0]?.close();
        await vi.waitFor(() => expect(root()?.getAttribute("data-rpc-state")).toBe("offline"));
        expect(root()).toBe(page);
        expect(container.querySelector(".nb-offline-banner")?.getAttribute("role")).toBe("status");

        clock.advance(500);
        await vi.waitFor(() => expect(root()?.getAttribute("data-rpc-state")).toBe("online"));
        expect(container.querySelector(".nb-offline-banner")).toBeNull();
        await browserWindow.stop();
    });

    it("重连到另一个服务端进程：页面换成只能刷新的“服务端已重启”宿主页", async () => {
        const clock = new ManualClock();
        const server = {current: serverProcess()};
        const {browserWindow, container, links, reloads} = await mountAt("/", {clock, server});

        links[0]?.close();
        await vi.waitFor(() => expect(container.querySelector(".nb-offline-banner")).not.toBeNull());
        server.current = serverProcess();
        clock.advance(500);
        await vi.waitFor(() => expect(container.querySelector("[data-browser-host-status]")?.getAttribute("data-browser-host-status")).toBe("server-restarted"));
        expect(container.querySelector("[data-workbench-root]")).toBeNull();
        expect(container.querySelector(".nb-offline-banner")).toBeNull();
        expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["刷新页面"]);
        (container.querySelector("button") as HTMLButtonElement).click();
        expect(reloads).toEqual(["reload"]);
        await browserWindow.stop();
    });

    it("当前路径的页面模块加载失败：显示只能刷新的启动失败页，不挂半个页面", async () => {
        const {browserWindow, container, reloads} = await mountAt("/broken", {plugins: [brokenPage]});
        const host = container.querySelector("[data-browser-host-status]");
        expect(host?.getAttribute("data-browser-host-status")).toBe("startup-failed");
        expect(host?.textContent).toContain("页面模块加载失败（测试注入）");
        expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["刷新页面"]);
        (container.querySelector("button") as HTMLButtonElement).click();
        expect(reloads).toEqual(["reload"]);
        await browserWindow.stop();
    });

    it("在 `/` 发出的通知，导航到 `/workbench` 后仍在（workbench.notifications 验收 2）", async () => {
        const plugin = notifier();
        const {browserWindow, container, history} = await mountAt("/", {plugins: [plugin]});
        const root = (): Element | null => container.querySelector("[data-workbench-root]");
        const shown = (): boolean => [...root()?.querySelectorAll("[data-notification-stack] [role='status']") ?? []].some((node) => node.textContent?.includes("导出完成") === true);
        // 没有项目时 `/` 是书架首页，`/workbench` 从不用首页贡献：据此分辨两个页面。
        expect(root()?.hasAttribute("data-workbench-home")).toBe(true);
        const home = root();
        plugin.notify({title: "导出完成", message: "第一卷.md", sticky: true});
        // 视口是异步组件，模块第一次加载要一两秒。
        await vi.waitFor(() => expect(shown()).toBe(true), {timeout: 10_000});

        // 产品里还没有站内去 `/workbench` 的入口：排好历史记录、不触发地退回 `/`，再前进，走的是浏览器前进的同一条路由导航。
        history.push("/workbench");
        history.go(-1, false);
        history.go(1);
        await vi.waitFor(() => expect(root()?.hasAttribute("data-workbench-home")).toBe(false));
        expect(root()).not.toBe(home);
        // 视口模块已经加载过：新页面挂上就该看到。
        await vi.waitFor(() => expect(shown()).toBe(true));
        await browserWindow.stop();
    }, 15_000);
});
