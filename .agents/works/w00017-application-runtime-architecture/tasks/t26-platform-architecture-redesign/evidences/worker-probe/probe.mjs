import {Worker} from "node:worker_threads";
const url = (f) => new URL(f, import.meta.url);
const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

// 1. 主线程能否在 worker 死循环时继续响应，terminate 能否打断死循环
let ticks = 0;
const timer = setInterval(() => ticks++, 10);
const busy = new Worker(url("./busy.mjs"));
await new Promise((r) => busy.once("message", r));
await new Promise((r) => setTimeout(r, 300));
console.log(`worker 死循环 300ms 期间主线程定时器触发 ${ticks} 次（期望约 30）`);
const t0 = performance.now();
const code = await busy.terminate();
console.log(`terminate 返回 exitCode=${code}，耗时 ${(performance.now() - t0).toFixed(1)}ms`);
clearInterval(timer);

// 2. 主线程自己同步阻塞时，定时器（也就是超时机制）是否失效
let fired = false;
setTimeout(() => { fired = true; }, 50);
const b0 = performance.now();
while (performance.now() - b0 < 500) {}
console.log(`主线程同步阻塞 500ms 后，50ms 定时器是否已触发：${fired}（阻塞期间不可能触发）`);
await new Promise((r) => setTimeout(r, 0));
console.log(`让出一次事件循环后：${fired}`);

// 3. worker 启动耗时、往返延迟、内存开销
const base = rss();
const s0 = performance.now();
const workers = [];
for (let i = 0; i < 5; i++) {
  const w = new Worker(url("./idle.mjs"));
  await new Promise((r) => w.once("message", r));
  workers.push(w);
}
console.log(`启动 5 个空 worker 平均 ${((performance.now() - s0) / 5).toFixed(1)}ms/个，RSS 增加约 ${Math.round((rss() - base) / 5)}MB/个`);
const r0 = performance.now();
for (let i = 0; i < 1000; i++) {
  await new Promise((r) => { workers[0].once("message", r); workers[0].postMessage({i, payload: "x".repeat(200)}); });
}
console.log(`1000 次 postMessage 往返平均 ${((performance.now() - r0) / 1000 * 1000).toFixed(0)}µs`);
for (const w of workers) await w.terminate();
console.log(`bun ${Bun.version}`);
