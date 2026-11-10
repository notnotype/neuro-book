/**
 * 源码编辑器的右键菜单与语法配色在真实 Chrome 中的验收（docs/specs/workbench/editor.md 输出 64、65，场景 40–43）：带探针的
 * 生产构建，测试插件 `test.menus` 往 `editor.code-context` 贡献一个只对 `.json` 的项。每个用例用自己的文件。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-code-menu");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await mkdir(join(projectDir, "code"), {recursive: true});
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    // 这里只看菜单与着色，自动保存会在点资源管理器时写盘，干扰“正文没变”的判断。
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    server = await startProbeServer(stateRoot, {env: {NBOOK_TEST_PLUGINS: "test.menus"}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const editor = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
const lines = (page: Page) => editor(page).locator(".view-lines");
const menu = (page: Page) => page.getByRole("menu");
/** 菜单项的名字以显示文字开头（后面可能接着快捷键）。 */
const entry = (page: Page, label: string) => menu(page).getByRole("menuitem", {name: new RegExp(`^${label}`, "u")});
/** 源码编辑器里文字正好是 `text` 的第一个 token。 */
const token = (page: Page, text: string) => lines(page).locator("span > span").filter({hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u")}).first();
/** 一行（Monaco 把空格画成不换行空格，按 token 找不到带空格的文字）。 */
const line = (page: Page, contains: string) => lines(page).locator(".view-line").filter({hasText: contains}).first();
/** 文档的正文：从 Monaco 取（不读磁盘，自动保存关着）。 */
const text = (page: Page): Promise<string> => page.evaluate(() => {
    const host = document.querySelector("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"] .monaco-editor .view-lines");
    return host === null ? "" : [...host.querySelectorAll(".view-line")].map((line) => (line.textContent ?? "").replace(/\u00a0/gu, " ")).join("\n");
});

async function openFile(page: Page, path: string, content: string): Promise<void> {
    await mkdir(dirname(join(projectDir, path)), {recursive: true});
    await writeFile(join(projectDir, path), content);
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = item(page, "project://code");
    await expect(folder).toBeVisible();
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    await item(page, `project://${path}`).dblclick();
    await expect(lines(page)).toContainText(content.split("\n")[0]!.slice(0, 4));
}

/** 菜单里依次是哪些项，分隔线写 `---`；只取每项开头的文字（去掉快捷键）。 */
async function menuLabels(page: Page): Promise<string[]> {
    await expect(menu(page)).toBeVisible();
    return menu(page).locator("[role^=\"menuitem\"], [role=\"separator\"]").evaluateAll((nodes) => nodes.map((node) => {
        if (node.getAttribute("role") === "separator") return "---";
        return (node.querySelector("[data-menu-label], span:not([aria-hidden])")?.textContent ?? node.textContent ?? "").trim();
    }));
}

test("JSON 文件：右击出现应用的菜单，内置三节之后是只对 .json 的贡献项，点它收到文件地址；CSS 文件没有这一项（场景 40、42）", async ({page}) => {
    await openFile(page, "code/a40.json", "{\"key\": \"value\", \"n\": 12}\n");
    await token(page, "\"value\"").click({button: "right"});
    const labels = await menuLabels(page);
    expect(labels.map((label) => label.replace(/\s.*$/u, ""))).toEqual(expect.arrayContaining(["剪切", "复制", "粘贴", "全选", "查找", "替换", "更改所有匹配项", "格式化文档", "测试源码右键项"]));
    expect(labels.indexOf("---")).toBeGreaterThan(0);
    // 只有一个菜单：Monaco 自己的没有出来。
    await expect(menu(page)).toHaveCount(1);
    await entry(page, "测试源码右键项").click();
    await expect(page.getByText(`收到 ${JSON.stringify({address: "project://code/a40.json"})}`)).toBeVisible();

    await openFile(page, "code/a40.css", "a { color: red; }\n");
    await token(page, "red").click({button: "right"});
    await expect(entry(page, "复制")).toBeVisible();
    await expect(entry(page, "测试源码右键项")).toHaveCount(0);
});

test("剪切后正文与剪贴板都变；光标在一行里不选中、复制后到另一行粘贴，插成完整的一行；格式化文档（场景 40）", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFile(page, "code/b40.json", "{\"alpha\": 1,\n\"beta\": 2}\n");
    await token(page, "\"beta\"").dblclick();
    await token(page, "\"beta\"").click({button: "right"});
    await entry(page, "剪切").click();
    await expect.poll(() => text(page)).not.toContain("beta");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("beta");

    await token(page, "\"alpha\"").click();
    await token(page, "\"alpha\"").click({button: "right"});
    await entry(page, "复制").click();
    await page.keyboard.press("Control+End");
    await lines(page).locator(".view-line").last().click({button: "right"});
    await entry(page, "粘贴").click();
    await expect.poll(async () => (await text(page)).split("\n").filter((line) => line.includes("alpha")).length).toBe(2);
    expect((await text(page)).split("\n").filter((line) => line.includes("alpha")).every((line) => line.trim().startsWith("{\"alpha\"") || line.trim().startsWith("\"alpha\""))).toBe(true);

    await lines(page).click({button: "right"});
    await entry(page, "格式化文档").click();
    await expect.poll(() => text(page)).toMatch(/^\s+"alpha": 1/mu);
});

test("先点资源管理器再右击正文，“更改所有匹配项”在且有效（场景 40）", async ({page}) => {
    await openFile(page, "code/c40.txt", "cat dog cat\n");
    await item(page, "project://code").click();
    await line(page, "dog").click({button: "right", position: {x: 6, y: 6}});
    await entry(page, "更改所有匹配项").click();
    await page.keyboard.type("fox");
    await expect.poll(() => text(page)).toContain("fox dog fox");
});

test("两个选区时右击其中一个之内选区都在；右击查找输入框没有应用的菜单；Shift+F10 与菜单键在光标处打开，Escape 后焦点回正文；滚动时关闭（场景 41）", async ({page}) => {
    await openFile(page, "code/d41.txt", `${Array.from({length: 80}, (_, index) => `line ${String(index)} word`).join("\n")}\n`);
    await line(page, "line").click();
    // 光标放进第一行的 word 里，Ctrl+D 两次：选中它，再加上下一处同样的词。
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+d");
    await page.keyboard.press("Control+d");
    const selections = (): Promise<number> => editor(page).locator(".selected-text").count();
    await expect.poll(selections).toBeGreaterThan(1);
    const before = await selections();
    const first = await editor(page).locator(".selected-text").first().boundingBox();
    await page.mouse.click(first!.x + first!.width / 2, first!.y + first!.height / 2, {button: "right"});
    await expect(menu(page)).toBeVisible();
    expect(await selections()).toBe(before);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".monaco-editor") !== null)).toBe(true);

    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toBeVisible();
    const box = await menu(page).boundingBox();
    const cursor = await editor(page).locator(".cursor").first().boundingBox();
    expect(Math.abs(box!.y - (cursor!.y + cursor!.height))).toBeLessThan(40);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ContextMenu");
    await expect(menu(page)).toBeVisible();
    await lines(page).hover();
    await page.mouse.wheel(0, 400);
    await expect(menu(page)).toHaveCount(0);

    // 滚动关掉菜单时焦点还在菜单上：先点回正文再开查找。
    // `.view-lines` 随滚动整体平移，按它的位置点会点到可见区外面：点编辑器的外框。
    await editor(page).click({position: {x: 120, y: 30}});
    await page.keyboard.press("Control+f");
    const find = editor(page).locator(".find-widget textarea").first();
    await expect(find).toBeFocused();
    await find.click({button: "right"});
    await expect(menu(page)).toHaveCount(0);
    await expect(find).toBeFocused();
});

