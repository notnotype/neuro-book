// WebAssembly 长循环能否被 worker.terminate() 打断：有限循环（约数秒）与无限循环，Bun 与 Node 对照。
import {Worker} from "node:worker_threads";
import {readFileSync} from "node:fs";
const COUNTDOWN = [0,97,115,109,1,0,0,0, 1,5,1,96,1,127,0, 3,2,1,0, 7,8,1,4,115,112,105,110,0,0, 10,16,1,14,0,3,64,32,0,65,1,107,34,0,13,0,11,11];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`;
const cpuMs = () => { const f = readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" "); return (Number(f[11]) + Number(f[12])) * 10; };
// 主线程直接跑一次，得到有限循环的自然耗时
const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(COUNTDOWN)));
let t = performance.now();
inst.exports.spin(-1);
const natural = performance.now() - t;
console.log(`# ${new Date().toISOString()} ${runtime}；wasm 倒计数 2^32 次的自然耗时 ${natural.toFixed(0)}ms`);
const src = `
const {parentPort, workerData} = require("node:worker_threads");
const m = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(workerData.bytes)));
parentPort.postMessage("start");
if (workerData.kind === "finite") m.exports.spin(-1);
else while (true) m.exports.spin(-1);
parentPort.postMessage("wasm-returned");
`;
for (const kind of ["finite", "infinite-js-outer-loop"]) {
    const w = new Worker(src, {eval: true, workerData: {bytes: COUNTDOWN, kind}});
    await new Promise((r) => w.once("message", r));
    await sleep(300);
    const exited = new Promise((r) => w.once("exit", r));
    const c0 = cpuMs();
    t = performance.now();
    void w.terminate();
    const res = await Promise.race([exited.then(() => "exit"), sleep(8000).then(() => "timeout")]);
    console.log(`${kind}: terminate 后 ${res === "exit" ? `${(performance.now() - t).toFixed(0)}ms 退出` : "8 秒内未退出"}；期间进程 CPU ${cpuMs() - c0}ms`);
}
process.exit(0);
