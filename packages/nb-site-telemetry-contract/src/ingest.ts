/**
 * 三个写入口的 HTTP 合同（docs/specs/telemetry/protocol.md 的输入、输出 1 到 12 与失败表；`unavailable` 见
 * docs/specs/site/telemetry-ingest.md）。写入口在单独的遥测主机上，路径不带 `TELEMETRY_API_PREFIX`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 三个写入口的路径。不兼容的改动换新路径，旧路径留到旧版本的应用不再上报（协议的“边界与兼容”）。 */
export const INGEST_PATHS = {daily: "/v1/daily", heartbeat: "/v1/heartbeat", event: "/v1/event"} as const;

export type IngestKind = keyof typeof INGEST_PATHS;

/** 请求体上限：16 KiB，超过回 413（协议输出 11）。 */
export const INGEST_MAX_BODY_BYTES = 16384;

/** 合格上报的 HTTP 状态：每日上报 200、心跳 204（没有响应体）、立即事件 202（协议输出 1、7、8）。 */
export const INGEST_SUCCESS_STATUS = {daily: 200, heartbeat: 204, event: 202} as const satisfies Record<IngestKind, number>;

/** 失败码（运行时数组：服务端、合同测试按它穷尽）。 */
export const INGEST_ERROR_CODES = ["invalid_report", "payload_too_large", "rate_limited", "unavailable"] as const;

export type IngestErrorCode = (typeof INGEST_ERROR_CODES)[number];

/** 每个失败码的 HTTP 状态；发送方按码决定丢弃还是重发（协议的失败表）。 */
export const INGEST_ERROR_STATUS = {invalid_report: 400, payload_too_large: 413, rate_limited: 429, unavailable: 503} as const satisfies Record<IngestErrorCode, number>;

/**
 * 每日上报 200 的响应体；立即事件 202 的响应体与它同形（协议输出 8）。`serverDay` 是记入的服务端日（UTC），
 * 重发时是第一次记入的那天；`dropped` 是被丢弃的字段，嵌套的写点分路径。
 */
export const DailyResponse = Type.Object({
    serverDay: Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}$"}),
    duplicate: Type.Boolean(),
    dropped: Type.Array(Type.String()),
});

export type DailyResponse = Static<typeof DailyResponse>;

export const EventResponse = DailyResponse;

export type EventResponse = DailyResponse;

/**
 * 失败的响应体（协议输出 12）：`invalid_report` 总带 `field`，是出问题的字段（嵌套的写点分路径），请求体读不成 JSON 对象、
 * 或内容类型与编码不对时为 null；别的码只有 `code`。两个分支都不收多余的键：这是服务端回应的形状，
 * 拿它核对替代实现时，多发一个 `field` 也要判成不合格。
 */
export const IngestError = Type.Union([
    Type.Object({code: Type.Literal("invalid_report"), field: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false}),
    Type.Object({code: Type.Union(INGEST_ERROR_CODES.filter((code) => code !== "invalid_report").map((code) => Type.Literal(code)))}, {additionalProperties: false}),
]);

export type IngestError = Static<typeof IngestError>;
