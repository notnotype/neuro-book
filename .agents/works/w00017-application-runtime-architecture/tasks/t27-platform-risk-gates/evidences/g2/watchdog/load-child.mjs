// 被测进程：mode = idle | load；wd = none | 参数 JSON。结束前把看门狗统计打印到 stdout。
import {startMainThreadWatchdog} from "./watchdog-host.mjs";
const [mode, wdJson, durationMs] = process.argv.slice(2);
const wd = wdJson === "none" ? null : startMainThreadWatchdog({reportPath: "/dev/null", exitMethod: "none", ...JSON.parse(wdJson)});
const keep = setInterval(() => {}, 1000);
const blocks = [];
if (mode === "load") {
    // 主线程偶发 200~500ms 同步任务，间隔 0~300ms；同时大量分配以触发 GC
    let garbage = [];
    const step = () => {
        const ms = 200 + Math.random() * 300;
        const end = performance.now() + ms;
        while (performance.now() < end) { garbage.push({a: new Array(64).fill(Math.random())}); if (garbage.length > 20000) garbage = []; }
        blocks.push(ms);
        setTimeout(step, Math.random() * 300);
    };
    step();
}
setTimeout(async () => {
    const stats = wd ? await wd.stats() : null;
    console.log(JSON.stringify({mode, blocks: blocks.length, maxBlockMs: blocks.length ? Math.round(Math.max(...blocks)) : 0, stats}));
    process.exit(0);
}, Number(durationMs));
