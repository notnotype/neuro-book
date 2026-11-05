/**
 * 主题皮肤（docs/specs/theme/skins.md）：本机 Chrome、真实服务，内置的“书房”。对比度是量出来的：把文字藏起来截图，拿每个像素和文字原来的颜色算。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {productPlugins} from "nbook/manifest";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STUDY = "nbook.theme-study.study";
const THEME = "nbook.workbench/theme";
const APPEARANCE = "nbook.workbench/appearance";

// 够宽：右栏开着时编辑区也放得下两侧。
test.use({viewport: {width: 2200, height: 1000}});

let tmp = "";
let stateRoot = "";
let projectDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "themes");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(projectDir, "notes/data.json"), "{\n  \"a\": 1\n}\n");
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const settingsFile = (): string => join(stateRoot, "settings.json");
const writeSettings = (values: Readonly<Record<string, unknown>>): Promise<void> => writeFile(settingsFile(), JSON.stringify(values));
const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const scene = (page: Page) => activeGroup(page).locator("[data-editor-scene]");
const margin = (page: Page, side: "left" | "right") => activeGroup(page).locator(`[data-markdown-margin="${side}"]`);

async function openProject(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
}

async function openFile(page: Page, name: string): Promise<void> {
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://notes/${name}`).dblclick({timeout: 3000});
        await expect(activeGroup(page).locator("[data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
}

const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

const HIDE_TEXT = `html[data-e2e-hide-text] *, html[data-e2e-hide-text] *::before, html[data-e2e-hide-text] *::after {
    color: transparent !important; caret-color: transparent !important; text-decoration-color: transparent !important; transition: none !important;
    outline-color: transparent !important; border-color: transparent !important; box-shadow: none !important; -webkit-text-fill-color: transparent !important;
}`;

interface Measured {
    /** 文字和背景里任一像素的最差对比度。 */
    readonly worst: number;
    /** 背景的平均亮度，正向对照用。 */
    readonly mean: number;
    readonly distinct: number;
}

/** 量一个元素：先记下它里面文字的颜色，藏起文字截图，在页面里解码（不用图片库）逐像素算。 */
async function measure(page: Page, selector: string): Promise<Measured> {
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    // 图标按钮里没有文字，量它自己的颜色（图标按 currentColor 画）。
    const colors = await target.evaluate((element) => {
        const found = new Set<string>();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (node.textContent?.trim() && node.parentElement !== null) found.add(getComputedStyle(node.parentElement).color);
        }
        return found.size > 0 ? [...found] : [getComputedStyle(element).color];
    });
    const box = await target.boundingBox();
    if (box === null) throw new Error(`${selector} 不可见`);
    await page.evaluate(() => document.documentElement.setAttribute("data-e2e-hide-text", ""));
    await nextFrame(page);
    const shot = await page.screenshot({clip: box, animations: "disabled"});
    await page.evaluate(() => document.documentElement.removeAttribute("data-e2e-hide-text"));
    return page.evaluate(async ({base64, colors: textColors}) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", {willReadFrequently: true}) as CanvasRenderingContext2D;
        context.drawImage(image, 0, 0);
        const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
        // 文字颜色可能是 color-mix 算出来的格式，让画布转成 RGBA。
        const rgba = textColors.map((color) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
        });
        const channel = (value: number): number => {
            const s = value / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (r: number, g: number, b: number): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        const seen = new Set<number>();
        let worst = Number.POSITIVE_INFINITY;
        let total = 0;
        for (let index = 0; index < data.length; index += 4) {
            const [r, g, b] = [data[index] as number, data[index + 1] as number, data[index + 2] as number];
            total += (r + g + b) / 3;
            const key = (r << 16) | (g << 8) | b;
            if (seen.has(key)) continue;
            seen.add(key);
            const under = luminance(r, g, b);
            for (const [tr, tg, tb, ta] of rgba) {
                const alpha = ta / 255;
                const over = luminance(tr * alpha + r * (1 - alpha), tg * alpha + g * (1 - alpha), tb * alpha + b * (1 - alpha));
                const ratio = (Math.max(under, over) + 0.05) / (Math.min(under, over) + 0.05);
                if (ratio < worst) worst = ratio;
            }
        }
        return {worst, mean: total / (data.length / 4), distinct: seen.size};
    }, {base64: shot.toString("base64"), colors});
}

const DOCUMENT = "# 第一章\n\n第一段正文，长一些的句子才看得出字读不读得动。\n\n> 引用是次要文字\n\n[一个链接](https://example.com)\n\n<mark>高亮的正文</mark>\n\n" + "接着写下去。\n\n".repeat(60);

