// 服务端 worker 池原型的行为与性能测量（Bun）。
import {Worker} from "node:worker_threads";
import {cpSync, mkdirSync} from "node:fs";
import {WorkerPool} from "./worker-pool.mjs";

const here = new URL(".", import.meta.url);
const A = new URL("./plugin-demo/dist/worker.mjs", here).href;
mkdirSync(new URL("./plugin-b/dist/", here), {recursive: true});
cpSync(new URL("./plugin-demo/dist/worker.mjs", here), new URL("./plugin-b/dist/worker.mjs", here));
const B = new URL("./plugin-b/dist/worker.mjs", here).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (v) => `${v.toFixed(2)}ms`;
const log = (...a) => console.log(...a);
log(`# ${new Date().toISOString()} ${process.platform} bun ${Bun.version}`);

// 1. 冷启动与热调用
{
    const cold = [];
    for (let i = 0; i < 8; i++) {
        const pool = new WorkerPool({maxWorkers: 2});
        const t0 = performance.now();
        const r = await pool.forPlugin(`cold.${i}`).run(A, {op: "echo", payload: i});
        cold.push(performance.now() - t0);
        if (!r.ok) throw new Error(JSON.stringify(r));
        await pool.close();
    }
    log(`1 冷启动（创建 worker + 加载 1.6KB 插件模块 + 一次调用）：平均 ${ms(avg(cold))}，最小 ${ms(Math.min(...cold))}，最大 ${ms(Math.max(...cold))}`);
    const pool = new WorkerPool({maxWorkers: 2});
    const w = pool.forPlugin("warm");
    await w.run(A, {op: "echo", payload: 0});
    for (const [label, payload] of [["小输入", 1], ["1KB 字符串", "x".repeat(1024)], ["1MB 字符串", "x".repeat(1 << 20)]]) {
        const n = label.startsWith("1MB") ? 100 : 1000;
        const t0 = performance.now();
        for (let i = 0; i < n; i++) await w.run(A, {op: "echo", payload});
        log(`  热调用往返（${label}，串行 ${n} 次）：平均 ${((performance.now() - t0) / n * 1000).toFixed(0)}µs`);
    }
    const buf = new ArrayBuffer(64 << 20);
    let t0 = performance.now();
    await w.run(A, {op: "bytes", size: 1, blob: new Uint8Array(buf)});
    const copyMs = performance.now() - t0;
    t0 = performance.now();
    await w.run(A, {op: "bytes", size: 1, blob: buf}, {transfer: [buf]});
    log(`  64MB 输入：结构化克隆复制 ${ms(copyMs)}，transfer 移交 ${ms(performance.now() - t0)}（移交后本端 byteLength=${buf.byteLength}）`);
    log(`  池统计：${JSON.stringify(pool.stats())}（同一插件同一模块 ${2 + 1000 + 1000 + 100 + 2} 次调用只创建 1 个 worker）`);
    await pool.close();
}

// 2. 中止：CPU 死循环中 signal 中止 → 结算“已中断”的延迟、线程真正退出的延迟、主线程是否一直可响应
{
    const pool = new WorkerPool({maxWorkers: 2});
    const w = pool.forPlugin("spinner");
    await w.run(A, {op: "echo", payload: 0});
    const settle = [], exitLat = [];
    for (let i = 0; i < 10; i++) {
        const controller = new AbortController();
        let ticks = 0;
        const timer = setInterval(() => ticks++, 10);
        const p = w.run(A, {op: "spin", ms: -1}, {signal: controller.signal});
        await sleep(200);
        const record = [...pool.workers].find((x) => x.state === "busy");
        const t0 = performance.now();
        controller.abort();
        const r = await p;
        settle.push(performance.now() - t0);
        await record.exited;
        exitLat.push(performance.now() - t0);
        clearInterval(timer);
        if (r.ok || r.error.code !== "interrupted") throw new Error(JSON.stringify(r));
        if (i === 0) log(`2 中止：结果 ${JSON.stringify(r)}；死循环 200ms 期间主线程 10ms 定时器触发 ${ticks} 次`);
    }
    log(`  abort() → 调用方得到结果：平均 ${ms(avg(settle))}；abort() → worker 线程 exit：平均 ${ms(avg(exitLat))}，最大 ${ms(Math.max(...exitLat))}`);
    log(`  池统计：${JSON.stringify(pool.stats())}`);
    await pool.close();
}

// 3. 各类阻塞能否被 terminate() 打断（直接用 Worker，5 秒内未退出记为不能）
{
    log("3 terminate() 能否打断不同阻塞（运行 300ms 后终止）：");
    for (const kind of ["spin", "atomics-wait", "sleep-sync", "regex", "wasm-loop", "sort"]) {
        const worker = new Worker(new URL("./worker-host.mjs", here), {workerData: {moduleUrl: A}});
        await new Promise((r) => worker.once("message", r));
        worker.postMessage({type: "run", callId: 1, input: kind === "spin" ? {op: "spin", ms: -1} : {op: "block", kind}});
        await sleep(300);
        const exited = new Promise((r) => worker.once("exit", (code) => r(code)));
        const t0 = performance.now();
        void worker.terminate();
        const code = await Promise.race([exited, sleep(5000).then(() => "timeout")]);
        log(`  ${kind}: ${code === "timeout" ? "5 秒内未退出" : `退出 exitCode=${code}，${ms(performance.now() - t0)}`}`);
        if (code === "timeout") log(`    （该 worker 仍在运行；进程结束时由 process.exit 回收）`);
    }
}

