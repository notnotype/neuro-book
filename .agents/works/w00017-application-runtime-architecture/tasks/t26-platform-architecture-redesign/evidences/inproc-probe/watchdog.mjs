import {Worker} from "node:worker_threads";
const sab = new SharedArrayBuffer(8);
const beat = new Int32Array(sab, 0, 1), inflight = new Int32Array(sab, 4, 1);
const report = new URL("./hang-report.json", import.meta.url).pathname;
new Worker(new URL("./watchdog-worker.mjs", import.meta.url), {workerData: {sab, limitMs: 1000, report}}).unref();
setInterval(() => Atomics.add(beat, 0, 1), 100);                 // 主线程心跳
await new Promise((r) => setTimeout(r, 500));
console.log("主线程开始调用插件 7 的同步死循环");
Atomics.store(inflight, 0, 7);
while (true) {}
