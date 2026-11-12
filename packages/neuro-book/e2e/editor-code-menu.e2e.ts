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
/** 源码编辑器里文字正好是 `text` 的第一个 token；Monaco 把空格画成不换行空格，两种都认。 */
const token = (page: Page, text: string) => lines(page).locator("span > span").filter({hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/ /gu, "[ \\u00a0]")}$`, "u")}).first();
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

test("剪切后正文与剪贴板都变；光标在一行里不选中、复制后到另一行的中间粘贴，插成完整的一行；格式化文档（场景 40）", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFile(page, "code/b40.json", "{\"alpha\": 1,\n\"beta\": 2,\n\"gamma\": 3}\n");
    await token(page, "\"beta\"").dblclick();
    await token(page, "\"beta\"").click({button: "right"});
    await entry(page, "剪切").click();
    await expect.poll(() => text(page)).not.toContain("beta");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("beta");

    await token(page, "\"alpha\"").click();
    await token(page, "\"alpha\"").click({button: "right"});
    await entry(page, "复制").click();
    // 右击落在“gamma”这个词的中间：光标在行中间。整行复制的信息没带上时，粘贴会插在这里，把这一行拆开。
    await token(page, "\"gamma\"").click({button: "right"});
    await entry(page, "粘贴").click();
    await expect.poll(async () => (await text(page)).split("\n").filter((line) => line === "{\"alpha\": 1,").length).toBe(2);
    expect((await text(page)).split("\n")).toContain("\"gamma\": 3}");

    await lines(page).click({button: "right"});
    await entry(page, "格式化文档").click();
    await expect.poll(() => text(page)).toMatch(/^\s+"alpha": 1/mu);
});

test("全选、查找、替换与格式化选定内容（场景 40）", async ({page}) => {
    await openFile(page, "code/h40.json", "{\"a\": [1,2,3]}\n");
    await token(page, "\"a\"").click({button: "right"});
    await entry(page, "全选").click();
    await expect(editor(page).locator(".selected-text").first()).toBeVisible();
    await token(page, "\"a\"").click({button: "right"});
    await expect(entry(page, "格式化选定内容")).toBeVisible();
    await entry(page, "格式化选定内容").click();
    await expect.poll(() => text(page)).toMatch(/^\s+"a": \[/mu);
    await token(page, "\"a\"").click({button: "right"});
    await entry(page, "查找").click();
    await expect(editor(page).locator(".find-widget textarea").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await token(page, "\"a\"").click({button: "right"});
    await entry(page, "替换").click();
    await expect(editor(page).locator(".find-widget .replace-input textarea, .find-widget .replace-part textarea").first()).toBeVisible();
});

test("先点资源管理器再右击正文，光标移到点击处，“更改所有匹配项”在且有效（场景 40、41）", async ({page}) => {
    await openFile(page, "code/c40.txt", "cat dog cat\n");
    await line(page, "dog").click({position: {x: 2, y: 6}});
    await page.keyboard.press("Home");
    await item(page, "project://code").click();
    // 右击在“dog”上：光标原来在行首，右击之后应在点击处。
    const dog = await page.evaluate(() => {
        const host = document.querySelector("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"] .view-lines .view-line");
        const range = document.createRange();
        const textNode = [...(host?.querySelectorAll("span span") ?? [])].map((span) => span.firstChild).find((node) => node?.textContent?.includes("dog"));
        if (textNode == null) return null;
        const at = textNode.textContent!.indexOf("dog");
        range.setStart(textNode, at + 1);
        range.setEnd(textNode, at + 2);
        const rect = range.getBoundingClientRect();
        return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    });
    await page.mouse.click(dog!.x, dog!.y, {button: "right"});
    await expect(menu(page)).toBeVisible();
    await expect(page.locator("[data-workbench-status-bar] [data-workbench-item=\"nbook.editor.cursor\"]")).toContainText(/第 1 行，第 [56] 列/u);
    await entry(page, "更改所有匹配项").click();
    await page.keyboard.type("fox");
    await expect.poll(() => text(page)).toContain("cat fox cat");
});

test("两个编辑组各按各的 Shift+F10；光标滚出可见区时先滚回来、菜单开在光标处；只发右键事件的键盘也在光标处打开（场景 41）", async ({page}) => {
    await openFile(page, "code/k41.txt", `${Array.from({length: 120}, (_, index) => `row ${String(index)}`).join("\n")}\n`);
    await line(page, "row 0").click();
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    const right = page.locator("[data-editor-group-active]");
    const rightBox = await right.boundingBox();
    await page.keyboard.press("Shift+F10");
    const opened = await menu(page).boundingBox();
    expect(opened!.x).toBeGreaterThanOrEqual(rightBox!.x - 1);
    await page.keyboard.press("Escape");

    // 光标在第 1 行，把正文滚到底再按：菜单不能开到编辑器外面去。
    await lines(page).hover();
    await page.mouse.wheel(0, 4000);
    await expect.poll(async () => (await text(page)).includes("row 0")).toBe(false);
    await page.keyboard.press("Shift+F10");
    const after = await menu(page).boundingBox();
    const box = await editor(page).boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(box!.y);
    expect(after!.y).toBeLessThanOrEqual(box!.y + box!.height);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);

    // 有的平台菜单键只发 contextmenu：键盘发的 pointerType 是空串。
    await page.evaluate(() => document.activeElement?.dispatchEvent(new PointerEvent("contextmenu", {bubbles: true, cancelable: true, pointerType: "", button: 0})));
    await expect(menu(page)).toBeVisible();
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
        expect(near(bg, await resolved(page, "var(--bg-panel)"))).toBe(true);
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

test("TypeScript、CSS、HTML 的成分各取对应的语法变量；切换明暗后颜色跟着变（场景 43）", async ({page}) => {
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "light"}));
    const cases: Record<string, {readonly content: string; readonly tokens: ReadonlyArray<readonly [string, string]>}> = {
        "code/s43.ts": {content: "// 注释\nexport const n = f(\"s\");\n", tokens: [["// 注释", "--syntax-comment"], ["export", "--syntax-keyword"], ["\"s\"", "--syntax-string"], ["(", "--syntax-punctuation"]]},
        "code/s43.css": {content: ".a {\n    color: red;\n}\n", tokens: [["color:", "--syntax-attribute"], ["{", "--syntax-punctuation"]]},
        "code/s43.html": {content: "<p id=\"x\">t</p>\n", tokens: [["p", "--syntax-tag"], ["id", "--syntax-attribute"], ["\"x\"", "--syntax-string"]]},
    };
    for (const [path, {content, tokens}] of Object.entries(cases)) {
        await openFile(page, path, content);
        for (const [text, variable] of tokens) {
            const expected = await resolved(page, `var(${variable})`);
            await expect.poll(async () => near(await tokenColor(page, text), expected), {message: `${path} 的 ${text} 应取 ${variable}`}).toBe(true);
        }
    }
    // 运行中切到暗色：主题重新生成，同一个 token 的颜色变成暗色下的值。
    const lightColor = await tokenColor(page, "id");
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.workbench/theme": "nbook", "nbook.workbench/appearance": "dark"}));
    await expect(page.locator("html")).toHaveAttribute("data-nb-appearance", "dark");
    const dark = await resolved(page, "var(--syntax-attribute)");
    await expect.poll(async () => near(await tokenColor(page, "id"), dark)).toBe(true);
    expect(near(lightColor, dark)).toBe(false);
});

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
