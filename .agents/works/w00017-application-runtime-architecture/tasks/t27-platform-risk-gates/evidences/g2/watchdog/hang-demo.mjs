// 三种卡死：宿主同步调用插件时卡死（direct）、插件异步续体中卡死（candidate）、插件自建定时器中卡死（unknown）。
// 参数：case thresholdMs exitMethod
import {startMainThreadWatchdog} from "./watchdog-host.mjs";
const [kase = "sync", threshold = "3000", exitMethod = "ffi-exit"] = process.argv.slice(2);
const reportPath = `${process.env.OUT_DIR ?? "."}/hang-report-${kase}.json`;
const wd = startMainThreadWatchdog({thresholdMs: Number(threshold), beatMs: 1000, checkMs: 500, reportPath, exitMethod, exitCode: 76});
wd.setHostPhase("available");
const imageGen = {id: "acme.image-gen", version: "1.2.0", generation: 3};
const wordcount = {id: "acme.wordcount", version: "0.3.1", generation: 1};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);
// 一个正常的在途调用：早已开始，正在等待外部 I/O
void wd.invoke(imageGen, "channel-call", "imageGen.render", () => sleep(60_000));
await sleep(1500);
console.log(`main: 开始 case=${kase} at ${new Date().toISOString()}`);
if (kase === "sync") {
    void wd.invoke(wordcount, "command", "wordcount.recount", () => { while (true) {} });
} else if (kase === "async") {
    void wd.invoke(wordcount, "export", "wordcount.countProject", async () => { await sleep(100); while (true) {} });
} else if (kase === "unowned") {
    // 插件在 activate 时自建定时器，宿主无从登记
    setTimeout(() => { while (true) {} }, 100);
}
await sleep(120_000);
