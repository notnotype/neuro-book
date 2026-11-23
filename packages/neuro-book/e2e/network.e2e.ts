/**
 * 网络页（docs/specs/network/egress.md 的“网络页”）：生产构建的服务端、真实浏览器。“测试代理”的目标由启动环境指到 `trace.test`
 * （不是本机名，出口才会让它走代理），本机起的转发代理收到绝对地址形式的请求后自己答 trace 的内容：看得到请求真的经过了代理。
 */

import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/** 代理收到的请求行里的目标（绝对地址）。 */
const proxied: string[] = [];
const proxy = createServer((request, response) => {
    proxied.push(request.url ?? "");
    if (request.url === "http://trace.test/cdn-cgi/trace") {
        response.writeHead(200, {"content-type": "text/plain"});
        response.end("fl=1\nip=198.51.100.7\nts=1\n");
        return;
    }
    response.writeHead(502);
    response.end();
});

let tmp = "";
let stateRoot = "";
let server: ProductServer;
let proxyUrl = "";

test.beforeAll(async () => {
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    tmp = await createTestTmpRoot("neuro-book-e2e", "network");
    stateRoot = join(tmp, "state");
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(stateRoot, "settings.json"), "{}\n");
    server = await startProductServer(stateRoot, {env: {NBOOK_NETWORK_TEST_URL: "http://trace.test/cdn-cgi/trace"}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function openNetwork(page: Page): Promise<void> {
    await page.goto(new URL("/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await page.locator("[data-settings-nav='nbook.network']").click();
    await expect(page.locator("[data-network-page]")).toBeVisible();
}

const userSettings = async (): Promise<Record<string, unknown>> => parseJsonc(await readFile(join(stateRoot, "settings.json"), "utf8")) as Record<string, unknown>;

test("网络页：切到自定义、填代理地址写进设置；测试代理经本机代理取到出口 IP；直连时没有测试一行；自动更新的开关写进设置；390 宽不横向溢出", async ({page}) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await openNetwork(page);

    await page.locator("[data-network-mode]").getByRole("radio", {name: "自定义"}).click();
    await expect.poll(async () => (await userSettings())["nbook.network/proxyMode"]).toBe("custom");
    const address = page.locator("[data-network-url] input, input[data-network-url]");
    await address.fill(proxyUrl);
    await address.press("Enter");
    await expect.poll(async () => (await userSettings())["nbook.network/proxyUrl"]).toBe(proxyUrl);

    await page.locator("[data-network-test]").click();
    const status = page.locator("[data-settings-action-row]").filter({has: page.locator("[data-network-test]")}).locator("[data-settings-action-status]");
    await expect(status).toHaveText(/^通了：出口 IP 198\.51\.100\.7，\d+ ms$/u);
    await expect(status).toHaveAttribute("data-tone", "success");
    expect(proxied).toEqual(["http://trace.test/cdn-cgi/trace"]);

    await page.locator("[data-network-mode]").getByRole("radio", {name: "直连"}).click();
    await expect.poll(async () => (await userSettings())["nbook.network/proxyMode"]).toBe("direct");
    await expect(page.locator("[data-network-test]")).toHaveCount(0);

    await page.locator("[data-network-auto-update]").click();
    await expect.poll(async () => (await userSettings())["nbook.network/catalogAutoUpdate"]).toBe(false);

    await page.setViewportSize({width: 390, height: 800});
    await expect(page.locator("[data-network-page]")).toBeVisible();
    const overflow = await page.locator("[data-network-page]").evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
});
