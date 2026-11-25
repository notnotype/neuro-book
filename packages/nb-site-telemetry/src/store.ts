/**
 * 把校验过的上报写进统计模块的库（表的形状与约定见 `migrations/0001_init.sql`；行为见 docs/specs/site/telemetry-ingest.md
 * 输出 2、4、11 与协议输出 2）。
 *
 * 时序：每次写是一个同步的 `BEGIN IMMEDIATE` 事务，里面没有 `await`。模块只有一条业务连接，`bun:sqlite` 是同步的，
 * 事务执行期间别的请求与定时任务插不进来，所以不会有两方的语句落进同一个事务（`nb-site-server` 的 `ModuleContext.db`）。
 * 用 `IMMEDIATE`：库被别的进程占着写时在事务开头就报忙，不会读了一半才失败。
 *
 * 失败：这里不接任何数据库错误，照原样抛给调用方。写入口用 `isDbUnavailable` 分出“库一时用不了”（回 503 `unavailable`），
 * 其余的（约束类错误等）是程序错误，照常抛给入口（500）。
 *
 * 连接要按入口的 `openModuleDb` 打开：语句用 `$名字` 的参数，`strict` 开不开都能绑定。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {heartbeatSegmentAt, serverDayAt} from "./days";
import type {DailyRecord, EventRecord, HeartbeatRecord} from "./validate";

/** 每个服务端日、每个心跳段至多这么多个不同的应用版本进聚合，之后新出现的记成 `OVERFLOW_APP_VERSION`（`site.telemetry-ingest` 输出 11）。 */
export const APP_VERSIONS_PER_PERIOD = 64;

/** 超出上限的应用版本记成它。语义化版本的写法里不会出现这个词，所以不会和真实版本混在一起。 */
export const OVERFLOW_APP_VERSION = "other";

/** 记入一份每日上报或立即事件的结果：`serverDay` 是这一份被记入的服务端日，重发时是第一次记入的那天（协议输出 2）。 */
export interface RecordOutcome {
    readonly serverDay: number;
    readonly duplicate: boolean;
}

export interface TelemetryStore {
    /**
     * 记入一份每日上报，`nowMs` 取自模块的时钟、在这一步开始时读（`site.telemetry-ingest` 输出 2）。同一个 `reportId`
     * 已在库里时不写，回第一次的服务端日与 `duplicate: true`，内容不同也一样（协议输出 2）。
     */
    recordDaily(record: DailyRecord, nowMs: number): RecordOutcome;
    /** 记入一条立即事件；去重同 `recordDaily`，编号与每日上报的各自去重。 */
    recordEvent(record: EventRecord, nowMs: number): RecordOutcome;
    /** 让 `nowMs` 所在心跳段里这一格的计数加一（输出 4）；这一段已有上限个不同的应用版本、这个版本又不在其中时记成 `other`。 */
    recordHeartbeat(record: HeartbeatRecord, nowMs: number): void;
}

