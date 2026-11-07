/**
 * 编辑器区的 Lab 集成场景在真实浏览器中的验收（docs/specs/workbench/editor.md 的 Lab 部分）：真实的 `bun run dev` 里的
 * Lab，产品里同一个编辑器区控制器、文档模型与两种控件，文件换成内存适配器。输入、保存、外部改写与外部删除都改变场景
 * 数据；没有产品接口请求；切出再回是新的数据。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-editor");
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
const stage = (page: Page) => page.locator("[data-lab-stage]");
const prose = (page: Page) => stage(page).locator("[data-editor-group-active] [data-editor-prose]");
const tab = (page: Page, label: string) => stage(page).locator("[data-editor-group-head-active] [data-editor-tab]").filter({hasText: label});

/** 场景多于四个，Lab 用下拉框切场景。 */
async function chooseScene(page: Page, label: string): Promise<void> {
    await page.getByRole("combobox", {name: "场景"}).click();
    await page.getByRole("option", {name: label, exact: true}).click();
}

test("Lab 集成场景：输入后保存清掉未保存标记；外部改写进入正文；外部删除给出提示；拆分场景两种控件都渲染；不发产品接口请求；切出再回是新数据", async ({page}) => {
    const problems = watchConsole(page);
    await page.setViewportSize({width: 1400, height: 900});
    await page.goto(`${dev.pageUrl}lab?c=EditorGroup&s=live`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "live"});
    const requests: string[] = [];
    page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/") || path.startsWith("/rpc")) requests.push(path);
    });
    page.on("websocket", (socket) => requests.push(`websocket ${socket.url()}`));

    // 输入：在末尾追加，标签出现未保存标记；编辑器区内的 Ctrl+S 经意图保存，标记消失。
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await prose(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("雨停了。");
    await expect(tab(page, "第二章.md")).toHaveAttribute("data-editor-tab-dirty", "");
    await page.keyboard.press("Control+S");
    await expect(tab(page, "第二章.md")).not.toHaveAttribute("data-editor-tab-dirty", "");

    // 外部改写：没有未保存修改时直接采用磁盘的新正文。
    await page.locator("[data-lab-editor-external-write]").click();
    await expect(prose(page)).toContainText("另一个程序改写于");
    await expect(prose(page)).not.toContainText("雨停了。");

    // 外部删除：文档留在标签里，提示文件已被删除，正文只读（输入不进去）。
    await page.locator("[data-lab-editor-external-delete]").click();
    await expect(stage(page).locator("[data-editor-group-active] [data-editor-banner]")).toContainText("文件已被删除。");
    await expect(prose(page)).toHaveAttribute("contenteditable", "false");
    const deletedText = await prose(page).textContent();
    await prose(page).click();
    await page.keyboard.type("删后");
    await expect(prose(page)).toHaveText(deletedText ?? "");

    // 读取扣住：800 ms 后显示进度条，颜色取主题的强调色，读屏能读到“正在读取”；放行后打开。
    await page.locator("[data-lab-editor-controls]").getByRole("radio", {name: "扣住读取"}).click();
    await page.locator("[data-lab-editor-controls]").getByRole("button", {name: "打开设定.json"}).click();
    const bar = stage(page).locator("[data-editor-progress]");
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await expect(stage(page).getByRole("status").filter({hasText: "正在读取"})).toHaveCount(1);
    await page.locator("[data-lab-editor-controls]").getByRole("radio", {name: "正常"}).click();
    await expect(bar).toHaveCount(0);
    await expect(stage(page).locator("[data-editor-monaco]")).toContainText("临川");

    // 拆分场景：左组是 Markdown 富文本，右组是 Monaco 打开的 JSON。
    await chooseScene(page, "向右拆分的两组");
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "split"});
    await expect(stage(page).locator("[data-editor-group]")).toHaveCount(2);
    await expect(stage(page).locator("[data-editor-monaco]")).toContainText("临川");
    await expect(stage(page).locator("[data-editor-group]:not([data-editor-group-active]) [data-editor-prose]")).toContainText("雨下了一整夜。");

    // 切回：新的内存数据，之前的保存、改写与删除都不在了。
    await chooseScene(page, "内存数据：两个标签");
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "live"});
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await expect(prose(page)).not.toContainText("另一个程序改写于");
    await expect(stage(page).locator("[data-editor-banner]")).toHaveCount(0);

    expect(requests).toEqual([]);
    expect(problems).toEqual([]);
});

