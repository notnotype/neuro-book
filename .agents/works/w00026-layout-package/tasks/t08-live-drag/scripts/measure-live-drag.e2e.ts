/**
 * t08 的测量：长章节开着时，实时布局拖动的帧间隔（卡片是否跟手）。对照落点指示。
 *
 * 跑法（在 packages/neuro-book 里，先构建 server、web、e2e 三份产物）：
 *   cp ../../.agents/works/w00026-layout-package/tasks/t08-live-drag/scripts/measure-live-drag.e2e.ts e2e/t08-measure.e2e.ts
 *   T08_MEASURE_OUT=/tmp/t08.json npx playwright test -c e2e/playwright.config.ts e2e/t08-measure.e2e --reporter=line
 *   rm e2e/t08-measure.e2e.ts
 * 负载高时结果偏慢：先看 /proc/loadavg，证据里写明。
 */
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

let tmp = "";
let state = "";
let server: ProductServer;
const paragraph = "天色将晚，她推开了门，雨下了一整夜。街上没有人，只有远处的灯还亮着，风把门吹得吱吱作响。\n\n";

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "t08-measure");
    const project = join(tmp, "book");
    await mkdir(join(project, "notes"), {recursive: true});
    await mkdir(join(project, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(project, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(project, "notes", "short.md"), `# 短章\n\n${paragraph.repeat(20)}`);
    await writeFile(join(project, "notes", "long.md"), `# 长章\n\n${paragraph.repeat(2300)}`);
    state = join(tmp, "state");
    await mkdir(join(state, "user"), {recursive: true});
    await writeFile(join(state, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: project}]}));
    server = await startProductServer(state);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const stats = (gaps: ReadonlyArray<number>) => {
    const sorted = [...gaps].sort((a, b) => a - b);
    return {frames: sorted.length, median: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), max: Math.round(sorted.at(-1) ?? 0)};
};

/** 拖短章的标签，在长章那一组的四条边上转圈：每条边停 300ms，预览换一次，邻居的长章重排一次。 */
async function sweep(page: Page): Promise<ReturnType<typeof stats>> {
    const tab = page.locator("[data-editor-tab]").filter({hasText: "short.md"});
    const from = await tab.boundingBox();
    const groupBox = await page.locator("[data-editor-group]").filter({hasText: "长章"}).first().boundingBox();
    if (from === null || groupBox === null) throw new Error("没有矩形");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, {steps: 2});
    await page.evaluate(() => {
        const gaps: number[] = [];
        const probe = window as unknown as {__gaps: number[]; __stop: boolean};
        probe.__gaps = gaps;
        probe.__stop = false;
        let last = performance.now();
        const sample = (now: number): void => {
            gaps.push(now - last);
            last = now;
            if (!probe.__stop) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    const {x, y, width, height} = groupBox;
    const stops = [{x: x + width - 20, y: y + height / 2}, {x: x + width / 2, y: y + height - 20}, {x: x + 20, y: y + height / 2}, {x: x + width / 2, y: y + 60}, {x: x + width / 2, y: y + height / 2}];
    for (let round = 0; round < 2; round += 1) {
        for (const stop of stops) {
            await page.mouse.move(stop.x, stop.y, {steps: 12});
            await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300))); // test-lint-allow fixed-wait: 测量脚本，等预览换完
        }
    }
    const gaps = await page.evaluate(() => {
        const probe = window as unknown as {__gaps: number[]; __stop: boolean};
        probe.__stop = true;
        return probe.__gaps;
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    return stats(gaps);
}

test("长章节开着时拖标签", async ({page}) => {
    test.setTimeout(5 * 60_000);
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.setViewportSize({width: 1440, height: 900});
    const results: Record<string, unknown> = {};
    for (const feel of ["live", "indicator"] as const) {
        await writeFile(join(state, "settings.json"), JSON.stringify({"nbook.workbench/dragFeel": feel}));
        await page.goto(new URL("/?project=book", server.url).href);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
        const folder = page.locator("[data-explorer-row=\"project://notes\"]");
        if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
        const tabs = page.locator("[data-editor-tab]");
        // 恢复的会话里可能已经开着；工作区还可能开着欢迎页。
        for (const name of ["long", "short"]) {
            await page.locator(`[data-explorer-row="project://notes/${name}.md"]`).dblclick();
            await expect(tabs.filter({hasText: `${name}.md`})).toHaveCount(1);
        }
        await tabs.filter({hasText: "long.md"}).click();
        await expect(page.locator("[data-editor-group-active] [data-editor-prose]")).toContainText("长章");
        await tabs.filter({hasText: "short.md"}).click();
        await tabs.filter({hasText: "long.md"}).click();
        results[feel] = await sweep(page);
    }
    const text = JSON.stringify(results, null, 2);
    console.log(text);
    if (process.env.T08_MEASURE_OUT !== undefined) await writeFile(process.env.T08_MEASURE_OUT, text);
});