// 4. 池上限、插件上限与排队
{
    const pool = new WorkerPool({maxWorkers: 3, maxWorkersPerPlugin: 2});
    const t0 = performance.now();
    const jobs = [];
    for (let i = 0; i < 9; i++) {
        const plugin = ["p1", "p2", "p3"][i % 3];
        jobs.push(pool.forPlugin(plugin).run(A, {op: "spin", ms: 200}));
    }
    const results = await Promise.all(jobs);
    log(`4 上限：maxWorkers=3、每插件 2，9 个 200ms 任务（3 个插件）用时 ${ms(performance.now() - t0)}，全部成功=${results.every((r) => r.ok)}，统计 ${JSON.stringify(pool.stats())}`);
    const controller = new AbortController();
    const blockers = [0, 1, 2].map((i) => pool.forPlugin(`q${i}`).run(A, {op: "spin", ms: 500}));
    const queued = pool.forPlugin("q-late").run(A, {op: "spin", ms: 10}, {signal: controller.signal});
    await sleep(50);
    const q0 = pool.stats().queued;
    const ta = performance.now();
    controller.abort();
    const qr = await queued;
    log(`  排队中的调用被中止：排队数 ${q0}，结果 ${qr.error?.code}/${qr.error?.reason}，${ms(performance.now() - ta)} 结算，未创建 worker`);
    await Promise.all(blockers);
    await pool.close();
}

// 5. 禁用插件：在途与排队的调用全部以“已中断(plugin-disabled)”结算，其它插件不受影响
{
    const pool = new WorkerPool({maxWorkers: 4, maxWorkersPerPlugin: 2});
    const a = pool.forPlugin("acme.image-gen");
    const b = pool.forPlugin("acme.other");
    const aCalls = Array.from({length: 5}, () => a.run(A, {op: "spin", ms: -1}));
    const bCall = b.run(B, {op: "spin", ms: 600});
    await sleep(200);
    const aWorkers = [...pool.workers].filter((w) => w.pluginId === "acme.image-gen").length;
    const t0 = performance.now();
    const disabled = pool.disablePlugin("acme.image-gen");
    const aResults = await Promise.all(aCalls);
    const settledMs = performance.now() - t0;
    await disabled;
    const exitedMs = performance.now() - t0;
    const after = await a.run(A, {op: "echo", payload: 1});
    const bResult = await bCall;
    log(`5 禁用：插件 A 有 ${aWorkers} 个忙碌 worker + ${5 - aWorkers} 个排队；全部结算 ${ms(settledMs)}，worker 全部退出 ${ms(exitedMs)}；结果 ${JSON.stringify([...new Set(aResults.map((r) => `${r.error.code}/${r.error.reason}`))])}`);
    log(`  禁用后再调用：${JSON.stringify(after)}；插件 B 的调用：ok=${bResult.ok}；剩余 worker ${pool.stats().live}`);
    await pool.close();
}

// 6. 错误与流式进度
{
    const pool = new WorkerPool({maxWorkers: 2});
    const w = pool.forPlugin("errs");
    log("6 错误形状：");
    log(`  插件代码抛错：${JSON.stringify(strip(await w.run(A, {op: "throw", value: 7})))}`);
    log(`  输入不可克隆：${JSON.stringify(strip(await w.run(A, {op: "echo", payload: () => 1})))}`);
    log(`  输出不可克隆：${JSON.stringify(strip(await w.run(A, {op: "bad-output"})))}`);
    log(`  插件代码 process.exit(3)：${JSON.stringify(strip(await w.run(A, {op: "exit"})))}`);
    log(`  模块缺少 default 导出：${JSON.stringify(strip(await w.run(new URL("./plugin-broken/no-default.mjs", here).href, {})))}`);
    log(`  模块语法错误：${JSON.stringify(strip(await w.run(new URL("./plugin-broken/syntax.mjs", here).href, {})))}`);
    log(`  出错后同插件仍可用：${JSON.stringify(await w.run(A, {op: "echo", payload: "ok"}))}`);
    const seen = [];
    const t0 = performance.now();
    const r = await w.run(A, {op: "progress", count: 1000}, {onProgress: (v) => seen.push(v)});
    log(`  流式进度：1000 条进度 + 结果 ${ms(performance.now() - t0)}，收到 ${seen.length} 条，顺序正确=${seen.every((v, i) => v === i)}，结果=${JSON.stringify(r)}`);
    const c = new AbortController();
    const late = [];
    const pr = w.run(A, {op: "spin", ms: -1}, {signal: c.signal, onProgress: (v) => late.push(v)});
    await sleep(300);
    const before = late.length;
    c.abort();
    await pr;
    await sleep(100);
    log(`  中止后不再回调进度：中止前 ${before} 条，中止后新增 ${late.length - before} 条`);
    await pool.close();
}
// 7. 中止一个卡在 WebAssembly 死循环里的调用：调用方立即得到“已中断”，但 worker 线程不退出、继续占用 CPU 与池名额
{
    const pool = new WorkerPool({maxWorkers: 2});
    const c = new AbortController();
    const p = pool.forPlugin("wasm-heavy").run(A, {op: "block", kind: "wasm-loop"}, {signal: c.signal});
    await sleep(300);
    const t0 = performance.now();
    c.abort();
    const r = await p;
    log(`7 WebAssembly 死循环：中止后 ${ms(performance.now() - t0)} 得到 ${r.error?.code}/${r.error?.reason}`);
    await sleep(3000);
    log(`  3 秒后池统计：${JSON.stringify(pool.stats())}（live=1 即未退出的 worker 仍占名额）`);
    const other = await pool.forPlugin("other").run(A, {op: "echo", payload: "仍可服务"});
    log(`  其它插件调用：${JSON.stringify(other)}`);
}
process.exit(0);

function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function strip(r) { return r.ok ? r : {ok: false, error: {...r.error, stack: r.error.stack ? "<stack>" : undefined}}; }
