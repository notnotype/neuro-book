/**
 * 主题编辑器（docs/specs/theme/editor.md）：本机 Chrome、真实服务与真实 Storage。判据是文档根上的变量（真实工作台在变）、记录里存下的
 * 声明、真实插件安装对导出的包的接受，以及页面里的布局测量。
 */

import {createHash, randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
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
import {STUDY_ICON_NAMES} from "nbook/plugins/theme-study/plugin";

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
        await expect(page.locator("[data-contrast-group=light] [data-contrast-failure]")).toHaveCount(0);
        await expect(page.locator("[data-contrast-group=light] [data-contrast-sample]").first()).toBeVisible();
        await page.locator("[data-section-tab=colors]").click();

        await colorInput(page, "--text-muted").fill("#dfe8d8");
        await expect(page.locator("[data-color-field=\"--text-muted\"] [data-color-check]")).toHaveAttribute("data-tone", "bad");
        await expect(page.locator("[data-contrast-count]")).toBeVisible();
        await page.locator("[data-section-tab=contrast]").click();
        const muted = page.locator("[data-contrast-group=light] [data-contrast-failure][data-contrast-row=\"--text-muted\"]");
        await expect(muted).toBeVisible();
        // 样张用的就是被编辑的那两个颜色：浏览器算出的文字色与底色和输入里的值一致。
        expect(await muted.locator("[data-contrast-sample]").evaluate((node) => `${getComputedStyle(node).color}|${getComputedStyle(node).backgroundColor}`)).toMatch(/^rgb\(223, 232, 216\)\|rgb\(/u);
        // “去修改”：回到配色分区、光标落在那个变量的色值上。
        await muted.locator("[data-contrast-locate]").click();
        await expect(colorInput(page, "--text-muted")).toBeFocused();

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

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>';
const sceneVar = (page: Page): Promise<string> => rootVar(page, "--skin-scene");

/** 点“添加”（它按输入框里的名字打开文件选择），在文件选择里给一个 SVG。 */
async function chooseIcon(page: Page, name: string, svg: string): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page.locator("[data-icon-choose]").click();
    await (await chooser).setFiles({name, mimeType: "image/svg+xml", buffer: Buffer.from(svg)});
}

test("图标：上传 SVG 后工作台里该图标换成它，不合格的被路由拒绝并给原因，亮暗各一份，移除后恢复", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=icons]").click();
        await expect(page.locator("[data-icons-none]")).toBeVisible();
        const sheet = page.locator("style[data-nb-skin-icons]");
        await expect(sheet).toHaveCount(0);

        // 名字不合规则：行内给原因，列表仍是空的（没有写声明）。
        await page.locator("[data-icon-name]").fill("Bad Name");
        await expect(page.locator("[data-icon-name-problem]")).toBeVisible();
        await expect(page.locator("[data-icons-none]")).toBeVisible();

        // 换的是编辑器自己用的 image-plus：添加按钮上的图标随即变成上传的那一个。
        const hash = createHash("sha256").update(ICON_SVG).digest("hex");
        await page.locator("[data-icon-name]").fill("image-plus");
        await expect(page.locator("[data-icon-name-problem]")).toHaveCount(0);
        const iconOf = () => page.locator("[data-theme-editor] .i-lucide-image-plus").first().evaluate((element) => getComputedStyle(element).getPropertyValue("--svg"));
        // 对照：上传之前用的是内置图标，不含上传内容的摘要。
        expect(await iconOf()).not.toContain(`${hash}.svg`);
        await chooseIcon(page, "mine.svg", ICON_SVG);
        await expect(page.locator('[data-icon-row="image-plus"]')).toBeVisible();
        await expect(sheet).toHaveCount(1);
        expect(await sheet.textContent()).toContain(`${hash}.svg`);
        await expect.poll(iconOf).toContain(`${hash}.svg`);

        // 路由的白名单检查：带脚本的 SVG 被拒，声明不变，原因里有说明。
        await page.locator("[data-icon-name]").fill("search");
        await chooseIcon(page, "bad.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>');
        await expect(page.locator("[data-icon-error]")).toContainText("script");
        await expect(page.locator('[data-icon-row="search"]')).toHaveCount(0);

        // 亮暗各一份：暗色里没有；复制到另一套之后有。
        await page.locator("[data-appearance]").getByText("暗色").click();
        await expect(page.locator("[data-icons-none]")).toBeVisible();
        await page.locator("[data-appearance]").getByText("亮色").click();
        await page.locator("[data-icons-copy]").click();
        await page.locator("[data-appearance]").getByText("暗色").click();
        await expect(page.locator('[data-icon-row="image-plus"]')).toBeVisible();

        // 移除：这一套（暗色）没有了。
        await page.locator('[data-icon-row="image-plus"] [data-icon-remove]').click();
        await expect(page.locator("[data-icons-none]")).toBeVisible();
        // 暗色这套移除了，工作台现在画的就是暗色：样式表也随之去掉；亮色那套还在，切回去它又回来。
        await expect(sheet).toHaveCount(0);
        await page.locator("[data-appearance]").getByText("亮色").click();
        await expect(sheet).toHaveCount(1);
        await page.locator('[data-icon-row="image-plus"] [data-icon-remove]').click();
        await expect(sheet).toHaveCount(0);
    });
});

