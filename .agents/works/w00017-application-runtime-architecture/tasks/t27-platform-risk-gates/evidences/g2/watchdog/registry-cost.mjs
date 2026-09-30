// 宿主每次调用插件时登记/清除在途槽位的开销。
import {startMainThreadWatchdog} from "./watchdog-host.mjs";
const wd = startMainThreadWatchdog({thresholdMs: 10000, beatMs: 1000, checkMs: 500, reportPath: "/dev/null", exitMethod: "none"});
const plugin = {id: "acme.image-gen", version: "1.2.0", generation: 1};
for (let i = 0; i < 1e5; i++) wd.endCall(wd.beginCall(plugin, "command", "imageGen.render"));
const n = 1e6;
let t = performance.now();
for (let i = 0; i < n; i++) { const s = wd.beginCall(plugin, "command", "imageGen.render"); wd.enterSync(s); wd.exitSync(); wd.endCall(s); }
const sync = (performance.now() - t) / n * 1e6;
t = performance.now();
for (let i = 0; i < 1e5; i++) await wd.invoke(plugin, "command", "imageGen.render", () => 1);
const wrapped = (performance.now() - t) / 1e5 * 1e6;
t = performance.now();
for (let i = 0; i < 1e5; i++) await (async () => 1)();
const bare = (performance.now() - t) / 1e5 * 1e6;
console.log(`# ${new Date().toISOString()} bun ${Bun.version}`);
console.log(`登记+同步段标记+清除：每次 ${sync.toFixed(0)}ns；invoke 包装异步调用 ${wrapped.toFixed(0)}ns，对照裸 await ${bare.toFixed(0)}ns`);
await wd.stop();