test("欢迎页与没开文件有场景；关闭后的空状态也有；切回 NeuroBook 不留变量", async ({page}) => {
    await writeSettings({[THEME]: STUDY, [APPEARANCE]: "light"});
    await openProject(page);
    await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
    await expect(scene(page)).toHaveCSS("background-image", /study-day/u);
    await expect(page.locator("[data-welcome-page]")).toBeVisible();

    await writeSettings({[THEME]: STUDY, [APPEARANCE]: "dark"});
    await expect(scene(page)).toHaveCSS("background-image", /study-night/u);

    await activeGroup(page).locator("[data-editor-tab-close]").first().click({force: true});
    await expect(activeGroup(page).locator("[data-editor-empty]")).toBeVisible();
    await expect(scene(page)).toHaveCSS("background-image", /study-night/u);

    await writeSettings({[THEME]: "nbook", [APPEARANCE]: "dark"});
    await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
    await expect(page.locator("html")).not.toHaveAttribute("data-nb-skin-scene");
    await expect(scene(page)).toBeHidden();
    const leftovers = await page.evaluate(() => [...document.documentElement.style].filter((name) => name.startsWith("--skin-") || name === "--font-prose"));
    expect(leftovers).toEqual([]);
});

test("正文两侧：滚动不动；一侧不足 120px 不画；拆分后各自判断；源码编辑器不画", async ({page}) => {
    await writeFile(join(projectDir, "notes/long.md"), DOCUMENT);
    await writeSettings({[THEME]: STUDY, [APPEARANCE]: "light"});
    await openProject(page);
    await openFile(page, "long.md");
    await expect(prose(page)).toBeVisible();
    await expect(margin(page, "left")).toBeVisible();
    await expect(margin(page, "right")).toBeVisible();
    await expect(margin(page, "left")).toHaveCSS("background-image", /study-day/u);
    expect((await margin(page, "left").boundingBox())?.width).toBeGreaterThanOrEqual(120);

    const before = await margin(page, "left").boundingBox();
    const first = prose(page).locator("p").first();
    const firstBefore = await first.boundingBox();
    await first.click();
    await page.mouse.wheel(0, 1500);
    await expect.poll(async () => (await first.boundingBox())?.y).toBeLessThan(firstBefore?.y as number);
    expect(await margin(page, "left").boundingBox()).toEqual(before);

    // 正文列在两侧中间，两侧不压正文。
    const line = await first.boundingBox();
    expect((before?.x as number) + (before?.width as number)).toBeLessThanOrEqual(line?.x as number);

    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect(page.locator("[data-editor-group] [data-markdown-margin]:visible")).toHaveCount(0);
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
    await expect(margin(page, "left")).toBeVisible();

    await page.setViewportSize({width: 1440, height: 900});
    await expect(margin(page, "left")).toBeHidden();
    await page.setViewportSize({width: 2200, height: 1000});
    await expect(margin(page, "left")).toBeVisible();

    await openFile(page, "data.json");
    await expect(activeGroup(page).locator(".monaco-editor")).toBeVisible();
    await expect(activeGroup(page).locator("[data-markdown-margin]:visible")).toHaveCount(0);
});

test("高对比度、强制颜色下不画场景，配色照旧", async ({page}) => {
    await writeFile(join(projectDir, "notes/a11y.md"), DOCUMENT);
    await writeSettings({[THEME]: STUDY, [APPEARANCE]: "light"});
    await openProject(page);
    await expect(scene(page)).toBeVisible();
    const corner = () => page.locator("[data-tool-part=\"sidebar\"]").evaluate((element) => getComputedStyle(element, "::after").display);
    await expect.poll(corner).toBe("block");
    await page.emulateMedia({contrast: "more"});
    await expect(scene(page)).toBeHidden();
    await expect.poll(corner).toBe("none");
    await page.emulateMedia({contrast: "no-preference"});
    await expect(scene(page)).toBeVisible();
    await page.emulateMedia({forcedColors: "active"});
    await expect(scene(page)).toBeHidden();
    await page.emulateMedia({forcedColors: "none"});
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg-panel"))).toBe("#fbf6ea");
});

test("设置里的主题不存在：项目层退到用户层，再退到缺省，设置不改写", async ({page}) => {
    const projectSettings = join(projectDir, ".nbook/settings.json");
    await writeSettings({[THEME]: STUDY});
    await writeFile(projectSettings, JSON.stringify({[THEME]: "gone.theme"}));
    try {
        await openProject(page);
        await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "macos");
        await writeSettings({[THEME]: "also.gone"});
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
        await expect(page.locator("html")).not.toHaveAttribute("data-nb-skin-scene");
        expect(JSON.parse(await readFile(projectSettings, "utf8"))).toEqual({[THEME]: "gone.theme"});
        expect(JSON.parse(await readFile(settingsFile(), "utf8"))).toEqual({[THEME]: "also.gone"});
    } finally {
        await rm(projectSettings, {force: true});
    }
});

