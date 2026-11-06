/**
 * 主题编辑器（docs/specs/theme/editor.md）：本机 Chrome、真实服务与真实 Storage。判据是文档根上的变量（真实工作台在变）、记录里存下的
 * 声明、真实插件安装对导出的包的接受，以及页面里的布局测量。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {unzipSync} from "fflate";

import {productPlugins} from "nbook/manifest";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const THEME = "nbook.workbench/theme";
const APPEARANCE = "nbook.workbench/appearance";
const SCENE_IMAGE = join(PACKAGE_ROOT, "src/plugins/theme-study/assets/study-day.webp");

test.use({viewport: {width: 1920, height: 1000}});

let tmp = "";
let counter = 0;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "theme-editor");
});

test.afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Session {
    readonly server: ProductServer;
    readonly stateRoot: string;
    readonly url: string;
}

/** 每个用例一个全新的服务与状态根：我的主题存在用户记录里，用例之间不能留东西。 */
async function withSession(settings: Readonly<Record<string, unknown>>, run: (session: Session) => Promise<void>): Promise<void> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const projectDir = join(root, "Book");
    const stateRoot = join(root, "state");
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(settings));
    const server = await startProductServer(stateRoot);
    try {
        await run({server, stateRoot, url: new URL("/?project=book", server.url).href});
    } finally {
        expect(await server.stop()).toBe(0);
    }
}

async function open(page: Page, session: Session): Promise<void> {
    await page.goto(session.url);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

const editor = (page: Page) => page.locator("[data-theme-editor]");
const colorInput = (page: Page, name: string) => page.locator(`[data-color-field="${name}"] input:not([type="color"])`).first();
const rootVar = (page: Page, name: string) => page.evaluate((variable) => document.documentElement.style.getPropertyValue(variable), name);

async function openEditorTab(page: Page): Promise<void> {
    await page.getByRole("menuitem", {name: "视图"}).click();
    await page.getByRole("menuitem", {name: "打开主题编辑器", exact: true}).click();
    await expect(editor(page)).toBeVisible();
}

async function newTheme(page: Page): Promise<void> {
    await page.locator("[data-new-empty]").click();
    await expect(page.locator("[data-section-tab]").first()).toBeVisible();
}


test("新建一套：改配色真实工作台立刻变，明暗只在编辑器里预览，关掉就回到设置里选的；列表里有我的，选了生效", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await expect(page.locator("[data-empty]")).toBeVisible();
        await newTheme(page);
        await page.locator("[data-section-tab=colors]").click();

        await colorInput(page, "--accent-main").fill("#2f6f4f");
        await expect.poll(() => rootVar(page, "--accent-main")).toBe("#2f6f4f");

        await page.locator("[data-appearance]").getByText("暗色").click();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");


        await page.locator("[data-editor-tab-close]").last().click({force: true});
        await expect(editor(page)).toBeHidden();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");
        expect(await rootVar(page, "--accent-main")).not.toBe("#2f6f4f");
        expect(JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8"))).toEqual({[THEME]: "nbook", [APPEARANCE]: "light"});

        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-row=\"nbook.workbench/theme\"]").getByRole("combobox").click();
        await page.getByRole("option", {name: "新主题 · 我的"}).click();
        await expect.poll(async () => (JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8")) as Record<string, string>)[THEME]).toMatch(/^user:/u);
        await expect.poll(() => rootVar(page, "--accent-main")).toBe("#2f6f4f");
    });
});

test("推导整套、对比度：三个主色推出整套并不低于 4.5；改坏一项被标出，汇总分区与角标都有；导出只提示", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=colors]").click();

        await colorInput(page, "--bg-main").fill("#e8f0e0");
        await colorInput(page, "--text-main").fill("#1d2a20");
        await colorInput(page, "--accent-main").fill("#2f6f4f");
        await page.locator("[data-derive]").click();
        await expect.poll(() => rootVar(page, "--bg-panel")).not.toBe("");
        const checks = await page.locator("[data-color-check]").evaluateAll((nodes) => nodes.map((node) => `${(node.closest("[data-color-field]") as HTMLElement).dataset.colorField ?? "?"}:${(node as HTMLElement).dataset.tone ?? "?"}:${node.textContent ?? ""}`));
        expect(checks.length).toBeGreaterThan(5);
        expect(checks.filter((entry) => !entry.includes(":ok:"))).toEqual([]);
        // 汇总里亮色这一套没有不合格项（暗色那一套还是主题包缺省的，不在这里判）。
        await page.locator("[data-section-tab=contrast]").click();
        await expect(page.locator("[data-contrast-failure]").filter({hasText: "亮色"})).toHaveCount(0);
        await page.locator("[data-section-tab=colors]").click();

        await colorInput(page, "--text-muted").fill("#dfe8d8");
        await expect(page.locator("[data-color-field=\"--text-muted\"] [data-color-check]")).toHaveAttribute("data-tone", "bad");
        await expect(page.locator("[data-contrast-count]")).toBeVisible();
        await page.locator("[data-section-tab=contrast]").click();
        await expect(page.locator("[data-contrast-failure]").filter({hasText: "亮色"}).filter({hasText: "--text-muted"})).toBeVisible();

        // 手改过的项再推导时不变。
        await page.locator("[data-section-tab=colors]").click();
        await page.locator("[data-derive]").click();
        await expect(colorInput(page, "--text-muted")).toHaveValue("#dfe8d8");

        const download = page.waitForEvent("download");
        await page.locator("[data-export]").click();
        await download;
        await expect(page.locator("[data-transfer]")).toContainText("对比度不合格");
    });
});

