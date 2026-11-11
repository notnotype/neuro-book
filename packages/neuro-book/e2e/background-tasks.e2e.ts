/**
 * 后台任务与通知中心的 Smoke（docs/specs/workbench/background-tasks.md 验收 1、2、4 与输出 15；workbench/notifications.md
 * 验收 8 与输出 17）：真实浏览器的两个标签页、宿主测试入口的服务端，任务由测试插件 `test.tasks-probe` 经控制路由登记与推进。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";
import {expect, test} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

let tmp = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "background-tasks");
    server = await startProbeServer(join(tmp, "state"), {env: {NBOOK_TEST_PLUGINS: "test.tasks-probe"}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 经测试插件的控制路由操作任务。 */
async function probe(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(new URL(`/api/test.tasks-probe${path}`, server.url), body === undefined ? {} : {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    expect(response.ok).toBe(true);
    return response.json();
}

const startTask = async (body: Record<string, unknown>): Promise<string> => ((await probe("/start", body)) as {id: string}).id;

async function open(page: Page, path = "/workbench"): Promise<void> {
    await page.goto(new URL(path, server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

async function twoTabs(browser: Browser): Promise<readonly [Page, Page]> {
    const context = await browser.newContext();
    const pages = [await context.newPage(), await context.newPage()] as const;
    for (const page of pages) await open(page);
    return pages;
}

/** 收起底部面板：布局记录在同一个状态根里，前一个用例打开的视图在新页面里仍然可见，而视图可见时结束的任务立即算看过。 */
async function hidePanel(page: Page): Promise<void> {
    const toggle = page.locator('[data-shell-focus-target="panel-toggle"]');
    await expect(toggle).toBeEnabled();
    if ((await toggle.textContent())?.trim() === "隐藏面板") await toggle.click();
    await expect(toggle).toHaveText("显示面板");
}

const statusItem = (page: Page) => page.locator('[data-workbench-item="nbook.tasks.status"]');
const statusIcon = (page: Page) => statusItem(page).locator("[data-workbench-item-icon]");
const row = (page: Page, id: string) => page.locator(`[data-task="${id}"]`);
const toasts = (page: Page) => page.locator("[data-notification-stack] [role='status']");

test("两个标签页看到同一件任务；在一处取消，两处都显示“正在取消”，发起方结束后显示已取消、不弹通知（验收 1）", async ({browser}) => {
    const [a, b] = await twoTabs(browser);
    const id = await startTask({title: "初始化 Skill epub-export", message: "正在安装 23 个包", cancellable: true, progress: 10});
    for (const page of [a, b]) {
        await expect(statusItem(page)).toContainText("初始化 Skill epub-export");
        await statusItem(page).click();
        await expect(row(page, id)).toBeVisible();
        await expect(row(page, id).locator("[data-task-status]")).toHaveText("正在安装 23 个包");
    }
    await probe(`/${id}/report`, {progress: 60});
    await expect(row(b, id).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");

    await row(a, id).locator("[data-task-cancel]").click();
    for (const page of [a, b]) await expect(row(page, id).locator("[data-task-cancel]")).toHaveText("正在取消");
    expect(await probe(`/${id}/signal`)).toEqual({aborted: true, reason: "cancelled"});

    await probe(`/${id}/cancelled`, {});
    for (const page of [a, b]) {
        await expect(row(page, id).locator("[data-task-status]")).toHaveText("已取消");
        await expect(statusIcon(page)).toHaveClass(/i-lucide-list-checks/u);
        await expect(toasts(page).filter({hasText: "初始化 Skill epub-export"})).toHaveCount(0);
    }
    await row(a, id).locator("[data-task-remove]").click();
    await expect(row(b, id)).toHaveCount(0);
    await a.context().close();
});

test("失败：弹常驻的错误通知（重试、详情），条目画失败图标；打开视图后不再画；看详情、重试顶替旧行；刷新后仍算看过（验收 2、4）", async ({browser}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    await hidePanel(page);
    const id = await startTask({title: "初始化 Skill pdf-tools", retry: true});
    await expect(statusItem(page)).toContainText("初始化 Skill pdf-tools");
    await probe(`/${id}/fail`, {message: "连不上 registry.npmjs.org（超时）", detail: "bun install v1.4.4\nerror: ETIMEDOUT"});

    const toast = toasts(page).filter({hasText: "初始化 Skill pdf-tools"});
    await expect(toast).toContainText("连不上 registry.npmjs.org（超时）");
    await expect(toast.getByRole("button", {name: "重试"})).toBeVisible();
    await expect(toast.getByRole("button", {name: "详情"})).toBeVisible();
    await expect(statusIcon(page)).toHaveClass(/i-lucide-circle-x/u);

    await statusItem(page).click();
    await expect(row(page, id)).toBeVisible();
    await expect(statusIcon(page)).toHaveClass(/i-lucide-list-checks/u);

    await row(page, id).locator("[data-task-detail]").click();
    const dialog = page.getByRole("dialog", {name: "初始化 Skill pdf-tools：详情"});
    await expect(dialog).toContainText("ETIMEDOUT");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // 刷新：取到时已经结束的算看过。
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(statusIcon(page)).toHaveClass(/i-lucide-list-checks/u);

    await statusItem(page).click();
    await row(page, id).locator("[data-task-retry]").click();
    await expect(row(page, id)).toHaveCount(0);
    const again = ((await probe("/last")) as {id: string}).id;
    expect(again).not.toBe(id);
    await expect(row(page, again)).toBeVisible();
    await expect(statusItem(page)).toContainText("初始化 Skill pdf-tools");
    await probe(`/${again}/succeed`, {});
    await context.close();
});

test("通知中心：关掉的通知留在中心，标签写条数、铃铛带点；点铃铛打开“通知”，看过后清零；视图开着时新通知不弹出（notifications 验收 8、输出 17）", async ({browser}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page);
    const first = await startTask({title: "导出《雾港》"});
    await probe(`/${first}/succeed`, {message: "保存在 导出/雾港.epub。"});
    const toast = toasts(page).filter({hasText: "导出《雾港》"});
    await expect(toast).toBeVisible();
    await toast.getByRole("button", {name: "关闭"}).click();
    await expect(toast).toHaveCount(0);

    const bell = page.locator("[data-status-notifications]");
    await expect(bell).toHaveAttribute("aria-label", "通知：1 条没看过");
    await expect(bell.locator("[data-status-notifications-dot]")).toBeVisible();
    await bell.click();
    const entry = page.locator("[data-notification-entry]").filter({hasText: "导出《雾港》"});
    await expect(entry).toBeVisible();
    await expect(bell).toHaveAttribute("aria-label", "通知");
    await expect(page.getByRole("tab", {name: "通知", exact: true})).toBeVisible();

    const second = await startTask({title: "导出《雾港》为 PDF"});
    await probe(`/${second}/succeed`, {});
    await expect(page.locator("[data-notification-entry]").filter({hasText: "导出《雾港》为 PDF"})).toBeVisible();
    await expect(toasts(page).filter({hasText: "导出《雾港》为 PDF"})).toHaveCount(0);
    await expect(bell).toHaveAttribute("aria-label", "通知");

    // 切到“后台任务”标签，“通知”不再可见：之后的通知照常弹出，标签写没看过的条数。
    await page.getByRole("tab", {name: "后台任务"}).click();
    const third = await startTask({title: "重建全文索引"});
    await probe(`/${third}/succeed`, {});
    await expect(toasts(page).filter({hasText: "重建全文索引"})).toBeVisible();
    await expect(page.getByRole("tab", {name: "通知 1"})).toBeVisible();
    await context.close();
});

test("书架页没有状态栏与面板，任务结束时照样弹通知（输出 15）", async ({browser}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await open(page, "/");
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-workbench-home", /\S/u);
    const id = await startTask({title: "安装插件 nb-story"});
    await probe(`/${id}/fail`, {message: "下载失败"});
    await expect(toasts(page).filter({hasText: "安装插件 nb-story"})).toContainText("下载失败");
    await expect(statusItem(page)).toHaveCount(0);
    await context.close();
});
