/**
 * 背景图片与护眼底色（docs/specs/ui/backgrounds.md）：本机 Chrome、真实文件服务。对比度是量出来的：把文字藏起来截图，拿每个像素和文字原来的颜色算，
 * 不靠算遮罩的那份代码；所以先有正向对照（图确实画出来了），否则比无图还容易过。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {deflateSync} from "node:zlib";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

test.use({viewport: {width: 1280, height: 900}});

let tmp = "";
let stateRoot = "";
let projectDir = "";
let server: ProductServer;

/** 不靠图片库：按 PNG 格式拼出一张 RGB 图。 */
function png(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Buffer {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 3 + 1);
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = pixel(x, y);
            raw[row + 1 + x * 3] = r;
            raw[row + 2 + x * 3] = g;
            raw[row + 3 + x * 3] = b;
        }
    }
    const table = Array.from({length: 256}, (_, index) => {
        let c = index;
        for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (data: Buffer): number => {
        let c = 0xffffffff;
        for (const byte of data) c = (table[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
        const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const WHITE = (): readonly [number, number, number] => [255, 255, 255];
const BLACK = (): readonly [number, number, number] => [0, 0, 0];
/** 高细节：160 像素一格，白、黑、噪点轮流，正文下面总有最亮和最暗的地方。 */
function detail(x: number, y: number): readonly [number, number, number] {
    const cell = (Math.floor(x / 160) + Math.floor(y / 160)) % 3;
    if (cell === 0) return [255, 255, 255];
    if (cell === 1) return [0, 0, 0];
    const noise = Math.floor(x / 2) * 7 + Math.floor(y / 2) * 13;
    return noise % 2 === 0 ? [255, 255, 255] : [0, 0, 0];
}

const IMAGES = {white: png(64, 64, WHITE), black: png(64, 64, BLACK), detail: png(1280, 960, detail)};

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "backgrounds");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "notes"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(tmp, "white.png"), IMAGES.white);
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");
const prose = (page: Page) => activeGroup(page).locator("[data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
const settingsFile = (): string => join(stateRoot, "settings.json");

async function writeSettings(values: Readonly<Record<string, unknown>>): Promise<void> {
    await writeFile(settingsFile(), JSON.stringify(values));
}

async function openFile(page: Page, name: string, content: string): Promise<void> {
    await writeFile(join(projectDir, "notes", name), content);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(async () => {
        const folder = item(page, "project://notes");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        await item(page, `project://notes/${name}`).dblclick({timeout: 3000});
        await expect(activeGroup(page).locator("[data-editor-tab]").filter({hasText: name})).toBeVisible({timeout: 3000});
    }).toPass();
    await expect(prose(page)).toBeVisible();
}

/** 真实的上传路径：页面里同源 `fetch`。 */
async function upload(page: Page, bytes: Buffer): Promise<string> {
    const address = await page.evaluate(async (base64) => {
        const body = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const response = await fetch("/api/nbook.files/backgrounds", {method: "PUT", body});
        return ((await response.json()) as {address: string}).address;
    }, bytes.toString("base64"));
    return address;
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

const DOCUMENT = "第一段正文，长一些的句子才看得出背景抢不抢字。\n\n> 引用是次要文字\n\n[一个链接](https://example.com)\n\n<mark>高亮的正文</mark>\n";
const EDITOR_TARGETS = ["[data-editor-prose] p", "[data-editor-prose] blockquote p", "[data-editor-prose] a", "[data-editor-prose] mark"];
/** 窗口背景还要量：面包屑、标签条、标题栏、状态栏、活动栏与侧栏。 */
const WINDOW_TARGETS = [...EDITOR_TARGETS, "[data-editor-breadcrumbs] .editor-crumbs__label", "[data-editor-group-active] [data-editor-tab]", "[data-status-project]", "[data-titlebar-menu-entry]", "[data-activity-items] [data-activity-item]", "[data-explorer-row=\"project://notes\"] [data-explorer-label]"];

test.describe("可读性", () => {
    test.setTimeout(600_000);
    for (const theme of ["nbook", "macos"] as const) {
        for (const appearance of ["light", "dark"] as const) {
            test(`${theme} ${appearance}：遮罩取下限时每个地方都读得清`, async ({page}) => {
                await writeSettings({"nbook.workbench/theme": theme, "nbook.workbench/appearance": appearance});
                await openFile(page, `contrast-${theme}-${appearance}.md`, DOCUMENT);
                await page.addStyleTag({content: HIDE_TEXT});
                await page.mouse.move(640, 500);
                await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", appearance);
                const baseline = new Map<string, Measured>();
                for (const selector of WINDOW_TARGETS) baseline.set(selector, await measure(page, selector));

                const addresses = {white: await upload(page, IMAGES.white), black: await upload(page, IMAGES.black), detail: await upload(page, IMAGES.detail)};
                const cases = [
                    {name: "white", blur: true},
                    {name: "black", blur: true},
                    {name: "detail", blur: true},
                    {name: "white", blur: false},
                    {name: "black", blur: false},
                    {name: "detail", blur: false},
                ] as const;
                const report: string[] = [];
                for (const kind of ["editor", "window"] as const) {
                    for (const {name, blur} of cases) {
                        // scrim 给最小值：显示时被抬到下限，量的就是下限。
                        const image = {kind: "image", image: addresses[name], fit: "cover", blur, scrim: 75};
                        await writeSettings({"nbook.workbench/theme": theme, "nbook.workbench/appearance": appearance, [`nbook.workbench/background.${kind}`]: image});
                        const layer = kind === "editor" ? activeGroup(page).locator("[data-background-image]") : page.locator(".workbench-shell-host > [data-background-layer] [data-background-image]");
                        await expect(layer).toHaveCount(1);
                        await expect(layer).toHaveCSS("background-image", new RegExp(addresses[name].split("/").at(-1) as string));
                        await expect(layer).toHaveClass(blur ? /is-blurred/ : /^(?!.*is-blurred)/);
                        await nextFrame(page);
                        let changed = false;
                        for (const selector of kind === "editor" ? EDITOR_TARGETS : WINDOW_TARGETS) {
                            const before = baseline.get(selector) as Measured;
                            const after = await measure(page, selector);
                            const where = `${kind} ${name} blur=${String(blur)} ${selector}`;
                            report.push(`${where}: ${after.worst.toFixed(2)}（无图 ${before.worst.toFixed(2)}）`);
                            expect(after.worst, where).toBeGreaterThanOrEqual(Math.min(4.5, before.worst));
                            changed ||= Math.abs(after.mean - before.mean) > 0.5 || after.distinct > before.distinct;
                        }
                        // 正向对照：亮色上的黑图、暗色上的白图、高细节一定改变了像素。单看一处不够：一小块字可能正好落在和面色相同的格子上。
                        if (name === "detail" || (name === "black") === (appearance === "light")) expect(changed, `${kind} ${name} blur=${String(blur)} 图没画出来`).toBe(true);
                    }
                }
                await test.info().attach("contrast.txt", {body: report.join("\n")});
                console.log(`[${theme} ${appearance}]\n${report.join("\n")}`);
            });
        }
    }
});

test("系统要求少透明、高对比或强制颜色时不画图片，设置不改写", async ({page}) => {
    await openFile(page, "prefers.md", DOCUMENT);
    const address = await upload(page, IMAGES.detail);
    const settings = {"nbook.workbench/background.editor": {kind: "image", image: address, fit: "cover", blur: true, scrim: 85}};
    await writeSettings(settings);
    const image = activeGroup(page).locator("[data-background-image]");
    await expect(image).toHaveCount(1);
    // Playwright 的 emulateMedia 还不收减少透明，经调试协议设（配置只跑 Chromium）。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-transparency", value: "reduce"}]});
    await expect(image).toHaveCount(0);
    await cdp.send("Emulation.setEmulatedMedia", {features: []});
    await expect(image).toHaveCount(1);
    await page.emulateMedia({contrast: "more"});
    await expect(image).toHaveCount(0);
    await page.emulateMedia({contrast: "no-preference"});
    await expect(image).toHaveCount(1);
    await page.emulateMedia({forcedColors: "active"});
    await expect(image).toHaveCount(0);
    await page.emulateMedia({forcedColors: "none"});
    expect(JSON.parse(await readFile(settingsFile(), "utf8"))).toEqual(settings);
});

test("在设置页传图选中，重启页面还在；文件不见退回没有背景并说明，放回后恢复", async ({page}) => {
    await writeSettings({});
    await openFile(page, "settings-page.md", DOCUMENT);
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-nav='nbook.workbench.background']").click();
    const block = page.locator("[data-background-kind=\"editor\"]");
    await block.getByRole("radio", {name: "图片"}).click();
    await block.locator("[data-background-file]").setInputFiles(join(tmp, "white.png"));
    const saved = async (): Promise<Record<string, {image?: string; scrim?: number; kind?: string}>> => JSON.parse(await readFile(settingsFile(), "utf8")) as Record<string, {image?: string}>;
    await expect.poll(async () => (await saved())["nbook.workbench/background.editor"]?.kind).toBe("image");
    const address = (await saved())["nbook.workbench/background.editor"]?.image as string;
    expect(address).toMatch(/^user:\/\/backgrounds\/[0-9a-f]{64}\.png$/);
    await expect(block.locator("[data-background-preview] [data-background-image]")).toHaveCount(1);
    await expect(block.locator(`[data-background-image-option="${address}"]`)).toHaveAttribute("aria-pressed", "true");

    // 遮罩：拖动时预览跟着变、设置不写，松手才写。
    const thumb = block.locator("[data-background-scrim-slider] [role=slider]");
    const previewScrim = block.locator("[data-background-preview] [data-background-scrim]");
    const opacityBefore = await previewScrim.evaluate((element) => getComputedStyle(element).opacity);
    const scrimBefore = (await saved())["nbook.workbench/background.editor"]?.scrim;
    const box = await thumb.boundingBox();
    if (box === null) throw new Error("滑块不可见");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, {steps: 4});
    await expect.poll(() => previewScrim.evaluate((element) => getComputedStyle(element).opacity)).not.toBe(opacityBefore);
    expect((await saved())["nbook.workbench/background.editor"]?.scrim).toBe(scrimBefore);
    await page.mouse.up();
    await expect.poll(async () => (await saved())["nbook.workbench/background.editor"]?.scrim).not.toBe(scrimBefore);

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(activeGroup(page).locator("[data-background-image]")).toHaveCount(1);

    const file = join(stateRoot, "user", address.slice("user://".length));
    await rename(file, `${file}.gone`);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(prose(page)).toBeVisible();
    expect((await saved())["nbook.workbench/background.editor"]?.image).toBe(address);
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-nav='nbook.workbench.background']").click();
    await expect(page.locator("[data-background-kind=\"editor\"] [data-background-status]")).toContainText("读不出来");
    // 加载失败已经发生（上一行）：这时还没有图才算退回没有背景，否则只是图还没加载好。
    await expect(activeGroup(page).locator("[data-background-image]")).toHaveCount(0);

    await rename(`${file}.gone`, file);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(activeGroup(page).locator("[data-background-image]")).toHaveCount(1);
});

test("纯色底：预设写进设置；取色不合格时不写、说明原因；显示按当前明暗取色、不合格的不应用", async ({page}) => {
    await writeSettings({"nbook.workbench/appearance": "light", "nbook.workbench/background.editor": {kind: "color", light: "#d9f0dc", dark: "#1f2a24"}});
    await openFile(page, "color.md", DOCUMENT);
    const scrim = activeGroup(page).locator("[data-background-scrim]");
    await expect(scrim).toHaveCSS("background-color", "rgb(217, 240, 220)");
    await writeSettings({"nbook.workbench/appearance": "dark", "nbook.workbench/background.editor": {kind: "color", light: "#d9f0dc", dark: "#1f2a24"}});
    await expect(scrim).toHaveCSS("background-color", "rgb(31, 42, 36)");
    // 暗色主题的浅字在浅色底上读不清：不应用。
    await writeSettings({"nbook.workbench/appearance": "dark", "nbook.workbench/background.editor": {kind: "color", light: "#d9f0dc", dark: "#ffffff"}});
    await expect(scrim).toHaveCount(0);

    await writeSettings({"nbook.workbench/appearance": "light", "nbook.workbench/background.editor": {kind: "color", light: "#d9f0dc", dark: "#1f2a24"}});
    await expect(scrim).toHaveCSS("background-color", "rgb(217, 240, 220)");
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-nav='nbook.workbench.background']").click();
    const light = page.locator("[data-background-kind=\"editor\"] [data-background-swatches=\"light\"]");
    await light.locator("[data-color-swatch=\"#f4ecd8\"]").click();
    await expect.poll(async () => (JSON.parse(await readFile(settingsFile(), "utf8")) as Record<string, {light?: string}>)["nbook.workbench/background.editor"]?.light).toBe("#f4ecd8");
    await expect(scrim).toHaveCSS("background-color", "rgb(244, 236, 216)");
    // 亮色主题的深字在深色底上读不清。
    await light.locator("[data-color-swatch=\"custom\"]").click();
    const hex = page.locator("[data-color-panel-input]");
    await hex.fill("#111111");
    await hex.press("Enter");
    await expect(page.locator("[data-background-kind=\"editor\"] [data-background-status]")).toContainText("读不清");
    expect((JSON.parse(await readFile(settingsFile(), "utf8")) as Record<string, {light?: string}>)["nbook.workbench/background.editor"]?.light).toBe("#f4ecd8");
});

test("正文背景按组定位：滚动时图不动，拖分隔条时每组的图按新尺寸重排", async ({page}) => {
    await writeSettings({});
    await openFile(page, "scroll.md", "很长的一段。\n\n".repeat(200));
    const address = await upload(page, IMAGES.detail);
    await writeSettings({"nbook.workbench/background.editor": {kind: "image", image: address, fit: "cover", blur: true, scrim: 85}});
    const layer = activeGroup(page).locator("[data-background-layer]");
    await expect(layer).toHaveCount(1);
    const before = await layer.boundingBox();
    const first = prose(page).locator("p").first();
    const firstBefore = await first.boundingBox();
    await first.click();
    await page.mouse.wheel(0, 2000);
    // 正文真的滚了，否则图不动不说明问题。
    await expect.poll(async () => (await first.boundingBox())?.y).toBeLessThan(firstBefore?.y as number);
    expect(await layer.boundingBox()).toEqual(before);

    await page.keyboard.press("Control+\\");
    const groups = page.locator("[data-editor-group]");
    await expect(groups).toHaveCount(2);
    const layers = page.locator("[data-editor-group] [data-background-layer]");
    await expect(layers).toHaveCount(2);
    const widths = () => layers.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    const [left = 0, right = 0] = await widths();
    const sash = page.locator("[data-editor-area] [role=separator]");
    const box = await sash.boundingBox();
    if (box === null) throw new Error("分隔线没有盒");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, {steps: 6});
    await page.mouse.up();
    await expect.poll(widths).toEqual([left - 120, right + 120]);
});

