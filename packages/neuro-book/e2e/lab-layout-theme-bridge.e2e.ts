/**
 * nb-ui 给布局组件的桥接在真实浏览器里生效（docs/specs/theme/system.md 的“布局组件的桥接”，docs/specs/ui/nested-grid.md
 * 输出 141、142）。桥接与清单一一对应由 `src/web/theme-bridge.test.ts` 核对；这里查的是层叠：主题、配色与减少动效之下，
 * nb-layout 读的新名在根上取到的就是主题的旧名，没有别的声明盖过桥接，也没有落到回退。另查 nb-layout 的全局样式进了构建
 * 产物：装了 nb-ui 时减少动效那一段有没有都一样，只有焦点环看得出来。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {NB_LAYOUT_THEME_VARS} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-layout-theme-bridge");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state());

async function open(page: Page, query: string, motion: "reduce" | "no-preference"): Promise<void> {
    await page.emulateMedia({reducedMotion: motion});
    await page.goto(`${dev.pageUrl}lab?${query}&vp=1200x800`);
    await expect.poll(async () => (await labState(page))?.ready, {timeout: 60_000}).toBe(true);
}

/** 经桥接接旧名的每一项：根上新名与旧名的计算值。 */
const PAIRS = NB_LAYOUT_THEME_VARS.flatMap((entry) => (entry.kind === "bridged" && entry.from !== null ? [[entry.name, entry.from] as const] : []));

const rootValues = (page: Page) => page.evaluate((pairs) => {
    const style = getComputedStyle(document.documentElement);
    return pairs.map(([name, from]) => ({name, value: style.getPropertyValue(name).trim(), theme: style.getPropertyValue(from).trim()}));
}, PAIRS);

test.describe("nb-layout 的主题变量经 nb-ui 桥接", () => {
    for (const [label, query] of [["nbook 亮色", "theme=nbook&cw=light"], ["nbook 暗色", "theme=nbook&cw=dark"], ["macos", "theme=macos&cw=light"]] as const) {
        test(`${label}：每个新名在根上取到主题的旧名，不是空的`, async ({page}) => {
            await open(page, `c=NestedGrid&s=swap&${query}`, "no-preference");
            const values = await rootValues(page);
            expect(values.filter((item) => item.value === "").map((item) => item.name)).toEqual([]);
            expect(values.filter((item) => item.value !== item.theme)).toEqual([]);
            const z = await page.evaluate(() => ["--nb-layout-z-drop-sectors", "--nb-layout-z-drop-feedback"].map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()));
            expect(z).toEqual(["59", "60"]);
        });
    }

    test("减少动态效果：nb-layout 读的四个时长与主题的都是 0ms", async ({page}) => {
        await open(page, "c=NestedGrid&s=swap&theme=nbook&cw=light", "reduce");
        const motion = (await rootValues(page)).filter((item) => item.name.startsWith("--nb-layout-motion-"));
        expect(motion.map((item) => item.name).sort()).toEqual(["--nb-layout-motion-base", "--nb-layout-motion-fast", "--nb-layout-motion-layout", "--nb-layout-motion-move"]);
        for (const item of motion) expect(item).toEqual({name: item.name, value: "0ms", theme: "0ms"});
    });

    test("nb-layout 的全局样式进了产物：键盘聚焦可排序列表的把手时有焦点环", async ({page}) => {
        await open(page, "c=SortableList&s=default&theme=nbook&cw=light", "reduce");
        const handle = page.locator("[data-sortable-handle]").first();
        await expect(handle).toBeVisible();
        // 用 Tab 走到把手：键盘导航才有 :focus-visible。
        for (let step = 0; step < 30; step += 1) {
            if (await handle.evaluate((element) => element === document.activeElement)) break;
            await page.keyboard.press("Tab");
        }
        const ring = await handle.evaluate((element) => ({visible: element.matches(":focus-visible"), outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow}));
        expect(ring.visible).toBe(true);
        expect(ring.outline).toBe("none");
        expect(ring.shadow).not.toBe("none");
    });
});
