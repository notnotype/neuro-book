// 用仓库 node_modules 中的 playwright-core 驱动本机 Chrome，测浏览器端 worker 池。
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
const require = createRequire("/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/package.json");
const {chromium} = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("bun", [new URL("./server.mjs", import.meta.url).pathname], {stdio: ["ignore", "pipe", "inherit"]});
const port = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).trim()))));
const browser = await chromium.launch({executablePath: "/usr/bin/google-chrome-stable", headless: true});
try {
    const page = await browser.newPage();
    const cdp = await browser.newBrowserCDPSession();
    await page.goto(`http://127.0.0.1:${port}/browser/index.html`);
    await page.waitForFunction(() => window.__ready === true);
    console.log(`# ${new Date().toISOString()} ${browser.version()}（headless），页面 http://127.0.0.1:${port}`);
    const rendererCpu = async () => {
        const {processInfo} = await cdp.send("SystemInfo.getProcessInfo");
        return processInfo.filter((p) => p.type === "renderer").reduce((a, p) => a + p.cpuTime, 0) * 1000;
    };
    const cpuOver = async (ms) => { const c0 = await rendererCpu(); await sleep(ms); return (await rendererCpu()) - c0; };

    // 1. 冷启动、热调用
    const basic = await page.evaluate(async () => {
        const cold = [];
        for (let i = 0; i < 8; i++) {
            const pool = new BrowserWorkerPool({maxWorkers: 2});
            const t0 = performance.now();
            const r = await pool.forPlugin(`cold.${i}`).run(PLUGIN, {op: "echo", payload: i});
            cold.push(performance.now() - t0);
            if (!r.ok) return {error: r};
            await pool.close();
        }
        const pool = new BrowserWorkerPool({maxWorkers: 2});
        window.pool = pool;
        const w = pool.forPlugin("warm");
        await w.run(PLUGIN, {op: "echo", payload: 0});
        let t0 = performance.now();
        for (let i = 0; i < 1000; i++) await w.run(PLUGIN, {op: "echo", payload: i});
        const warmUs = (performance.now() - t0);
        return {coldAvg: cold.reduce((a, b) => a + b) / cold.length, coldMin: Math.min(...cold), coldMax: Math.max(...cold), warmUs, stats: pool.stats()};
    });
    console.log(`1 冷启动（创建 module worker + 加载宿主引导与插件模块 + 一次调用）：平均 ${basic.coldAvg.toFixed(2)}ms（${basic.coldMin.toFixed(1)}~${basic.coldMax.toFixed(1)}）；热调用往返平均 ${basic.warmUs.toFixed(0)}µs；池统计 ${JSON.stringify(basic.stats)}`);

    // 2. 中止：JS 死循环与 WebAssembly 死循环，调用方结算延迟与终止后的渲染进程 CPU
    for (const input of [{op: "spin", ms: -1}, {op: "block", kind: "wasm-loop"}]) {
        await page.evaluate((input) => {
            window.ctl = new AbortController();
            window.ticks = 0;
            window.tick = setInterval(() => window.ticks++, 10);
            window.pending = window.pool.forPlugin("busy").run(PLUGIN, input, {signal: window.ctl.signal});
        }, input);
        await sleep(300);
        const busyCpu = await cpuOver(1000);
        const settled = await page.evaluate(async () => {
            const t0 = performance.now();
            window.ctl.abort();
            const r = await window.pending;
            clearInterval(window.tick);
            return {r, ms: performance.now() - t0, ticks: window.ticks};
        });
        await sleep(200);
        const afterCpu = await cpuOver(1000);
        console.log(`2 中止 ${input.op === "spin" ? "JS 死循环" : "WebAssembly 死循环"}：结果 ${settled.r.error.code}/${settled.r.error.reason}，abort→结算 ${settled.ms.toFixed(2)}ms；死循环约 1.3s 期间页面主线程 10ms 定时器触发 ${settled.ticks} 次；渲染进程 CPU 终止前 ${busyCpu.toFixed(0)}ms/s → 终止后 ${afterCpu.toFixed(0)}ms/s`);
    }

    // 3. 禁用插件、错误形状、进度
    const rest = await page.evaluate(async () => {
        const out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const pool = new BrowserWorkerPool({maxWorkers: 4, maxWorkersPerPlugin: 2});
        const a = pool.forPlugin("acme.image-gen"), b = pool.forPlugin("acme.other");
        const aCalls = Array.from({length: 5}, () => a.run(PLUGIN, {op: "spin", ms: -1}));
        const bCall = b.run(PLUGIN, {op: "spin", ms: 400});
        await sleep(200);
        const t0 = performance.now();
        const disabled = pool.disablePlugin("acme.image-gen");
        const aResults = await Promise.all(aCalls);
        out.disable = {settleMs: performance.now() - t0, codes: [...new Set(aResults.map((r) => `${r.error.code}/${r.error.reason}`))]};
        await disabled;
        out.disable.after = await a.run(PLUGIN, {op: "echo", payload: 1});
        out.disable.other = (await bCall).ok;
        out.disable.live = pool.stats().live;
        const w = pool.forPlugin("errs");
        const strip = (r) => r.ok ? r : {ok: false, error: {...r.error, stack: r.error.stack ? "<stack>" : undefined}};
        out.errors = {
            throw: strip(await w.run(PLUGIN, {op: "throw", value: 7})),
            inputNotCloneable: strip(await w.run(PLUGIN, {op: "echo", payload: () => 1})),
            outputNotCloneable: strip(await w.run(PLUGIN, {op: "bad-output"})),
            noDefault: strip(await w.run(BROKEN("no-default.mjs"), {})),
            syntax: strip(await w.run(BROKEN("syntax.mjs"), {})),
            stillWorks: await w.run(PLUGIN, {op: "echo", payload: "ok"}),
        };
        const seen = [];
        const t1 = performance.now();
        const r = await w.run(PLUGIN, {op: "progress", count: 1000}, {onProgress: (v) => seen.push(v)});
        out.progress = {ms: performance.now() - t1, count: seen.length, ordered: seen.every((v, i) => v === i), r};
        await pool.close();
        return out;
    });
    console.log(`3 禁用：${JSON.stringify(rest.disable)}`);
    for (const [k, v] of Object.entries(rest.errors)) console.log(`  错误形状 ${k}：${JSON.stringify(v)}`);
    console.log(`  流式进度：${JSON.stringify(rest.progress)}`);
} finally {
    await browser.close();
    server.kill();
}
