/**
 * 命令与快速打开在真实浏览器中的验收，对着真实的 `bun run dev` 里的 Lab 命令场景：ui.component-lab 场景 16、
 * workbench.commands 场景 10、workbench.quick-open 场景 1 与 7。产品 `/` 页的命令面板在 commands.e2e.ts。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-commands");
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

async function openScene(page: Page, query: string): Promise<void> {
    await page.goto(`${dev.pageUrl}lab?${query}`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true});
}

/** 命令面板的输入框；Lab 外壳的下拉框也是 combobox，按面板输入框的名字区分。 */
const combobox = (page: Page): Locator => page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
const editor = (page: Page): Locator => page.locator("[data-lab-sample-editor]");

/** 文本框里光标所在的行与列（都从 1 起）。 */
const caret = (page: Page) => editor(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lines = before.split("\n");
    return {line: lines.length, column: (lines[lines.length - 1] ?? "").length + 1, focused: document.activeElement === textarea};
});

test("命令场景：快捷键打开受检的面板、执行撤销、执行记录进事件；换到别的组件后快捷键不再响应（场景 16、commands 10）", async ({page}) => {
    const problems = watchConsole(page);
    await openScene(page, "c=WorkbenchCommandPalette&s=command-navigation");
    const original = await editor(page).inputValue();
    await editor(page).fill(`${original}\n追加的一行`);

    await page.keyboard.press("Control+Shift+P");
    await expect(combobox(page)).toBeFocused();
    await expect(page.locator("[data-lab-subject]").filter({has: combobox(page)})).toHaveCount(1);
    await page.keyboard.type("撤销");
    await expect(page.locator('[role="option"]').filter({hasText: "撤销"})).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(combobox(page)).toHaveCount(0);
    await expect(editor(page)).toHaveValue(original);

    await page.keyboard.press("Control+Shift+P");
    await expect(combobox(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(combobox(page)).toHaveCount(0);

    await page.locator('[role="tab"]').filter({hasText: "事件"}).click();
    const events = page.locator('[data-lab-panel="events"]');
    await expect(events).toContainText("nbook.edit.undo");
    await expect(events).toContainText("nbook.quick-open.open-commands");

    await page.locator('.lab-columns > .nb-lab-panel--nav [role="treeitem"]').filter({hasText: /^SkillChip$/u}).click();
    await expect.poll(() => labState(page)).toMatchObject({component: "SkillChip", ready: true});
    await page.keyboard.press("Control+Shift+P");
    await expect(combobox(page)).toHaveCount(0);
    await expect(page.locator("[data-lab-command-inspector]")).toHaveCount(0);
    expect(problems).toEqual([]);
});

test("没有活动编辑器：编辑器命令不登记、按钮不可用，检视里给出可读的原因（commands 10）", async ({page}) => {
    const problems = watchConsole(page);
    await openScene(page, "c=WorkbenchCommandPalette&s=commands-unavailable");
    await expect(page.getByRole("button", {name: "撤销", exact: true})).toBeDisabled();
    const inspector = page.locator("[data-lab-command-inspector]");
    await inspector.locator("summary").click();
    await expect(inspector.locator('[data-lab-command-row="nbook.quick-open.open-line"]')).toContainText("缺少：当前编辑器不支持行号跳转");
    await expect(inspector.locator('[data-lab-command-row="nbook.edit.undo"]')).toHaveCount(0);
    expect(problems).toEqual([]);
});

test("`:15` 回车：光标到第 15 行第 1 列，焦点在编辑器（quick-open 1）", async ({page}) => {
    const problems = watchConsole(page);
    await openScene(page, "c=WorkbenchCommandPalette&s=command-navigation");
    await page.keyboard.press("Control+Shift+P");
    await expect(combobox(page)).toBeFocused();
    await combobox(page).fill(":15");
    await expect(page.locator('[role="option"]').filter({hasText: "跳转到第 15 行"})).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(combobox(page)).toHaveCount(0);
    await expect.poll(() => caret(page)).toEqual({line: 15, column: 1, focused: true});
    expect(problems).toEqual([]);
});

/** 解析 getComputedStyle 给出的颜色：`rgb()`/`rgba()`（0–255）或 `color(srgb r g b / a)`（0–1），返回 0–255 的 RGB 与透明度。 */
function parseColor(color: string): {rgb: [number, number, number]; alpha: number} {
    const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/u.exec(color);
    if (srgb !== null) return {rgb: [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255], alpha: srgb[4] === undefined ? 1 : Number(srgb[4])};
    const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/u.exec(color);
    if (rgb === null) throw new Error(`认不出的颜色：${color}`);
    return {rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: rgb[4] === undefined ? 1 : Number(rgb[4])};
}

/** WCAG 对比度。 */
function contrastOf(foreground: [number, number, number], background: [number, number, number]): number {
    const luminance = (rgb: [number, number, number]): number => {
        const [r, g, b] = rgb.map((value) => {
            const scaled = value / 255;
            return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

for (const theme of ["nbook", "macos", "editorial", "aurora"]) {
    for (const colorway of ["light", "dark"]) {
        test(`面板在 ${theme} / ${colorway}、390 px 下：S4 层级、文字对比度足够、不横向溢出（quick-open 7）`, async ({page}) => {
            const problems = watchConsole(page);
            await page.setViewportSize({width: 390, height: 844});
            await openScene(page, `c=WorkbenchCommandPalette&s=command-navigation&theme=${theme}&cw=${colorway}`);
            await page.keyboard.press("Control+Shift+P");
            await expect(combobox(page)).toBeFocused();
            const panel = page.locator('[role="dialog"]').filter({has: combobox(page)});
            const style = await panel.evaluate((element) => {
                const computed = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return {
                    zIndex: Number(computed.zIndex),
                    color: getComputedStyle(element.querySelector('[role="combobox"]') as Element).color,
                    background: computed.backgroundColor,
                    backdrop: computed.backdropFilter,
                    left: rect.left,
                    right: rect.right,
                    overflow: document.documentElement.scrollWidth - innerWidth,
                };
            });
            expect(style.zIndex).toBeGreaterThanOrEqual(9200);
            // 材质：不透明的面板底色，或带背景模糊的半透明玻璃。对比度按文字与面板底色这对 token 算（不计透明度）：
            // 玻璃下实际看到的底色还取决于下层内容与模糊，算不出确定值。
            const surface = parseColor(style.background);
            expect(surface.alpha === 1 || (surface.alpha > 0 && style.backdrop !== "none")).toBe(true);
            expect(contrastOf(parseColor(style.color).rgb, surface.rgb)).toBeGreaterThanOrEqual(4.5);
            expect(style.left).toBeGreaterThanOrEqual(0);
            expect(style.right).toBeLessThanOrEqual(390);
            expect(style.overflow).toBeLessThanOrEqual(0);
            expect(problems).toEqual([]);
        });
    }
}