test.describe("回收（docs/specs/workbench/editor.md 术语“视图”）：每种编辑器只留 2 个控件", () => {
    /** 场景 `recycle` 的标签顺序：三个 Markdown（第一章、第二章、方言）、三个源码（第一章、第二章、设定）。 */
    const tabAt = (page: Page, index: number) => stage(page).locator("[data-editor-tab]").nth(index);
    const controls = (page: Page, kind: string) => stage(page).locator(`[data-editor-kind="${kind}"]`);
    const monacoText = (page: Page) => stage(page).locator("[data-editor-kind=\"nbook.editor.code\"]:visible .view-lines").evaluate((element) => [...element.querySelectorAll(".view-line")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((line) => (line.textContent ?? "").replace(/\u00a0/gu, " ")).join("\n"));

    test("Markdown：最久没用的卸载，切回来时光标与撤销都在", async ({page}) => {
        const problems = watchConsole(page);
        await page.setViewportSize({width: 1400, height: 900});
        await page.goto(`${dev.pageUrl}lab?c=EditorGroup&s=recycle`);
        await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "recycle"});
        await expect(stage(page).locator("[data-editor-tab]")).toHaveCount(6);
        // 滚动：方言那个标签滚到一半，它被卸载再切回来还在原处。视口压矮，正文才滚得动。
        await page.setViewportSize({width: 1400, height: 420});
        const scroller = stage(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-control=\"markdown\"]");
        await tabAt(page, 2).click();
        await expect(prose(page)).toContainText("方言一览");
        const scrolled = await scroller.evaluate((element) => {
            element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) / 2);
            return element.scrollTop;
        });
        expect(scrolled).toBeGreaterThan(0);
        await tabAt(page, 0).click();
        await expect(prose(page)).toContainText("天色将晚");
        await tabAt(page, 1).click();
        await expect(prose(page)).toContainText("雨下了一整夜");
        await expect(controls(page, "nbook.editor.markdown")).toHaveCount(2);
        await tabAt(page, 2).click();
        await expect(prose(page)).toContainText("方言一览");
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(scrolled);
        await page.setViewportSize({width: 1400, height: 900});

        await tabAt(page, 0).click();
        await expect(prose(page)).toContainText("天色将晚");
        await prose(page).click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("回收");
        await expect(prose(page)).toContainText("回收");
        await tabAt(page, 1).click();
        await expect(prose(page)).toContainText("雨下了一整夜");
        await tabAt(page, 2).click();
        await expect(prose(page)).toContainText("方言一览");
        // 第一章是最久没用的：它的控件卸了，只剩两个 Markdown 控件。
        await expect(controls(page, "nbook.editor.markdown")).toHaveCount(2);
        await tabAt(page, 0).click();
        await expect(prose(page)).toContainText("回收");
        // 不点正文：点了会移动光标。接着输入落在卸载之前的位置。
        await prose(page).focus();
        await page.keyboard.type("尾");
        await expect(prose(page)).toContainText("回收尾");
        for (let press = 0; press < 3 && (await prose(page).textContent())?.includes("回收") === true; press += 1) await page.keyboard.press("Control+z");
        await expect(prose(page)).not.toContainText("回收");
        expect(problems).toEqual([]);
    });

    test("源码编辑器：最久没用的卸载，切回来时光标与撤销都在", async ({page}) => {
        const problems = watchConsole(page);
        await page.setViewportSize({width: 1400, height: 900});
        await page.goto(`${dev.pageUrl}lab?c=EditorGroup&s=recycle`);
        await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "recycle"});
        await expect(stage(page).locator("[data-editor-tab]")).toHaveCount(6);
        await tabAt(page, 3).click();
        const editor = stage(page).locator("[data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
        await expect.poll(() => monacoText(page)).toContain("天色将晚");
        await editor.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("recycled");
        await expect.poll(() => monacoText(page)).toContain("recycled");
        const cursorAt = () => stage(page).locator("[data-editor-kind=\"nbook.editor.code\"]:visible .cursors-layer .cursor").first().evaluate((element) => `${(element as HTMLElement).style.top} ${(element as HTMLElement).style.left}`);
        const cursorBefore = await cursorAt();
        await tabAt(page, 4).click();
        await expect.poll(() => monacoText(page)).toContain("雨下了一整夜");
        await tabAt(page, 5).click();
        await expect.poll(() => monacoText(page)).toContain("临川");
        await expect(controls(page, "nbook.editor.code")).toHaveCount(2);
        await tabAt(page, 3).click();
        await expect.poll(() => monacoText(page)).toContain("recycled");
        await expect.poll(cursorAt).toBe(cursorBefore);
        await editor.click();
        for (let press = 0; press < 3 && (await monacoText(page)).includes("recycled"); press += 1) await page.keyboard.press("Control+z");
        await expect.poll(() => monacoText(page)).not.toContain("recycled");
        expect(problems).toEqual([]);
    });
});
