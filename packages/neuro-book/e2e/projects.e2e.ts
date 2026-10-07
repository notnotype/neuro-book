/**
 * 项目在真实 Chrome 中的验收（runtime.projects 场景 2–6、11，runtime.browser-host 场景 10、11）：e2e 测试外壳
 * （多装测试插件 `test.remote-probe`，窗口绑定了项目时它也挂上项目探针）与宿主测试入口起的真实后端，项目子进程跑
 * 项目宿主的测试入口。宽限期用短的启动参数；断线用 Playwright 的 `routeWebSocket` 制造。项目子进程的输出带
 * `[project <短名>#<代次>]` 前缀转发到后端的输出，用例据此看到子进程何时收口。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page, WebSocketRoute} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

// 只为 `window.__nbRemoteProbe` 的全局类型。
import type {} from "nbook/web/testing/remote-probe";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const GRACE_MS = 1500;
/** 项目探针的项目入口关闭时打印的一行（`src/project/testing/probe-plugin.ts`）。 */
const PROJECT_PROBE_CLOSED_LINE = "remote-probe project entry closed";

let tmp = "";
let projectDir = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "projects");
    projectDir = join(tmp, "Book");
    await mkdir(projectDir, {recursive: true});
    server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_PROJECT_GRACE_MS: String(GRACE_MS)}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const root = (page: Page) => page.locator("[data-workbench-root]");
const hostStatus = (page: Page) => page.locator("[data-browser-host-status]");
const projectUrl = () => new URL("/?project=book", server.url).href;

/** 打开绑定 `book` 的页面，等项目探针挂上，返回它看到的项目代次。 */
async function openBound(page: Page): Promise<number> {
    await page.goto(projectUrl());
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.project !== undefined && window.__nbRemoteProbe.project !== null)).toBe(true);
    return generationOf(page);
}

async function generationOf(page: Page): Promise<number> {
    const echo = await page.evaluate(() => window.__nbRemoteProbe?.project?.echo()) as {readonly ok: boolean; readonly value?: {readonly project: {readonly generation: number}}};
    expect(echo.ok).toBe(true);
    return echo.value!.project.generation;
}

test("“打开项目”：登记目录并整页打开它，工作台显示当前项目短名", async ({page}) => {
    await page.goto(server.url);
    await expect(root(page)).toHaveAttribute("data-window-state", "ready");
    await expect(page.locator("[data-workbench-project]")).toHaveCount(0);

    const commands = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(commands).toBeFocused({timeout: 500});
    }).toPass();
    await commands.fill("打开项目");
    await expect(page.getByRole("option", {name: /打开项目/})).toBeVisible();
    await page.keyboard.press("Enter");

    const picker = page.getByRole("combobox", {name: "选择项目，或输入项目目录的路径"});
    await expect(picker).toBeFocused();
    await expect(page.getByText("还没有登记的项目")).toBeVisible();
    await picker.fill(projectDir);
    await expect(page.getByRole("option", {name: `登记并打开 ${projectDir}`})).toBeVisible();
    await page.keyboard.press("Enter");

    await page.waitForURL(/\?project=book$/u);
    await expect(page.locator("[data-workbench-project]")).toHaveAttribute("data-workbench-project", "book");
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
});

test("两个页面共用同一代次；掐断一个页面的链路，宽限期内重连恢复原绑定，订阅收到 onResync", async ({page}) => {
    const routes: WebSocketRoute[] = [];
    await page.routeWebSocket((url) => url.port === String(server.rpcPort), (route) => {
        routes.push(route);
        route.connectToServer();
    });
    const generation = await openBound(page);
    const other = await page.context().newPage();
    expect(await openBound(other)).toBe(generation);

    routes.at(-1)?.close();
    await expect(root(page)).toHaveAttribute("data-rpc-state", "offline");
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.project?.resyncs)).toBe(1);
    expect(await generationOf(page)).toBe(generation);
    await page.evaluate(() => window.__nbRemoteProbe?.project?.tick());
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.project?.ticks.length)).toBe(1);
    await expect.poll(() => other.evaluate(() => window.__nbRemoteProbe?.project?.ticks.length)).toBe(1);
});

test("没有页面使用项目：宽限期满后项目子进程收口退出；再打开得到新代次", async ({page}) => {
    const generation = await openBound(page);
    await page.goto("about:blank");
    await server.waitFor(new RegExp(`\\[project book#${String(generation)}\\] ${PROJECT_PROBE_CLOSED_LINE}`, "u"));

    expect(await openBound(page)).toBeGreaterThan(generation);
});

test("项目子进程崩溃：页面转为项目已关闭，“不打开项目”回到不绑定项目的页面", async ({page}) => {
    await openBound(page);
    await page.evaluate(() => window.__nbRemoteProbe?.project?.crash(70));
    await expect(hostStatus(page)).toHaveAttribute("data-browser-host-status", "project-gone");
    await expect(page.getByRole("button")).toHaveText(["刷新页面"]);

    await page.getByRole("link", {name: "不打开项目"}).click();
    await page.waitForURL((url) => url.pathname === "/" && url.search === "");
    await expect(root(page)).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-workbench-project]")).toHaveCount(0);
});

test("没有登记的项目：显示无法打开项目页，给重试与“不打开项目”", async ({page}) => {
    await page.goto(new URL("/?project=nope", server.url).href);
    await expect(hostStatus(page)).toHaveAttribute("data-browser-host-status", "project-unavailable");
    await expect(page.getByText("没有登记的项目：nope")).toBeVisible();
    await expect(page.getByRole("button")).toHaveText(["重试"]);
    await expect(page.getByRole("link", {name: "不打开项目"})).toHaveAttribute("href", "/");
    await expect(root(page)).toHaveCount(0);
});
