// 从外部测量被测进程的 CPU（/proc/<pid>/task/*/schedstat，纳秒）与 RSS，比较有无看门狗。
import {spawn} from "node:child_process";
import {readFileSync, readdirSync} from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpuNs = (pid) => {
    const perThread = {};
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
        try {
            const ns = Number(readFileSync(`/proc/${pid}/task/${tid}/schedstat`, "utf8").split(" ")[0]);
            const name = readFileSync(`/proc/${pid}/task/${tid}/comm`, "utf8").trim();
            perThread[`${name}#${tid}`] = ns;
        } catch {}
    }
    return perThread;
};
const rssKb = (pid) => { const s = readFileSync(`/proc/${pid}/status`, "utf8"); const m = /VmRSS:\s+(\d+)/.exec(s); if (!m) throw new Error(`无法读取 RSS：pid=${pid} 内容=${s.slice(0, 200)}`); return Number(m[1]); };
async function measure(label, mode, wd, durationMs, warmMs = 3000) {
    const child = spawn("bun", ["load-child.mjs", mode, wd, String(durationMs + warmMs + 500)], {stdio: ["ignore", "pipe", "inherit"]});
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    await sleep(warmMs);
    const c0 = cpuNs(child.pid), r0 = rssKb(child.pid);
    await sleep(durationMs);
    const c1 = cpuNs(child.pid), r1 = rssKb(child.pid);
    await new Promise((r) => child.on("exit", r));
    const delta = {};
    for (const k of Object.keys(c1)) delta[k] = (c1[k] - (c0[k] ?? 0)) / 1e6;
    const total = Object.values(delta).reduce((a, b) => a + b, 0);
    const threads = Object.entries(delta).filter(([, v]) => v > 0.05).map(([k, v]) => `${k}=${v.toFixed(2)}ms`).join(" ");
    console.log(`${label}: ${durationMs / 1000}s 内 CPU ${total.toFixed(2)}ms（${(total / durationMs * 100).toFixed(3)}%），RSS ${Math.round(r0 / 1024)}→${Math.round(r1 / 1024)}MB；线程：${threads}`);
    if (out.trim()) console.log(`  子进程统计：${out.trim()}`);
    return {total, rss: r1};
}
console.log(`# ${new Date().toISOString()} ${process.platform} bun ${Bun.version}`);
const wdStd = JSON.stringify({thresholdMs: 12000, beatMs: 1000, checkMs: 500});
const wdFast = JSON.stringify({thresholdMs: 12000, beatMs: 100, checkMs: 100});
const D = 30000;
const a = await measure("空闲·无看门狗", "idle", "none", D);
const b = await measure("空闲·看门狗(心跳1s/检查0.5s)", "idle", wdStd, D);
const c = await measure("空闲·看门狗(心跳0.1s/检查0.1s)", "idle", wdFast, D);
console.log(`看门狗增量：标准配置 CPU +${(b.total - a.total).toFixed(2)}ms/30s，RSS +${Math.round((b.rss - a.rss) / 1024)}MB；高频配置 CPU +${(c.total - a.total).toFixed(2)}ms/30s`);
// 误报：主线程偶发 200~500ms 同步任务 60 秒；用阈值 12s 与更严的 2s、1.2s 同时观察
await measure("负载·看门狗阈值12s", "load", wdStd, 60000);
await measure("负载·看门狗阈值2s", "load", JSON.stringify({thresholdMs: 2000, beatMs: 1000, checkMs: 500}), 60000);
await measure("负载·看门狗阈值1.2s(心跳0.25s/检查0.1s)", "load", JSON.stringify({thresholdMs: 1200, beatMs: 250, checkMs: 100}), 60000);
