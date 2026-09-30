// G1 诊断：卸载插件并强制 GC 后抓取 Chromium 堆快照，列出插件组件对象（__name === "G1Widget"）
// 到 GC 根的最短保留路径，用来区分“做法本身无法回收”与“宿主或依赖库残留引用”。
// 用法：node g1-heap.mjs --url <url> --approach esm|cjs --out <file.json> [--cdp <endpoint>]
import {writeFile} from "node:fs/promises";
import {createRequire} from "node:module";

const require = createRequire(process.env.G1_PLAYWRIGHT_FROM ?? import.meta.url);
const {chromium} = require("playwright-core");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), list[index + 1]]);
    return pairs;
}, []));

const browser = args.cdp
    ? await chromium.connectOverCDP(args.cdp)
    : await chromium.launch({executablePath: "/usr/bin/google-chrome-stable", headless: true});
const context = args.cdp ? browser.contexts()[0] : await browser.newContext();
const page = args.cdp ? (context.pages()[0] ?? await context.newPage()) : await context.newPage();
const cdp = await context.newCDPSession(page);
const a = args.approach;
const interact = args.interact ?? "full";

await page.goto(args.url, {waitUntil: "load"});
await page.waitForFunction(() => window.__G1__?.ready === true);
// Vue 开发构建在没有 devtools 时缓冲前 3 秒的组件事件（含组件对象），等它清空。
await page.waitForTimeout(3500);
await page.click(`[data-testid=load-${a}]`);
await page.locator(`[data-g1-plugin=${a}]`).waitFor();
if (interact !== "none") {
    await page.click(`[data-g1-plugin=${a}] [data-testid=plain-inc]`);
}
if (interact === "full" || interact === "popover") {
    await page.click(`[data-g1-plugin=${a}] [data-testid=popover-trigger]`);
    await page.locator(`[data-testid=popover-body-${a}]`).waitFor({state: "visible"});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
}
if (interact === "full" || interact === "tooltip") {
    await page.hover(`[data-g1-plugin=${a}] [data-testid=tooltip-trigger]`);
    await page.locator(".nb-ui-tooltip-surface").waitFor({state: "visible"});
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
}
await page.click(`[data-testid=unload-${a}]`);
await page.waitForFunction((x) => document.querySelectorAll(`[data-g1-plugin=${x}]`).length === 0, a);
// 让焦点离开，并等待 reka 的延迟清理计时器。
await page.mouse.click(2, 2);
await page.waitForTimeout(1500);
await cdp.send("Runtime.discardConsoleEntries").catch(() => {});
for (let i = 0; i < 4; i += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(100);
}
const collected = await page.evaluate((x) => {
    const weak = window.__G1__.weak[x] ?? {};
    return {component: weak.component ? weak.component.deref() === undefined : null, factory: weak.factory ? weak.factory.deref() === undefined : null};
}, a);

let chunks = [];
cdp.on("HeapProfiler.addHeapSnapshotChunk", ({chunk}) => chunks.push(chunk));
await cdp.send("HeapProfiler.takeHeapSnapshot", {reportProgress: false, captureNumericValue: false});
const snapshot = JSON.parse(chunks.join(""));
chunks = [];

const {meta} = snapshot.snapshot;
const nodeFields = meta.node_fields;
const edgeFields = meta.edge_fields;
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const NF = nodeFields.length;
const EF = edgeFields.length;
const nodes = snapshot.nodes;
const edges = snapshot.edges;
const strings = snapshot.strings;
const nType = nodeFields.indexOf("type");
const nName = nodeFields.indexOf("name");
const nEdgeCount = nodeFields.indexOf("edge_count");
const eType = edgeFields.indexOf("type");
const eName = edgeFields.indexOf("name_or_index");
const eTo = edgeFields.indexOf("to_node");
const nodeCount = nodes.length / NF;
const firstEdge = new Uint32Array(nodeCount + 1);
for (let i = 0, e = 0; i < nodeCount; i += 1) {
    firstEdge[i] = e;
    e += nodes[i * NF + nEdgeCount] * EF;
    firstEdge[i + 1] = e;
}
const nodeLabel = (i) => `${nodeTypes[nodes[i * NF + nType]]}:${String(strings[nodes[i * NF + nName]]).slice(0, 80)}`;
const edgeLabel = (e) => {
    const type = edgeTypes[edges[e + eType]];
    const raw = edges[e + eName];
    return `${type}:${type === "element" || type === "hidden" ? raw : String(strings[raw]).slice(0, 60)}`;
};

// 目标：带 __name 属性且值为 "G1Widget" 的对象。
const targets = [];
for (let i = 0; i < nodeCount; i += 1) {
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
        if (edgeTypes[edges[e + eType]] === "property" && strings[edges[e + eName]] === "__name") {
            const to = edges[e + eTo] / NF;
            if (strings[nodes[to * NF + nName]] === "G1Widget") targets.push(i);
        }
    }
}

// 从根出发做 BFS，跳过弱边与 WeakMap 表项，得到每个目标的最短强引用路径。
const parent = new Int32Array(nodeCount).fill(-1);
const parentEdge = new Int32Array(nodeCount).fill(-1);
const seen = new Uint8Array(nodeCount);
const queue = [0];
seen[0] = 1;
for (let q = 0; q < queue.length; q += 1) {
    const i = queue[q];
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += EF) {
        const type = edgeTypes[edges[e + eType]];
        if (type === "weak" || type === "shortcut") continue;
        // WeakMap 的 ephemeron 表项只在键存活时保留值；按强边处理会得到假路径。
        if (type === "internal" && String(strings[edges[e + eName]]).includes("part of key")) continue;
        const to = edges[e + eTo] / NF;
        if (seen[to]) continue;
        seen[to] = 1;
        parent[to] = i;
        parentEdge[to] = e;
        queue.push(to);
    }
}
const paths = targets.map((t) => {
    if (!seen[t]) return {reachable: false};
    const steps = [];
    for (let cur = t; cur !== 0 && steps.length < 60; cur = parent[cur]) {
        steps.push(`${nodeLabel(parent[cur])} --${edgeLabel(parentEdge[cur])}--> ${nodeLabel(cur)}`);
    }
    return {reachable: true, path: steps.reverse()};
});

const result = {url: args.url, approach: a, interact, collected, targetCount: targets.length, paths};
await writeFile(args.out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({approach: a, interact, collected, targetCount: targets.length, reachable: paths.map((p) => p.reachable)}));
for (const p of paths) if (p.reachable) console.log(p.path.join("\n"));
if (!args.cdp) await browser.close();
process.exit(0);
