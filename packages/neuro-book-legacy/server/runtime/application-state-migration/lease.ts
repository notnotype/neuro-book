import {open, mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {lock} from "proper-lockfile";

/** Application State 顶层写事务的稳定 lease 路径。 */
export const APPLICATION_STATE_LEASE_RELATIVE_PATH = ".nbook/agent/migrations/application-state.lease";

/**
 * 获取 Application State 独占 lease。
 *
 * apply/resume/rollback 从重新 preflight 到 sentinel 完成或回滚全程持有；plan
 * 不调用本入口，因此保持纯只读。
 */
export async function acquireApplicationStateLease(rootWorkspace: string): Promise<() => Promise<void>> {
    const path = resolve(rootWorkspace, ...APPLICATION_STATE_LEASE_RELATIVE_PATH.split("/"));
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "a");
    await handle.close();
    return lock(path, {realpath: false, stale: 30_000});
}