test("只读（文件被别处删掉后）：菜单只有复制、全选、查找，没有贡献项（场景 41）", async ({page}) => {
    await openFile(page, "code/e41.json", "{\"gone\": true}\n");
    await rm(join(projectDir, "code/e41.json"));
    await expect(page.locator("[data-editor-banner]")).toBeVisible();
    await token(page, "\"gone\"").click({button: "right"});
    const labels = (await menuLabels(page)).map((label) => label.replace(/\s.*$/u, ""));
    expect(labels.filter((label) => label !== "---")).toEqual(["复制", "全选", "查找"]);
});

/** 把一个颜色表达式在页面里算成 0–255 的 RGB：读临时元素的计算色，`rgb()` 与 `color(srgb …)` 两种写法都认。不用画布，免得和实现用同一种办法、一起错。 */
async function resolved(page: Page, expression: string): Promise<[number, number, number]> {
    return page.evaluate((value) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();
        const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/u.exec(computed);
        if (srgb !== null) return [srgb[1], srgb[2], srgb[3]].map((part) => Math.round(Number(part) * 255)) as [number, number, number];
        const rgb = /^rgba?\((\d+), (\d+), (\d+)/u.exec(computed);
        if (rgb !== null) return [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
        throw new Error(`不认识的计算色 ${computed}`);
    }, expression);
}
const tokenColor = (page: Page, text: string) => token(page, text).evaluate((node) => {
    const match = /^rgba?\((\d+), (\d+), (\d+)/u.exec(getComputedStyle(node).color);
    return match === null ? null : [match[1], match[2], match[3]].map(Number);
});
const near = (a: ReadonlyArray<number> | null, b: ReadonlyArray<number>): boolean => a !== null && a.every((value, index) => Math.abs(value - b[index]!) <= 1);
const luminance = ([r, g, b]: ReadonlyArray<number>): number => {
    const channel = (value: number): number => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
};
const contrast = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high! + 0.05) / (low! + 0.05);
};

