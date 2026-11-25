import {describe, expect, it} from "bun:test";

import {parseTelemetryConfig} from "./config";

const NAMES = ["NB_SITE_TELEMETRY_RETENTION_DAYS", "NB_SITE_TELEMETRY_RATE_LIMIT", "NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS"] as const;

describe("统计模块的配置（site.telemetry-ingest 的输入一节）", () => {
    it("三个变量都没给或是空串时取缺省：保留 7 天、每窗口 600 个、聚合间隔 600 秒", () => {
        const expected = {ok: true, config: {retentionDays: 7, rateLimit: 600, aggregateIntervalMs: 600_000}} as const;
        expect(parseTelemetryConfig({})).toEqual(expected);
        expect(parseTelemetryConfig(Object.fromEntries(NAMES.map((name) => [name, ""])))).toEqual(expected);
    });

    it("范围的两端都收", () => {
        expect(parseTelemetryConfig({NB_SITE_TELEMETRY_RETENTION_DAYS: "2", NB_SITE_TELEMETRY_RATE_LIMIT: "1", NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS: "60"})).toEqual({
            ok: true,
            config: {retentionDays: 2, rateLimit: 1, aggregateIntervalMs: 60_000},
        });
        expect(parseTelemetryConfig({NB_SITE_TELEMETRY_RETENTION_DAYS: "7", NB_SITE_TELEMETRY_RATE_LIMIT: "1000000", NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS: "86400"})).toEqual({
            ok: true,
            config: {retentionDays: 7, rateLimit: 1_000_000, aggregateIntervalMs: 86_400_000},
        });
    });

    it("越过两端报 out_of_range，三个变量各自报、只带变量名", () => {
        expect(parseTelemetryConfig({NB_SITE_TELEMETRY_RETENTION_DAYS: "1", NB_SITE_TELEMETRY_RATE_LIMIT: "1000001", NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS: "59"})).toEqual({
            ok: false,
            problems: NAMES.map((name) => ({name, problem: "out_of_range"})),
        });
        expect(parseTelemetryConfig({NB_SITE_TELEMETRY_RETENTION_DAYS: "8"})).toEqual({ok: false, problems: [{name: "NB_SITE_TELEMETRY_RETENTION_DAYS", problem: "out_of_range"}]});
        expect(parseTelemetryConfig({NB_SITE_TELEMETRY_RATE_LIMIT: "-1"})).toEqual({ok: false, problems: [{name: "NB_SITE_TELEMETRY_RATE_LIMIT", problem: "out_of_range"}]});
    });

    it("不是整数写法的报 not_integer", () => {
        for (const value of ["7.0", "1e3", "seven", " 7", "0x10"]) {
            expect({value, result: parseTelemetryConfig({NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS: value})}).toEqual({
                value,
                result: {ok: false, problems: [{name: "NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS", problem: "not_integer"}]},
            });
        }
    });
});