test("窗口背景开着时切明暗、切主题，面色跟着换，不读到自己写的旧值", async ({page}) => {
    await writeSettings({"nbook.workbench/appearance": "light"});
    await openFile(page, "switching.md", DOCUMENT);
    await page.addStyleTag({content: HIDE_TEXT});
    const rootVar = (name: string) => page.evaluate((key) => document.documentElement.style.getPropertyValue(key), name);
    const address = await upload(page, IMAGES.detail);
    const image = {kind: "image", image: address, fit: "cover", blur: true, scrim: 75};
    await writeSettings({"nbook.workbench/appearance": "light", "nbook.workbench/background.window": image});
    await expect.poll(() => rootVar("--shell-card-surface")).not.toBe("");
    const lightCard = await rootVar("--shell-card-surface");
    const lightTabs = await rootVar("--editor-tabs-surface");

    await writeSettings({"nbook.workbench/appearance": "dark", "nbook.workbench/background.window": image});
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    await expect.poll(() => rootVar("--shell-card-surface")).not.toBe(lightCard);
    await expect.poll(() => rootVar("--editor-tabs-surface")).not.toBe(lightTabs);
    await nextFrame(page);
    expect((await measure(page, "[data-editor-prose] a")).worst).toBeGreaterThanOrEqual(4.5);
    // 再切回来等于第一次的值：如果读到了自己写的半透明值，这里会一轮轮叠下去。
    await writeSettings({"nbook.workbench/appearance": "light", "nbook.workbench/background.window": image});
    await expect.poll(() => rootVar("--shell-card-surface")).toBe(lightCard);
    await expect.poll(() => rootVar("--editor-tabs-surface")).toBe(lightTabs);

    await writeSettings({"nbook.workbench/theme": "macos", "nbook.workbench/appearance": "light", "nbook.workbench/background.window": image});
    await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "macos");
    await expect.poll(() => rootVar("--shell-card-surface")).not.toBe(lightCard);
    await nextFrame(page);
    expect((await measure(page, "[data-editor-prose] a")).worst).toBeGreaterThanOrEqual(4.5);

    await writeSettings({"nbook.workbench/appearance": "light"});
    await expect.poll(() => rootVar("--shell-card-surface")).toBe("");
    await expect(page.locator("html")).not.toHaveAttribute("data-nb-editor-transparent");
});