/** 迁移全部执行过之后再建：语句在这里准备一次。 */
export function createTelemetryStore(db: Database): TelemetryStore {
    const insertDaily = db.query<{id: number}, [Record<string, string | number | null>]>(`
        INSERT INTO telemetry_daily_raw (
            report_id, server_day, manifest_anonymous_declared, manifest_anonymous, manifest_usage_declared, manifest_usage,
            app_version, channel, form, os_version, arch, locale, region, days_since_last, install_week, usage_enabled,
            notice_seen, usage_errors, usage_crashes, usage_upgrade
        ) VALUES (
            $report_id, $server_day, $manifest_anonymous_declared, $manifest_anonymous, $manifest_usage_declared, $manifest_usage,
            $app_version, $channel, $form, $os_version, $arch, $locale, $region, $days_since_last, $install_week, $usage_enabled,
            $notice_seen, $usage_errors, $usage_crashes, $usage_upgrade
        )
        ON CONFLICT (report_id) DO NOTHING
        RETURNING id`);
    const dailyDay = db.query<{server_day: number}, [{$report_id: string}]>("SELECT server_day FROM telemetry_daily_raw WHERE report_id = $report_id");

    const insertEvent = db.query<{id: number}, [Record<string, string | number | null>]>(`
        INSERT INTO telemetry_event_raw (
            report_id, server_day, manifest_anonymous_declared, manifest_anonymous, manifest_usage_declared, manifest_usage,
            app_version, form, kind, code
        ) VALUES (
            $report_id, $server_day, $manifest_anonymous_declared, $manifest_anonymous, $manifest_usage_declared, $manifest_usage,
            $app_version, $form, $kind, $code
        )
        ON CONFLICT (report_id) DO NOTHING
        RETURNING id`);
    const eventDay = db.query<{server_day: number}, [{$report_id: string}]>("SELECT server_day FROM telemetry_event_raw WHERE report_id = $report_id");

    // `other` 不占名额：上限数的是真实的版本。
    const segmentVersions = db.query<{known: number; versions: number}, [{$segment: number; $app_version: string}]>(`
        SELECT
            EXISTS (SELECT 1 FROM telemetry_heartbeat WHERE segment = $segment AND app_version = $app_version) AS known,
            (SELECT count(DISTINCT app_version) FROM telemetry_heartbeat WHERE segment = $segment AND app_version <> '${OVERFLOW_APP_VERSION}') AS versions`);
    const addBeat = db.query<never, [{$segment: number; $manifest_anonymous: number; $app_version: string; $form: string}]>(`
        INSERT INTO telemetry_heartbeat (segment, manifest_anonymous, app_version, form, beats)
        VALUES ($segment, $manifest_anonymous, $app_version, $form, 1)
        ON CONFLICT (segment, manifest_anonymous, app_version, form) DO UPDATE SET beats = beats + 1`);

    /** 插入被唯一约束挡下（没有返回行）时，同一个事务里再读第一次的服务端日；这时那一行必然在。 */
    const outcome = (inserted: {id: number} | null, serverDay: number, firstDay: () => {server_day: number} | null): RecordOutcome => {
        if (inserted !== null) return {serverDay, duplicate: false};
        const first = firstDay();
        if (first === null) throw new Error("report id conflicted but no row holds it");
        return {serverDay: first.server_day, duplicate: true};
    };

    const recordDaily = db.transaction((record: DailyRecord, serverDay: number): RecordOutcome => {
        const usage = record.usage;
        const inserted = insertDaily.get({
            $report_id: record.reportId,
            $server_day: serverDay,
            $manifest_anonymous_declared: record.anonymous.declared,
            $manifest_anonymous: record.anonymous.effective,
            $manifest_usage_declared: record.usageDeclared,
            $manifest_usage: usage?.version ?? null,
            $app_version: record.appVersion,
            $channel: record.channel,
            $form: record.form,
            $os_version: record.osVersion,
            $arch: record.arch,
            $locale: record.locale,
            $region: record.region,
            $days_since_last: record.daysSinceLast,
            $install_week: record.installWeek,
            $usage_enabled: record.usageEnabled ? 1 : 0,
            $notice_seen: record.noticeSeen,
            $usage_errors: usage === null ? null : JSON.stringify(usage.errors),
            $usage_crashes: usage?.crashes ?? null,
            $usage_upgrade: usage?.upgrade ?? null,
        });
        return outcome(inserted, serverDay, () => dailyDay.get({$report_id: record.reportId}));
    });

    const recordEvent = db.transaction((record: EventRecord, serverDay: number): RecordOutcome => {
        const inserted = insertEvent.get({
            $report_id: record.reportId,
            $server_day: serverDay,
            $manifest_anonymous_declared: record.anonymous.declared,
            $manifest_anonymous: record.anonymous.effective,
            $manifest_usage_declared: record.usage.declared,
            $manifest_usage: record.usage.effective,
            $app_version: record.appVersion,
            $form: record.form,
            $kind: record.kind,
            $code: record.code,
        });
        return outcome(inserted, serverDay, () => eventDay.get({$report_id: record.reportId}));
    });

    const recordHeartbeat = db.transaction((record: HeartbeatRecord, segment: number): void => {
        const seen = segmentVersions.get({$segment: segment, $app_version: record.appVersion});
        const full = seen !== null && seen.known === 0 && seen.versions >= APP_VERSIONS_PER_PERIOD;
        addBeat.run({$segment: segment, $manifest_anonymous: record.anonymousVersion, $app_version: full ? OVERFLOW_APP_VERSION : record.appVersion, $form: record.form});
    });

    return {
        recordDaily: (record, nowMs) => recordDaily.immediate(record, serverDayAt(nowMs)),
        recordEvent: (record, nowMs) => recordEvent.immediate(record, serverDayAt(nowMs)),
        recordHeartbeat: (record, nowMs) => recordHeartbeat.immediate(record, heartbeatSegmentAt(nowMs)),
    };
}

/**
 * SQLite 的主结果码（`SQLiteError.errno` 是扩展结果码，低 8 位就是主结果码，见 sqlite.org/rescode.html）里算作
 * “库一时用不了”的几类：别的进程占着写（BUSY）、库或它的日志文件不可写（READONLY、CANTOPEN）、读写错误（IOERR）、
 * 磁盘满（FULL）。按主结果码分，扩展码（例如 `SQLITE_IOERR_WRITE`、`SQLITE_BUSY_SNAPSHOT`）都归到各自的类里。
 *
 * 不收 LOCKED（6）：SQLite 只在同一条连接内的冲突（例如有语句正读着一张表时对它改结构）或共享缓存的另一条连接上回它；
 * 入口不开共享缓存，别的进程占着写回的是 BUSY。所以在这里它只会是本模块自己的程序错误，照常抛（500），
 * 不能当成 503 让发送方退避重发、把问题藏起来。
 */
const UNAVAILABLE_PRIMARY_CODES: ReadonlySet<number> = new Set([
    5, // SQLITE_BUSY
    8, // SQLITE_READONLY
    10, // SQLITE_IOERR
    13, // SQLITE_FULL
    14, // SQLITE_CANTOPEN
]);

/**
 * 写库失败是不是“库一时用不了”（`site.telemetry-ingest` 输出 10，写入口回 503 `unavailable`）。依据是 `bun:sqlite` 的
 * `SQLiteError.errno`（`sqlite3_extended_errcode`）的低 8 位，不看说明文字；日志里记 `error.code`（错误码的名字）。
 * 约束类（`SQLITE_CONSTRAINT_*`）与别的错误为 false：那是程序错误，调用方照常抛出。
 */
export function isDbUnavailable(error: unknown): error is SQLiteError {
    return error instanceof SQLiteError && UNAVAILABLE_PRIMARY_CODES.has(error.errno & 0xff);
}
