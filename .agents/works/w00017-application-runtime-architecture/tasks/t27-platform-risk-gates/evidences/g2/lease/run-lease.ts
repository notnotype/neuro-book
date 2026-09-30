// 编排租约场景：真实租约参数（15s 心跳、30s 过期），主进程阻塞与第二进程竞争。
import {spawn} from "node:child_process";
import {mkdtempSync, readFileSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

type Scenario = {
    holder: Record<string, string>;
    contender?: Record<string, string> & {START_AT?: string};
    restartOnExit?: Record<string, string>;
};
const scenarios: Record<string, Scenario> = {
    // 阻塞在第一次心跳前开始：锁 mtime 停在获取时刻，约 16~18 秒后即被判过期
    A_worst_phase_block22s_with_contender: {
        holder: {BLOCK_AT: "14000", BLOCK_FOR: "22000", END_AT: "50000"},
        contender: {START_AT: "14500", HOLD: "8000", GIVE_UP_AT: "48000"},
    },
    // 阻塞在一次心跳刚完成后开始：同样 22 秒阻塞，锁在阻塞期间不过期
    B_best_phase_block22s_with_contender: {
        holder: {BLOCK_AT: "15600", BLOCK_FOR: "22000", END_AT: "42000"},
        contender: {START_AT: "16000", HOLD: "2000", GIVE_UP_AT: "55000"},
    },
    // 阻塞 45 秒但无人竞争：恢复后是否自判失效
    C_block45s_no_contender: {
        holder: {BLOCK_AT: "14000", BLOCK_FOR: "45000", END_AT: "75000"},
        contender: {START_AT: "64000", HOLD: "1000", GIVE_UP_AT: "70000"},
    },
    // 看门狗阈值 20 秒、以 SIGKILL 结束；监督方立即重启（第二进程在前者退出后立即尝试获取）
    D_best_phase_watchdog20s_sigkill_restart: {
        holder: {BLOCK_AT: "15600", BLOCK_FOR: "20000", KILL: "sigkill", END_AT: "90000"},
        restartOnExit: {HOLD: "1000", GIVE_UP_AT: "80000", POLL: "250"},
    },
    // 同 D，但看门狗在结束进程前删除本进程的锁目录
    E_best_phase_watchdog20s_release_then_sigkill_restart: {
        holder: {BLOCK_AT: "15600", BLOCK_FOR: "20000", KILL: "sigkill-release", END_AT: "90000"},
        restartOnExit: {HOLD: "1000", GIVE_UP_AT: "80000", POLL: "250"},
    },
};
const selected = process.argv.slice(2);
const here = import.meta.dir;
const run = async (name: string, s: Scenario): Promise<string[]> => {
    const root = mkdtempSync(join(process.env.G2_TMP ?? tmpdir(), `lease-${name}-`));
    const T0 = String(Date.now());
    const lines: string[] = [];
    const spawnBun = (script: string, extra: Record<string, string>, tag: string) => {
        const child = spawn("bun", [join(here, script)], {
            env: {...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", ROOT: root, T0, TAG: tag, ...extra},
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (b) => lines.push(...String(b).trim().split("\n")));
        child.stderr.on("data", (b) => lines.push(`${tag} stderr: ${String(b).trim().slice(0, 300)}`));
        return new Promise<void>((resolve) => child.on("exit", (code, signal) => {
            lines.push(JSON.stringify({t: Date.now() - Number(T0), who: tag, ev: "process-exit", code, signal}));
            resolve();
        }));
    };
    const tasks: Promise<void>[] = [];
    const holder = spawnBun("lease-holder.ts", s.holder, "holder");
    if (s.restartOnExit) {
        tasks.push(holder.then(() => spawnBun("lease-contender.ts", s.restartOnExit!, "restart")));
    } else tasks.push(holder);
    if (s.contender) {
        const {START_AT, ...rest} = s.contender;
        tasks.push(new Promise<void>((resolve) => setTimeout(() => spawnBun("lease-contender.ts", rest, "contender").then(resolve), Number(START_AT))));
    }
    await Promise.all(tasks);
    const writesPath = join(root, "writes.log");
    const writes = existsSync(writesPath) ? readFileSync(writesPath, "utf8").trim().split("\n") : [];
    const sorted = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).sort((a, b) => a.t - b.t);
    const out = [`## ${name}`, `参数：${JSON.stringify(s)}`, ...sorted.map((e) => JSON.stringify(e)), ...lines.filter((l) => !l.startsWith("{"))];
    // 写入交错：holder 与 contender/restart 的写入时间区间是否重叠
    const byWho: Record<string, number[]> = {};
    for (const w of writes) { const [tt, who] = w.split(" "); (byWho[who!] ??= []).push(Number(tt)); }
    out.push(`会话写入时间范围：${Object.entries(byWho).map(([w, ts]) => `${w} ${Math.min(...ts)}..${Math.max(...ts)}ms（${ts.length} 次）`).join("；")}`);
    return out;
};
const names = selected.length ? selected : Object.keys(scenarios);
const results = await Promise.all(names.map((n) => run(n, scenarios[n]!)));
console.log(`# ${new Date().toISOString()} ${process.platform} bun ${Bun.version}；租约 stale=30000ms update=15000ms（仓库常量）`);
for (const r of results) console.log(r.join("\n"));