test("工作态场景与预览状态：上传后预览选“工作中”场景换成它，“空闲”换回，“跟随”回到真实状态；关掉编辑器后回到真实状态", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=scene]").click();
        await page.locator("[data-scene-file]").setInputFiles(SCENE_IMAGE);
        await expect(page.locator("[data-scene-note]")).toContainText("KB");
        await expect.poll(() => sceneVar(page)).not.toBe("");
        const idle = await sceneVar(page);

        // 工作态场景用另一张图（夜色那张）：上传后工作台还是空闲，场景不变。
        await expect(page.locator("[data-working-none]")).toBeVisible();
        await page.locator("[data-working-file]").setInputFiles(join(PACKAGE_ROOT, "src/plugins/theme-study/assets/study-night.webp"));
        await expect(page.locator("[data-working-note]")).toContainText("KB");
        await expect(page.locator("[data-working-thumb]")).toBeVisible();
        await expect.poll(() => sceneVar(page)).toBe(idle);

        const preview = page.locator("[data-preview-state]");
        await preview.getByRole("radio", {name: "工作中"}).click();
        await expect.poll(() => sceneVar(page)).not.toBe(idle);
        const working = await sceneVar(page);
        expect(working).toContain("theme-assets");
        await preview.getByRole("radio", {name: "空闲"}).click();
        await expect.poll(() => sceneVar(page)).toBe(idle);
        await preview.getByRole("radio", {name: "工作中"}).click();
        await expect.poll(() => sceneVar(page)).toBe(working);
        await preview.getByRole("radio", {name: "跟随"}).click();
        await expect.poll(() => sceneVar(page)).toBe(idle);

        // 强制“工作中”之后关掉编辑器：回到真实状态（空闲），不残留。
        await preview.getByRole("radio", {name: "工作中"}).click();
        await expect.poll(() => sceneVar(page)).toBe(working);
        await page.locator("[data-editor-tab-close]").last().click({force: true});
        await expect(editor(page)).toBeHidden();
        // 设置里选的还是 nbook（没有场景图）：预览清掉之后文档根回到它，工作态与空闲的场景都不残留。
        await expect.poll(() => sceneVar(page)).toBe("");
    });
});

