/**
 * 把原始上报算进聚合（docs/specs/site/telemetry-ingest.md 输出 5、6、11 与时序一节；表的形状与写法见
 * `migrations/0001_init.sql` 的注释）。用它的有三处：定时任务 `aggregate`（`jobs.ts`）、`purge` 的“删除之前先聚合”
 * （`purge.ts`）、备份时在副本上把没算的算完（`backup.ts`）。
 *
 * 一批（`aggregateBatch`）是一个同步事务：读游标、取 `id > 游标 ORDER BY id LIMIT n` 实际选出的行、把这些行算进各张
 * 聚合表、把游标推到选出的最后一行。三件事必须在同一个事务里：
 * - `aggregate` 与 `purge` 两个任务在批与批之间交错，各自拿着事务外读到的游标就会把同一批算两遍；
 * - 一批中途出错时整批回滚、游标不动，下一次从同一处再来，同一天的聚合重复计算结果相同（输出 5）。
 * 上界取实际选出的最后一行，不是游标加 n：编号有空号（重发时 `ON CONFLICT DO NOTHING` 也消耗编号），按差推进时
 * 空号会占掉一批的额度。用普通（DEFERRED）事务：没有新行时只读不写，库被进程外占着写时也不报忙。
 *
 * 一批在一个事务里更新所有维度，所以批与批之间读到的同一天的各维度彼此对得上（`site.telemetry-dashboard` 的时序）。
 *
 * 应用版本的上限（输出 11）：每个服务端日至多 `APP_VERSIONS_PER_PERIOD` 个不同的真实版本，之后新出现的记成
 * `OVERFLOW_APP_VERSION`。“已有哪些版本”从这一天已有的聚合里数，新版本按编号先到先占，所以结果只取决于原始行的
 * 编号顺序，与分几批、两个任务怎样交错无关。每日上报与立即事件各数各的：两张原始表的编号是各自的序列，合在一起数时
 * 谁先占名额要看两边的批怎样交错，重算就可能不同。
 */

import type {Database, Statement} from "bun:sqlite";

import {APP_VERSIONS_PER_PERIOD, OVERFLOW_APP_VERSION} from "./store";

/**
 * 一批至多这么多行。按最坏的输入定：每份每日上报带满第 1 版能有的 27 项错误、每天 64 个应用版本、各维度的取值打散，
 * 让一批的同步事务不超过 100 毫秒，请求在批与批之间处理（时序一节：写入不被阻塞超过 1 秒）。2026-11-25 在 8 核桌面机上
 * 量的（`scripts/measure-ingest.ts --batches`，2 万行一天）：500 行一批时事件循环最长停 56 到 67 毫秒；单独计时一批，
 * 500 行 26 到 36 毫秒，1000 行最长 158 毫秒，2000 行 123 到 233 毫秒。VPS 更慢，所以留了余量。
 */
export const AGGREGATE_BATCH_ROWS = 500;

/** 两张原始表；聚合游标表里的 `source` 也是这两个词。 */
export type AggregateSource = "daily" | "event";

export const AGGREGATE_SOURCES: readonly AggregateSource[] = ["daily", "event"];

export interface Aggregator {
    /** 算一批；返回这一批的行数，0 表示已经追平。同步，自己是一个事务；出错时整批回滚，照原样抛出。 */
    aggregateBatch(source: AggregateSource): number;
    /** 游标：已经算进聚合的最后一行的编号。 */
    cursor(source: AggregateSource): number;
}

/**
 * 记入聚合的应用版本：（服务端日，版本）在这一批的溢出集合 `$overflow`（`[[服务端日, 版本], …]` 的 JSON）里时记 `other`。
 * 集合在 JS 里按“已有的加上先到的”算好，语句里只是查表。
 */
const VERSION = `CASE WHEN (server_day, app_version) IN (SELECT value ->> 0, value ->> 1 FROM json_each($overflow)) THEN '${OVERFLOW_APP_VERSION}' ELSE app_version END`;

const IN_BATCH = "id > $from AND id <= $to";

/** 每日上报的单维度：维度名与取值的写法（`telemetry_daily_count` 的注释）。`usage_enabled` 写成协议里的 `true`、`false`。 */
const DAILY_DIMENSIONS: readonly (readonly [dimension: string, value: string])[] = [
    ["total", "''"],
    ["app_version", VERSION],
    ["channel", "channel"],
    ["form", "form"],
    ["os_version", "os_version"],
    ["arch", "arch"],
    ["locale", "locale"],
    ["region", "region"],
    ["usage_enabled", "CASE usage_enabled WHEN 1 THEN 'true' ELSE 'false' END"],
    ["notice_seen", "notice_seen"],
];

/** 安装周交叉表里 `days_since_last` 的封顶档（迁移里的 CHECK 与注释）。 */
const COHORT_DAYS_CAP = 8;

