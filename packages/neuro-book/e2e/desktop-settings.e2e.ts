/**
 * 桌面专属设置在真实浏览器里的验收（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”，docs/specs/settings/settings-window.md
 * 分区的 `host`）：生产构建的后端与前端，本机 Chrome。壳由 `addInitScript` 装的假发送函数代替，记下页面交给壳的消息。
 * 真实 WebView2 里快捷键能不能拦住它自带的缩放，只能在 Windows 上用真实键盘验，不在这里。
 */

import {randomUUID} from "node:crypto";
import {copyFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import {markFirstRunSeen} from "./support/desktop-shell";
import type {ProductServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async ({browser}) => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "desktop-settings");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await copyFile(join(import.meta.dirname, "../../../brand/logo/06-production/png/app-icon/neurobook-app-icon-256.png"), join(projectDir, "notes/cover.png"));
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
    // 首次启动向导会在桌面窗口里弹出、挡住用例：先在这个状态根上记下看过（desktop-shell 输出 34）。
    await markFirstRunSeen(browser, server.url, stateRoot);
});

test.afterEach(async () => {
    await rm(join(stateRoot, "settings.json"), {force: true});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 像桌面壳那样：页面脚本之前就有壳的发送函数；记下页面发给壳的消息。 */
async function installShell(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const messages: unknown[] = [];
        (window as unknown as {__shellSent: unknown[]}).__shellSent = messages;
        (window as unknown as {__electrobunSendToHost: (message: unknown) => void}).__electrobunSendToHost = (message) => void messages.push(message);
        // 冒泡到窗口的滚轮事件有没有被拦下（桌面里 Ctrl+滚轮在编辑器与图片查看器之外由全局监听拦下）。
        const wheels: boolean[] = [];
        (window as unknown as {__wheelPrevented: boolean[]}).__wheelPrevented = wheels;
        // 同一目标上的监听按登记顺序执行，这里先于页面的监听：到下一个宏任务再读，才看得到别人拦没拦。
        window.addEventListener("wheel", (event) => void setTimeout(() => wheels.push(event.defaultPrevented), 0), {passive: true});
    });
}

/** 页面交给壳的缩放，按先后。 */
const zooms = async (page: Page): Promise<number[]> => (await page.evaluate(() => (window as unknown as {__shellSent: Array<{type: string; values?: {zoom: number}}>}).__shellSent))
    .filter((message) => message.type === "desktop-settings")
    .map((message) => message.values!.zoom);

/** 页面最后一次交给壳的桌面设置。 */
const lastValues = async (page: Page): Promise<unknown> => (await page.evaluate(() => (window as unknown as {__shellSent: Array<{type: string; values?: unknown}>}).__shellSent))
    .filter((message) => message.type === "desktop-settings")
    .at(-1)?.values;

const userLayer = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(stateRoot, "settings.json"), "utf8").catch(() => "{}")) as Record<string, unknown>;

async function openWorkbench(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    // 工作台的键位随标题栏所在的外壳装好；按快捷键之前等它出现。
    await expect(page.locator("[data-workbench-titlebar]")).toBeVisible();
}

/** 设置窗口左栏的分区 id。 */
const sectionIds = async (page: Page): Promise<string[]> => {
    await page.keyboard.press("Control+,");
    const dialog = page.getByRole("dialog", {name: "设置"});
    await expect(dialog).toBeVisible();
    return dialog.locator("[data-settings-nav]").evaluateAll((items) => items.map((item) => item.getAttribute("data-settings-nav") ?? ""));
};

test("浏览器里（没有壳）：设置里没有“桌面窗口”分区，命令面板里没有缩放命令，不发任何桌面设置", async ({page}) => {
    await openWorkbench(page);
    expect(await sectionIds(page)).not.toContain("nbook.desktop.window");
    await page.keyboard.press("Escape");
    await paletteSearch(page, "放大");
    await expect(page.locator("[role=option]").filter({hasText: "放大"})).toHaveCount(0);
});

/** 打开命令面板、输入查询词；面板确实开着才返回（不开着时“没有某条命令”的断言是空的）。 */
async function paletteSearch(page: Page, query: string): Promise<void> {
    await page.keyboard.press("Control+Shift+P");
    const input = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(input).toBeVisible();
    await input.fill(query);
    await expect(input).toHaveValue(query);
}

