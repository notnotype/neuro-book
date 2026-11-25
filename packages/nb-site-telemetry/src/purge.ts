/**
 * 定时任务 `purge`：删除到期的原始上报（docs/specs/site/telemetry-ingest.md 输出 3、7、8 与边界一节）。
 *
 * 一轮的步骤：
 * 1. 限流器按时间清空（`rate-limit.ts` 的 `sweep`）：没有新请求时，上一个窗口的来源地址也按时离开内存（输出 8）。
 * 2. 按 `clock.now()` 的服务端日算截止日（`days.ts` 的 `retentionCutoffDay`）；`server_day` 早于它的原始上报到期。
 * 3. 先把到期的行都算进聚合（`aggregate.ts` 的一批，直到游标不小于到期行里最大的编号；批的上界也是这个编号，截止日之后的
 *    行不进这里的批）。读游标与算一批出错时分两种：库一时用不了（`isDbUnavailable`）时这一轮什么都不删、以失败结束，
 *    下一轮再来；别的错误（包括游标行被删掉了）照样往下删，记一行 error（只带没进聚合的行数，游标读不到时为 null），
 *    这一轮最后以失败结束。保留期是隐私承诺，先于聚合的完整。
 * 4. 按批删到期的行，每批一条语句（自己就是一个事务）。
 * 5. 在事务之外做截断检查点：删掉的内容经 `secure_delete` 从库文件的页里抹掉，但插入时的 WAL 帧里还有，截断才清掉
 *    （w00037 t06 计划探针 3）。每一轮都做，哪怕没有要删的；第 4 步提交过一批、后面的批出错时也做，再抛出那个错误。
 *    有读者拿着旧快照（备份正读着）时做不完，记一行 warn，下一轮再做。
 *
 * 两个任务交错时：这里的聚合与任务 `aggregate` 用同一个聚合器，一批是一个自带游标的事务，交错不会把同一批算两遍；
 * 删除只删整天，删的都已经算过（或在第 3 步记了 error）。每批之前看模块的“正在关闭”标志，置位就收手，不做后面的步骤。
 */

import type {Database} from "bun:sqlite";

import {AGGREGATE_SOURCES, type AggregateSource, type Aggregator, yieldToEventLoop} from "./aggregate";
import {retentionCutoffDay, serverDayAt} from "./days";
import type {TelemetryLog} from "./log";
import {isDbUnavailable} from "./store";

/** `purge` 的间隔；固定，不做成配置（Spec 的输入一节：每 10 分钟一次）。 */
export const PURGE_INTERVAL_MS = 600_000;

/**
 * 一批至多删这么多行，依据同 `AGGREGATE_BATCH_ROWS`：最坏输入的每日上报、`secure_delete` 开着时，2026-11-25 在 8 核桌面机上
 * 500 行一批的整轮 `purge`（含截断检查点）事件循环最长停 15 到 72 毫秒；单独计时一批，500 行至多 26 毫秒，1000 行偶尔到
 * 187 毫秒。
 */
export const PURGE_BATCH_ROWS = 500;

export interface PurgeOptions {
    readonly db: Database;
    readonly aggregator: Aggregator;
    readonly limiter: {sweep(): void};
    readonly clock: {now(): number};
    readonly retentionDays: number;
    readonly log: TelemetryLog;
    /** 模块的“正在关闭”标志（`index.ts` 的 `close()`）。 */
    readonly closing: () => boolean;
}

/** 数据库错误的码名（例如 `SQLITE_BUSY`），只给日志用；不是 SQLite 的错误时为 null。 */
function dbCodeOf(error: unknown): string | null {
    const code = (error as {code?: unknown} | null)?.code;
    return typeof code === "string" && code.startsWith("SQLITE_") ? code : null;
}

/**
 * 到期行里最大的编号：游标到了它，到期的就都算过了。单独导出，让包内测试对同一条语句看查询计划。
 *
 * 写明走日索引：不写时 SQLite 3.53 选的是从最大编号往回扫原始表，没有到期行时同步扫完整张表，80 万行的冷库上
 * 事件循环停了 15 秒（w00037 t06 omp 实现审查第 10 条）。走索引时只读到期的那段索引项：没有到期行时冷库约 1 毫秒；
 * 有到期行时耗时与到期行数成正比，冷库上 10 万行 35 到 38 毫秒、40 万行 162 到 228 毫秒。每 10 分钟一轮时到期的
 * 只是刚过期的那一天，停机很久、积压了多天的第一轮可能超过 100 毫秒，只有那一轮。
 */
export function lastExpiredSql(source: AggregateSource): string {
    return `SELECT max(id) AS last FROM telemetry_${source}_raw INDEXED BY telemetry_${source}_raw_server_day WHERE server_day < $cutoff`;
}