test("复制书房：它的场景图与全部图标都传成我的素材（真实路由的检查都过），行预览与取景编辑画的都是素材目录里的文件", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await page.locator("[data-empty] [role=combobox]").click();
        await page.getByRole("option", {name: "书房"}).click();
        await expect(page.locator("[data-section-tab]").first()).toBeVisible();
        await page.locator("[data-section-tab=icons]").click();
        // 书房有哪些图标以它的声明为准（STUDY_ICON_NAMES）：一个不多一个不少。
        await expect(page.locator("[data-icon-row]")).toHaveCount(STUDY_ICON_NAMES.length);
        const names = await page.locator("[data-icon-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-icon-row")));
        expect([...names].sort()).toEqual([...STUDY_ICON_NAMES].sort());

        // 传成我的素材：每个图标行预览的地址都是素材目录里 `<sha256>.svg` 的读取地址，取得到 SVG；素材目录里的文件都是摘要命名。
        const assetPath = /^\/api\/nbook\.files\/raw\/user\/theme-assets\/[0-9a-f]{64}\.svg$/u;
        const urls = await page.locator("[data-icon-row] [aria-hidden=true]").evaluateAll((previews) => previews.map((element) => /url\("(.+)"\)/u.exec((element as HTMLElement).style.getPropertyValue("--icon-url"))?.[1] ?? ""));
        expect(urls).toHaveLength(STUDY_ICON_NAMES.length);
        for (const url of urls) {
            expect(url).toMatch(assetPath);
            const response = await page.request.get(new URL(url, session.url).href);
            expect(response.status()).toBe(200);
            expect(response.headers()["content-type"]).toContain("image/svg+xml");
        }
        const files = await readdir(join(session.stateRoot, "user", "theme-assets"));
        expect(files.every((name) => /^[0-9a-f]{64}\.(?:svg|webp|png|jpg)$/u.test(name))).toBe(true);
        for (const url of urls) expect(files).toContain(url.split("/").pop());

        // 场景图一并复制：取景编辑里画的就是我的素材。
        await page.locator("[data-section-tab=scene]").click();
        await expect(page.locator("[data-crop-editor] img")).toHaveAttribute("src", /\/api\/nbook\.files\/raw\/user\/theme-assets\/[0-9a-f]{64}\.(?:webp|png|jpg)$/u);
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
        // 窄屏下分区里要有内容才量得到：先放一张场景图、一张工作态场景和一个名字很长的图标。
        await page.locator("[data-section-tab=scene]").click();
        await page.locator("[data-scene-file]").setInputFiles(SCENE_IMAGE);
        await expect(page.locator("[data-scene-note]")).toContainText("KB");
        await page.locator("[data-working-file]").setInputFiles(join(PACKAGE_ROOT, "src/plugins/theme-study/assets/study-night.webp"));
        await expect(page.locator("[data-working-thumb]")).toBeVisible();
        await page.locator("[data-section-tab=icons]").click();
        await page.locator("[data-icon-name]").fill("a-very-long-icon-name-that-keeps-going-and-going-and-going");
        await chooseIcon(page, "long.svg", ICON_SVG);
        await expect(page.locator("[data-icon-row]")).toHaveCount(1);
        await page.setViewportSize({width: 390, height: 844});
        // 当前分区（图标，最靠右的两个之一）在竖排变横排后要在导航条的可视范围里。不点击就量：Playwright 的 click 会自己把目标滚进视口，
        // 那样量到的不是编辑器自己的行为（theme.editor 的响应式条目）。
        await expect.poll(() => page.locator("[data-section-tab=icons]").evaluate((tab) => {
            const bar = tab.closest("nav")?.getBoundingClientRect();
            const box = tab.getBoundingClientRect();
            return bar !== undefined && box.left >= bar.left - 1 && box.right <= bar.right + 1;
        }), {message: "窄屏下当前分区的导航项要在导航条的可视范围里"}).toBe(true);
        // 每个分区都量一次：分区里是 ScrollArea，横向溢出不会让编辑器根的 scrollWidth 变大，所以量分区内容自己和每个配色行。
        for (const section of ["basic", "colors", "fonts", "chrome", "scene", "icons", "contrast"]) {
            await page.locator(`[data-section-tab=${section}]`).click();
            const content = page.locator(`[data-section=${section}]`);
            await expect(content).toBeVisible();
            await expect.poll(() => content.evaluate((element) => element.scrollWidth - element.clientWidth), {message: `${section} 分区横向溢出`}).toBeLessThanOrEqual(0);
        }
        await page.locator("[data-section-tab=colors]").click();
        const overflowing = await page.locator("[data-color-field]").evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).map((row) => (row as HTMLElement).dataset.colorField));
        expect(overflowing).toEqual([]);
        // 窄屏下色值输入放得下完整的色值（#rrggbb 要 70px 以上）。
        expect((await colorInput(page, "--bg-panel").boundingBox())?.width ?? 0).toBeGreaterThan(90);
    });
});

