/**
 * 聚合、删除与备份的包内测试共用的造数与读数：记录用真的校验器从请求体做出来（与写入口拿到的同形状），经真的存储写库；
 * 读数按表把聚合整张读出来，用来比较“两种做法算出的聚合相同”。不含断言。
 */

import type {Database} from "bun:sqlite";

import {DAY_MS, formatIsoWeek, serverDayAt} from "../days";
import {validateReport, type DailyRecord, type EventRecord} from "../validate";

/** 测试里的“现在”：2026-11-24 正午（UTC）。 */
export const NOW = Date.parse("2026-11-24T12:00:00Z");
export const TODAY = serverDayAt(NOW);

/** 第 `day` 个服务端日里的一刻（缺省正午）。 */
export function dayAt(day: number, offsetMs = DAY_MS / 2): number {
    return day * DAY_MS + offsetMs;
}

/** 每份编号都不同、长度合规的上报编号。 */
export function reportId(prefix: string, index: number): string {
    return `${prefix}-${index.toString(36).padStart(20, "0")}`;
}

/** 一份合格的每日上报；`overrides` 照请求体的字段名覆盖。`day` 是校验用的服务端日（安装周的范围按它算）。 */
export function dailyRecord(overrides: Record<string, unknown> = {}, day = TODAY): DailyRecord {
    const body = {
        manifest: {anonymous: 1},
        reportId: reportId("daily", 0),
        appVersion: "0.17.0",
        channel: "stable",
        form: "desktop",
        osVersion: "linux",
        arch: "x64",
        locale: "zh-CN",
        region: "east-asia",
        daysSinceLast: "first",
        installWeek: formatIsoWeek(day),
        usageEnabled: false,
        noticeSeen: "wizard",
        ...overrides,
    };
    const result = validateReport("daily", body, day);
    if (!result.ok) throw new Error(`fixture is invalid at ${result.field}`);
    return result.record;
}

/** 带使用段的每日上报要的几个字段，与 `dailyRecord` 的覆盖合用。 */
export function withUsage(usage: {errors?: readonly {owner: string; code: string; count: string}[]; crashes?: string; upgrade?: string} = {}): Record<string, unknown> {
    return {manifest: {anonymous: 1, usage: 1}, usageEnabled: true, usage: {errors: [], crashes: "0", upgrade: "none", ...usage}};
}

export function eventRecord(overrides: Record<string, unknown> = {}, day = TODAY): EventRecord {
    const result = validateReport("event", {manifest: {anonymous: 1, usage: 1}, reportId: reportId("event", 0), appVersion: "0.17.0", form: "desktop", kind: "crash", ...overrides}, day);
    if (!result.ok) throw new Error(`fixture is invalid at ${result.field}`);
    return result.record;
}

/** 全部聚合表的全部行；游标不在里面。 */
export const AGGREGATE_TABLES = ["telemetry_daily_count", "telemetry_daily_activity", "telemetry_daily_cohort", "telemetry_usage_count", "telemetry_usage_error", "telemetry_event_count"] as const;

export function aggregateTables(db: Database): Record<(typeof AGGREGATE_TABLES)[number], unknown[]> {
    // 按整行的写法排：几张表的列数不同，行的先后与比较无关。
    const rows = (table: string): unknown[] => db.query(`SELECT * FROM ${table}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return Object.fromEntries(AGGREGATE_TABLES.map((table) => [table, rows(table)])) as Record<(typeof AGGREGATE_TABLES)[number], unknown[]>;
}

/** 两张原始表各有几行。 */
export function rawRows(db: Database): {daily: number; event: number} {
    const count = (table: string): number => db.query<{rows: number}, []>(`SELECT count(*) AS rows FROM ${table}`).get()?.rows ?? 0;
    return {daily: count("telemetry_daily_raw"), event: count("telemetry_event_raw")};
}