test("桌面里：有“桌面窗口”分区；启动时交出有效值；Ctrl+= 改档、防抖后写进用户层；Ctrl+滚轮不换界面缩放；Ctrl+0 删掉这个键", async ({page}) => {
    await installShell(page);
    await openWorkbench(page);
    await expect.poll(() => zooms(page)).toEqual([1]);
    expect(await sectionIds(page)).toContain("nbook.desktop.window");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(() => zooms(page)).toEqual([1, 1.1, 1.25]);
    await expect.poll(userLayer).toEqual({"nbook.desktop/zoom": 1.25});

    // Ctrl+滚轮不换界面缩放（只在编辑器上改字号、在图片查看器里缩放图片）：滚几格，壳收到的缩放不变。上面已等防抖写回
    // 落盘：写回之后配置服务会再交一次同样的值，所以下面按不同的值核对，不按条数。
    // 指针放在标题栏上：不在任何编辑组里，走的是桌面插件的全局监听。
    const box = await page.locator("[data-workbench-titlebar]").boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 150);
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Control");
    await expect.poll(() => page.evaluate(() => (window as unknown as {__wheelPrevented: boolean[]}).__wheelPrevented)).toEqual([true, true]);
    const settled = await zooms(page);
    expect(settled.at(-1)).toBe(1.25);
    expect([...new Set(settled)]).toEqual([1, 1.1, 1.25]);

    await page.keyboard.press("Control+0");
    await expect.poll(async () => (await zooms(page)).at(-1)).toBe(1);
    await expect.poll(userLayer).toEqual({});

    // 命令面板里的“放大”（只在桌面里可用）。
    await paletteSearch(page, "放大");
    const option = page.locator("[role=option]").filter({hasText: "放大"});
    await expect(option).toHaveCount(1);
    await option.click();
    await expect.poll(async () => (await zooms(page)).at(-1)).toBe(1.1);
    // 防抖写回落盘之后再改文件，不然写回会盖掉下面这次修改。
    await expect.poll(userLayer).toEqual({"nbook.desktop/zoom": 1.1});

    // 直接改设置文件：拥有者推给页面，页面交给壳（三项都交，关窗去向也在内）。
    expect(await lastValues(page)).toMatchObject({closeLastWindow: "quit"});
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.desktop/zoom": 1.5, "nbook.desktop/closeLastWindow": "tray"}));
    await expect.poll(() => lastValues(page)).toEqual({zoom: 1.5, openAtLogin: false, closeLastWindow: "tray", windowBackdrop: "off", desktopShortcut: true});
    // 窗口背景（desktop-shell 输出 32）：改了交给壳，壳只对之后新开的窗口用它。
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.desktop/zoom": 1.5, "nbook.desktop/closeLastWindow": "tray", "nbook.desktop/windowBackdrop": "acrylic"}));
    await expect.poll(() => lastValues(page)).toEqual({zoom: 1.5, openAtLogin: false, closeLastWindow: "tray", windowBackdrop: "acrylic", desktopShortcut: true});
});

test("图片查看器里的 Ctrl+滚轮缩放图片，不改界面缩放", async ({page}) => {
    await installShell(page);
    await openWorkbench(page);
    const folder = page.locator('[data-explorer-row="project://notes"]');
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await page.locator('[data-explorer-row="project://notes/cover.png"]').dblclick();
    const image = page.locator("[data-image-viewer-image]");
    await expect(image).toBeVisible();
    const before = await image.boundingBox();
    await page.mouse.move((before?.x ?? 0) + 20, (before?.y ?? 0) + 20);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Control");
    // 图片自己放大了（滚轮已被处理），界面缩放没有动。
    await expect.poll(async () => (await image.boundingBox())?.width ?? 0).toBeGreaterThan(before?.width ?? 0);
    expect(await zooms(page)).toEqual([1]);
});

test("用户层坏了又修回、有效值没变时，页面补交一次桌面设置（壳靠第一份值对账开机自启与桌面快捷方式）", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), "{broken");
    await installShell(page);
    await openWorkbench(page);
    // 坏的用户层不交值（读到的是缺省值，交给壳会被当真）。
    // test-lint-allow fixed-wait: 断言“没有交值”，没有可等的信号；等过插件激活与配置快照到达的时间
    await page.waitForTimeout(1_000);
    expect(await lastValues(page)).toBeUndefined();
    await writeFile(join(stateRoot, "settings.json"), "{}\n");
    await expect.poll(() => lastValues(page)).toEqual({zoom: 1, openAtLogin: false, closeLastWindow: "quit", windowBackdrop: "off", desktopShortcut: true});
});
