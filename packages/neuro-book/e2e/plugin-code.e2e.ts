/**
 * 第三方插件浏览器入口代码的装载在真实 Chrome 上的验收（docs/specs/runtime/plugin-code-loading.md 输出 2–5、8、9，验收 1、3、9）：
 *
 * - 示例插件 snippets 经构建预设构建、安装进状态根，重启后它的设置页可以打开、能写设置；入口代码在打开分区时才取回、只取一次，
 *   分区图标在激活前就显示（图标规则在插件自己的样式表里）；产品构建与开发会话各一次。
 * - 几个故意写坏的插件（手写的产物，不经构建预设）各自原位显示失败原因，其它插件照常；文件找回来后重试可以恢复。
 *
 * 插件经插件管理的安装接口装进状态根（与插件页同一条路径；插件页的安装流程由 `plugins.e2e.ts` 验收）。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {copyFile, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {productPlugins} from "nbook/manifest";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {PACKAGE_ROOT, startDevSession, startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const SNIPPETS_SECTION = "example.snippets.main";
let tmp = "";
let built = "";
/** clock、notes、counter 的构建产物（服务端与项目入口）。 */
let backend: string[] = [];
let focus = "";
/** scene-clock 的构建产物：主题加浏览器入口里的场景提供者。 */
let sceneClock = "";

/** 一个手写的、故意写坏的插件：浏览器入口贡献一个 page 分区，`body` 是登记工厂里的模块体。 */
interface Broken {
    readonly name: string;
    /** 整个脚本；缺省把 `body` 包进登记工厂。 */
    readonly script?: string;
    readonly body?: string;
    /** 期望设置窗口原位显示的失败原因里含有的码。 */
    readonly code: string;
}

const REGISTER = `globalThis[${JSON.stringify(NEUROBOOK_PROFILE.registryGlobal)}].register(document.currentScript.src, function (module, exports, require) {`;
const sectionOf = (name: string): string => `fixture.${name}.main`;
/** 能正常工作的页面：恢复的那个插件用它。 */
const workingBody = (name: string): string => `const vue = require("vue");
exports.activate = () => ({contributions: {"settings.pages": {${JSON.stringify(sectionOf(name))}: {load: async () => vue.defineComponent({setup: () => () => vue.h("p", {"data-fixture-page": ${JSON.stringify(name)}}, "已恢复")})}}}});`;

const BROKEN: ReadonlyArray<Broken> = [
    {name: "missing", body: workingBody("missing"), code: "code-load-failed"},
    {name: "syntax", script: `${REGISTER}\nexports.activate = (;\n});\n`, code: "code-threw"},
    {name: "throws", body: "throw new Error(\"故意在模块顶层抛出\");", code: "code-threw"},
    {name: "shape", body: "exports.other = 1;", code: "code-shape"},
    {name: "lodash", body: "require(\"lodash\");", code: "module-not-shared"},
];

async function brokenSource(item: Broken): Promise<string> {
    const directory = join(tmp, "sources", item.name);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "package.json"), JSON.stringify({
        publisher: "fixture",
        name: item.name,
        version: "1.0.0",
        engines: {neurobook: ">=0.1.0"},
        entries: {browser: {
            location: "browser",
            main: "browser.js",
            activationEvents: [`onSettingsPage:${sectionOf(item.name)}`],
            contributes: [{capability: "settings.pages", id: sectionOf(item.name), declaration: {title: {"zh-CN": `坏插件 ${item.name}`, "en-US": `Broken ${item.name}`}, category: "plugins", icon: "i-lucide-bug"}}],
        }},
    }));
    await writeFile(join(directory, "browser.js"), item.script ?? `${REGISTER}\n${item.body ?? ""}\n});\n`);
    return directory;
}