test("源码编辑器透出，图片查看器不透出；两种同时开时正文盖在窗口上面；窄窗口不溢出", async ({page}) => {
    await writeSettings({});
    await writeFile(join(projectDir, "notes", "picture.png"), IMAGES.white);
    await writeFile(join(projectDir, "notes", "data.json"), "{\n  \"a\": 1\n}\n");
    await openFile(page, "both.md", DOCUMENT);
    const address = await upload(page, IMAGES.detail);
    const image = {kind: "image", image: address, fit: "cover", blur: true, scrim: 85};
    await writeSettings({"nbook.workbench/background.editor": image, "nbook.workbench/background.window": image});
    const editorImage = activeGroup(page).locator("[data-background-image]");
    const windowImage = page.locator(".workbench-shell-host > [data-background-layer] [data-background-image]");
    await expect(editorImage).toHaveCount(1);
    await expect(windowImage).toHaveCount(1);
    // 正文盖在窗口上面：正文的那层在编辑组里，窗口的在外壳最底下，正文一块点上去命中的是编辑组里的元素。
    const hit = await activeGroup(page).evaluate((group) => {
        const box = group.getBoundingClientRect();
        return document.elementFromPoint(box.left + box.width / 2, box.bottom - 40)?.closest("[data-editor-group]") === group;
    });
    expect(hit).toBe(true);

    await item(page, "project://notes/data.json").dblclick();
    await expect(activeGroup(page).locator(".monaco-editor")).toBeVisible();
    await expect(editorImage).toHaveCount(1);
    await expect.poll(() => activeGroup(page).locator(".monaco-editor-background").first().evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(/rgba\(.*, 0\)|transparent/);

    await item(page, "project://notes/picture.png").dblclick();
    await expect(activeGroup(page).locator("[data-editor-tab]").filter({hasText: "picture.png"})).toBeVisible();
    await expect(editorImage).toHaveCount(0);

    await page.setViewportSize({width: 390, height: 844});
    await expect(windowImage).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-nav='nbook.workbench.background']").click();
    const block = page.locator("[data-background-kind=\"window\"]");
    await expect(block).toBeVisible();
    const box = await block.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});
