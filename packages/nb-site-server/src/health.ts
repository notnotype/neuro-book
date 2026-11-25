/**
 * 就绪检查（`site.operations` 输出 4）：每个模块的库能取得写锁、读得到迁移记录、本版本的迁移都已执行，模块自己的
 * `ready()` 也为真。
 *
 * 只在探测连接上开事务，不碰模块的业务连接：模块会在业务连接上开跨 await 的事务（Better Auth 的注册），在它上面
 * `BEGIN IMMEDIATE` 会失败，随后的 `ROLLBACK` 还会把模块的事务回滚掉。
 *
 * 探测连接不等锁（`openProbeDb`），撞上写锁立即得 `SQLITE_BUSY`。这时业务连接正在事务里，写锁多半在本进程手里，算就绪，
 * 只读迁移记录；业务连接在只读事务里（没拿写锁）时探测本来就成功，不走这条路。同一个模块连续 `stuckAfterMs` 每次检查都
 * 是这样时回 503、写 `transaction_stuck`：模块的错误路径漏了 `COMMIT`/`ROLLBACK` 时，这条连接从此一直在事务里，后面的写入
 * 都进了这个不提交的事务，不能一直报成就绪。分不出“同一个事务一直开着”与“每次都碰上一个新的短事务”，按窄场景接受；
 * 这时进程外另有人占着写锁也看不出来。
 *
 * 检查本身是同步的，同一时刻只会有一次；结果复用 1 秒，被频繁探测时不反复开事务。复用与卡住的时长都按单调时钟算：
 * 墙钟往回拨时，按墙钟算的复用窗口会把旧结果冻结到墙钟追回来为止。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {migrationsApplied, type MigratableModule} from "./db/migrate";
import {errorType, type Logger} from "./log";
import type {ModuleInstance} from "./module";

export interface ReadinessTarget {
    readonly module: MigratableModule;
    readonly probe: Database;
    /** 模块的业务连接；这里只读它的 `inTransaction`，不在上面执行任何语句。 */
    readonly business: Database;
    readonly instance: ModuleInstance;
}

export type ModuleReadiness = "ready" | "not_ready" | "transaction_stuck";

export interface ReadinessReport {
    readonly ready: boolean;
    readonly modules: Readonly<Record<string, ModuleReadiness>>;
}

export interface ReadinessOptions {
    readonly log: Logger;
    /** 单调时钟的读数，毫秒；缺省 `performance.now()`。包内用例注入手动的时钟。 */
    readonly now?: () => number;
    /** 本进程的事务连续占着写锁多久算卡住；缺省 30 秒（Spec 输出 4）。 */
    readonly stuckAfterMs?: number;
}

type NotReadyReason = "db_unavailable" | "migrations_missing" | "module_not_ready" | "transaction_stuck";

type DbCheck = {readonly ok: true; readonly heldByUs: boolean} | {readonly ok: false; readonly reason: NotReadyReason; readonly fields: Readonly<Record<string, unknown>>};

function dbErrorFields(error: unknown): Readonly<Record<string, unknown>> {
    // SQLite 的说明可能带文件名，只报码与类型。
    return error instanceof SQLiteError ? {dbCode: error.code} : {errorType: errorType(error)};
}

/** `heldByUs`：探测撞上了写锁、业务连接又在事务里，按本进程持锁算。 */
function checkDb(target: ReadinessTarget): DbCheck {
    const {probe, module} = target;
    let applied: boolean;
    let heldByUs = false;
    try {
        probe.exec("BEGIN IMMEDIATE");
    } catch (error) {
        if (!(error instanceof SQLiteError && error.code === "SQLITE_BUSY" && target.business.inTransaction)) return {ok: false, reason: "db_unavailable", fields: dbErrorFields(error)};
        heldByUs = true;
    }
    try {
        applied = migrationsApplied(probe, module);
    } catch (error) {
        return {ok: false, reason: "db_unavailable", fields: dbErrorFields(error)};
    } finally {
        if (!heldByUs) probe.exec("ROLLBACK");
    }
    return applied ? {ok: true, heldByUs} : {ok: false, reason: "migrations_missing", fields: {}};
}

/** 结果复用的时长；Spec 允许同一秒内的多次检查得到同一个结果。 */
export const READINESS_CACHE_MS = 1_000;

/** 返回做一次就绪检查的函数；复用窗口内重复调用拿到同一个结果。 */
export function createReadiness(targets: readonly ReadinessTarget[], options: ReadinessOptions): () => ReadinessReport {
    const now = options.now ?? (() => performance.now());
    const stuckAfterMs = options.stuckAfterMs ?? 30_000;
    const {log} = options;
    /** 每个模块从哪一次检查起一直是“本进程持锁”；不是时删掉。 */
    const heldSince = new Map<string, number>();
    let cached: {readonly at: number; readonly report: ReadinessReport} | undefined;

    const checkModule = (target: ReadinessTarget, at: number): ModuleReadiness => {
        const name = target.module.name;
        const db = checkDb(target);
        let reason: NotReadyReason | undefined;
        let fields: Readonly<Record<string, unknown>> = {};
        if (!db.ok) {
            heldSince.delete(name);
            reason = db.reason;
            fields = db.fields;
        } else if (db.heldByUs) {
            const since = heldSince.get(name) ?? at;
            heldSince.set(name, since);
            if (at - since >= stuckAfterMs) reason = "transaction_stuck";
        } else {
            heldSince.delete(name);
        }
        if (reason === undefined && target.instance.ready !== undefined) {
            try {
                if (!target.instance.ready()) reason = "module_not_ready";
            } catch (error) {
                reason = "module_not_ready";
                fields = {errorType: errorType(error)};
            }
        }
        if (reason === undefined) return "ready";
        log.warn("health.not_ready", "module is not ready", {module: name, reason, ...fields});
        return reason === "transaction_stuck" ? "transaction_stuck" : "not_ready";
    };

    return () => {
        const at = now();
        if (cached !== undefined && at - cached.at < READINESS_CACHE_MS) return cached.report;
        const modules: Record<string, ModuleReadiness> = {};
        for (const target of targets) modules[target.module.name] = checkModule(target, at);
        const report = {ready: Object.values(modules).every((state) => state === "ready"), modules};
        cached = {at, report};
        return report;
    };
}
