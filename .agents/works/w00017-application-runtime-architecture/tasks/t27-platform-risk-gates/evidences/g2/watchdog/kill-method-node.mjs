// 主线程同步死循环时，从 worker 以不同方式结束整个进程，观察父进程看到的退出结果。
import {Worker} from "node:worker_threads";
const method = process.argv[2];
if (method === "sigterm") process.on("SIGTERM", () => console.log("main: SIGTERM handler 执行"));
process.on("exit", (c) => console.log(`main: exit 事件 code=${c}`));
const w = new Worker(new URL("./kill-method-worker-node.mjs", import.meta.url), {workerData: {method}});
w.on("exit", (c) => console.log(`main: worker exit 事件 code=${c}`));
w.on("error", (e) => console.log(`main: worker error ${e.message}`));
await new Promise((r) => setTimeout(r, 50));
const end = Date.now() + 3000;
while (Date.now() < end) {}
console.log("main: 3s 死循环结束，进程未被结束");
await new Promise((r) => setTimeout(r, 200));
process.exit(0);
