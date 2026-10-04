/**
 * 窗口界面的挂载（runtime.browser-host 启动序列第 4 步）：任何时刻容器里要么是宿主页，要么是完整的页面。
 * 窗口、内核与工作台插件都是真的；连接对象返回符合协议的引导响应（真实后端的响应在 window.test.ts 里），
 * 这里要控制的是“先失败、再成功”的时序。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {describe, expect, it, vi} from "vitest";
import {createMemoryHistory} from "vue-router";

import type {PluginDescriptor} from "nbook/manifest";

import {ConnectionError} from "./host/connection";
import type {Connection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import {mountWindowUi} from "./mount";
import {browserPluginFactories, builtinBrowserPlugins} from "./plugins";
import type {BrowserPluginFactory} from "./plugins";

const bootstrapOf = (plugins: ReadonlyArray<PluginDescriptor>) => ({protocolVersion: 1, revision: "r", plugins: plugins.map(({id, version}) => ({id, version}))});

/** 前 `failures` 次请求失败、之后成功的连接。 */
function connection(plugins: ReadonlyArray<PluginDescriptor>, failures = 0): Connection {
    let calls = 0;
    return {
        async bootstrap() {
            calls += 1;
            if (calls <= failures) throw new ConnectionError("无法连接服务端", null);
            return bootstrapOf(plugins);
        },
    };
}

/** 贡献一个加载必然失败的页面的插件。 */
const brokenPage: {descriptor: PluginDescriptor; factory: BrowserPluginFactory} = {
    descriptor: {id: "test.broken-page", version: "0.1.0", locations: ["browser"]},
    factory: (): PluginDefinition => ({
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
    }),
};

async function mountAt(path: string, options: {failures?: number; withBrokenPage?: boolean} = {}) {
    const builtin = options.withBrokenPage === true ? [...builtinBrowserPlugins, brokenPage.descriptor] : builtinBrowserPlugins;
    const factories = options.withBrokenPage === true ? {...browserPluginFactories, [brokenPage.descriptor.id]: brokenPage.factory} : browserPluginFactories;
    const browserWindow = createBrowserWindow({connection: connection(builtin, options.failures), page: new EventTarget(), console: {error: () => undefined}, builtin, factories});
    await browserWindow.start();
    const container = document.createElement("div");
    const history = createMemoryHistory();
    history.replace(path);
    const reloads: string[] = [];
    await mountWindowUi({browserWindow, container, history, navigateDocument: () => undefined, reloadDocument: () => reloads.push("reload")});
    return {browserWindow, container, reloads};
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

    it("当前路径的页面模块加载失败：显示只能刷新的启动失败页，不挂半个页面", async () => {
        const {browserWindow, container, reloads} = await mountAt("/broken", {withBrokenPage: true});
        const host = container.querySelector("[data-browser-host-status]");
        expect(host?.getAttribute("data-browser-host-status")).toBe("startup-failed");
        expect(host?.textContent).toContain("页面模块加载失败（测试注入）");
        expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["刷新页面"]);
        (container.querySelector("button") as HTMLButtonElement).click();
        expect(reloads).toEqual(["reload"]);
        await browserWindow.stop();
    });
});
