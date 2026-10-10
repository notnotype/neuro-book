/**
 * 产品 `/` 页的命令面板（workbench.commands 场景 13）：生产构建的外壳与后端，本机 Chrome。
 * 面板入口命令是工作台向 nbook.commands 贡献的，键位分发挂在 `/` 页的命令宿主上。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "commands");
    server = await startProductServer(join(tmp, "state"));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test("`/` 页按 Ctrl+Shift+P 打开命令面板，Escape 关闭并把焦点还回去", async ({page}) => {
    const problems: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    await page.goto(new URL("/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");

    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    // 命令宿主随 `/` 页异步加载：按到面板出现为止。
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    // 面板入口本身不进候选；产品命令表里另有“打开项目”。
    await expect(page.getByRole("option", {name: /打开项目/})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(combobox).toHaveCount(0);
    await expect(page.locator("body")).toBeFocused();
    expect(problems).toEqual([]);
});
