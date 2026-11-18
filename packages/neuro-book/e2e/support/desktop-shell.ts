/**
 * 模拟桌面壳的 e2e 共用的两件事（docs/specs/runtime/desktop-shell.md 输出 34）。
 *
 * - `installFakeShell`：像 Electrobun 的预加载那样，在页面脚本之前装上 `window.__electrobunSendToHost`，记下页面发给壳的消息；
 *   页面就绪（`page-ready`）时像壳那样回一条 `install-facts`。各文件原有的模拟壳另有自己的需要（询问、更新提示、外框），不强求合并。
 * - `markFirstRunSeen`：首次启动向导在桌面窗口里、状态根还没有“看过”的记录时会弹出模态框，挡住别的用例。模拟桌面壳的文件在
 *   `beforeAll` 里调它：以模拟壳打开一次书架、按“跳过”，等记录落进用户库再返回。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {expect} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";

export interface FakeInstallFacts {
    readonly installed: boolean;
    readonly defaultStateRoot: boolean;
    readonly stateRoot: string;
}

/** 装模拟壳；`facts` 为 null 时不回安装事实（像还没算出来）。页面发给壳的消息在 `window.__shellSent`。 */
export async function installFakeShell(page: Page, facts: FakeInstallFacts | null): Promise<void> {
    await page.addInitScript((installFacts) => {
        const sent: unknown[] = [];
        (window as unknown as {__shellSent: unknown[]}).__shellSent = sent;
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = (message) => {
            sent.push(message);
            if (installFacts !== null && (message as {type?: unknown}).type === "page-ready") {
                window.dispatchEvent(new CustomEvent("nbook-desktop", {detail: {type: "install-facts", facts: installFacts}}));
            }
        };
    }, facts);
}

/** 页面发给壳的消息（按发送顺序）。 */
export function shellSent(page: Page): Promise<ReadonlyArray<{readonly type: string} & Record<string, unknown>>> {
    return page.evaluate(() => (window as unknown as {__shellSent: Array<{type: string} & Record<string, unknown>>}).__shellSent);
}

/**
 * 用户库里有没有首次启动向导的记录：记录的键 `first-run` 以文本存进 `storage/user.sqlite`（WAL 模式下先在 `-wal` 里）。只用来等
 * 写入落盘，不解析库的结构。
 */
export async function firstRunRecorded(stateRoot: string): Promise<boolean> {
    for (const file of ["user.sqlite", "user.sqlite-wal"]) {
        const bytes = await readFile(join(stateRoot, "storage", file)).catch(() => null);
        if (bytes !== null && bytes.includes("first-run")) return true;
    }
    return false;
}

export async function markFirstRunSeen(browser: Browser, url: string, stateRoot: string): Promise<void> {
    const page = await browser.newPage();
    try {
        await installFakeShell(page, null);
        await page.goto(url);
        const wizard = page.locator("[data-first-run-wizard]");
        await expect(wizard).toBeVisible({timeout: 30_000});
        await page.locator("[data-first-run-secondary]").click();
        await expect(wizard).toHaveCount(0);
        await expect.poll(() => firstRunRecorded(stateRoot), {message: "首次启动向导的记录落进用户库", timeout: 15_000}).toBe(true);
    } finally {
        await page.close();
    }
}
