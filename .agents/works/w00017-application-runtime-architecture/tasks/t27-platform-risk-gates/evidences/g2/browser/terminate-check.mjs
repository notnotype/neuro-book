// 诊断：浏览器 worker.terminate() 后 JS 死循环与 WebAssembly 死循环是否真正停止。
// JS 循环用 SharedArrayBuffer 计数器直接观察；两种循环都同时看渲染进程 CPU。
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
    const cpu = async () => {
        const {processInfo} = await cdp.send("SystemInfo.getProcessInfo");
        return Object.fromEntries(processInfo.map((p) => [`${p.type}:${p.id}`, p.cpuTime * 1000]));
    };
    const cpuOver = async (ms) => {
        const a = await cpu(); await sleep(ms); const b = await cpu();
        return Object.entries(b).map(([k, v]) => [k, Math.round(v - (a[k] ?? 0))]).filter(([, v]) => v > 20).map(([k, v]) => `${k}=${v}`).join(" ");
    };
    console.log(`# ${new Date().toISOString()} ${browser.version()} crossOriginIsolated=${await page.evaluate(() => crossOriginIsolated)}`);
    console.log(`空闲 1s 各进程 CPU(ms)：${await cpuOver(1000)}`);
    await page.evaluate(() => {
        const src = `
            const WASM = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,8,1,4,115,112,105,110,0,0,10,9,1,7,0,3,64,12,0,11,11]);
            onmessage = (e) => {
                if (e.data.kind === "js") { const c = new Int32Array(e.data.sab); while (true) Atomics.add(c, 0, 1); }
                else new WebAssembly.Instance(new WebAssembly.Module(WASM)).exports.spin();
            };`;
        window.workerUrl = URL.createObjectURL(new Blob([src], {type: "text/javascript"}));
    });
    for (const kind of ["js", "wasm"]) {
        await page.evaluate((kind) => {
            window.sab = new SharedArrayBuffer(4);
            window.w = new Worker(window.workerUrl);
            window.w.postMessage({kind, sab: window.sab});
        }, kind);
        await sleep(300);
        const c1 = await page.evaluate(() => Atomics.load(new Int32Array(window.sab), 0));
        const busy = await cpuOver(1000);
        const t0 = Date.now();
        await page.evaluate(() => { window.w.terminate(); window.c0 = Atomics.load(new Int32Array(window.sab), 0); });
        const series = [];
        let last = 0;
        for (let i = 0; i < 5; i++) {
            const a = await cpu();
            const k0 = kind === "js" ? await page.evaluate(() => Atomics.load(new Int32Array(window.sab), 0)) : 0;
            await sleep(500);
            const b = await cpu();
            const k1 = kind === "js" ? await page.evaluate(() => Atomics.load(new Int32Array(window.sab), 0)) : 0;
            const r = Object.entries(b).filter(([k]) => k.startsWith("renderer")).reduce((x, [k, v]) => x + v - (a[k] ?? 0), 0);
            series.push(`${((Date.now() - t0) / 1000).toFixed(1)}s:CPU=${Math.round(r)}ms${kind === "js" ? `,计数+${k1 - k0}` : ""}`);
        }
        console.log(`${kind}：运行中 CPU ${busy}；terminate 后每 500ms 渲染进程 CPU：${series.join(" ")}`);
    }
} finally {
    await browser.close();
    server.kill();
}
