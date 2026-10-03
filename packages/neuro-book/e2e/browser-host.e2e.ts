/**
 * runtime.browser-host 在真实浏览器中的验收：生产构建（`bun run build`）的外壳与后端，本机 Chrome。
 * 覆盖场景 1（挂载前建立实例）、2（引导失败与重试）、4（多窗口隔离）与协议不兼容。引导失败用拦截请求模拟：
 * 同源部署下服务端完全停止时浏览器连外壳都取不到，不属于场景 2。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const BOOTSTRAP = "**/api/runtime/browser-bootstrap";

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "browser-host");
    server = await startProductServer(join(tmp, "state"));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test("首屏是空工作台：窗口运行实例建立、工作台激活之后才挂载界面（场景 1）", async ({page}) => {
    // 记下 #app 里出现过的宿主页状态：挂载前只有静态占位（loading），挂载后直接是工作台，从不出现“启动中”。
    await page.addInitScript(() => {
        const seen = new Set<string>();
        (window as unknown as {hostStatusesSeen: Set<string>}).hostStatusesSeen = seen;
        new MutationObserver(() => {
            for (const element of document.querySelectorAll("[data-browser-host-status]")) seen.add(element.getAttribute("data-browser-host-status") ?? "");
        }).observe(document, {childList: true, subtree: true, attributes: true});
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    const root = page.locator("[data-workbench-root]");
    await expect(root).toHaveAttribute("data-window-state", "ready");
    await expect(root).toHaveAttribute("data-window-instance", /.+/u);
    await expect(page.locator("[data-browser-host-status]")).toHaveCount(0);
    expect(await page.evaluate(() => [...(window as unknown as {hostStatusesSeen: Set<string>}).hostStatusesSeen])).toEqual(["loading"]);
    expect(errors).toEqual([]);
});

test("引导请求失败：带重试的连接失败页，没有半个工作台；恢复后重试进入工作台（场景 2）", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.abort("connectionrefused"));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="connection-failed"]');
    await expect(failure).toBeVisible();
    await expect(page.locator("[data-workbench-root]")).toHaveCount(0);

    await page.unroute(BOOTSTRAP);
    await failure.getByRole("button", {name: "重试"}).click();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
});

test("服务端返回 503（例如正在关闭）：同样是可重试的连接失败，原因带状态码与错误码", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.fulfill({status: 503, json: {error: {code: "stopping", message: "NeuroBook 正在关闭。"}}}));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="connection-failed"]');
    await expect(failure).toContainText("503");
    await expect(failure).toContainText("stopping");
    await expect(failure.getByRole("button", {name: "重试"})).toBeVisible();
});

test("服务端协议版本不同：提示刷新页面，不给原地重试", async ({page}) => {
    await page.route(BOOTSTRAP, (route) => route.fulfill({json: {protocolVersion: 2}}));
    await page.goto(server.url);
    const failure = page.locator('[data-browser-host-status="incompatible"]');
    await expect(failure.getByRole("button", {name: "刷新页面"})).toBeVisible();
    await expect(failure.getByRole("button", {name: "重试"})).toHaveCount(0);
    await expect(page.locator("[data-workbench-root]")).toHaveCount(0);
});

test("两个窗口互相独立：关闭一个，另一个照常可用、刷新后重新引导，服务端不停止（场景 4）", async ({context}) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([a.goto(server.url), b.goto(server.url)]);
    const rootB = b.locator("[data-workbench-root]");
    await expect(a.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await expect(rootB).toHaveAttribute("data-window-state", "ready");
    const instanceB = await rootB.getAttribute("data-window-instance");

    await a.close();
    await expect(rootB).toHaveAttribute("data-window-instance", instanceB ?? "");
    expect((await b.request.get(`${server.url}api/runtime/health`)).status()).toBe(200);
    await b.reload();
    await expect(rootB).toHaveAttribute("data-window-state", "ready");
    await expect(rootB).not.toHaveAttribute("data-window-instance", instanceB ?? "");
    expect(server.child.exitCode).toBeNull();
});
