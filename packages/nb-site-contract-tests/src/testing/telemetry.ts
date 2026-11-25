/**
 * 统计写入口的请求与样例上报（docs/specs/telemetry/protocol.md）。样例按合同包里服务端认识的最新清单版本组装，取值取自
 * 清单的取值表；只造合格的上报，不合格的由用例在它上面改。不含断言。
 *
 * 发到写入口的请求都带沙箱遥测地址的 `Host`：按主机名分派（`site.operations` 的输入一节），别的主机名到不了写入口。
 */

import {randomBytes} from "node:crypto";

import {INGEST_PATHS, LATEST_ANONYMOUS_MANIFEST, LATEST_USAGE_MANIFEST, type AnonymousManifest, type IngestKind} from "@notnotype/nb-site-telemetry-contract";

import {rawHttp, SANDBOX_SITE_URL, SANDBOX_TELEMETRY_URL} from "./site";

export const TELEMETRY_HOST = new URL(SANDBOX_TELEMETRY_URL).host;
export const SITE_HOST = new URL(SANDBOX_SITE_URL).host;

/** 底座的请求上限同 `site.ts`：合同里没有哪个写入口要等这么久。 */
const REQUEST_TIMEOUT_MS = 10_000;

export type Report = Record<string, unknown>;

/** 一个新的上报编号：32 个字符，只含协议许可的字符；每次都不同。 */
export function newReportId(): string {
    return randomBytes(24).toString("base64url");
}

/** 取值表里的第一个取值；清单里这个字段没有取值表时抛错（样例与清单对不上，要改样例）。 */
function firstValue(table: Readonly<Record<string, unknown>> | undefined, field: string): string {
    const value = table === undefined ? undefined : Object.keys(table)[0];
    if (value === undefined) throw new Error(`manifest field ${field} has no listed values`);
    return value;
}

const usageFields = LATEST_USAGE_MANIFEST.usage.fields;

/** 使用档里错误项 `owner` 的取值表（按清单的顺序）；`usage.errors` 的项按 `owner` 与 `code` 不许重复，造两项时要两个 `owner`。 */
export function errorOwners(): string[] {
    const errors = usageFields.errors;
    const owner = errors?.kind === "list" ? errors.item.fields.owner : undefined;
    if (owner?.kind !== "value" || owner.values === undefined) throw new Error("manifest usage.errors.owner has no listed values");
    return Object.keys(owner.values);
}

/** 使用档的一段：一项错误、崩溃与升级各取取值表里的第一个。 */
export function usageSegment(): Report {
    const errors = usageFields.errors;
    if (errors?.kind !== "list") throw new Error("manifest usage.errors is not a list");
    const owner = firstValue(errors.item.fields.owner?.kind === "value" ? errors.item.fields.owner.values : undefined, "usage.errors.owner");
    const code = errors.item.fields.code;
    if (code?.kind !== "dependent") throw new Error("manifest usage.errors.code is not a dependent field");
    const count = errors.item.fields.count;
    return {
        errors: [{owner, code: firstValue(code.valuesBy[owner], "usage.errors.code"), count: firstValue(count?.kind === "value" ? count.values : undefined, "usage.errors.count")}],
        crashes: firstValue(usageFields.crashes?.kind === "value" ? usageFields.crashes.values : undefined, "usage.crashes"),
        upgrade: firstValue(usageFields.upgrade?.kind === "value" ? usageFields.upgrade.values : undefined, "usage.upgrade"),
    };
}

/**
 * 一份合格的每日上报，不带使用段；`withUsage` 为真时带上使用档的版本与一段使用统计。`installWeek` 发 `older`：
 * 它不随服务端日变（具体的周只收服务端日前后的一段），拨过时钟的进程上照样合格。
 *
 * `anonymous` 缺省是服务端认识的最新匿名档；相邻版本测试给第 1 版，上一个版本只认识它发布时的清单。
 */
export function dailyReport(options: {readonly withUsage?: boolean; readonly anonymous?: AnonymousManifest} = {}): Report {
    const withUsage = options.withUsage === true;
    const manifest = options.anonymous ?? LATEST_ANONYMOUS_MANIFEST;
    const anonymous = manifest.daily;
    return {
        manifest: withUsage ? {anonymous: manifest.version, usage: LATEST_USAGE_MANIFEST.version} : {anonymous: manifest.version},
        reportId: newReportId(),
        appVersion: "0.17.0",
        channel: firstValue(anonymous.channel?.values, "channel"),
        form: firstValue(anonymous.form?.values, "form"),
        osVersion: firstValue(anonymous.osVersion?.values, "osVersion"),
        arch: firstValue(anonymous.arch?.values, "arch"),
        locale: firstValue(anonymous.locale?.values, "locale"),
        region: firstValue(anonymous.region?.values, "region"),
        daysSinceLast: 3,
        installWeek: "older",
        usageEnabled: withUsage,
        noticeSeen: firstValue(anonymous.noticeSeen?.values, "noticeSeen"),
        ...(withUsage ? {usage: usageSegment()} : {}),
    };
}

