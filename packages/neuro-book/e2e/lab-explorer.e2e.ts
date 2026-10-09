/**
 * 资源管理器的 Lab 集成场景在真实浏览器中的验收（docs/specs/workbench/files-explorer.md 验收 13 的 Lab 部分）：真实的
 * `bun run dev` 里的 Lab，产品里同一个视图宿主、控制器与命令，文件换成内存适配器。删除与剪切粘贴改变场景数据，结果
 * 未知的门禁照常；没有产品接口请求；切出再回，旧的订阅、剪贴板与修改都不在了。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-explorer");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function watchConsole(page: Page): string[] {
    const problems: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);
const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const tree = (page: Page) => page.getByRole("tree", {name: "文件"});

async function chooseScene(page: Page, label: string): Promise<void> {
    await page.getByRole("combobox", {name: "场景"}).click();
    await page.getByRole("option", {name: label, exact: true}).click();
}

test("Lab 集成场景：删除、剪切粘贴（同名改名）改变场景数据；结果未知挡住批量动作直到放弃；不发产品接口请求；切出再回是新的数据与订阅", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1400, height: 900});
    await page.goto(`${dev.pageUrl}lab?c=FilesExplorerView&s=live`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "live"});
    const requests: string[] = [];
    page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/") || path.startsWith("/rpc")) requests.push(path);
    });
    page.on("websocket", (socket) => requests.push(`websocket ${socket.url()}`));

    await expect(item(page, "project://lore.content/alice")).toContainText("爱丽丝");
    await expect(item(page, "project://lore.content/gone")).toContainText("缺失");
    await expect(page.locator("[data-lab-explorer-watchers]")).toHaveText("订阅 2");

    // 删除：确认框默认在取消上，Tab 到删除再确认。
    await item(page, "project://plain/b.md").click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("project://plain/b.md");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(item(page, "project://plain/b.md")).toHaveCount(0);

    // 剪切粘贴到有同名项的目录：问改名，预填候选名。
    await item(page, "project://plain/a.md").click();
    await page.keyboard.press("Control+X");
    await expect(item(page, "project://plain/a.md")).toHaveAttribute("data-explorer-cut", "");
    await item(page, "project://drafts").click();
    await expect(item(page, "project://drafts/a.md")).toBeVisible();
    await item(page, "project://drafts").click({button: "right"});
    await page.getByRole("menuitem", {name: /粘贴/u}).click();
    const collision = page.getByRole("dialog");
    await expect(collision.locator("[data-explorer-collision-target]")).toHaveText("project://drafts/a.md");
    await expect(collision.locator("input").first()).toHaveValue("a (2).md");
    await collision.locator("[data-explorer-collision-rename]").click();
    await expect(item(page, "project://drafts/a (2).md")).toBeVisible();
    await expect(item(page, "project://plain/a.md")).toHaveCount(0);

    // 下一次批量结果未知：复制粘贴后门禁出现，粘贴菜单项禁用；放弃后恢复。
    await page.locator("[data-lab-explorer-batch]").getByRole("radio", {name: "结果未知"}).click();
    await item(page, "project://drafts/a.md").click();
    await page.keyboard.press("Control+C");
    await item(page, "project://plain").click({button: "right"});
    await page.getByRole("menuitem", {name: /粘贴/u}).click();
    const unknown = page.locator("[data-explorer-unknown]");
    await expect(unknown).toContainText("复制 1 项的结果未知");
    await item(page, "project://plain").click({button: "right"});
    await expect(page.getByRole("menuitem", {name: /粘贴/u})).toBeDisabled();
    await page.keyboard.press("Escape");
    await unknown.locator("[data-explorer-abandon]").click();
    await expect(unknown).toHaveCount(0);
    await expect(page.locator("[data-lab-explorer-batch]").getByRole("radio", {name: "正常"})).toBeChecked();

    // 切出再回：新的内存数据（删掉的 b.md 回来了），剪贴板与修改都不在，订阅仍是两条。
    await chooseScene(page, "浏览");
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "default"});
    await chooseScene(page, "内存数据：真实控制器与命令");
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "live"});
    await expect(item(page, "project://plain/b.md")).toBeVisible();
    await expect(item(page, "project://plain/a.md")).not.toHaveAttribute("data-explorer-cut", "");
    await expect(page.locator("[data-lab-explorer-watchers]")).toHaveText("订阅 2");
    await item(page, "project://plain").click({button: "right"});
    await expect(page.getByRole("menuitem", {name: /粘贴/u})).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(tree(page)).toBeVisible();

    expect(requests).toEqual([]);
    expect(problems).toEqual([]);
});
