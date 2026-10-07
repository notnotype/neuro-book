/**
 * 浏览器窗口与内核 RPC 端口在真实 Chrome 中的验收（runtime.browser-host 场景 6、8、9，runtime.plugin-channel
 * “WebSocket 传输与握手”）：e2e 测试外壳（多装测试插件 `test.remote-probe`）与宿主测试入口起的真实后端。
 * 断线与“回 wire-version 拒绝的服务端”用 Playwright 的 `routeWebSocket` 制造：前者把连接原样转给真实后端、
 * 需要时掐断，后者不连后端、只回拒绝帧（拒绝帧的形状跨 wire 版本不变）。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page, WebSocketRoute} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

// 只为 `window.__nbRemoteProbe` 的全局类型。
import type {} from "nbook/web/testing/remote-probe";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

let tmp = "";
let server: ProbeServer;
let sequence = 0;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "rpc");
    server = await startProbeServer(join(tmp, "state"));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const root = (page: Page) => page.locator("[data-workbench-root]");
const hostStatus = (page: Page) => page.locator("[data-browser-host-status]");

/** 测试插件的观察入口（`src/web/testing/remote-probe.ts`，`window.__nbRemoteProbe`）在插件激活完之后才挂上。 */
async function probeReady(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe !== undefined)).toBe(true);
}


async function control(path: string, method: "GET" | "POST" = "POST"): Promise<unknown> {
    return (await fetch(new URL(`/api/test.remote-probe/${path}`, server.url), {method})).json();
}

/** 在页面里开一个指向 RPC 端口的 WebSocket，返回它是否打开过。 */
function tryRpcSocket(page: Page, port: number): Promise<"open" | "closed-before-open"> {
    return page.evaluate((rpcPort) => new Promise<"open" | "closed-before-open">((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${String(rpcPort)}/`);
        socket.addEventListener("open", () => {
            resolve("open");
            socket.close();
        });
        socket.addEventListener("close", () => resolve("closed-before-open"));
    }), port);
}

test("连上 RPC 端口：页面在线，测试插件经远程服务调用服务端插件，提供方看到本页的实例", async ({page}) => {
    await page.goto(server.url);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    const instanceId = await root(page).getAttribute("data-window-instance");
    await probeReady(page);
    const echo = await page.evaluate(() => window.__nbRemoteProbe?.echo());
    expect(echo).toEqual({ok: true, value: {instanceId, location: "browser", plugin: "test.remote-probe", entry: "browser", generation: 1}});
    await expect(page.locator(".nb-offline-banner")).toHaveCount(0);
});

test("页面来源：本服务的页面能连 RPC 端口，别的来源的页面连不上", async ({page}) => {
    await page.goto(server.url);
    expect(await tryRpcSocket(page, server.rpcPort)).toBe("open");

    await page.route("http://localhost:9/foreign", (route) => route.fulfill({contentType: "text/html", body: "<!doctype html><title>外站</title>"}));
    await page.goto("http://localhost:9/foreign");
    expect(await tryRpcSocket(page, server.rpcPort)).toBe("closed-before-open");
});

test("断开后显示离线横幅、界面保留；重连后横幅收起，订阅收到 onResync 且之后的事件到达", async ({page}) => {
    const routes: WebSocketRoute[] = [];
    await page.routeWebSocket((url) => url.port === String(server.rpcPort), (route) => {
        routes.push(route);
        route.connectToServer();
    });
    await page.goto(server.url);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    const instanceId = await root(page).getAttribute("data-window-instance");
    await control("tick");
    await probeReady(page);
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.ticks.length)).toBe(1);

    routes.at(-1)?.close();
    await expect(root(page)).toHaveAttribute("data-rpc-state", "offline");
    await expect(page.locator(".nb-offline-banner")).toBeVisible();
    await expect(root(page)).toHaveAttribute("data-window-instance", instanceId ?? "");

    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator(".nb-offline-banner")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.resyncs)).toBe(1);
    await control("tick");
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.ticks.length)).toBe(2);
    expect(routes.length).toBeGreaterThanOrEqual(2);
});

test("刷新页面：旧页发出、仍在执行的请求在服务端收到终止，新页是新的实例", async ({page}) => {
    sequence += 1;
    const name = `refresh-${String(sequence)}`;
    await page.goto(server.url);
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    const before = await root(page).getAttribute("data-window-instance");
    await probeReady(page);
    await page.evaluate((holdName) => window.__nbRemoteProbe?.hold(holdName), name);
    await expect.poll(async () => (await control("holds", "GET")) as Array<{name: string}>).toContainEqual(expect.objectContaining({name, aborted: false}));

    await page.reload();
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    expect(await root(page).getAttribute("data-window-instance")).not.toBe(before);
    await expect.poll(async () => (await control("holds", "GET")) as Array<{name: string}>).toContainEqual(expect.objectContaining({name, aborted: true}));
    // 提供方收到终止后仍在等放行；放行它，服务端停止时的排空不必等它。
    await control(`release/${name}`);
});

test("握手以 wire-version 被拒：显示版本不一致页，只给刷新", async ({page}) => {
    await page.routeWebSocket((url) => url.port === String(server.rpcPort), (route) => {
        route.onMessage(() => {
            route.send(JSON.stringify({type: "reject", reason: "wire-version", message: "wire 协议版本 1 与本端 2 不兼容"}));
            route.close();
        });
    });
    await page.goto(server.url);
    await expect(hostStatus(page)).toHaveAttribute("data-browser-host-status", "incompatible");
    await expect(page.getByRole("button")).toHaveText(["刷新页面"]);
    await expect(root(page)).toHaveCount(0);
});

test("服务端换了进程：已打开的页面显示服务端已重启页，不自动刷新、不再重连", async ({page}) => {
    const restartRoot = join(tmp, "restart");
    const first = await startProbeServer(join(restartRoot, "first"));
    const port = Number(new URL(first.url).port);
    let second: ProbeServer | null = null;
    try {
        await page.goto(first.url);
        await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
        await page.evaluate(() => {
            (window as {__nbBeforeRestart?: boolean}).__nbBeforeRestart = true;
        });

        expect(await first.stop()).toBe(0);
        await expect(root(page)).toHaveAttribute("data-rpc-state", "offline");
        second = await startProbeServer(join(restartRoot, "second"), {port});

        await expect(hostStatus(page)).toHaveAttribute("data-browser-host-status", "server-restarted");
        await expect(page.getByRole("heading")).toHaveText("服务端已重启");
        await expect(page.getByRole("button")).toHaveText(["刷新页面"]);
        expect(await page.evaluate(() => (window as {__nbBeforeRestart?: boolean}).__nbBeforeRestart)).toBe(true);
    } finally {
        if (second !== null) expect(await second.stop()).toBe(0);
        if (first.child.exitCode === null) first.child.kill("SIGKILL");
    }
});