test("复制插件主题（库里已有主题时也能）；删除正在使用的主题：设置不改写，退回缺省；快速双击不会直接删除", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);

        // 库里已有一套：顶栏的“复制自…”照样能从插件主题（macOS）起步。
        await page.locator("[data-copy-from]").getByRole("combobox").click();
        await page.getByRole("option", {name: "macOS"}).click();
        await expect(page.locator("[data-theme-editor] [data-section=basic] input").first()).toHaveValue("macOS 副本");
        await page.locator("[data-section-tab=basic]").click();
        await expect(page.locator("[data-base]").getByRole("radio", {name: "macOS"})).toBeChecked();

        // 选它为当前主题，再删掉：设置里的值不改写。
        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-row=\"nbook.workbench/theme\"]").getByRole("combobox").click();
        await page.getByRole("option", {name: "macOS 副本 · 我的"}).click();
        await expect.poll(async () => (JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8")) as Record<string, string>)[THEME]).toMatch(/^user:/u);
        const chosen = (JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8")) as Record<string, string>)[THEME];
        await page.keyboard.press("Escape");

        // 快速双击“删除”不删：第二下来不及读到“确认删除”。
        await page.locator("[data-delete]").dblclick();
        await expect(page.locator("[data-delete]")).toContainText("确认删除");
        const before = await page.locator("[data-theme-editor] [data-section-tab]").count();
        expect(before).toBeGreaterThan(0);
        // 过了防误触的间隔再点第二下才真的删：点到删掉为止（间隔内的点不算，是行为的一部分，不按固定时长等）。
        await expect(async () => {
            await page.locator("[data-delete]").click({timeout: 1000});
            await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook", {timeout: 500});
        }).toPass();
        await expect.poll(async () => (JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8")) as Record<string, string>)[THEME]).toBe(chosen);
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
    });
});

test("编辑面板始终实心：把正在编辑的 --bg-panel 改成半透明，面板的背景仍不透；取值引外部资源被拒绝并给出原因", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-section-tab=colors]").click();

        await colorInput(page, "--bg-panel").fill("rgba(0, 0, 0, 0.3)");
        await expect.poll(() => rootVar(page, "--bg-panel")).toBe("rgba(0, 0, 0, 0.3)");
        // 面板的底是“--bg-panel 叠在不透明的 Canvas 上”：最底下一层不透明。
        const layers = await editor(page).evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(layers, `编辑面板的底色（Canvas 层）不能透明：${layers}`).not.toMatch(/rgba\(.*,\s*0\)$/u);

        await colorInput(page, "--bg-main").fill("url(https://example.com/x.png)");
        await expect(page.locator("[data-rejected]")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
        expect(await rootVar(page, "--bg-main")).not.toContain("url(");
    });
});

test("切到别的页签再回来：编辑的还是同一套、同一个明暗、同一个分区", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-appearance]").getByText("暗色").click();
        await page.locator("[data-section-tab=colors]").click();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");

        // 切到欢迎页再切回来。
        await page.locator("[data-editor-tab]").first().click();
        await expect(editor(page)).toBeHidden();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");
        await page.locator("[data-editor-tab]").last().click();
        await expect(editor(page)).toBeVisible();
        await expect(page.locator("[data-section-tab=colors]")).toHaveAttribute("aria-current", "page");
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    });
});

