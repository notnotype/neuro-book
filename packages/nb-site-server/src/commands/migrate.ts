/**
 * `nb-site migrate`：`serve` 的前三步（配置、按模块取锁、迁移），然后关库、放锁退出。服务在跑时取不到锁，
 * 得 `data_dir_busy`（`site.operations` 的时序一节）。迁移期间收到停止信号时把正在执行的那一条做完、以 0 退出。
 */

import type {Database} from "bun:sqlite";

import {configFailure, parseSiteConfig, type Env} from "../config";
import type {StopState} from "../lifecycle";
import {lockModules} from "../lock";
import type {Logger} from "../log";
import type {SiteModule} from "../module";
import {closeAll, failed, lockFailure, openAndMigrate, SUCCEEDED, type CommandResult} from "./prepare";

export async function migrate(env: Env, modules: readonly SiteModule[], log: Logger, stop: StopState): Promise<CommandResult> {
    const parsed = parseSiteConfig(env, modules);
    if (!parsed.ok) return failed(configFailure(parsed.problems));
    const {dataDir} = parsed.config.base;

    const locks = lockModules(dataDir, modules.map((module) => module.name));
    if (!locks.ok) return failed(lockFailure(locks));
    const dbs = new Map<string, Database>();
    try {
        const migrated = await openAndMigrate(dataDir, modules, log, stop, dbs);
        return migrated.kind === "failed" ? failed(migrated.failure) : SUCCEEDED;
    } finally {
        closeAll(dbs);
        locks.release();
    }
}
