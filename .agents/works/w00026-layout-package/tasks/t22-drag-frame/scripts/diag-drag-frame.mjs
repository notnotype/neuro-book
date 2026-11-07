// 临时诊断：拖动时每帧几次样式重算，谁触发的。开发服务是未压缩的，函数名和行号可读。不提交事务：Escape 取消。
import {createRequire} from "node:module";
import {writeFileSync} from "node:fs";
const require = createRequire("/home/notnotype/CodeRepository/neuro-book/package.json");
const {chromium} = require("playwright");

const URL_ = process.env.DIAG_URL ?? "http://127.0.0.1:4217/?project=sample";
const out = process.env.DIAG_OUT ?? "/tmp/w00026-drag-diag/result.json";
const browser = await chromium.launch({headless: true, channel: "chrome"});
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: "no-preference", colorScheme: "light"});
const page = await context.newPage();
await page.goto(URL_);
await page.waitForSelector("[data-workbench-root][data-rpc-state='online']", {timeout: 60000});
await page.waitForTimeout(3000);

const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const metric = async () => {
    const {metrics} = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.filter((m) => ["RecalcStyleCount", "LayoutCount", "RecalcStyleDuration", "LayoutDuration", "ScriptDuration", "TaskDuration"].includes(m.name)).map((m) => [m.name, m.value]));
};

/** 数 rAF：换算每帧几次。 */
async function frames(run) {
    await page.evaluate(() => {
        window.__frames = 0;
        window.__moves = 0;
        window.__counting = true;
        const tick = () => {
            if (!window.__counting) return;
            window.__frames += 1;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        window.__onMove = () => { window.__moves += 1; };
        window.addEventListener("pointermove", window.__onMove, true);
    });
    const before = await metric();
    const started = Date.now();
    await run();
    const wall = Date.now() - started;
    const after = await metric();
    const counted = await page.evaluate(() => {
        window.__counting = false;
        window.removeEventListener("pointermove", window.__onMove, true);
        return {frames: window.__frames, moves: window.__moves};
    });
    const recalc = after.RecalcStyleCount - before.RecalcStyleCount;
    const layouts = after.LayoutCount - before.LayoutCount;
    return {
        wall,
        ...counted,
        recalc,
        layouts,
        recalcPerFrame: +(recalc / Math.max(1, counted.frames)).toFixed(2),
        recalcPerMove: +(recalc / Math.max(1, counted.moves)).toFixed(2),
        layoutPerFrame: +(layouts / Math.max(1, counted.frames)).toFixed(2),
        recalcPerSecond: Math.round(recalc * 1000 / wall),
        styleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000),
        layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000),
        scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
        taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
    };
}

/** 轨迹：每次样式重算是谁强制的，元素数多少。 */
async function traced(run) {
    await browser.startTracing(page, {categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack"]});
    await run();
    const buffer = await browser.stopTracing();
    const events = JSON.parse(buffer.toString()).traceEvents ?? [];
    const recalcs = events.filter((e) => e.name === "UpdateLayoutTree" && e.ph === "X");
    const layouts = events.filter((e) => e.name === "Layout" && e.ph === "X");
    const group = (list) => {
        const byCaller = new Map();
        for (const e of list) {
            const stack = e.args?.beginData?.stackTrace ?? e.args?.data?.stackTrace ?? [];
            const frames = stack.slice(0, 4).map((f) => `${f.functionName || "(anon)"}@${(f.url ?? "").split("/").pop()?.split("?")[0]}:${f.lineNumber}`);
            const key = frames.length === 0 ? "(帧循环，非强制)" : frames.join(" < ");
            const cur = byCaller.get(key) ?? {count: 0, ms: 0, elements: 0};
            cur.count += 1;
            cur.ms += (e.dur ?? 0) / 1000;
            cur.elements += e.args?.elementCount ?? 0;
            byCaller.set(key, cur);
        }
        return [...byCaller.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 18).map(([k, v]) => `${String(v.count).padStart(5)}次 ${v.ms.toFixed(0).padStart(5)}ms 平均${Math.round(v.elements / v.count)}元素  ${k}`);
    };
    const sum = (name) => Math.round(events.filter((e) => e.name === name && e.ph === "X").reduce((t, e) => t + (e.dur ?? 0), 0) / 1000);
    const names = ["FunctionCall", "EventDispatch", "HitTest", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "RasterTask", "CompositeLayers", "UpdateLayer", "IntersectionObserverController::computeIntersections", "ResizeObserverController::BroadcastObservations"];
    const mainThreads = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
    const byName = new Map();
    for (const e of events) {
        if (e.ph !== "X" || !mainThreads.has(`${e.pid}:${e.tid}`)) continue;
        byName.set(e.name, (byName.get(e.name) ?? 0) + (e.dur ?? 0) / 1000);
    }
    const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([n, ms]) => `${String(Math.round(ms)).padStart(6)}ms ${n}`);
    return {top, recalcs: recalcs.length, layouts: layouts.length, sums: Object.fromEntries(names.map((n) => [n, sum(n)])), recalcBy: group(recalcs), layoutBy: group(layouts)};
}

const box = async (selector) => {
    const found = await page.locator(selector).first().boundingBox();
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const sweep = async (points, rounds, steps) => {
    for (let round = 0; round < rounds; round += 1) for (const p of points) await page.mouse.move(p.x, p.y, {steps});
};

const results = {};
results.tabs = await page.evaluate(() => [...document.querySelectorAll("[data-panel-tab]")].map((el) => el.dataset.panelTab));

// 空闲对照：不动鼠标。
results.idle = await frames(async () => { await page.waitForTimeout(1500); });

const tab = page.locator("[data-panel-head='sidebar'] [data-panel-tab]").first();
const from = await tab.boundingBox();
if (from === null) throw new Error("没有侧栏标签");
const editor = await box("[data-leaf][data-panel-id], [data-editor-group-active]").catch(() => null);
const aux = await box("[data-leaf='auxiliarybar']").catch(() => null);
results.boxes = {from, editor, aux};
const across = [
    {x: 700, y: 400}, {x: 1300, y: 300}, {x: 1000, y: 600}, {x: 300, y: 300}, {x: 900, y: 200},
];

// 拖动：指针一直在动（快速移动）。
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(from.x + from.width / 2 + 30, from.y + 60, {steps: 4});
await page.waitForTimeout(300);
results.dragMoving = await frames(() => sweep(across, 3, 40));
results.dragTrace = await traced(() => sweep(across, 2, 40));
// 指针不动：帧循环自己的开销。
results.dragStill = await frames(async () => { await page.waitForTimeout(1500); });
await page.keyboard.press("Escape");
await page.mouse.up();
await page.waitForTimeout(500);

// 编辑器标签：先确认有标签。
const editorTab = page.locator("[data-editor-tab]").first();
if (await editorTab.count() > 0) {
    const at = await editorTab.boundingBox();
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 + 30, at.y + 60, {steps: 4});
    await page.waitForTimeout(300);
    results.editorDrag = await frames(() => sweep(across, 2, 40));
    results.editorTrace = await traced(() => sweep(across, 1, 40));
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(500);
}

// 不按键划过：对照。
results.hover = await frames(() => sweep(across, 3, 40));
results.hoverTrace = await traced(() => sweep(across, 2, 40));

writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
