// 能否从 worker 经 node:inspector 取得正在死循环的主线程 JS 栈（用于把卡死归属到插件文件）。
import {Worker} from "node:worker_threads";
new Worker(new URL("./stack-probe-worker.mjs", import.meta.url));
await new Promise((r) => setTimeout(r, 100));
function pluginHotLoop() {
    const end = Date.now() + 3000;
    while (Date.now() < end) { /* 模拟插件同步计算 */ }
}
pluginHotLoop();
console.log("main: 死循环结束");
process.exit(0);
