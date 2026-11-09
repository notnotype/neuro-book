// 临时诊断：不按键划过时，谁排了分隔线对齐那一帧。RequestAnimationFrame 事件带排它的调用栈。
import {createRequire} from "node:module";
const require = createRequire("/home/notnotype/CodeRepository/neuro-book/package.json");
const {chromium} = require("playwright");
const URL_ = process.env.DIAG_URL ?? "http://127.0.0.1:4217/?project=sample";
const browser = await chromium.launch({headless: true, channel: "chrome"});
const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: "no-preference", colorScheme: "light"});
const page = await context.newPage();
await page.goto(URL_);
await page.waitForSelector("[data-workbench-root][data-rpc-state='online']", {timeout: 60000});
await page.waitForTimeout(3000);
const across = [{x: 700, y: 400}, {x: 1300, y: 300}, {x: 1000, y: 600}, {x: 300, y: 300}, {x: 900, y: 200}];
await browser.startTracing(page, {categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack"]});
for (let round = 0; round < 2; round += 1) for (const p of across) await page.mouse.move(p.x, p.y, {steps: 40});
const buffer = await browser.stopTracing();
const events = JSON.parse(buffer.toString()).traceEvents ?? [];
const fmt = (f) => `${f.functionName || "(anon)"}@${(f.url ?? "").split("/").pop()?.split("?")[0]}:${f.lineNumber}`;
const byCaller = new Map();
let total = 0;
for (const e of events) {
    if (e.name !== "RequestAnimationFrame") continue;
    total += 1;
    const stack = e.args?.data?.stackTrace ?? [];
    const key = stack.slice(0, 7).map(fmt).join(" < ") || "(无栈)";
    byCaller.set(key, (byCaller.get(key) ?? 0) + 1);
}
console.log("rAF 请求", total);
for (const [k, n] of [...byCaller.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(n).padStart(5), k);
await browser.close();
