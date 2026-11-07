/**
 * 落点分区的外观（docs/specs/ui/workbench-layout.md“落点分区”，t01 决定 14、18）：压暗不用模糊，外观走变量。happy-dom 算不出这些计算样式，所以在真实浏览器里看。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-drop-sectors");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test("压暗不用模糊、有底色；线与当前块走变量", async ({page}) => {
    await page.setViewportSize({width: 1400, height: 900});
    await page.goto(`${dev.pageUrl}lab?c=DropSectorsOverlay&s=five`);
    const overlay = page.locator("[data-drop-sectors]");
    await expect(overlay).toHaveCount(1);
    const look = await overlay.evaluate((element) => {
        const style = getComputedStyle(element);
        return {filter: style.filter, backdrop: style.backdropFilter, background: style.backgroundColor, events: style.pointerEvents};
    });
    expect(look).toMatchObject({filter: "none", backdrop: "none", events: "none"});
    expect(look.background).not.toBe("rgba(0, 0, 0, 0)");

    const stroke = (sector: string) => page.locator(`[data-drop-sector="${sector}"]`).evaluate((element) => getComputedStyle(element).stroke);
    await expect(page.locator("[data-drop-sector=\"right\"]")).toHaveAttribute("data-drop-sector-active", "");
    expect(await stroke("right")).not.toBe(await stroke("left"));
    await page.evaluate(() => {
        document.documentElement.style.setProperty("--layout-sector-line", "rgb(1, 2, 3)");
        document.documentElement.style.setProperty("--layout-sector-active-line", "rgb(4, 5, 6)");
    });
    await expect.poll(() => stroke("left")).toBe("rgb(1, 2, 3)");
    await expect.poll(() => stroke("right")).toBe("rgb(4, 5, 6)");
});
