// 作为 PID 命名空间的 1 号进程时，从 worker 自发 SIGKILL 与 ffi _exit 是否还能结束进程。
import {Worker} from "node:worker_threads";
const method = process.argv[2];
console.log(`pid=${process.pid} method=${method}`);
new Worker(new URL("./kill-method-worker.mjs", import.meta.url), {workerData: {method}});
await new Promise((r) => setTimeout(r, 50));
const end = Date.now() + 2000;
while (Date.now() < end) {}
console.log("main: 2s 死循环结束，进程未被结束");
process.exit(0);