export function heartbeatReport(): Report {
    return {manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version}, appVersion: "0.17.0", form: firstValue(LATEST_ANONYMOUS_MANIFEST.heartbeat.form?.values, "form")};
}

export function eventReport(): Report {
    const kind = LATEST_USAGE_MANIFEST.event.kind;
    const code = LATEST_USAGE_MANIFEST.event.code;
    const kindValue = firstValue(kind?.kind === "value" ? kind.values : undefined, "kind");
    return {
        manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version, usage: LATEST_USAGE_MANIFEST.version},
        reportId: newReportId(),
        appVersion: "0.17.0",
        form: firstValue(LATEST_ANONYMOUS_MANIFEST.event.form?.values, "form"),
        kind: kindValue,
        code: firstValue(code?.kind === "dependent" ? code.valuesBy[kindValue] : undefined, "code"),
    };
}

/** 写入口的一次回应。响应体照原样留着：心跳的 204 没有响应体，底座的 `requestJson` 不收空体。 */
export interface IngestResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly text: string;
    /** 响应体按 JSON 解析的结果；空体或不是 JSON 时为 undefined。 */
    readonly body: unknown;
}

export interface IngestRequest {
    /** 缺省 `JSON.stringify(report)`；给了就照原样发，测请求体本身不对的情况。 */
    readonly body?: string | ReadableStream<Uint8Array>;
    readonly method?: string;
    /** 盖在缺省的 `Host` 与 `Content-Type: application/json` 之上；值为 null 的去掉。 */
    readonly headers?: Readonly<Record<string, string | null>>;
}

/** 解析写入口的响应体；读不成 JSON 时为 undefined，由用例按状态码与原文断言。 */
function parseBody(text: string): unknown {
    if (text === "") return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        // 不是 JSON 也是一种回应，原文在 `text` 里给断言看。
        return undefined;
    }
}

/**
 * 经原始套接字发一份上报，请求头照 `headerLines` 逐行原样写出（另加 `Host`、`Content-Length` 与 `Connection: close`）。
 * `fetch` 的 `Headers` 会把同名头合并成一行，测“请求里有两个同名头”只能这样发。回的是状态码与按 JSON 解析的响应体。
 */
export async function sendRawReport(url: string, kind: IngestKind, report: Report, headerLines: readonly string[]): Promise<{readonly status: number; readonly body: unknown}> {
    const body = JSON.stringify(report);
    const request = [`POST ${INGEST_PATHS[kind]} HTTP/1.1`, `Host: ${TELEMETRY_HOST}`, ...headerLines, `Content-Length: ${String(Buffer.byteLength(body))}`, "Connection: close", "", body].join("\r\n");
    const response = await rawHttp(url, request, REQUEST_TIMEOUT_MS);
    const split = response.indexOf("\r\n\r\n");
    const head = response.slice(0, split);
    // 写入口的响应体都是定长的 JSON；回了分块编码时这里的解析不成立，直接报错，不猜。
    if (/^transfer-encoding:/imu.test(head)) throw new Error("raw ingest response uses Transfer-Encoding; sendRawReport only reads fixed-length bodies");
    const status = Number(/^HTTP\/1\.1 (\d{3})/u.exec(head)?.[1]);
    return {status, body: parseBody(response.slice(split + 4))};
}

/** 往 `url` 上的进程的某个写入口发一份上报（或 `request.body` 的原文）。 */
export async function sendReport(url: string, kind: IngestKind, report: Report | undefined, request: IngestRequest = {}): Promise<IngestResponse> {
    const headers = new Headers({Host: TELEMETRY_HOST, "Content-Type": "application/json"});
    for (const [name, value] of Object.entries(request.headers ?? {})) {
        if (value === null) headers.delete(name);
        else headers.set(name, value);
    }
    const response = await fetch(new URL(INGEST_PATHS[kind].slice(1), url), {
        method: request.method ?? "POST",
        headers,
        ...(request.method === "GET" || request.method === "OPTIONS" ? {} : {body: request.body ?? JSON.stringify(report)}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    return {status: response.status, headers: response.headers, text, body: parseBody(text)};
}