/** 使用档的单维度（`telemetry_usage_count` 的注释）。只算使用段在的行：使用档的生效版本与使用段同在同不在（迁移的 CHECK）。 */
const USAGE_DIMENSIONS: readonly (readonly [dimension: string, value: string])[] = [
    ["reports", "''"],
    ["crashes", "usage_crashes"],
    ["upgrade", "usage_upgrade"],
];

const add = (column: string): string => `DO UPDATE SET ${column} = ${column} + excluded.${column}`;

const DAILY_STATEMENTS: readonly string[] = [
    ...DAILY_DIMENSIONS.map(
        ([dimension, value]) => `INSERT INTO telemetry_daily_count (server_day, manifest_anonymous, dimension, value, reports)
        SELECT server_day, manifest_anonymous, '${dimension}', ${value}, count(*) FROM telemetry_daily_raw WHERE ${IN_BATCH} GROUP BY 1, 2, 4
        ON CONFLICT (server_day, manifest_anonymous, dimension, value) ${add("reports")}`,
    ),
    `INSERT INTO telemetry_daily_activity (server_day, manifest_anonymous, days_since_last, reports)
        SELECT server_day, manifest_anonymous, days_since_last, count(*) FROM telemetry_daily_raw WHERE ${IN_BATCH} GROUP BY 1, 2, 3
        ON CONFLICT (server_day, manifest_anonymous, days_since_last) ${add("reports")}`,
    `INSERT INTO telemetry_daily_cohort (server_day, manifest_anonymous, install_week, days_since_last, reports)
        SELECT server_day, manifest_anonymous, install_week, min(days_since_last, ${String(COHORT_DAYS_CAP)}), count(*) FROM telemetry_daily_raw WHERE ${IN_BATCH} GROUP BY 1, 2, 3, 4
        ON CONFLICT (server_day, manifest_anonymous, install_week, days_since_last) ${add("reports")}`,
    ...USAGE_DIMENSIONS.map(
        ([dimension, value]) => `INSERT INTO telemetry_usage_count (server_day, manifest_usage, app_version, dimension, value, reports)
        SELECT server_day, manifest_usage, ${VERSION}, '${dimension}', ${value}, count(*) FROM telemetry_daily_raw WHERE ${IN_BATCH} AND manifest_usage IS NOT NULL GROUP BY 1, 2, 3, 5
        ON CONFLICT (server_day, manifest_usage, app_version, dimension, value) ${add("reports")}`,
    ),
    // `json_each` 也有 `id` 一列，编号要写明是原始表的。
    `INSERT INTO telemetry_usage_error (server_day, manifest_usage, app_version, owner, code, count_bucket, reports)
        SELECT server_day, manifest_usage, ${VERSION}, error.value ->> 0, error.value ->> 1, error.value ->> 2, count(*)
        FROM telemetry_daily_raw, json_each(telemetry_daily_raw.usage_errors) AS error
        WHERE telemetry_daily_raw.id > $from AND telemetry_daily_raw.id <= $to AND manifest_usage IS NOT NULL GROUP BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (server_day, manifest_usage, app_version, owner, code, count_bucket) ${add("reports")}`,
];

const EVENT_STATEMENTS: readonly string[] = [
    // 省略了 `code` 的事件在聚合表里记空串（主键的列不能为空，迁移的注释）。
    `INSERT INTO telemetry_event_count (server_day, manifest_usage, app_version, form, kind, code, events)
        SELECT server_day, manifest_usage, ${VERSION}, form, kind, coalesce(code, ''), count(*) FROM telemetry_event_raw WHERE ${IN_BATCH} GROUP BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (server_day, manifest_usage, app_version, form, kind, code) ${add("events")}`,
];

/** 某个服务端日已经进了聚合的真实版本：每日上报看单维度表的 `app_version` 维度，立即事件看事件表。 */
const KNOWN_VERSIONS: Readonly<Record<AggregateSource, string>> = {
    daily: `SELECT DISTINCT value AS version FROM telemetry_daily_count WHERE server_day = $day AND dimension = 'app_version' AND value <> '${OVERFLOW_APP_VERSION}'`,
    event: `SELECT DISTINCT app_version AS version FROM telemetry_event_count WHERE server_day = $day AND app_version <> '${OVERFLOW_APP_VERSION}'`,
};

type BatchParams = {
    readonly $from: number;
    readonly $to: number;
    readonly $overflow: string;
};

interface SourceStatements {
    /** 这一批：选出的行数与最后一行的编号。 */
    readonly bounds: Statement<{rows: number; last: number | null}, [{$from: number; $limit: number}]>;
    /** 这一批里出现的（服务端日，版本），按首次出现的编号排。 */
    readonly versions: Statement<{day: number; version: string}, [{$from: number; $limit: number}]>;
    readonly known: Statement<{version: string}, [{$day: number}]>;
    readonly writes: readonly Statement<unknown, [BatchParams]>[];
}