/** 用插件管理的安装接口装进状态根；下一次启动生效。 */
async function install(stateRoot: string, sources: ReadonlyArray<string>): Promise<void> {
    const inventory = createPluginInventory({root: join(stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, builtin: productPlugins, startup: NO_INSTALLED_PLUGINS, record: () => undefined});
    for (const source of sources) {
        const result = await inventory.install(source);
        if (!result.ok) throw new Error(`安装 ${source} 失败：${JSON.stringify(result)}`);
    }
}

async function run(command: string, args: ReadonlyArray<string>): Promise<void> {
    const child = spawn(command, args, {cwd: PACKAGE_ROOT, stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number>((resolve) => child.on("exit", (exit) => resolve(exit ?? 1)));
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} 失败：\n${output}`);
}

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "plugin-code");
    built = join(tmp, "snippets-dist");
    // 构建示例：与作者在仓库外构建同一个预设，仓库里 SDK 的包名指到应用源码（`plugin-sdk/build-examples.ts`）。
    const backendExamples = ["clock", "notes", "counter", "menu", "file-menu"];
    focus = join(tmp, "focus-dist");
    backend = backendExamples.map((name) => join(tmp, `${name}-dist`));
    sceneClock = join(tmp, "scene-clock-dist");
    const builds = [["snippets", built], ["focus", focus], ["scene-clock", sceneClock], ...backendExamples.map((name, index) => [name, backend[index]!])];
    await run("bun", ["-e", `import {buildExample} from "./plugin-sdk/build-examples"; for (const [name, out] of ${JSON.stringify(builds)}) await buildExample(name, out);`]);
});

test.afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 状态根：装好插件，登记一部作品（工作台绑定作品时才有活动栏与设置入口）。 */
async function stateRootWith(name: string, sources: ReadonlyArray<string>): Promise<string> {
    const stateRoot = join(tmp, name, "state");
    const book = join(tmp, name, "Book");
    const id = randomUUID();
    await mkdir(join(book, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(book, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));
    await install(stateRoot, sources);
    return stateRoot;
}

const bookUrl = (base: string): string => new URL("/?project=book", base).href;

/** 数插件入口代码的请求（不算样式表）。 */
function countCode(page: Page, plugin: string): {readonly count: () => number} {
    let count = 0;
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith(`/api/runtime/plugins/${plugin}/files/`) && url.pathname.endsWith(".js")) count += 1;
    });
    return {count: () => count};
}

async function openSettings(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await expect(page.locator("[data-settings-window]")).toBeVisible();
}

test("snippets 外置：打开分区时才取回代码、只取一次；图标激活前就显示；设置页能写进用户设置（产品构建）", async ({page}) => {
    const stateRoot = await stateRootWith("product", [built]);
    const server: ProductServer = await startProductServer(stateRoot);
    try {
        const code = countCode(page, "example.snippets");
        await openSettings(page, bookUrl(server.url));
        const nav = page.locator(`[data-settings-nav="${SNIPPETS_SECTION}"]`);
        await expect(nav).toBeVisible();
        // 图标规则在插件的样式表里：窗口登记插件时就加载，入口还没激活。图标真的画出来要宿主的遮罩规则与插件的 --svg 都
        // 生效、层序对：看遮罩图与尺寸，不只看变量。
        await expect.poll(() => nav.locator(".i-lucide-text-quote").evaluate((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return {mask: style.maskImage.startsWith("url(") || style.getPropertyValue("-webkit-mask-image").startsWith("url("), sized: box.width > 0 && box.height > 0};
        })).toEqual({mask: true, sized: true});
        // 取码只由点开分区触发：到这里为止一次都没有。
        expect(code.count()).toBe(0);

        await nav.click();
        await expect(page.locator("[data-snippets-editor]")).toBeVisible();
        await expect(page.locator("[data-snippet]")).toHaveCount(3);
        expect(code.count()).toBe(1);
        await page.locator(".snippets-editor__add").click();
        await expect.poll(async () => {
            const settings = parseJsonc(await readFile(join(stateRoot, "settings.json"), "utf8").catch(() => "{}")) as Record<string, unknown>;
            return (settings["example.snippets/items"] as unknown[] | undefined)?.length;
        }).toBe(4);

        // 关掉再打开：同一窗口里同一文件只取一次。
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-settings-window]")).toBeHidden();
        await page.locator("[data-activity-item='nbook.settings']").click();
        await page.locator(`[data-settings-nav="${SNIPPETS_SECTION}"]`).click();
        await expect(page.locator("[data-snippets-editor]")).toBeVisible();
        expect(code.count()).toBe(1);
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

test("场景提供者外置（theme.skins 输出 18）：主题的场景图由插件代码在窗口里画，变量是 blob 地址，换明暗换图，PNG 解得开", async ({page}) => {
    const stateRoot = await stateRootWith("scene-clock", [sceneClock]);
    const setting = (appearance: string): Promise<void> => writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.workbench/theme": "example.scene-clock.sky", "nbook.workbench/appearance": appearance}));
    await setting("light");
    const server: ProductServer = await startProductServer(stateRoot);
    const sceneVar = (): Promise<string> => page.evaluate(() => document.documentElement.style.getPropertyValue("--skin-scene"));
    try {
        await page.goto(bookUrl(server.url));
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        // 入口启动即激活，画好并解码之后才有变量与 `data-nb-skin-scene`。
        await expect.poll(sceneVar).toMatch(/^url\("blob:/u);
        await expect(page.locator("html")).toHaveAttribute("data-nb-skin-scene", "");
        const light = await sceneVar();
        const size = await page.evaluate(async (css) => {
            const image = new Image();
            image.src = /url\("(.+)"\)/u.exec(css)?.[1] ?? "";
            await image.decode();
            return [image.naturalWidth, image.naturalHeight];
        }, light);
        expect(size).toEqual([1600, 900]);

        // 换明暗是另一个键：另画一张。
        await setting("dark");
        await expect.poll(async () => {
            const now = await sceneVar();
            return now.startsWith("url(\"blob:") && now !== light;
        }).toBe(true);
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

test("编辑器里选场景提供者（theme.editor 输出 20）：下拉列出已发布的提供者，选中后预览用它画的图，“无”去掉", async ({page}) => {
    const stateRoot = await stateRootWith("scene-clock-editor", [sceneClock]);
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "light"}));
    const server: ProductServer = await startProductServer(stateRoot);
    const sceneVar = (): Promise<string> => page.evaluate(() => document.documentElement.style.getPropertyValue("--skin-scene"));
    const provider = page.locator("[data-scene-provider]").getByRole("combobox");
    try {
        await page.goto(bookUrl(server.url));
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        await page.getByRole("menuitem", {name: "视图"}).click();
        await page.getByRole("menuitem", {name: "打开主题编辑器", exact: true}).click();
        await page.locator("[data-new-empty]").click();
        await page.locator("[data-section-tab=scene]").click();

        // 已发布的提供者在下拉里：选项名是它声明的标题，右侧的次要文字是贡献 id；选中后预览的场景是它画的 blob 图。
        await provider.click();
        const option = page.getByRole("option", {name: "天空时钟", exact: true});
        await expect(option).toBeVisible();
        await expect(option).toContainText("example.scene-clock.sky-painter");
        await option.click();
        await expect(provider).toContainText("天空时钟");
        await expect.poll(sceneVar).toMatch(/^url\("blob:/u);

        // “无”：声明里去掉提供者，没有后备图时场景也没了。
        await provider.click();
        await page.getByRole("option", {name: "无", exact: true}).click();
        await expect.poll(sceneVar).toBe("");
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

/**
 * 手写的场景提供者插件（不经构建预设）：两个提供者、两个主题。`broken` 交出解不开的“图片”，主题带后备图；`refresh` 画 1×1 的图并在
 * 半秒后过期，重画时尺寸加一，所以每次的 blob 地址与内容都不同。
 */
async function sceneFixture(): Promise<string> {
    const directory = join(tmp, "sources", "scenefx");
    await mkdir(join(directory, "assets"), {recursive: true});
    await copyFile(join(PACKAGE_ROOT, "plugin-sdk/examples/external/theme-dusk/assets/dusk-day.webp"), join(directory, "assets/day.webp"));
    const look = (extra: Record<string, unknown> = {}) => ({colors: {"--accent-main": "#a4552a"}, ...extra});
    const theme = (id: string, provider: string, light: Record<string, unknown>) => ({capability: "workbench.themes", id, declaration: {title: {"zh-CN": id, "en-US": id}, base: "nbook", sceneProvider: provider, light, dark: look()}});
    await writeFile(join(directory, "package.json"), JSON.stringify({
        publisher: "fixture",
        name: "scenefx",
        version: "1.0.0",
        engines: {neurobook: ">=0.1.0"},
        contributes: [theme("fixture.scenefx.broken", "fixture.scenefx.garbage", look({scene: "assets/day.webp"})), theme("fixture.scenefx.refresh", "fixture.scenefx.ticker", look())],
        entries: {browser: {
            location: "browser",
            main: "browser.js",
            activationEvents: ["onStartup"],
            contributes: [
                {capability: "workbench.theme-scenes", id: "fixture.scenefx.garbage", declaration: {}},
                {capability: "workbench.theme-scenes", id: "fixture.scenefx.ticker", declaration: {}},
            ],
        }},
    }));
    await writeFile(join(directory, "browser.js"), `${REGISTER}
let round = 0;
const ticker = {scene: () => new Promise((resolve, reject) => {
    round += 1;
    const canvas = document.createElement("canvas");
    canvas.width = round;
    canvas.height = 1;
    canvas.getContext("2d").fillRect(0, 0, round, 1);
    canvas.toBlob((blob) => (blob === null ? reject(new Error("toBlob")) : resolve({image: blob, expiresAt: round === 1 ? Date.now() + 500 : undefined})), "image/png");
})};
const garbage = {scene: async () => ({image: new Blob([new Uint8Array(64)], {type: "image/png"})})};
exports.activate = () => ({contributions: {"workbench.theme-scenes": {"fixture.scenefx.garbage": garbage, "fixture.scenefx.ticker": ticker}}});
});
`);
    return directory;
}

test("场景提供者的失败与刷新（theme.skins 输出 18）：解不开的图回退到后备图；expiresAt 到点换成新画的图", async ({page}) => {
    const stateRoot = await stateRootWith("scene-fixture", [await sceneFixture()]);
    const setTheme = (theme: string): Promise<void> => writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.workbench/theme": theme, "nbook.workbench/appearance": "light"}));
    await setTheme("fixture.scenefx.broken");
    const server: ProductServer = await startProductServer(stateRoot);
    const sceneVar = (): Promise<string> => page.evaluate(() => document.documentElement.style.getPropertyValue("--skin-scene"));
    try {
        await page.goto(bookUrl(server.url));
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        // 提供者画出来的东西浏览器解不开：场景用后备的静态图（插件文件端点），不是 blob。
        await expect.poll(sceneVar).toMatch(/\/plugins\/fixture\.scenefx\/files\/.+day\.webp/u);
        expect(await sceneVar()).not.toContain("blob:");

        await setTheme("fixture.scenefx.refresh");
        await expect.poll(sceneVar, {timeout: 20_000}).toMatch(/^url\("blob:/u);
        const first = await sceneVar();
        // 半秒后过期，至少隔 5 秒重画；新图解码成功后才换上。
        await expect.poll(async () => {
            const now = await sceneVar();
            return now.startsWith("url(\"blob:") && now !== first;
        }, {timeout: 30_000}).toBe(true);
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

test("写坏的插件各自原位显示失败原因、其它插件照常；文件找回来后重试可以恢复", async ({page}) => {
    const sources = [];
    for (const item of BROKEN) sources.push(await brokenSource(item));
    const stateRoot = await stateRootWith("broken", [...sources, built]);
    const server = await startProductServer(stateRoot);
    // 服务端启动之后才把 missing 的入口文件挪走（启动时入口文件不在的插件不登记）：端点给 404，脚本加载失败。挪回去后内容
    // 不变，地址里的摘要仍然对得上。
    const missingFile = join(stateRoot, "plugins", "fixture.missing", "1.0.0", "browser.js");
    await rename(missingFile, `${missingFile}.away`);
    try {
        await openSettings(page, bookUrl(server.url));
        for (const item of BROKEN) {
            await page.locator(`[data-settings-nav="${sectionOf(item.name)}"]`).click();
            const frame = page.locator(`[data-settings-page="${sectionOf(item.name)}"]`);
            await expect(frame.locator("[role='alert']")).toContainText(item.code);
        }
        // 别的插件不受影响。
        await page.locator(`[data-settings-nav="${SNIPPETS_SECTION}"]`).click();
        await expect(page.locator("[data-snippets-editor]")).toBeVisible();

        await rename(`${missingFile}.away`, missingFile);
        await page.locator(`[data-settings-nav="${sectionOf("missing")}"]`).click();
        await page.locator(`[data-settings-page="${sectionOf("missing")}"] [data-settings-page-retry-entry]`).click();
        await expect(page.locator("[data-fixture-page='missing']")).toHaveText("已恢复");
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

test("开发会话里同样装载：页面经 Vite 提供时，插件拿到的仍是页面那一份 Vue（设置页能渲染、能改）", async ({page}) => {
    const stateRoot = await stateRootWith("dev", [built]);
    const dev = await startDevSession(stateRoot);
    try {
        await openSettings(page, bookUrl(dev.pageUrl));
        await page.locator(`[data-settings-nav="${SNIPPETS_SECTION}"]`).click();
        await expect(page.locator("[data-snippet]")).toHaveCount(3);
        await page.locator(".snippets-editor__add").click();
        await expect(page.locator("[data-snippet]")).toHaveCount(4);
    } finally {
        await page.goto("about:blank");
        dev.child.kill("SIGTERM");
        expect(await dev.exit).toBe(0);
    }
});

test("clock、notes、counter、menu、file-menu 外置：产品服务端装载它们的入口（启动即激活的成功、menu 收到 file-menu 的菜单项），没有激活失败；插件页不再标“部分功能暂不可用”", async ({page}) => {
    const stateRoot = await stateRootWith("backend", [built, ...backend]);
    const server = await startProductServer(stateRoot);
    try {
        await openSettings(page, bookUrl(server.url));
        await page.locator("[data-settings-nav='nbook.plugins.installed']").click();
        for (const id of ["example.clock", "example.notes", "example.counter", "example.menu", "example.file-menu", "example.snippets"]) {
            await expect(page.locator(`[data-plugin-row="${id}"]`)).toBeVisible();
        }
        await expect(page.locator("[data-plugin-not-loaded]")).toHaveCount(0);
        // 启动即激活的入口：内核在激活成功、交出产出之后记 `published`，装载不到代码或产出不对都不会有这一条。menu 收到
        // file-menu 的菜单项时记一条自己的诊断，说明两边的代码都装上、贡献交到了接收者手里。其余入口按需激活（项目入口在
        // 第一次远程调用时），这里只核对没有激活失败。
        const log = async (): Promise<ReadonlyArray<{readonly event?: string; readonly data?: Readonly<Record<string, unknown>>}>> => (await readFile(join(stateRoot, "logs", "server-current.jsonl"), "utf8"))
            .split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as {readonly event?: string; readonly data?: Readonly<Record<string, unknown>>});
        const published = (plugin: string) => async () => (await log()).some(({data}) => data?.plugin === plugin && data.entry === "server" && data.reason === "published");
        for (const plugin of ["example.counter", "example.menu", "example.file-menu"]) await expect.poll(published(plugin)).toBe(true);
        await expect.poll(async () => (await log()).some(({event, data}) => event === "example.menu.item-received" && data?.item === "example.file-menu.open")).toBe(true);
        const text = await readFile(join(stateRoot, "logs", "server-current.jsonl"), "utf8");
        expect(text).not.toMatch(/activation-threw|code-load-failed|code-threw|code-shape|missing-implementation/u);
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});

test("完整示例 focus 外置：状态栏条目显示今天的个数；在侧栏视图里开始，主按钮变成“放弃”、状态栏显示剩余时间；放弃后回到今天 0 个（到点完成与跨重启由场景 7 覆盖）", async ({page}) => {
    const stateRoot = await stateRootWith("focus", [focus]);
    const server = await startProductServer(stateRoot);
    try {
        await page.goto(bookUrl(server.url));
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
        const item = page.locator("[data-workbench-status-bar] [data-workbench-item='example.focus.status']");
        await expect(item).toHaveText("今天 0 个番茄");

        // 显示 focus 的视图。活动栏条目点一下已经聚焦的视图会隐藏它，所以只在它没按下时点。
        const container = page.locator("[data-tool-entry='example.focus.panel']");
        await expect(container).toBeVisible();
        if ((await container.getAttribute("aria-pressed")) !== "true") await container.click();
        await expect(container).toHaveAttribute("aria-pressed", "true");
        const panel = page.locator("[data-focus-panel]");
        await expect(panel).toBeVisible();
        await expect(panel.locator("[data-focus-today]")).toHaveText("今天完成 0 次，共 0 分钟");
        const toggle = panel.locator("[data-focus-toggle]");
        await toggle.click();
        await expect(toggle).toHaveText("放弃");
        await expect(toggle).toBeFocused();
        await expect(item).toHaveText(/^专注 2[45]:\d\d$/u);
        await expect(panel.locator("[role=timer]")).toHaveText(/^2[45]:\d\d$/u);

        // 状态栏条目挂着切换命令：点它放弃。
        await item.click();
        await expect(item).toHaveText("今天 0 个番茄");
        await expect(toggle).toHaveText("开始专注");
        await expect(panel.locator("[data-focus-announcement]")).toHaveText("已放弃这次专注");
    } finally {
        await page.goto("about:blank");
        expect(await server.stop()).toBe(0);
    }
});