test("场景图与取景：上传转成图并显示，拖框与数值互相同步，读不懂的写法框不可拖、数值照改；传不是图的文件被拒", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=scene]").click();
        await expect(page.locator("[data-scene-none]")).toBeVisible();

        await page.locator("[data-scene-file]").setInputFiles({name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("不是图片")});
        await expect(page.locator("[data-scene-error]")).toBeVisible();

        await page.locator("[data-scene-file]").setInputFiles(SCENE_IMAGE);
        await expect(page.locator("[data-crop-editor]")).toBeVisible();
        await expect(page.locator("[data-scene-note]")).toContainText("KB");
        await expect(page.locator("[data-crop-editor] img")).toHaveJSProperty("complete", true);

        await page.locator("[data-crop-item=marginLeft]").click();
        const numbers = page.locator("[data-crop-numbers] input");
        await numbers.nth(0).fill("auto 118%");
        await numbers.nth(1).fill("0% 100%");
        const frame = page.locator("[data-crop-frame=marginLeft]");
        await expect(frame).toBeVisible();
        const before = await frame.boundingBox();

        // 改数值：框跟着动。
        await numbers.nth(1).fill("100% 100%");
        await expect.poll(async () => (await frame.boundingBox())?.x).toBeGreaterThan((before?.x ?? 0) + 20);
        // 拖框：数值跟着变。
        const placed = await frame.boundingBox();
        if (placed === null) throw new Error("框不可见");
        await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2);
        await page.mouse.down();
        await page.mouse.move(placed.x + placed.width / 2 - 150, placed.y + placed.height / 2 - 40, {steps: 6});
        await page.mouse.up();
        await expect(numbers.nth(1)).not.toHaveValue("100% 100%");

        // 读不懂的写法：框消失、提示出现，数值还能改，改成读得懂的就回来。
        await numbers.nth(0).fill("cover");
        await expect(page.locator("[data-crop-unparsable]")).toBeVisible();
        await expect(frame).toHaveCount(0);
        await numbers.nth(0).fill("auto 130%");
        await expect(frame).toBeVisible();
    });
});

test("导出的包被真实的插件安装接受，导入读得回来；坏 zip 整个拒绝", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=basic]").click();
        await page.locator("[data-section=basic] input").nth(0).fill("夜读");
        await page.locator("[data-section=basic] input").nth(1).fill("Night Reading");
        await page.locator("[data-section-tab=scene]").click();
        await page.locator("[data-scene-file]").setInputFiles(SCENE_IMAGE);
        await expect(page.locator("[data-crop-editor]")).toBeVisible();

        const waiting = page.waitForEvent("download");
        await page.locator("[data-export]").click();
        const download = await waiting;
        expect(download.suggestedFilename()).toBe("night-reading.zip");
        const archive = join(tmp, "exported.zip");
        await download.saveAs(archive);

        // 解开放进目录，交给真实的插件安装。
        const files = unzipSync(new Uint8Array(await readFile(archive)));
        const pluginDir = join(tmp, "exported-plugin");
        for (const [name, bytes] of Object.entries(files)) {
            await mkdir(join(pluginDir, name, ".."), {recursive: true});
            await writeFile(join(pluginDir, name), bytes);
        }
        const plugins = createPluginInventory({root: join(tmp, "plugins-root"), profile: NEUROBOOK_PROFILE, builtin: productPlugins, startup: NO_INSTALLED_PLUGINS, record: () => undefined});
        const installed = await plugins.install(pluginDir);
        expect(installed.ok, JSON.stringify(installed)).toBe(true);

        // 导入：坏的整个拒绝，好的多一套。
        await page.locator("[data-import-file]").setInputFiles({name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from("不是 zip")});
        await expect(page.locator("[data-transfer]")).toHaveAttribute("data-tone", "bad");
        await page.locator("[data-import-file]").setInputFiles(archive);
        await expect(page.locator("[data-transfer]")).toContainText("已导入 1 套");
        await expect(page.locator("[data-transfer]")).toHaveAttribute("data-tone", "ok");
        await page.locator("[data-section-tab=scene]").click();
        await expect(page.locator("[data-crop-editor]")).toBeVisible();
    });
});

test("浮动窗口里是同一个编辑器：实心面、可关闭，关掉后预览清掉；窄屏不横向溢出", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await page.getByRole("menuitem", {name: "视图"}).click();
        await page.getByRole("menuitem", {name: "在浮动窗口中打开主题编辑器", exact: true}).click();
        const floating = page.locator(".nb-ui-dialog-surface--window [data-theme-editor]");
        await expect(floating).toBeVisible();
        const background = await floating.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(/rgba\(.*,\s*0(\.\d+)?\)/u.test(background), `编辑面板要实心：${background}`).toBe(false);
        await newTheme(page);
        await page.locator("[data-appearance]").getByText("暗色").click();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
        await page.locator("[data-close]").click();
        await expect(floating).toBeHidden();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");

        await openEditorTab(page);
        await page.setViewportSize({width: 390, height: 844});
        const overflow = await editor(page).evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
