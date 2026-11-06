/**
 * t17 的测量：一个编辑组开 30 个标签的内存与 DOM、切换耗时、preview 连走的每步耗时。
 *
 * 跑法（在 packages/neuro-book 里，先构建 server、web、e2e 三份产物）：
 *   cp ../../.agents/works/w00026-layout-package/tasks/t17-per-tab-instance/scripts/measure-tabs.e2e.ts e2e/t17-measure.e2e.ts
 *   npx playwright test -c e2e/playwright.config.ts e2e/t17-measure.e2e --reporter=line
 *   rm e2e/t17-measure.e2e.ts
 * 结果写到环境变量 T17_MEASURE_OUT 指的文件，缺省打印。负载高时结果偏慢，跑之前看 /proc/loadavg。
 */
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {CDPSession, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const COUNT = 30;
/** 一章约五千字：长篇小说的常见长度。每章开头有自己的记号，等正文就绪用。 */
const chapter = (index: number): string => `# 记号${index}号\n\n${"天色将晚，她推开了门，雨下了一整夜。街上没有人，只有远处的灯还亮着。\n\n".repeat(150)}`;
const json = (index: number): string => JSON.stringify({记号: `记号${index}号`, 行: Array.from({length: 400}, (_, at) => `第 ${at} 行的内容`)}, null, 2);

let tmp = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "t17-measure");
    const project = join(tmp, "book");
    await mkdir(join(project, "md"), {recursive: true});
    await mkdir(join(project, "code"), {recursive: true});
    await mkdir(join(project, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(project, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    for (let index = 0; index < COUNT; index += 1) {
        await writeFile(join(project, "md", `c${String(index).padStart(2, "0")}.md`), chapter(index));
        await writeFile(join(project, "code", `c${String(index).padStart(2, "0")}.json`), json(index));
    }
    const state = join(tmp, "state");
    await mkdir(join(state, "user"), {recursive: true});
    await writeFile(join(state, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: project}]}));
    server = await startProductServer(state);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function heapMb(client: CDPSession): Promise<number> {
    await client.send("HeapProfiler.collectGarbage");
    const {usedSize} = await client.send("Runtime.getHeapUsage");
    return Math.round(usedSize / 1024 / 1024 * 10) / 10;
}
async function domNodes(client: CDPSession): Promise<number> {
    const {metrics} = await client.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "Nodes")?.value ?? 0;
}
/** 挂在文档上的元素个数：`Nodes` 还算没回收的游离节点，两个数差得多就是有东西留着 DOM。 */
const attachedElements = (page: Page): Promise<number> => page.evaluate(() => document.getElementsByTagName("*").length);
/** 在页面里点元素、逐帧等活动组的内容含这段字：往返 Playwright 的时间不算进去。 */
function clickUntil(page: Page, selector: string, mark: string, detail: 1 | 2 = 1): Promise<number> {
    return page.evaluate(async ({selector: target, mark: wanted, detail: clicks}) => {
        const element = document.querySelector<HTMLElement>(target);
        if (element === null) throw new Error(`没有 ${target}`);
        const start = performance.now();
        element.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
        if (clicks === 2) element.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, detail: 2}));
        for (;;) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const group = document.querySelector("[data-editor-group-active]");
            const control = group?.querySelector("[data-editor-kind]");
            if (control !== null && control !== undefined && getComputedStyle(control).display !== "none" && control.textContent?.includes(wanted) === true) return Math.round(performance.now() - start);
            if (performance.now() - start > 30_000) throw new Error(`等不到 ${wanted}`);
        }
    }, {selector, mark, detail});
}
const summary = (values: ReadonlyArray<number>) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1)};
};
const row = (dir: string, index: number, extension: string) => `[data-explorer-row="project://${dir}/c${String(index).padStart(2, "0")}.${extension}"]`;

test("30 个标签", async ({page}) => {
    test.setTimeout(20 * 60_000);
    await page.setViewportSize({width: 1440, height: 1500});
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.enable");
    await client.send("Performance.enable");
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-group]").first()).toBeVisible();
    await page.evaluate(() => {
        (window as unknown as {__longest: number}).__longest = 0;
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) (window as unknown as {__longest: number}).__longest = Math.max((window as unknown as {__longest: number}).__longest, entry.duration);
        }).observe({type: "longtask", buffered: false});
    });
    const longest = async (): Promise<number> => {
        const value = await page.evaluate(() => {
            const holder = window as unknown as {__longest: number};
            const current = holder.__longest;
            holder.__longest = 0;
            return Math.round(current);
        });
        return value;
    };
    const result: Record<string, unknown> = {};
    for (const [dir, extension] of [["md", "md"], ["code", "json"]] as const) {
        await page.locator(`[data-explorer-row="project://${dir}"]`).click();
        await expect(page.locator(row(dir, 0, extension))).toBeVisible();
    }
    result.baseline = {heapMb: await heapMb(client), nodes: await domNodes(client)};

    for (const [kind, dir, extension] of [["markdown", "md", "md"], ["monaco", "code", "json"]] as const) {
        const open: number[] = [];
        const memory: Array<{tabs: number; heapMb: number; nodes: number; attached: number}> = [];
        await longest();
        for (let index = 0; index < COUNT; index += 1) {
            open.push(await clickUntil(page, row(dir, index, extension), `记号${index}号`, 2));
            if ([1, 5, 10, 20, 30].includes(index + 1)) memory.push({tabs: index + 1, heapMb: await heapMb(client), nodes: await domNodes(client), attached: await attachedElements(page)});
        }
        const openLongest = await longest();
        const labels = page.locator("[data-editor-group-head-active] [data-editor-tab]");
        const tabIdOf = async (index: number): Promise<string> => {
            const name = `c${String(index).padStart(2, "0")}.${extension}`;
            return (await labels.filter({hasText: name}).first().getAttribute("data-panel-tab")) ?? "";
        };
        // 切到留着控件的标签：最近用过的 20 个里的。
        const kept: number[] = [];
        for (let index = 29; index >= 20; index -= 1) kept.push(await clickUntil(page, `[data-panel-tab="${await tabIdOf(index)}"]`, `记号${index}号`));
        const keptLongest = await longest();
        // 切到被回收的标签：要重新挂上。
        const recycled: number[] = [];
        for (let index = 0; index < 10; index += 1) recycled.push(await clickUntil(page, `[data-panel-tab="${await tabIdOf(index)}"]`, `记号${index}号`));
        const recycledLongest = await longest();
        const closeAll = page.locator("[data-editor-tab-close]").first();
        for (let guard = 0; guard < COUNT + 2 && await closeAll.count() > 0; guard += 1) await closeAll.click();
        await expect(page.locator("[data-editor-tab]")).toHaveCount(0);
        const afterClose = {heapMb: await heapMb(client), nodes: await domNodes(client), attached: await attachedElements(page)};
        result[kind] = {open: summary(open), openLongestTask: openLongest, memory, switchKept: summary(kept), switchKeptLongestTask: keptLongest, switchRecycled: summary(recycled), switchRecycledLongestTask: recycledLongest, afterClose};
    }

    // preview 连走：单击资源管理器的行，每步建一个控件。
    const walk: number[] = [];
    await longest();
    for (let index = 0; index < COUNT; index += 1) walk.push(await clickUntil(page, row("md", index, "md"), `记号${index}号`));
    result.previewWalk = {steps: summary(walk), longestTask: await longest()};
    const text = JSON.stringify(result, null, 2);
    console.log(text);
    if (process.env.T17_MEASURE_OUT !== undefined) await writeFile(process.env.T17_MEASURE_OUT, text);
});
