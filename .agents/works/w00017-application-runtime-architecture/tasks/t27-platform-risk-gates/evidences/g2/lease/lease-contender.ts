// 第二个进程：从 START_AT 起每 POLL ms 尝试获取同一租约，成功后持有 HOLD ms 再释放。
import {statSync, appendFileSync} from "node:fs";
import {
    acquireAgentSessionStoreRuntimeLease,
    agentSessionStoreLeasePath,
} from "/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book/server/agent/session/agent-session-store-lease.ts";

const env = process.env;
const root = env.ROOT!;
const T0 = Number(env.T0);
const tag = env.TAG ?? "contender";
const poll = Number(env.POLL ?? "500");
const hold = Number(env.HOLD ?? "5000");
const giveUpAt = Number(env.GIVE_UP_AT ?? "90000");
const lockPath = `${agentSessionStoreLeasePath(root)}.lock`;
const t = () => Date.now() - T0;
const lockMtime = (): number | null => {
    try { return statSync(lockPath).mtimeMs - T0; } catch { return null; }
};
const log = (ev: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({t: t(), who: tag, ev, lockMtime: lockMtime(), ...extra}));

let attempts = 0;
let firstError = "";
while (t() < giveUpAt) {
    attempts++;
    try {
        const lease = await acquireAgentSessionStoreRuntimeLease(root);
        log("acquired", {attempts, firstError});
        const writer = setInterval(() => appendFileSync(`${root}/writes.log`, `${t()} ${tag}\n`), 500);
        await new Promise((r) => setTimeout(r, hold));
        clearInterval(writer);
        await lease.release();
        log("released");
        process.exit(0);
    } catch (error) {
        const code = (error as {code?: string}).code;
        if (!firstError) {
            firstError = `${code}: ${(error as Error).message.slice(0, 80)}`;
            log("first-attempt-failed", {code});
        }
        if (code !== "ELOCKED") throw error;
    }
    await new Promise((r) => setTimeout(r, poll));
}
log("gave-up", {attempts});
