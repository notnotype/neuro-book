/**
 * 就绪检查（`site.operations` 输出 4）：每个模块的库能取得写锁、读得到迁移记录、本版本的迁移都已执行，模块自己的
 * `ready()` 也为真。
 *
 * 只在探测连接上开事务，不碰模块的业务连接：模块会在业务连接上开跨 await 的事务（Better Auth 的注册），在它上面
 * `BEGIN IMMEDIATE` 会失败，随后的 `ROLLBACK` 还会把模块的事务回滚掉。业务连接正在事务里时，写锁多半就在本进程手里，
 * 探测连接去拿必然撞上自己、误报 503，所以这时只读迁移记录、不拿写锁；代价是这时进程外另有人占着写锁也看不出来。
 *
 * 探测连接不等锁（`openProbeDb`），检查本身是同步的，同一时刻只会有一次；结果复用 1 秒，被频繁探测时不反复开事务。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {migrationsApplied, type MigratableModule} from "./db/migrate";
import {errorType, type Logger} from "./log";
import type {Clock, ModuleInstance} from "./module";

export interface ReadinessTarget {
    readonly module: MigratableModule;
    readonly probe: Database;
    /** 模块的业务连接；这里只读它的 `inTransaction`，不在上面执行任何语句。 */
    readonly business: Database;
    readonly instance: ModuleInstance;
}

export interface ReadinessReport {
    readonly ready: boolean;
    readonly modules: Readonly<Record<string, "ready" | "not_ready">>;
}

/** 结果复用的时长；Spec 允许同一秒内的多次检查得到同一个结果。 */
export const READINESS_CACHE_MS = 1_000;

type NotReadyReason = "db_unavailable" | "migrations_missing" | "module_not_ready";

function checkDb(target: ReadinessTarget): {readonly ok: true} | {readonly ok: false; readonly reason: NotReadyReason; readonly fields: Readonly<Record<string, unknown>>} {
    const {probe, module} = target;
    try {
        let applied: boolean;
        if (target.business.inTransaction) {
            applied = migrationsApplied(probe, module);
        } else {
            probe.exec("BEGIN IMMEDIATE");
            try {
                applied = migrationsApplied(probe, module);
            } finally {
                probe.exec("ROLLBACK");
            }
        }
        return applied ? {ok: true} : {ok: false, reason: "migrations_missing", fields: {}};
    } catch (error) {
        // SQLite 的说明可能带文件名，只报码与类型。
        return {ok: false, reason: "db_unavailable", fields: error instanceof SQLiteError ? {dbCode: error.code} : {errorType: errorType(error)}};
    }
}

function checkModule(target: ReadinessTarget, log: Logger): boolean {
    const db = checkDb(target);
    let reason: NotReadyReason | undefined = db.ok ? undefined : db.reason;
    let fields = db.ok ? {} : db.fields;
    if (reason === undefined && target.instance.ready !== undefined) {
        try {
            if (!target.instance.ready()) reason = "module_not_ready";
        } catch (error) {
            reason = "module_not_ready";
            fields = {errorType: errorType(error)};
        }
    }
    if (reason === undefined) return true;
    log.warn("health.not_ready", "module is not ready", {module: target.module.name, reason, ...fields});
    return false;
}

/** 返回做一次就绪检查的函数；1 秒内重复调用拿到同一个结果。 */
export function createReadiness(targets: readonly ReadinessTarget[], options: {readonly clock: Clock; readonly log: Logger}): () => ReadinessReport {
    let cached: {readonly at: number; readonly report: ReadinessReport} | undefined;
    return () => {
        const now = options.clock.now();
        if (cached !== undefined && now - cached.at < READINESS_CACHE_MS) return cached.report;
        const modules: Record<string, "ready" | "not_ready"> = {};
        for (const target of targets) modules[target.module.name] = checkModule(target, options.log) ? "ready" : "not_ready";
        const report = {ready: Object.values(modules).every((state) => state === "ready"), modules};
        cached = {at: now, report};
        return report;
    };
}
