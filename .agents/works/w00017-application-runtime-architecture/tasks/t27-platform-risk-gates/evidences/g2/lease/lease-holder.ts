// 用仓库中真实的 Session Store 租约实现（只读导入）持有 runtime lease，按参数在指定时刻同步阻塞主线程。
// 环境变量：ROOT、T0（编排器统一的时间原点，epoch ms）、BLOCK_AT（相对获得租约的毫秒）、BLOCK_FOR、
// END_AT（正常释放的时刻）、KILL=sigkill|sigkill-release（阻塞到 BLOCK_FOR 时模拟看门狗结束进程）、TAG。
import {rmSync, statSync, appendFileSync} from "node:fs";
import {
    acquireAgentSessionStoreRuntimeLease,
    agentSessionStoreLeasePath,
} from "/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/server/agent/session/agent-session-store-lease.ts";

const env = process.env;
const root = env.ROOT!;
const T0 = Number(env.T0);
const tag = env.TAG ?? "holder";
const blockAt = Number(env.BLOCK_AT ?? "-1");
const blockFor = Number(env.BLOCK_FOR ?? "0");
const endAt = Number(env.END_AT ?? "60000");
const kill = env.KILL ?? "";
const lockPath = `${agentSessionStoreLeasePath(root)}.lock`;
const writes = `${root}/writes.log`;
const t = () => Date.now() - T0;
const lockMtime = (): number | null => {
    try { return statSync(lockPath).mtimeMs - T0; } catch { return null; }
};
const log = (ev: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({t: t(), who: tag, ev, lockMtime: lockMtime(), ...extra}));

const lease = await acquireAgentSessionStoreRuntimeLease(root);
const acquiredAt = Date.now();
log("acquired", {pid: process.pid});
let compromised = false;
void lease.compromised.then((error) => {
    compromised = true;
    log("compromised", {cause: (error.cause as Error | undefined)?.message});
    // 与产品一致：失效后以专用退出码 75 结束
    process.exit(75);
});
// 模拟会话写入：每 500ms 追加一行，事后可检查两个进程的写入是否交错
const writer = setInterval(() => {
    appendFileSync(writes, `${t()} ${tag}\n`);
}, 500);
if (blockAt >= 0) {
    setTimeout(() => {
        log("block-start");
        const end = Date.now() + blockFor;
        while (Date.now() < end) { /* 同步 CPU 计算 */ }
        if (kill === "sigkill-release") {
            // 看门狗在结束进程前删除本进程持有的锁目录
            rmSync(lockPath, {recursive: true, force: true});
            log("watchdog-released-lock");
        }
        if (kill) {
            log("watchdog-kill");
            process.kill(process.pid, "SIGKILL");
        }
        log("block-end");
    }, Math.max(0, acquiredAt + blockAt - Date.now()));
}
setTimeout(async () => {
    clearInterval(writer);
    if (!compromised) {
        await lease.release();
        log("released");
    }
    process.exit(0);
}, Math.max(0, acquiredAt + endAt - Date.now()));