test("切主题或明暗时整页渐变；编辑器里改色、系统偏好减弱动效时不渐变", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        // 本套 e2e 默认开着减弱动效（见 playwright.config.ts），这里要看动画，开回来。
        await page.emulateMedia({reducedMotion: "no-preference"});
        await open(page, session);
        await openEditorTab(page);

        // 逐帧看有没有浏览器的整页渐变（`::view-transition-*` 的动画）在跑，记在 window 上。
        await page.evaluate(() => {
            const seen = window as unknown as {__viewTransition: boolean; __viewTransitionRunning: () => boolean};
            seen.__viewTransitionRunning = () => document.getAnimations().some((animation) => String((animation.effect as KeyframeEffect | null)?.pseudoElement).startsWith("::view-transition"));
            seen.__viewTransition = false;
            const tick = (): void => {
                if (seen.__viewTransitionRunning()) seen.__viewTransition = true;
                requestAnimationFrame(tick);
            };
            tick();
        });
        const transitioned = (): Promise<boolean> => page.evaluate(() => (window as unknown as {__viewTransition: boolean}).__viewTransition);

        // 新建主题时预览从 nbook 换成这套新主题：主题 id 变了，渐变。等它放完再记后面的。
        await newTheme(page);
        await expect.poll(transitioned).toBe(true);
        await page.waitForFunction(() => !(window as unknown as {__viewTransitionRunning: () => boolean}).__viewTransitionRunning());
        await page.evaluate(() => {
            (window as unknown as {__viewTransition: boolean}).__viewTransition = false;
        });

        await page.locator("[data-section-tab=colors]").click();
        await colorInput(page, "--accent-main").fill("#2f6f4f");
        await expect.poll(() => rootVar(page, "--accent-main")).toBe("#2f6f4f");
        await colorInput(page, "--accent-main").fill("#1f5f3f");
        await expect.poll(() => rootVar(page, "--accent-main")).toBe("#1f5f3f");
        expect(await transitioned()).toBe(false);

        await page.locator("[data-appearance]").getByText("暗色").click();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
        await expect.poll(transitioned).toBe(true);
        await page.waitForFunction(() => !(window as unknown as {__viewTransitionRunning: () => boolean}).__viewTransitionRunning());

        // 偏好减弱动效：换明暗直接写，不渐变。
        await page.emulateMedia({reducedMotion: "reduce"});
        await page.evaluate(() => {
            (window as unknown as {__viewTransition: boolean}).__viewTransition = false;
        });
        await page.locator("[data-appearance]").getByText("亮色").click();
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");
        expect(await transitioned()).toBe(false);
    });
});

test("设置窗口里有“主题”页：我的主题列在页上，两个按钮分别在页签与浮动窗口里打开编辑器，打开后编辑器不被设置窗口挡住", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await page.locator("[data-editor-tab-close]").last().click({force: true});
        await expect(editor(page)).toBeHidden();

        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-nav='nbook.workbench.themes']").click();
        // 两个按钮经 SettingsPageActions 放进窗口标题区，不在页面根里面。
        const entry = page.locator("[data-theme-settings-page]");
        await expect(entry.locator("[data-my-theme]")).toHaveCount(1);
        await expect(entry.locator("[data-current-theme]")).toContainText("NeuroBook");

        await page.locator("[data-open-tab]").click();
        await expect(editor(page)).toBeVisible();
        // 点得到才说明没被设置窗口盖住：Playwright 的点击会先核对命中的就是这个元素。
        await page.locator("[data-section-tab=colors]").click({timeout: 3000});
        await page.locator("[data-editor-tab-close]").last().click({force: true});
        await expect(editor(page)).toBeHidden();

        await page.locator("[data-open-floating]").click();
        await expect(editor(page)).toBeVisible();
        await page.locator("[data-section-tab=colors]").click({timeout: 3000});
    });
});

