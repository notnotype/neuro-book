/**
 * 模块提供的子命令（`SiteCommand`）。两种占用方式与停止信号的规则写在 `SiteCommand` 的注释里；这里只负责照做：
 *
 * - 配置只校验入口这一层与本模块的：命令只用到本模块，别的模块的变量缺了不该挡住它。
 * - 取到本模块的锁时，先执行本模块的迁移；`exclusive` 运行期间一直拿着锁，`shared` 迁移做完就放锁。
 * - `shared` 取不到锁时，说明服务（或另一个命令）正拿着这个库；这时不执行迁移，只核对迁移记录完整，不完整报 `not_ready`
 *   （多半是拿着锁的那一方还在迁移），完整就在自己的连接上运行。两个进程同时写同一个库靠 SQLite 的写锁排队。
 */

import type {Database} from "bun:sqlite";

import {configFailure, parseSiteConfig, type Env} from "../config";
import {migrationsApplied, yieldToEventLoop} from "../db/migrate";
import {openModuleDb} from "../db/open";
import type {StopState} from "../lifecycle";
import {lockModules, type ModuleLocks} from "../lock";
import type {Logger} from "../log";
import type {CommandFailure, SiteCommand, SiteModule} from "../module";
import {closeAll, failed, lockFailure, openAndMigrate, SUCCEEDED, type CommandResult} from "./prepare";

const SYSTEM_CLOCK = {now: () => Date.now()};

function interrupted(module: string, command: string): CommandResult {
    return failed({code: "interrupted", message: `command ${command} was interrupted by a stop signal`, fields: {module, command}});
}

/** `run()` 收手时的 reject：`signal.reason` 本身，或别的 API 收到同一个 signal 后给的 `AbortError`。 */
function isAbort(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted && (error === signal.reason || (error instanceof DOMException && error.name === "AbortError"));
}

type RunOutcome = {readonly kind: "resolved"; readonly failure: CommandFailure | undefined} | {readonly kind: "rejected"; readonly error: unknown} | {readonly kind: "forced"};

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
    if (!locks.ok && (command.access === "exclusive" || locks.reason === "unusable")) return failed(lockFailure(locks));

    const dbs = new Map<string, Database>();
    try {
        if (locks.ok) {
            const migrated = await openAndMigrate(base.dataDir, [module], log, stop, dbs);
            if (migrated.kind === "failed") return failed(migrated.failure);
            if (migrated.kind === "stopped") return interrupted(module.name, command.name);
            // `shared` 只在迁移期间占着库：之后它可能停在等输入的地方很久，不能挡住服务启动（`site.operations` 的时序一节）。
            if (command.access === "shared") locks.release();
        } else {
            dbs.set(module.name, openModuleDb(base.dataDir, module.name));
            if (!migrationsApplied(dbs.get(module.name)!, module)) {
                return failed({code: "not_ready", message: `module ${module.name} has migrations that are not applied yet`, fields: {module: module.name}});
            }
        }
        // 让排队的信号先跑：上面这些都是同步的。
        await yieldToEventLoop();
        if (stop.requested) return interrupted(module.name, command.name);

        // 包成不会 reject 的 Promise 再与强制停止赛跑：强制赢了之后 `run()` 的结果没人再等，进程随即退出。
        const running: Promise<RunOutcome> = Promise.resolve()
            .then(() =>
                command.run({
                    db: dbs.get(module.name)!,
                    config: parsed.config.modules.get(module.name),
                    site: base.site,
                    log: log.child({module: module.name}),
                    clock: SYSTEM_CLOCK,
                    args,
                    signal: stop.signal,
                }),
            )
            .then(
                (failure): RunOutcome => ({kind: "resolved", failure}),
                (error: unknown): RunOutcome => ({kind: "rejected", error}),
            );
        const outcome = await Promise.race([running, stop.whenForced.then((): RunOutcome => ({kind: "forced"}))]);
        if (outcome.kind === "forced") return interrupted(module.name, command.name);
        if (outcome.kind === "rejected") {
            if (isAbort(outcome.error, stop.signal)) return interrupted(module.name, command.name);
            throw outcome.error;
        }
        return outcome.failure === undefined ? SUCCEEDED : failed(outcome.failure);
    } finally {
        closeAll(dbs);
        // `release()` 可以重复调用：`shared` 已经放过一次。
        if (locks.ok) locks.release();
    }
}