/**
 * 在 `db` 上建聚合器，语句在这里准备一次。`db` 是模块的业务连接或备份时副本的连接，迁移都已执行；连接用 `strict: true`
 * 打开与否都能用（参数名都带 `$`）。`batchRows` 缺省 `AGGREGATE_BATCH_ROWS`。
 */
export function createAggregator(db: Database, batchRows: number = AGGREGATE_BATCH_ROWS): Aggregator {
    const readCursor = db.query<{last_id: number}, [{$source: string}]>("SELECT last_id FROM telemetry_aggregate_cursor WHERE source = $source");
    const writeCursor = db.query<unknown, [{$source: string; $last: number}]>("UPDATE telemetry_aggregate_cursor SET last_id = $last WHERE source = $source");

    const prepare = (source: AggregateSource): SourceStatements => {
        const batch = `SELECT id, server_day, app_version FROM telemetry_${source}_raw WHERE id > $from ORDER BY id LIMIT $limit`;
        return {
            bounds: db.query<{rows: number; last: number | null}, [{$from: number; $limit: number}]>(`SELECT count(*) AS rows, max(id) AS last FROM (${batch})`),
            versions: db.query<{day: number; version: string}, [{$from: number; $limit: number}]>(`SELECT server_day AS day, app_version AS version FROM (${batch}) GROUP BY server_day, app_version ORDER BY min(id)`),
            known: db.query<{version: string}, [{$day: number}]>(KNOWN_VERSIONS[source]),
            writes: (source === "daily" ? DAILY_STATEMENTS : EVENT_STATEMENTS).map((sql) => db.query<unknown, [BatchParams]>(sql)),
        };
    };
    const statements: Readonly<Record<AggregateSource, SourceStatements>> = {daily: prepare("daily"), event: prepare("event")};

    const cursor = (source: AggregateSource): number => {
        const row = readCursor.get({$source: source});
        // 迁移插了两行初值；没有就是库被改坏了，不能当成 0 从头再算一遍。
        if (row === null) throw new Error(`aggregate cursor row ${source} is missing`);
        return row.last_id;
    };

    /** 这一批里要记成 `other` 的（服务端日，版本）：每一天先数已有的真实版本，新版本按首次出现的顺序占剩下的名额。 */
    const overflowOf = (source: AggregateSource, from: number): [number, string][] => {
        const {versions, known} = statements[source];
        const admitted = new Map<number, Set<string>>();
        const overflow: [number, string][] = [];
        for (const {day, version} of versions.all({$from: from, $limit: batchRows})) {
            let seen = admitted.get(day);
            if (seen === undefined) {
                seen = new Set(known.all({$day: day}).map((row) => row.version));
                admitted.set(day, seen);
            }
            if (seen.has(version)) continue;
            if (seen.size < APP_VERSIONS_PER_PERIOD) seen.add(version);
            else overflow.push([day, version]);
        }
        return overflow;
    };

    const batch = db.transaction((source: AggregateSource): number => {
        const from = cursor(source);
        const {bounds, writes} = statements[source];
        const {rows, last} = bounds.get({$from: from, $limit: batchRows}) ?? {rows: 0, last: null};
        if (last === null) return 0;
        const params: BatchParams = {$from: from, $to: last, $overflow: JSON.stringify(overflowOf(source, from))};
        for (const write of writes) write.run(params);
        writeCursor.run({$source: source, $last: last});
        return rows;
    });

    return {aggregateBatch: (source) => batch(source), cursor};
}

/**
 * 两张原始表都追平为止，一批接一批、中间不让出：给备份的副本用（`backup.ts`，必须同步）。定时任务走 `jobs.ts`，批间让出。
 */
export function aggregateAllNow(aggregator: Aggregator): void {
    for (const source of AGGREGATE_SOURCES) while (aggregator.aggregateBatch(source) > 0);
}

/**
 * 让出事件循环一次，请求在批与批之间处理。用 `setImmediate`：Promise 的微任务排在 I/O 回调之前，`await` 一个已完成的
 * Promise 等于没让出。
 */
export function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 定时任务 `aggregate` 的一轮：两张原始表各自追平为止，批间让出，没有批数上限；`closing()` 为真时在下一批之前收手。
 *
 * 两张表各自出错、互不阻挡（与 `purge.ts` 的“先聚合”同一种写法）：一张表的某一批一直出错时（那一行要到期才被删掉），
 * 另一张表照常进聚合。两张都试过之后，把先出的那个错误抛给调度器，这一轮以失败结束（入口记 `job.failed`）。
 */
export async function aggregateUntilCaughtUp(aggregator: Aggregator, closing: () => boolean): Promise<void> {
    const failures = new Map<AggregateSource, unknown>();
    for (const source of AGGREGATE_SOURCES) {
        try {
            while (!closing() && aggregator.aggregateBatch(source) > 0) await yieldToEventLoop();
        } catch (error) {
            failures.set(source, error);
        }
    }
    const [failure] = failures.values();
    if (failures.size > 0) throw failure;
}
