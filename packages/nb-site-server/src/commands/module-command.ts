/**
 * 模块提供的子命令（`SiteCommand`）。两种占用方式的规则写在 `SiteCommand` 的注释里；这里只负责照做：
 *
 * - 配置只校验入口这一层与本模块的：命令只用到本模块，别的模块的变量缺了不该挡住它。
 * - 取到本模块的锁时，先执行本模块的迁移再运行，运行期间一直拿着锁。
 * - `shared` 取不到锁时，说明服务（或另一个命令）正拿着这个库；这时不执行迁移，只核对迁移记录完整，不完整报 `not_ready`
 *   （多半是拿着锁的那一方还在迁移），完整就在自己的连接上运行。两个进程同时写同一个库靠 SQLite 的写锁排队。
 */

import type {Database} from "bun:sqlite";

import {configFailure, parseSiteConfig, type Env} from "../config";
import {migrationsApplied} from "../db/migrate";
import {openModuleDb} from "../db/open";
import type {StopState} from "../lifecycle";
import {lockModules, type ModuleLocks} from "../lock";
import type {Logger} from "../log";
import type {SiteCommand, SiteModule} from "../module";
import {busyFailure, closeAll, failed, openAndMigrate, SUCCEEDED, type CommandResult} from "./prepare";

const SYSTEM_CLOCK = {now: () => Date.now()};

export async function runModuleCommand(
    env: Env,
    module: SiteModule,
    command: SiteCommand<unknown>,
    args: Readonly<Record<string, string | undefined>>,
    log: Logger,
    stop: StopState,
): Promise<CommandResult> {
    const parsed = parseSiteConfig(env, [module]);
    if (!parsed.ok) return failed(configFailure(parsed.problems));
    const {base} = parsed.config;

    const locks: ModuleLocks = lockModules(base.dataDir, [module.name]);
    if (!locks.ok && command.access === "exclusive") return failed(busyFailure(module.name));

    const dbs = new Map<string, Database>();
    try {
        if (locks.ok) {
            const migrated = await openAndMigrate(base.dataDir, [module], log, stop, dbs);
            if (migrated.kind === "failed") return failed(migrated.failure);
            if (migrated.kind === "stopped") return SUCCEEDED;
        } else {
            dbs.set(module.name, openModuleDb(base.dataDir, module.name));
            if (!migrationsApplied(dbs.get(module.name)!, module)) {
                return failed({code: "not_ready", message: `module ${module.name} has migrations that are not applied yet`, fields: {module: module.name}});
            }
        }
        if (stop.requested) return SUCCEEDED;
        const failure = await command.run({
            db: dbs.get(module.name)!,
            config: parsed.config.modules.get(module.name),
            site: base.site,
            log: log.child({module: module.name}),
            clock: SYSTEM_CLOCK,
            args,
        });
        return failure === undefined ? SUCCEEDED : failed(failure);
    } finally {
        closeAll(dbs);
        if (locks.ok) locks.release();
    }
}
