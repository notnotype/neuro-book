import {Worker} from "node:worker_threads";
const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
// 4. worker 内存超限时，是否只死 worker、主进程存活；terminate 后内存是否回收
const before = rss();
const w = new Worker(new URL("./hog.mjs", import.meta.url), {resourceLimits: {maxOldGenerationSizeMb: 64}});
let last = -1, outcome = "running";
w.on("message", (m) => { if (typeof m === "number") last = m; else outcome = m; });
w.on("error", (e) => { outcome = `worker error: ${e.message.slice(0, 80)}`; });
const exitCode = await new Promise((r) => w.once("exit", r));
console.log(`限额 64MB：最后分配到第 ${last} 块（每块约 10MB），结果=${outcome}，exit=${exitCode}，主进程存活`);
const peak = rss();
Bun.gc(true);
await new Promise((r) => setTimeout(r, 200));
Bun.gc(true);
console.log(`RSS：开始 ${before}MB，worker 结束时 ${peak}MB，GC 后 ${rss()}MB`);
