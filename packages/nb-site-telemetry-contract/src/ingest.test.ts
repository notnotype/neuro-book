import {describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {DailyResponse, EventResponse, INGEST_ERROR_CODES, INGEST_ERROR_STATUS, INGEST_MAX_BODY_BYTES, INGEST_PATHS, INGEST_SUCCESS_STATUS, IngestError} from "./ingest";

describe("写入口的合同（docs/specs/telemetry/protocol.md）", () => {
    it("三个写入口在 /v1 下，请求体上限 16 KiB", () => {
        expect(INGEST_PATHS).toEqual({daily: "/v1/daily", heartbeat: "/v1/heartbeat", event: "/v1/event"});
        expect(INGEST_MAX_BODY_BYTES).toBe(16 * 1024);
        expect(INGEST_SUCCESS_STATUS).toEqual({daily: 200, heartbeat: 204, event: 202});
    });

    it("失败码与 HTTP 状态照失败表，每个码都有状态", () => {
        expect(Object.fromEntries(INGEST_ERROR_CODES.map((code) => [code, INGEST_ERROR_STATUS[code]]))).toEqual({invalid_report: 400, payload_too_large: 413, rate_limited: 429, unavailable: 503});
        expect(Object.keys(INGEST_ERROR_STATUS).sort()).toEqual([...INGEST_ERROR_CODES].sort());
    });

    it("每日上报与立即事件的响应体同形：服务端日、是否重发、被丢弃的字段", () => {
        const body = {serverDay: "2026-11-24", duplicate: false, dropped: ["usage", "manifest.x"]};
        expect(Value.Check(DailyResponse, body)).toBe(true);
        expect(Value.Check(EventResponse, body)).toBe(true);
        expect(Value.Check(DailyResponse, {...body, serverDay: "2026-11-24T00:00:00Z"})).toBe(false);
        expect(Value.Check(DailyResponse, {serverDay: "2026-11-24", duplicate: false})).toBe(false);
    });

    it("失败体：invalid_report 总带 field（字段或 null），别的码只有 code", () => {
        expect(Value.Check(IngestError, {code: "invalid_report", field: "usage.errors.3.code"})).toBe(true);
        expect(Value.Check(IngestError, {code: "invalid_report", field: null})).toBe(true);
        expect(Value.Check(IngestError, {code: "invalid_report"})).toBe(false);
        for (const code of ["payload_too_large", "rate_limited", "unavailable"]) expect(Value.Check(IngestError, {code})).toBe(true);
        expect(Value.Check(IngestError, {code: "internal"})).toBe(false);
    });

    it("失败体不收多余的键：别的码带了 field、invalid_report 多带别的键都不合格", () => {
        for (const body of [{code: "unavailable", field: "channel"}, {code: "rate_limited", field: null}, {code: "payload_too_large", field: null}, {code: "invalid_report", field: null, detail: "x"}]) {
            expect({body, ok: Value.Check(IngestError, body)}).toEqual({body, ok: false});
        }
    });
});
