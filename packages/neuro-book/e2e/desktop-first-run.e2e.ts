/**
 * 首次启动向导（docs/specs/runtime/desktop-shell.md 输出 34、验收场景 19 里能在浏览器里验的部分）：生产构建的后端与前端，本机 Chrome。
 * 壳由 `support/desktop-shell.ts` 的模拟壳代替（发送函数加回发安装事实）；桌面快捷方式真实的删与建在 Windows 上验。
 *
 * 每个用例一个新的状态根（向导看的是状态根上的记录），书架上放一部作品：像升级前已在用的用户，记录照样没有。
 */

import {randomUUID} from "node:crypto";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";
import {firstRunRecorded, installFakeShell, shellSent} from "./support/desktop-shell";

let tmp = "";
let stateRoot = "";
let server: ProductServer | null = null;

test.beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "desktop-first-run");
    stateRoot = join(tmp, "state");
    const projectDir = join(tmp, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "长夜行", path: projectDir}]}));
    server = await startProductServer(stateRoot, {env: {HOME: tmp}});
});

test.afterEach(async () => {
    if (server !== null) expect(await server.stop()).toBe(0);
    server = null;
    await chmod(join(stateRoot, "settings.json"), 0o644).catch(() => undefined);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const INSTALLED = (root: string) => ({installed: true, defaultStateRoot: true, stateRoot: root});
const wizard = (page: Page) => page.locator("[data-first-run-wizard]");
const primary = (page: Page) => page.locator("[data-first-run-primary]");
const readSettings = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(stateRoot, "settings.json"), "utf8").catch(() => "{}")) as Record<string, unknown>;

async function openDesktop(page: Page, facts = INSTALLED(stateRoot)): Promise<void> {
    await installFakeShell(page, facts);
    await page.goto(server!.url);
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
}

test("第一次打开桌面版：走完四步，外观与桌面三项写进用户层、交给壳，记录写好后再开不出现", async ({page}) => {
    await openDesktop(page);
    await expect(wizard(page)).toBeVisible();
    await expect(wizard(page)).toHaveAttribute("data-step", "1");
    await expect(primary(page)).toBeFocused();
    await primary(page).click();

    // 第二步：主题与明暗经切换命令写，界面当场换。
    await expect(wizard(page)).toHaveAttribute("data-step", "2");
    await expect(primary(page)).toBeFocused();
    await page.locator("[data-theme-card='macos']").click();
    await page.locator("[data-scheme-card='dark']").click();
    await expect.poll(readSettings).toMatchObject({"nbook.workbench/theme": "macos", "nbook.workbench/appearance": "dark"});
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    await expect(page.locator("[data-theme-card='macos']")).toHaveAttribute("aria-checked", "true");
    await primary(page).click();

    // 第三步：三行都在（安装版、缺省状态根）；关掉桌面快捷方式，写进用户层并交给壳。
    await expect(wizard(page)).toHaveAttribute("data-step", "3");
    await expect(page.locator("[data-desktop-option]")).toHaveCount(3);
    await page.locator("[data-desktop-option='desktopShortcut'] [role='switch']").click();
    await expect.poll(readSettings).toMatchObject({"nbook.desktop/desktopShortcut": false});
    await expect.poll(async () => (await shellSent(page)).filter((message) => message.type === "desktop-settings").at(-1)?.values).toMatchObject({desktopShortcut: false});
    await page.locator("[data-desktop-option='tray'] [role='switch']").click();
    await expect.poll(readSettings).toMatchObject({"nbook.desktop/closeLastWindow": "tray"});
    await primary(page).click();

    // 第四步：状态根来自壳交来的安装事实，作品目录还没建；“打开”状态根交给壳。
    await expect(wizard(page)).toHaveAttribute("data-step", "4");
    await expect(page.locator("[data-place='state-root']")).toContainText(stateRoot);
    // 临时 HOME 下没有文档目录，作品目录退回主目录下的 NeuroBook（projects 输出 19）。
    await expect(page.locator("[data-place='library']")).toContainText(join(tmp, "NeuroBook"));
    await page.locator("[data-place='state-root'] button").click();
    await expect.poll(async () => (await shellSent(page)).some((message) => message.type === "open-state-root")).toBe(true);
    await page.locator("[data-place='library'] button").click();
    await expect(page.locator("[data-library-missing]")).toBeVisible();
    await primary(page).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect.poll(() => firstRunRecorded(stateRoot)).toBe(true);

    // 再开一页：等桌面设置交给了壳（向导的出现条件里用户层已可用），再看一阵子，向导不出现。
    await page.reload();
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await expect.poll(async () => (await shellSent(page)).some((message) => message.type === "desktop-settings")).toBe(true);
    await page.waitForTimeout(1_500);
    await expect(wizard(page)).toHaveCount(0);

    // 命令面板能再打开；Esc 等于跳过。
    await page.keyboard.press("Control+Shift+P");
    const palette = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(palette).toBeVisible();
    await palette.fill("打开桌面版欢迎向导");
    await expect(page.locator("[role=option]").filter({hasText: "打开桌面版欢迎向导"})).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(wizard(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(wizard(page)).toHaveCount(0);
});

test("便携版或设了状态根环境变量：第三步只有关窗去向", async ({page}) => {
    await openDesktop(page, {installed: false, defaultStateRoot: false, stateRoot});
    await expect(wizard(page)).toBeVisible();
    await primary(page).click();
    await primary(page).click();
    await expect(page.locator("[data-desktop-option]")).toHaveCount(1);
    await expect(page.locator("[data-desktop-option='tray']")).toBeVisible();
});

test("Esc 跳过也写记录；已改的值不撤销", async ({page}) => {
    await openDesktop(page);
    await primary(page).click();
    await page.locator("[data-scheme-card='dark']").click();
    await expect.poll(readSettings).toMatchObject({"nbook.workbench/appearance": "dark"});
    await page.keyboard.press("Escape");
    await expect(wizard(page)).toHaveCount(0);
    await expect.poll(() => firstRunRecorded(stateRoot)).toBe(true);
    expect(await readSettings()).toMatchObject({"nbook.workbench/appearance": "dark"});
});

test("设置写不进去时开关回到原值，状态行说明", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), "{}\n");
    await chmod(join(stateRoot, "settings.json"), 0o444);
    await openDesktop(page);
    await primary(page).click();
    await primary(page).click();
    const login = page.locator("[data-desktop-option='openAtLogin'] [role='switch']");
    await expect(login).toHaveAttribute("aria-checked", "false");
    await login.click();
    await expect(wizard(page)).toContainText("登录时打开没有改成，回到了原来的值。");
    await expect(login).toHaveAttribute("aria-checked", "false");
});

test("动效：看板娘的缩放取有位移的那档时长；系统要求减少动态效果时为 0", async ({page}) => {
    // e2e 的浏览器缺省要求减少动态效果（playwright.config.ts），先开回来。
    await page.emulateMedia({reducedMotion: "no-preference"});
    await openDesktop(page);
    const mood = page.locator(".first-run__mood");
    await expect(wizard(page)).toBeVisible();
    expect(await mood.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.28s");
    await page.emulateMedia({reducedMotion: "reduce"});
    expect(await mood.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
});

test("浏览器里（没有壳）：不出现，也不加载向导的代码", async ({page}) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.goto(server!.url);
    await expect(page.locator("[data-bookshelf-page]")).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(wizard(page)).toHaveCount(0);
    expect(requested.filter((url) => /FirstRunWizard/u.test(url))).toEqual([]);
});