/** 返回一轮 `purge`；调度与“不叠着跑”由入口的调度器负责。 */
export function createPurge(options: PurgeOptions): () => Promise<void> {
    const {db, aggregator, log, closing} = options;

    const statements = (source: AggregateSource) => ({
        lastExpired: db.query<{last: number | null}, [{$cutoff: number}]>(lastExpiredSql(source)),
        /** 到期而没进聚合的行数，只给 error 行用。 */
        unaggregated: db.query<{rows: number}, [{$cutoff: number; $cursor: number}]>(`SELECT count(*) AS rows FROM telemetry_${source}_raw WHERE server_day < $cutoff AND id > $cursor`),
        deleteBatch: db.query<unknown, [{$cutoff: number; $limit: number}]>(
            `DELETE FROM telemetry_${source}_raw WHERE id IN (SELECT id FROM telemetry_${source}_raw WHERE server_day < $cutoff LIMIT $limit)`,
        ),
    });
    const bySource = {daily: statements("daily"), event: statements("event")} satisfies Record<AggregateSource, unknown>;
    const checkpoint = db.query<{busy: number; log: number; checkpointed: number}, []>("PRAGMA wal_checkpoint(TRUNCATE)");

    const deferred = (error: unknown): void => {
        log.warn("telemetry.purge_deferred", "telemetry database is not writable; expired raw reports are kept until the next purge", {dbCode: dbCodeOf(error)});
    };

    /**
     * 第 3 步里一张表出的错：`cursor` 是出错之前最后读到、此后没再推进的游标，算没进聚合的行数用；游标本身读不到时为 null，
     * 不再去读它。
     */
    interface AggregateFailure {
        readonly error: unknown;
        readonly cursor: number | null;
    }

    /**
     * 第 3 步；返回 false 表示正在关闭、收手了。库忙时抛出；别的错误记进 `failures`，接着做下一张表。
     *
     * “正在关闭”在每次读库之前查（换表时读到期行之前、让出回来后读游标之前）：强制停止时入口不等 `close()` 就关库，
     * 让出回来再读库会抛 `Database has closed`，在 `site.stopped` 之后多记一行 `job.failed`。
     */
    const aggregateExpired = async (cutoff: number, failures: Map<AggregateSource, AggregateFailure>): Promise<boolean> => {
        for (const source of AGGREGATE_SOURCES) {
            if (closing()) return false;
            const last = bySource[source].lastExpired.get({$cutoff: cutoff})?.last ?? null;
            if (last === null) continue;
            // 读游标与算一批在同一个 try 里：游标行坏了（被删）时与聚合出错一样照删，不让派生状态挡住保留期。
            let cursor: number | null = null;
            try {
                while ((cursor = aggregator.cursor(source)) < last) {
                    // 失败的一批整批回滚，游标仍是刚读到的值；成功的一批推进了游标，刚读到的值不再作数。
                    aggregator.aggregateBatch(source, last);
                    cursor = null;
                    await yieldToEventLoop();
                    if (closing()) return false;
                }
            } catch (error) {
                if (isDbUnavailable(error)) {
                    deferred(error);
                    throw error;
                }
                failures.set(source, {error, cursor});
            }
        }
        return true;
    };

    /**
     * 第 4 步；返回 false 表示正在关闭、收手了。某一批出错时，前面已经提交过批的话先做第 5 步再抛出：
     * 删掉的那些行已经查不到了，但插入时的 WAL 帧里还有，不能等到这个错误消失的那一轮才清。
     */
    const deleteExpired = async (cutoff: number): Promise<boolean> => {
        let committed = false;
        try {
            for (const source of AGGREGATE_SOURCES) {
                for (;;) {
                    if (closing()) return false;
                    const {changes} = bySource[source].deleteBatch.run({$cutoff: cutoff, $limit: PURGE_BATCH_ROWS});
                    if (changes === 0) break;
                    committed = true;
                    await yieldToEventLoop();
                }
            }
        } catch (error) {
            if (isDbUnavailable(error)) deferred(error);
            if (committed) {
                try {
                    truncateWal();
                } catch (checkpointError) {
                    // 抛出的是这一轮原来的错误；检查点自己的错误只在这一行里。
                    log.error("telemetry.checkpoint_failed", "WAL truncation after a failed delete batch failed; retrying at the next purge", {dbCode: dbCodeOf(checkpointError)});
                }
            }
            throw error;
        }
        return true;
    };

    const truncateWal = (): void => {
        try {
            if ((checkpoint.get()?.busy ?? 0) === 0) return;
            log.warn("telemetry.checkpoint_busy", "WAL could not be truncated while a reader holds an older snapshot; retrying at the next purge");
        } catch (error) {
            if (!isDbUnavailable(error)) throw error;
            log.warn("telemetry.checkpoint_busy", "WAL could not be truncated; retrying at the next purge", {dbCode: dbCodeOf(error)});
        }
    };

    return async () => {
        options.limiter.sweep();
        const cutoff = retentionCutoffDay(serverDayAt(options.clock.now()), options.retentionDays);

        const failures = new Map<AggregateSource, AggregateFailure>();
        if (!(await aggregateExpired(cutoff, failures))) return;
        const [failure] = failures.values();
        if (failure !== undefined) {
            /** 没出错的表到期的都算过了，记 0；出错的表从出错前的游标往后数，游标读不到时不知道。 */
            const rowsOf = (source: AggregateSource): number | null => {
                const failed = failures.get(source);
                if (failed === undefined) return 0;
                if (failed.cursor === null) return null;
                return bySource[source].unaggregated.get({$cutoff: cutoff, $cursor: failed.cursor})?.rows ?? 0;
            };
            // 字段不叫 `daily`、`event`：入口的日志器用事件名盖掉同名的 `event` 键（`nb-site-server` 的 `log.ts`）。
            log.error("telemetry.purge_unaggregated", "aggregating expired raw reports failed; deleting them anyway", {
                dailyRows: rowsOf("daily"),
                eventRows: rowsOf("event"),
                dbCode: dbCodeOf(failure.error),
            });
        }

        if (!(await deleteExpired(cutoff))) return;
        truncateWal();

        // 删除照常做完之后，让这一轮以失败结束（入口记 `job.failed`；经测试控制入口跑时回 `job_failed`）。
        if (failure !== undefined) throw failure.error;
    };
}