for (const [theme, appearance] of [["nbook", "light"], ["nbook", "dark"], ["macos", "light"], ["eye-green", "light"]] as const) {
    test(`语法配色 ${theme} ${appearance}：JSON 的键、字符串值、数字与 true 取主题的语法变量，互不相同，在底色上读得清（场景 43）`, async ({page}) => {
        await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.workbench/theme": theme, "nbook.workbench/appearance": appearance}));
        await openFile(page, `code/syntax-${theme}-${appearance}.json`, "{\"key\": \"value\", \"n\": 12, \"t\": true}\n");
        const cases = [["\"key\"", "--syntax-attribute"], ["\"value\"", "--syntax-string"], ["12", "--syntax-number"], ["true", "--syntax-keyword"]] as const;
        const background = await editor(page).locator(".monaco-editor-background").first().evaluate((node) => getComputedStyle(node).backgroundColor);
        const bg = (/^rgba?\((\d+), (\d+), (\d+)/u.exec(background) ?? []).slice(1).map(Number);
        expect(near(bg, await resolved(page, "var(--bg-main)"))).toBe(true);
        const seen: number[][] = [];
        for (const [text, variable] of cases) {
            const expected = await resolved(page, `var(${variable})`);
            await expect.poll(async () => near(await tokenColor(page, text), expected)).toBe(true);
            const color = (await tokenColor(page, text))!;
            expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
            seen.push(color);
        }
        expect(new Set(seen.map((color) => color.join(","))).size).toBe(cases.length);
    });
}

test("选区色取主题的 --selection-bg（带透明度的 rgba 也换算得对）（场景 43）", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "light"}));
    await openFile(page, "code/f43.txt", "select me\n");
    const variable = await editor(page).evaluate((node) => getComputedStyle(node).getPropertyValue("--vscode-editor-selectionBackground").trim().toLowerCase());
    const expected = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--selection-bg").trim());
    // Monaco 把主题色写成 CSS 变量时用 rgba()（不透明时是 #rrggbb）：比较 RGB 与有没有透明度。
    const [r, g, b] = await resolved(page, expected);
    const parts = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/u.exec(variable);
    expect(parts).not.toBeNull();
    expect(near(parts!.slice(1, 4).map(Number), [r, g, b])).toBe(true);
    if (/rgba|\/ /u.test(expected)) expect(Number(parts![4])).toBeLessThan(1);
});

test("磁盘内容没变：右键、菜单开关不会改正文", async ({page}) => {
    await openFile(page, "code/g.json", "{\"same\": 1}\n");
    await token(page, "\"same\"").click({button: "right"});
    await page.keyboard.press("Escape");
    expect(await readFile(join(projectDir, "code/g.json"), "utf8")).toBe("{\"same\": 1}\n");
});
