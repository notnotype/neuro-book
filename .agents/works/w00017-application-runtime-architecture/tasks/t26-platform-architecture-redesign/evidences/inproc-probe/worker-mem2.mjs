import {Worker} from "node:worker_threads";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
const req = createRequire("/home/notnotype/CodeRepository/neuro-book/packages/neuro-book/package.json");
const mode = process.argv[2]; const n = 10;
const libs = mode === "empty" ? [] : ["zod", "yaml", "marked", "dayjs", "vue"].map((m) => pathToFileURL(req.resolve(m)).href);
const rss = () => process.memoryUsage().rss / 1048576;
await new Promise((r) => setTimeout(r, 300));
const base = rss(); const ws = [];
for (let i = 0; i < n; i++) { const w = new Worker(new URL("./libworker.mjs", import.meta.url), {workerData: {urls: libs}}); await new Promise((r) => w.once("message", r)); ws.push(w); }
await new Promise((r) => setTimeout(r, 800));
console.log(`${mode}：主进程 ${base.toFixed(1)}MB，${n} 个 worker 后 ${rss().toFixed(1)}MB，每个约 +${((rss() - base) / n).toFixed(1)}MB`);
process.exit(0);
