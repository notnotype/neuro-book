/** 临时测量：鼠标划过界面、拖动在几种落点上的主线程开销。不入库。 */
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {CDPSession, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

// 轨迹快照本身很贵（captureSnapshot），会盖住应用的开销。
test.use({trace: "off", video: "off", screenshot: "off"});

let tmp = "";
let state = "";
let server: ProductServer;
const paragraph = "天色将晚，她推开了门，雨下了一整夜。街上没有人，只有远处的灯还亮着，风把门吹得吱吱作响。\n\n";

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "t20-measure");
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

const KEYS = ["TaskDuration", "ScriptDuration", "RecalcStyleDuration", "RecalcStyleCount", "LayoutDuration", "LayoutCount"] as const;
async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
    const {metrics: list} = await cdp.send("Performance.getMetrics") as {metrics: Array<{name: string; value: number}>};
    return Object.fromEntries(list.filter((item) => (KEYS as ReadonlyArray<string>).includes(item.name)).map((item) => [item.name, item.value]));
}

/** 跑一段，返回主线程开销（毫秒，按真实墙钟的占比）。 */
async function measure(cdp: CDPSession, page: Page, run: () => Promise<void>): Promise<Record<string, number>> {
    const before = await metrics(cdp);
    const started = Date.now();
    await run();
    const wall = Date.now() - started;
    const after = await metrics(cdp);
    const out: Record<string, number> = {wall};
    for (const key of KEYS) {
        const delta = (after[key] ?? 0) - (before[key] ?? 0);
        out[key] = key.endsWith("Count") ? delta : Math.round(delta * 1000);
    }
    out.busyPercent = Math.round((out.TaskDuration ?? 0) * 100 / wall);
    return out;
}

/** 在几个点之间来回走：每步一个指针事件。 */
async function sweep(page: Page, points: ReadonlyArray<{x: number; y: number}>, rounds: number, steps: number): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        for (const point of points) await page.mouse.move(point.x, point.y, {steps});
    }
}

interface ProfileNode {readonly id: number; readonly callFrame: {readonly functionName: string; readonly url: string; readonly lineNumber: number}; readonly hitCount: number}
/** 每个 DOM 量取函数被谁调：沿父节点往上三层，用 url:行:列 定位。 */
function callersOf(profile: {nodes: ReadonlyArray<ProfileNode & {readonly children?: ReadonlyArray<number>}>; samples?: ReadonlyArray<number>; timeDeltas?: ReadonlyArray<number>}, names: ReadonlyArray<string>): ReadonlyArray<string> {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const parent = new Map<number, number>();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const frame = (id: number | undefined): string => {
        const node = id === undefined ? undefined : byId.get(id);
        if (node === undefined) return "-";
        const file = node.callFrame.url.split("/").pop()?.split("?")[0] ?? "";
        return `${node.callFrame.functionName || "(anon)"}@${file}:${String(node.callFrame.lineNumber)}:${String((node.callFrame as {columnNumber?: number}).columnNumber ?? 0)}`;
    };
    const self = new Map<string, number>();
    (profile.samples ?? []).forEach((id, index) => {
        const node = byId.get(id);
        if (node === undefined || !names.includes(node.callFrame.functionName)) return;
        const up1 = parent.get(id);
        const up2 = up1 === undefined ? undefined : parent.get(up1);
        const up3 = up2 === undefined ? undefined : parent.get(up2);
        const up4 = up3 === undefined ? undefined : parent.get(up3);
        const key = `${node.callFrame.functionName} < ${frame(up1)} < ${frame(up2)} < ${frame(up3)} < ${frame(up4)}`;
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
    });
    return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, micros]) => `${String(Math.round(micros / 1000)).padStart(6)}ms ${name}`);
}

function topOf(profile: {nodes: ReadonlyArray<ProfileNode>; samples?: ReadonlyArray<number>; timeDeltas?: ReadonlyArray<number>}): ReadonlyArray<string> {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map<string, number>();
    (profile.samples ?? []).forEach((id, index) => {
        const node = byId.get(id);
        if (node === undefined) return;
        const file = node.callFrame.url.split("/").pop()?.split("?")[0] ?? "";
        const name = `${node.callFrame.functionName || "(anon)"} ${file}:${String(node.callFrame.lineNumber)}`;
        self.set(name, (self.get(name) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
    });
    return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, micros]) => `${String(Math.round(micros / 1000)).padStart(6)}ms ${name}`);
}