test("删掉最后一套我的主题：回到空状态，渐变被新的渐变跳过时页面没有未处理的错误", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        // 动效开着才走渐变路径（e2e 默认减弱动效，见 playwright.config.ts）。
        await page.emulateMedia({reducedMotion: "no-preference"});
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);

        // 设置里正在用着它，再删。
        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-row=\"nbook.workbench/theme\"]").getByRole("combobox").click();
        await page.getByRole("option", {name: "新主题 · 我的"}).click();
        await expect.poll(async () => (JSON.parse(await readFile(join(session.stateRoot, "settings.json"), "utf8")) as Record<string, string>)[THEME]).toMatch(/^user:/u);
        await page.keyboard.press("Escape");

        await expect(async () => {
            await page.locator("[data-delete]").click({timeout: 1000});
            await expect(page.locator("[data-empty]")).toBeVisible({timeout: 500});
        }).toPass();
        await expect(page.locator("html")).toHaveAttribute("data-nb-theme", "nbook");
        expect(errors).toEqual([]);
    });
});

test("渐变还没开始又切一次（明暗连点）：前一次被跳过，页面没有未处理的错误，最后停在最后一次选的", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await page.emulateMedia({reducedMotion: "no-preference"});
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
        await open(page, session);
        await openEditorTab(page);
        await newTheme(page);
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "light");

        // 同一个任务里连点会被 Vue 合成一次更新；每次点完让出一轮，下一次点时前一次的渐变还没到下一帧，只能被跳过。
        await page.evaluate(async () => {
            const buttons = [...document.querySelectorAll<HTMLElement>("[data-appearance] [role=radio]")];
            for (const index of [1, 0, 1]) {
                buttons[index]?.click();
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        });
        await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
        await page.waitForFunction(() => !document.getAnimations().some((animation) => String((animation.effect as KeyframeEffect | null)?.pseudoElement).startsWith("::view-transition")));
        expect(errors).toEqual([]);
    });
});

test("浮动的主题编辑器与设置窗口按最近聚焦叠放：后打开的在上，点哪个哪个提到最上", async ({page}) => {
    await withSession({[THEME]: "nbook", [APPEARANCE]: "light"}, async (session) => {
        await open(page, session);
        await expect(async () => {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
        }).toPass();
        await page.locator("[data-settings-nav='nbook.workbench.themes']").click();
        await page.locator("[data-open-floating]").click();
        await expect(editor(page)).toBeVisible();

        const settingsWindow = page.locator("[role=dialog]").filter({has: page.locator("[data-theme-settings-page]")});
        const editorWindow = page.locator("[role=dialog]").filter({has: page.locator("[data-theme-editor]")});
        /** 两个窗口重叠区的中心点上，最上面的是哪个窗口。 */
        const topWindow = async (): Promise<"设置" | "编辑器" | "别的"> => {
            const [a, b] = await Promise.all([settingsWindow.boundingBox(), editorWindow.boundingBox()]);
            if (a === null || b === null) throw new Error("两个窗口都要开着");
            const x = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
            const y = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
            return page.evaluate(([px, py]) => {
                const hit = document.elementFromPoint(px as number, py as number)?.closest("[role=dialog]");
                if (hit?.querySelector("[data-theme-editor]") != null) return "编辑器";
                if (hit?.querySelector("[data-theme-settings-page]") != null) return "设置";
                return "别的";
            }, [x, y]);
        };

        // 后打开的编辑器在设置之上；点一下设置（标题区的空白处）它就提到最上；再点编辑器又回去。
        expect(await topWindow()).toBe("编辑器");
        await settingsWindow.dispatchEvent("pointerdown");
        await expect.poll(topWindow).toBe("设置");
        await editorWindow.dispatchEvent("pointerdown");
        await expect.poll(topWindow).toBe("编辑器");
    });
});