test("主题列表里有书房，在设置窗口选中就生效；Lab 不受影响", async ({page}) => {
    await writeSettings({});
    await openProject(page);
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-row=\"nbook.workbench/theme\"]").getByRole("combobox").click();
    await page.getByRole("option", {name: "书房"}).click();
    await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
    await expect.poll(async () => (JSON.parse(await readFile(settingsFile(), "utf8")) as Record<string, string>)[THEME]).toBe(STUDY);
});

test("不写代码的主题插件：装上重启后能选，图走插件文件端点；禁用重启退回且设置不变；启用重启恢复", async ({page}) => {
    const root = join(tmp, "third-party");
    const plugins = createPluginInventory({root: join(root, "plugins"), profile: NEUROBOOK_PROFILE, builtin: productPlugins, startup: NO_INSTALLED_PLUGINS, record: () => undefined});
    await mkdir(join(root, "user"), {recursive: true});
    await writeFile(join(root, "projects.json"), await readFile(join(stateRoot, "projects.json")));
    const installed = await plugins.install(join(PACKAGE_ROOT, "plugin-sdk/examples/plugins/theme-dusk"));
    if (!installed.ok) throw new Error(`安装失败：${JSON.stringify(installed)}`);
    const settings = {[THEME]: "example.theme-dusk.dusk", [APPEARANCE]: "light"};
    await writeFile(join(root, "settings.json"), JSON.stringify(settings));
    const withServer = async (check: (url: string) => Promise<void>): Promise<void> => {
        const running = await startProductServer(root);
        try {
            await check(new URL("/?project=book", running.url).href);
        } finally {
            await page.goto("about:blank");
            expect(await running.stop()).toBe(0);
        }
    };
    const open = async (url: string): Promise<void> => {
        await page.goto(url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    };
    await withServer(async (url) => {
        await open(url);
        await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
        await expect(scene(page)).toHaveCSS("background-image", /\/plugins\/example\.theme-dusk\/files\/.+dusk-day\.webp/u);
        const loaded = await scene(page).evaluate(async (element) => {
            const image = new Image();
            image.src = /url\("(.+)"\)/u.exec(getComputedStyle(element).backgroundImage)?.[1] ?? "";
            await image.decode();
            return image.naturalWidth;
        });
        expect(loaded).toBe(960);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-main"))).toBe("#a4552a");
        // 没写的配色取 base 的：没有未定义的。
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg-panel"))).not.toBe("");
    });
    expect((await plugins.setEnabled("example.theme-dusk", false)).ok).toBe(true);
    await withServer(async (url) => {
        await open(url);
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
        await expect(page.locator("html")).not.toHaveAttribute("data-nb-skin-scene");
        expect(JSON.parse(await readFile(join(root, "settings.json"), "utf8"))).toEqual(settings);
    });
    expect((await plugins.setEnabled("example.theme-dusk", true)).ok).toBe(true);
    await withServer(async (url) => {
        await open(url);
        await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
    });
});

test.describe("可读性", () => {
    for (const appearance of ["light", "dark"] as const) {
        test(`书房 ${appearance}：欢迎页、活动栏、侧栏、正文的文字不低于 4.5`, async ({page}) => {
            await writeFile(join(projectDir, "notes/contrast.md"), DOCUMENT);
            await writeSettings({[THEME]: STUDY, [APPEARANCE]: appearance});
            await openProject(page);
            await page.addStyleTag({content: HIDE_TEXT});
            await page.mouse.move(1100, 900);
            await expect(scene(page)).toBeVisible();
            const report: string[] = [];
            const check = async (selector: string, min = 4.5): Promise<void> => {
                const {worst} = await measure(page, selector);
                report.push(`${appearance} ${selector}: ${worst.toFixed(2)}`);
                expect(worst, selector).toBeGreaterThanOrEqual(min);
            };
            for (const selector of ["[data-welcome-title]", "[data-welcome-stats]", ".welcome-page__description", "[data-welcome-shelf]", "[data-activity-item=\"nbook.settings\"]", "[data-explorer-row=\"project://notes\"] [data-explorer-label]", "[data-status-project]", "[data-titlebar-menu-entry]"]) await check(selector);
            await openFile(page, "contrast.md");
            await expect(prose(page)).toBeVisible();
            for (const selector of ["[data-editor-prose] p", "[data-editor-prose] blockquote p", "[data-editor-prose] a", "[data-editor-prose] mark", "[data-editor-breadcrumbs] .editor-crumbs__label"]) await check(selector);
            console.log(report.join("\n"));
        });
    }
});
