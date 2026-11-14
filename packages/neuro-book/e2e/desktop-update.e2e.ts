/**
 * 桌面版更新提示的页面一侧在真实浏览器里的验收（docs/specs/runtime/browser-host.md 输出 11，docs/specs/runtime/desktop-update.md
 * 输出 3 到 10 与场景 7 的页面一侧）：生产构建的后端与前端，本机 Chrome。壳由页面里的一个假发送函数代替（同
 * `desktop-close.e2e.ts`）：`addInitScript` 装上 `window.__electrobunSendToHost` 记下页面回的消息，提示用与壳相同的方式派发
 * `nbook-desktop` 事件。壳一侧的交付、转交与选择的判定在 `src/desktop/windows.test.ts`、`src/desktop/update.test.ts`。
 */

import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "desktop-update");
    const stateRoot = join(tmp, "state");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const toasts = (page: Page) => page.locator("[data-notification-stack] [role='status']");
const entries = (page: Page) => page.locator("[data-notification-entry]");

/** 页面发给假壳的消息。 */
const sent = (page: Page): Promise<unknown[]> => page.evaluate(() => (window as unknown as {__shellSent: unknown[]}).__shellSent);
const ofType = async (page: Page, type: string): Promise<unknown[]> => (await sent(page)).filter((message) => (message as {type: string}).type === type);

/** 像壳那样在页面里派发一条消息。 */
async function shell(page: Page, detail: unknown): Promise<void> {
    await page.evaluate((value) => window.dispatchEvent(new CustomEvent("nbook-desktop", {detail: value})), detail);
}

async function open(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const messages: unknown[] = [];
        (window as unknown as {__shellSent: unknown[]}).__shellSent = messages;
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = (message) => void messages.push(message);
    });
    await page.goto(new URL("/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

test("场景 7 的页面一侧：页面挂好后报一次就绪；提示弹出并回“已显示”；关掉回 later；中心里的“下载”回 download；收起时连中心记录一起撤掉", async ({page}) => {
    await open(page);
    await expect.poll(() => ofType(page, "page-ready")).toEqual([{type: "page-ready"}]);

    await shell(page, {type: "update-hint", id: 1, hint: {kind: "available", version: "0.90.2"}});
    const toast = toasts(page).filter({hasText: "NeuroBook 0.90.2 可以更新"});
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", {name: "下载"})).toBeVisible();
    await expect.poll(() => ofType(page, "update-hint-shown")).toEqual([{type: "update-hint-shown", id: 1}]);

    await toast.getByRole("button", {name: "关闭"}).click();
    await expect(toast).toHaveCount(0);
    await expect.poll(() => ofType(page, "update-choice")).toEqual([{type: "update-choice", id: 1, choice: "later"}]);
    // 同一个 id 再来（壳转交、重发）不再弹出。
    await shell(page, {type: "update-hint", id: 1, hint: {kind: "available", version: "0.90.2"}});
    await expect(toasts(page).filter({hasText: "0.90.2"})).toHaveCount(0);

    await page.locator("[data-status-notifications]").click();
    const entry = entries(page).filter({hasText: "NeuroBook 0.90.2 可以更新"});
    await expect(entry).toBeVisible();
    await entry.locator("[data-notification-action]").click();
    await expect.poll(() => ofType(page, "update-choice")).toEqual([
        {type: "update-choice", id: 1, choice: "later"},
        {type: "update-choice", id: 1, choice: "download"},
    ]);

    // 壳进入下一阶段：“正在下载”只进中心（通知视图开着），上一阶段的被收起后从中心里也撤掉。
    await shell(page, {type: "update-hint", id: 2, hint: {kind: "downloading", version: "0.90.2"}});
    await shell(page, {type: "update-hint-end", id: 1});
    await expect(entries(page).filter({hasText: "正在下载 NeuroBook 0.90.2"})).toBeVisible();
    await expect(entries(page).filter({hasText: "可以更新"})).toHaveCount(0);
    await expect(toasts(page).filter({hasText: "正在下载"})).toHaveCount(0);
});

test("只提示的启动：设了 NBOOK_STATE_ROOT 时正文说明不设时可以自动更新，动作是“打开下载页”", async ({page}) => {
    await open(page);
    await shell(page, {type: "update-hint", id: 7, hint: {kind: "notify-only", version: "0.90.3", envRoot: true}});
    const toast = toasts(page).filter({hasText: "NeuroBook 0.90.3 可以下载"});
    await expect(toast).toContainText("不设这个环境变量打开 NeuroBook 时可以自动更新");
    await toast.getByRole("button", {name: "打开下载页"}).click();
    await expect.poll(() => ofType(page, "update-choice")).toEqual([{type: "update-choice", id: 7, choice: "open-page"}]);
});

test("关窗询问进行中来提示：照样发出并回“已显示”，询问照常回答", async ({page}) => {
    await open(page);
    await shell(page, {type: "close-query", generation: 1, reason: "window"});
    await expect.poll(() => ofType(page, "close-ack")).toEqual([{type: "close-ack", generation: 1}]);
    await shell(page, {type: "update-hint", id: 3, hint: {kind: "updated", version: "0.90.2"}});
    await expect.poll(() => ofType(page, "update-hint-shown")).toEqual([{type: "update-hint-shown", id: 3}]);
    await expect.poll(() => ofType(page, "close-answer")).toEqual([{type: "close-answer", generation: 1, answer: "allow"}]);
});

test("刷新：旧页面报离开就绪，新页面挂好后再报一次就绪", async ({page}) => {
    await open(page);
    await expect.poll(() => ofType(page, "page-ready")).toHaveLength(1);
    // 离开前把消息转存到 sessionStorage：刷新后页面的全局对象是新的。
    await page.evaluate(() => {
        addEventListener("pagehide", () => sessionStorage.setItem("shellSent", JSON.stringify((window as unknown as {__shellSent: unknown[]}).__shellSent)));
    });
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const before = await page.evaluate(() => JSON.parse(sessionStorage.getItem("shellSent") ?? "[]") as unknown[]);
    expect(before.filter((message) => (message as {type: string}).type.startsWith("page-"))).toEqual([{type: "page-ready"}, {type: "page-gone"}]);
    await expect.poll(() => ofType(page, "page-ready")).toEqual([{type: "page-ready"}]);
});
