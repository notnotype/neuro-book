/**
 * 写入口在模块里的两条行为，起真实进程的合同测试看不全（docs/specs/site/telemetry-ingest.md 输出 8、10）：
 * 取不到来源地址时日志怎样提醒、库被占着时日志怎样记。模块按入口的做法建（`createTelemetryModule`），库是真的 SQLite 文件，
 * 来源地址与时钟由测试给；请求经 Hono 的 `app.request` 发到写入口子应用，不经入口。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {Database} from "bun:sqlite";

import {INGEST_PATHS, type IngestKind} from "@notnotype/nb-site-telemetry-contract";

import {parseTelemetryConfig} from "./config";
import {formatIsoWeek, serverDayAt} from "./days";
import {createTelemetryModule, TELEMETRY_INGEST_PREFIX, type TelemetryLog, type TelemetryModule} from "./index";
import {RATE_LIMIT_WINDOW_MS} from "./rate-limit";
import {createTestDbRoot, type TestDbRoot} from "./testing/db";

const START = Math.floor(Date.parse("2026-11-24T12:00:00Z") / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
const SOURCE = "198.51.100.23";

interface LoggedLine {
    readonly level: "info" | "warn" | "error";
    readonly event: string;
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>> | undefined;
}

let root: TestDbRoot;
let db: Database;
let lines: LoggedLine[];
let now: number;
let source: string | null;
let module: TelemetryModule;

beforeEach(async () => {
    root = await createTestDbRoot("ingest");
    db = root.open();
    lines = [];
    now = START;
    source = SOURCE;
    const log: TelemetryLog = {
        info: (event, message, fields) => lines.push({level: "info", event, message, fields}),
        warn: (event, message, fields) => lines.push({level: "warn", event, message, fields}),
        error: (event, message, fields) => lines.push({level: "error", event, message, fields}),
    };
    const parsed = parseTelemetryConfig({});
    if (!parsed.ok) throw new Error("default telemetry config is invalid");
    module = createTelemetryModule({db, config: parsed.config, log, clock: {now: () => now}, jobs: {register: () => undefined}, clientAddress: () => source});
});

afterEach(async () => {
    await root.cleanup();
});

function dailyBody(): Record<string, unknown> {
    return {
        manifest: {anonymous: 1},
        reportId: `ingest-test-${crypto.randomUUID()}`,
        appVersion: "0.17.0",
        channel: "stable",
        form: "desktop",
        osVersion: "linux",
        arch: "x64",
        locale: "zh-CN",
        region: "east-asia",
        daysSinceLast: "first",
        installWeek: formatIsoWeek(serverDayAt(now)),
        usageEnabled: false,
        noticeSeen: "wizard",
    };
}

function send(kind: IngestKind, body: unknown): Promise<Response> {
    return Promise.resolve(
        module.ingest.request(INGEST_PATHS[kind].slice(TELEMETRY_INGEST_PREFIX.length), {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}),
    );
}

/** 写出的日志行里没有来源地址的任何一处。 */
function linesMention(text: string): boolean {
    return lines.some((line) => JSON.stringify(line).includes(text));
}

describe("取不到来源地址（site.telemetry-ingest 输出 9 的前提，site.operations 的来源地址）", () => {
    it("回 503 unavailable；每个限流窗口至多记一行 warn，下一个窗口再记", async () => {
        source = null;
        const responses = [await send("daily", dailyBody()), await send("heartbeat", {})];
        now = START + RATE_LIMIT_WINDOW_MS - 1;
        responses.push(await send("daily", dailyBody()));
        expect(await Promise.all(responses.map(async (response) => [response.status, await response.json()]))).toEqual(new Array(3).fill([503, {code: "unavailable"}]));
        expect(lines.map((line) => [line.level, line.event])).toEqual([["warn", "telemetry.client_address_missing"]]);

        now = START + RATE_LIMIT_WINDOW_MS;
        await send("daily", dailyBody());
        expect(lines.map((line) => line.event)).toEqual(["telemetry.client_address_missing", "telemetry.client_address_missing"]);
    });

    it("拿到来源地址的请求在日志里不留地址", async () => {
        const responses = [await send("daily", dailyBody()), await send("daily", {broken: true})];
        expect(responses.map((response) => response.status)).toEqual([200, 400]);
        expect(linesMention(SOURCE)).toBe(false);
    });
});

describe("发送方没发完请求体就断开", () => {
    /**
     * 照 Bun 在对端断开时的做法造请求：先 abort 请求的 signal，请求体的流再以 `AbortError` 出错（真实进程上的复现见
     * w00037 t06 的 Task 记录）。`contentLength` 为真时带 `Content-Length`，读的是 `c.req.text()`；否则是分块传输，
     * 由 `bodyLimit` 边读边数。
     */
    function abandoned(contentLength: boolean): Request {
        const controller = new AbortController();
        const half = new TextEncoder().encode(JSON.stringify(dailyBody()).slice(0, 40));
        const body = new ReadableStream<Uint8Array>({
            start(stream) {
                stream.enqueue(half);
            },
            pull(stream) {
                controller.abort();
                stream.error(new DOMException("The connection was closed.", "AbortError"));
            },
        });
        const headers: Record<string, string> = {"Content-Type": "application/json", ...(contentLength ? {"Content-Length": "400"} : {})};
        return new Request(`http://telemetry.test${INGEST_PATHS.daily.slice(TELEMETRY_INGEST_PREFIX.length)}`, {method: "POST", headers, body, signal: controller.signal, duplex: "half"} as RequestInit);
    }

    it("按读不成请求体回 400 invalid_report、field 为 null，不抛给入口（入口会记成 error 行与 500）", async () => {
        for (const contentLength of [true, false]) {
            const response = await module.ingest.request(abandoned(contentLength));
            expect({contentLength, status: response.status, body: await response.json()}).toEqual({contentLength, status: 400, body: {code: "invalid_report", field: null}});
        }
        expect(lines).toEqual([]);
    });
});

describe("库被别的连接占着写（site.telemetry-ingest 输出 10）", () => {
    let release: () => void;

    beforeEach(() => {
        const other = root.open();
        other.exec("BEGIN IMMEDIATE");
        release = () => other.exec("ROLLBACK");
    });

    it("立即回 503 unavailable；同一种错误码一分钟至多记一行，带错误码、不带别的；放开之后照常写入", async () => {
        const started = performance.now();
        const locked = [await send("daily", dailyBody()), await send("heartbeat", {manifest: {anonymous: 1}, appVersion: "0.17.0", form: "desktop"})];
        const elapsed = performance.now() - started;
        expect(await Promise.all(locked.map(async (response) => [response.status, await response.json()]))).toEqual(new Array(2).fill([503, {code: "unavailable"}]));
        // 等锁的话单是一个请求就要入口给的 250 毫秒；两个请求合起来都到不了。
        expect(elapsed).toBeLessThan(250);
        expect(lines).toEqual([{level: "warn", event: "telemetry.db_unavailable", message: expect.any(String), fields: {dbCode: "SQLITE_BUSY"}}]);

        now += 60_000;
        await send("daily", dailyBody());
        expect(lines.map((line) => line.event)).toEqual(["telemetry.db_unavailable", "telemetry.db_unavailable"]);

        release();
        expect((await send("daily", dailyBody())).status).toBe(200);
    });
});