test("开销", async ({page}) => {
    test.setTimeout(8 * 60_000);
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    const folder = page.locator("[data-explorer-row=\"project://notes\"]");
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    const tabs = page.locator("[data-editor-tab]");
    for (const name of ["short", "long"]) {
        await page.locator(`[data-explorer-row="project://notes/${name}.md"]`).dblclick();
        await expect(tabs.filter({hasText: `${name}.md`})).toHaveCount(1);
    }
    await expect(page.locator("[data-editor-group-active] [data-editor-prose]")).toContainText("长章");
    await page.waitForTimeout(1500);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    const results: Record<string, unknown> = {};

    // 没按键，分区域划过：每块样式重算动了多少元素。
    const browser = page.context().browser();
    const leafBox = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
    const regions: Record<string, {x: number; y: number; width: number; height: number}> = {
        sidebar: await leafBox("[data-leaf=\"sidebar\"]"),
        editor: await leafBox("[data-editor-group-active]"),
        titlebar: await leafBox("[data-shell-titlebar]"),
    };
    const traces: Record<string, unknown> = {};
    for (const [name, area] of Object.entries(regions)) {
        await page.mouse.move(area.x + 5, area.y + 5);
        await browser?.startTracing(page, {categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"]});
        const cost = await measure(cdp, page, async () => {
            for (let round = 0; round < 6; round += 1) {
                await page.mouse.move(area.x + area.width - 10, area.y + area.height - 10, {steps: 40});
                await page.mouse.move(area.x + 10, area.y + 10, {steps: 40});
            }
        });
        const buffer = await browser?.stopTracing();
        const events = (JSON.parse(buffer?.toString() ?? "{}") as {traceEvents?: Array<{name: string; dur?: number; args?: {elementCount?: number}}>}).traceEvents ?? [];
        const sum = (event: string) => Math.round(events.filter((item) => item.name === event).reduce((total, item) => total + (item.dur ?? 0), 0) / 1000);
        const recalcs = events.filter((item) => item.name === "UpdateLayoutTree");
        const counts = recalcs.map((item) => item.args?.elementCount ?? 0).sort((a, b) => a - b);
        traces[name] = {...cost, recalcs: recalcs.length, elementsMedian: counts[Math.floor(counts.length / 2)] ?? 0, elementsMax: counts.at(-1) ?? 0, HitTest: sum("HitTest"), EventDispatch: sum("EventDispatch"), UpdateLayoutTree: sum("UpdateLayoutTree"), Layout: sum("Layout"), PrePaint: sum("PrePaint"), Paint: sum("Paint"), Layerize: sum("Layerize"), Commit: sum("Commit"), FunctionCall: sum("FunctionCall")};
    }
    results.regions = traces;

    // 没按键，划过整个界面。
    const across = [{x: 30, y: 60}, {x: 1400, y: 500}, {x: 200, y: 850}, {x: 1400, y: 60}, {x: 700, y: 400}];
    await cdp.send("Profiler.start");
    results.hover = await measure(cdp, page, () => sweep(page, across, 4, 40));
    const hoverProfile = await cdp.send("Profiler.stop") as {profile: {nodes: ReadonlyArray<ProfileNode>; samples?: ReadonlyArray<number>; timeDeltas?: ReadonlyArray<number>}};
    results.hoverTop = topOf(hoverProfile.profile);
    results.hoverCallers = callersOf(hoverProfile.profile, ["getBoundingClientRect", "caretPositionFromPoint", "elementsFromPoint", "elementFromPoint", "getClientRects", "getComputedStyle", "visitNode"]);

    const box = async (selector: string) => {
        const found = await page.locator(selector).first().boundingBox();
        if (found === null) throw new Error(`没有 ${selector}`);
        return found;
    };
    const body = await box("[data-editor-group-active]");
    const sidebar = await box("[data-leaf=\"sidebar\"]");
    const from = await tabs.filter({hasText: "short.md"}).boundingBox();
    if (from === null) throw new Error("没有标签");
    // 编辑器标签拖过工具面板：被拒绝。
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, {steps: 2});
    await cdp.send("Profiler.start");
    results.dragRejected = await measure(cdp, page, () => sweep(page, [{x: sidebar.x + 40, y: sidebar.y + 120}, {x: sidebar.x + sidebar.width - 40, y: sidebar.y + sidebar.height - 80}], 8, 25));
    const rejectedProfile = await cdp.send("Profiler.stop") as {profile: {nodes: ReadonlyArray<ProfileNode>; samples?: ReadonlyArray<number>; timeDeltas?: ReadonlyArray<number>}};
    results.dragRejectedTop = topOf(rejectedProfile.profile);
    // 拖过编辑组中央：并入或原位，来回走。
    await cdp.send("Profiler.start");
    results.dragCenter = await measure(cdp, page, () => sweep(page, [{x: body.x + body.width * 0.4, y: body.y + body.height * 0.4}, {x: body.x + body.width * 0.6, y: body.y + body.height * 0.6}], 8, 25));
    const centerProfile = await cdp.send("Profiler.stop") as {profile: {nodes: ReadonlyArray<ProfileNode>; samples?: ReadonlyArray<number>; timeDeltas?: ReadonlyArray<number>}};
    results.dragCenterTop = topOf(centerProfile.profile);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    const text = JSON.stringify(results, null, 2);
    console.log(text);
    if (process.env.T20_MEASURE_OUT !== undefined) await writeFile(process.env.T20_MEASURE_OUT, text);
});
