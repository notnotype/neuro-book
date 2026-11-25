/**
 * 三个写入口（docs/specs/telemetry/protocol.md 的输入一节、输出 1 到 13；docs/specs/site/telemetry-ingest.md 输出 2、8、9、10）。
 * 入口的适配器把这里的子应用挂在写入口主机的 `TELEMETRY_INGEST_PREFIX` 下。
 *
 * 一个请求按协议输出 13 的先后走下面几步，先遇到的决定回应：
 * 1. 内容类型与编码（`acceptsReportBody`）：不读请求体，也不计入限流，网页借访客的浏览器发 `text/plain` 耗不掉访客的额度；
 * 2. 取来源地址，取不到回 503；
 * 3. 限流：从这里起每个请求都计入，包括后面被判 400、413 的；
 * 4. 请求体上限（`hono/body-limit`）；
 * 5. 读请求体、解析 JSON（第 4、5 步读到一半发送方断开时同样按读不成回 400，见 `uploadAbandoned`）；
 * 6. 取一次时间，按它的服务端日校验（`validate.ts`）；
 * 7. 用同一个时间写库（`store.ts`），回应。
 * 只有 `POST` 有路由：别的方法与跨域预检落到入口的 404，也就不回跨域头（协议：写入口不给网页用）。
 *
 * 时序：第 4、5 步读请求体是整条处理里仅有的 `await`。第 6 步取时间之后到写库完成之间都是同步的，写库是一个同步事务，
 * 别的请求与定时任务插不进来；同一次取的时间先交给校验（`installWeek` 的范围）、再交给存储（记入的服务端日、心跳段），
 * 日界上两边算出的是同一天。
 *
 * 来源地址：只在第 2 步取，只交给限流器，不进日志、错误、响应与库（`site.telemetry-ingest` 输出 8）；本包的
 * `architecture.test.ts` 核对 `clientAddress` 只在本文件里被调用。Cookie 与 `Authorization` 不读（协议输出 9）。
 */

import {INGEST_ERROR_STATUS, INGEST_MAX_BODY_BYTES, INGEST_PATHS, INGEST_SUCCESS_STATUS, type IngestErrorCode, type IngestKind} from "@notnotype/nb-site-telemetry-contract";
import {Hono, type Context, type MiddlewareHandler} from "hono";
import {bodyLimit} from "hono/body-limit";

import {formatServerDay, serverDayAt} from "./days";
import type {TelemetryLog} from "./log";
import {RATE_LIMIT_WINDOW_MS, type RateLimiter} from "./rate-limit";
import {isDbUnavailable, type TelemetryStore} from "./store";
import type {ReportValidator, ValidatedRecords} from "./validate";

/** 三个写入口路径共同的前缀；子应用里的路由是去掉它之后的部分。 */
export const TELEMETRY_INGEST_PREFIX = "/v1";

for (const path of Object.values(INGEST_PATHS)) {
    if (!path.startsWith(`${TELEMETRY_INGEST_PREFIX}/`)) throw new Error("every ingest path must start with TELEMETRY_INGEST_PREFIX");
}

export interface IngestOptions {
    readonly store: TelemetryStore;
    readonly validate: ReportValidator;
    readonly limiter: RateLimiter;
    readonly clock: {now(): number};
    readonly log: TelemetryLog;
    /** 入口给的来源地址（`ModuleContext.clientAddress`）；取不到时为 null。 */
    readonly clientAddress: (c: Context) => string | null;
}

/** 同一种数据库错误码一分钟至多记一行：库被占着时每个请求都会撞上，逐个记会刷屏。 */
const DB_UNAVAILABLE_LOG_INTERVAL_MS = 60_000;

/**
 * 内容类型是 `application/json`（媒体类型本身精确比较，不分大小写，可带参数），且没有 `Content-Encoding` 或它是 `identity`
 * （协议的输入一节）。`text/plain;application/json` 的媒体类型是 `text/plain`，不收。不收压缩：Bun 不替请求体解压，
 * 收下来也读不成 JSON。
 *
 * `Content-Type` 只能有一个媒体类型：值里在引号之外出现逗号的不收。请求带了两个 `Content-Type` 头时，运行时把它们
 * 合并成一个逗号分隔的值交上来，所以这一条同时挡住“重复的头”；只看第一个分号之前时，
 * `application/json; charset=utf-8, text/plain` 会被收下。带引号的参数值里可以有逗号；引号到末尾都没闭合的不收：
 * 第一个头的参数里引号没闭合时，合并进来的逗号与第二个类型都落在“引号里”。
 */
function acceptsReportBody(c: Context): boolean {
    const type = c.req.header("content-type");
    if (type === undefined || !isSingleValue(type) || type.split(";", 1)[0]!.trim().toLowerCase() !== "application/json") return false;
    const encoding = c.req.header("content-encoding");
    return encoding === undefined || encoding.trim().toLowerCase() === "identity";
}

/**
 * 头的值是不是只有一个值：带引号的字符串之外没有逗号，引号都闭合了。引号里的 `\` 转义下一个字符（RFC 9110 的
 * quoted-string）。
 */
function isSingleValue(value: string): boolean {
    let quoted = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (quoted) {
            if (char === "\\") index += 1;
            else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === ",") return false;
    }
    return !quoted;
}

/**
 * 读请求体失败时，是不是发送方没发完就断开了：这时 Bun 已经 abort 了请求的 `signal`（读的 reject 是 `AbortError`）。
 * 桌面应用关机、断网、休眠时中途断开是常态，不是程序错误，所以按“请求体读不成”回 400 `invalid_report`、`field` 为 null
 * （响应已经没人收），不抛给入口的 `onError` 记成 error 行与 500。`signal` 没 abort 的读失败照常抛。
 */
function uploadAbandoned(c: Context): boolean {
    return c.req.raw.signal.aborted;
}

function failure(c: Context, code: Exclude<IngestErrorCode, "invalid_report">): Response {
    return c.json({code}, INGEST_ERROR_STATUS[code]);
}

function invalidReport(c: Context, field: string | null): Response {
    return c.json({code: "invalid_report", field}, INGEST_ERROR_STATUS.invalid_report);
}

/** 一种上报校验合格之后怎样写库、怎样回应。写库抛的错由调用方分类。 */
type Writer<K extends IngestKind> = (c: Context, record: ValidatedRecords[K], nowMs: number, dropped: readonly string[]) => Response;

export function createIngestApp(options: IngestOptions): Hono {
    const {store, validate, limiter, clock, log} = options;

    /** 上一次记“取不到来源地址”是在哪个限流窗口：每个窗口至多一行（这一行不带任何地址与转发头）。 */
    let addressMissingLoggedWindow: number | null = null;
    const dbUnavailableLoggedAt = new Map<string, number>();

    // 第 1 到 3 步。来源地址只在这个函数里，判完限流就丢掉。
    const admit: MiddlewareHandler = async (c, next) => {
        if (!acceptsReportBody(c)) return invalidReport(c, null);
        const source = options.clientAddress(c);
        if (source === null) {
            const window = Math.floor(clock.now() / RATE_LIMIT_WINDOW_MS);
            if (addressMissingLoggedWindow !== window) {
                addressMissingLoggedWindow = window;
                log.warn("telemetry.client_address_missing", "ingest request has no usable client address; check NB_SITE_TRUSTED_PROXIES and the proxy's X-Forwarded-For");
            }
            return failure(c, "unavailable");
        }
        const decision = limiter.take(source);
        if (!decision.ok) {
            c.header("Retry-After", String(decision.retryAfterSeconds));
            return failure(c, "rate_limited");
        }
        await next();
    };

    const limitBody = bodyLimit({maxSize: INGEST_MAX_BODY_BYTES, onError: (c) => failure(c, "payload_too_large")});
    // 分块传输的请求体由 `bodyLimit` 边读边数，发送方在这时断开，读的 reject 从它这里出来；`next()` 之后的错误不归这里管。
    const sizeLimit: MiddlewareHandler = async (c, next) => {
        let passed = false;
        try {
            return await limitBody(c, async () => {
                passed = true;
                await next();
            });
        } catch (error) {
            if (passed || !uploadAbandoned(c)) throw error;
            return invalidReport(c, null);
        }
    };

    const logDbUnavailable = (code: string, nowMs: number): void => {
        const last = dbUnavailableLoggedAt.get(code);
        if (last !== undefined && nowMs - last < DB_UNAVAILABLE_LOG_INTERVAL_MS) return;
        dbUnavailableLoggedAt.set(code, nowMs);
        log.warn("telemetry.db_unavailable", "telemetry database is not writable; ingest answers 503", {dbCode: code});
    };

    // 第 5 到 7 步。
    const handler =
        <K extends IngestKind>(kind: K, write: Writer<K>) =>
        async (c: Context): Promise<Response> => {
            let text: string;
            try {
                text = await c.req.text();
            } catch (error) {
                if (!uploadAbandoned(c)) throw error;
                return invalidReport(c, null);
            }
            let body: unknown;
            try {
                body = JSON.parse(text);
            } catch {
                // 读不成 JSON 是请求方的错，按协议回 `field: null`；错误对象里是请求体的片段，不记不传。
                return invalidReport(c, null);
            }
            // 在读完请求体之后取时间：跨午夜的慢请求按读完的那一刻记入（协议输出 1，`site.telemetry-ingest` 输出 2）。
            // 合同用例 C1 只在两次请求之间拨钟，护不住这一点，挪到读请求体之前用例照过。
            const nowMs = clock.now();
            const validated = validate(kind, body, serverDayAt(nowMs));
            if (!validated.ok) return invalidReport(c, validated.field);
            try {
                return write(c, validated.record, nowMs, validated.dropped);
            } catch (error) {
                // 库一时用不了（被别的进程占着写、只读、磁盘满等）回 503，发送方退避重发；约束类错误是程序错误，照常抛给入口（500）。
                if (!isDbUnavailable(error)) throw error;
                logDbUnavailable(error.code ?? "unknown", nowMs);
                return failure(c, "unavailable");
            }
        };

    const writers: {readonly [K in IngestKind]: Writer<K>} = {
        daily: (c, record, nowMs, dropped) => {
            const outcome = store.recordDaily(record, nowMs);
            return c.json({serverDay: formatServerDay(outcome.serverDay), duplicate: outcome.duplicate, dropped}, INGEST_SUCCESS_STATUS.daily);
        },
        heartbeat: (c, record, nowMs) => {
            store.recordHeartbeat(record, nowMs);
            return c.body(null, INGEST_SUCCESS_STATUS.heartbeat);
        },
        event: (c, record, nowMs, dropped) => {
            const outcome = store.recordEvent(record, nowMs);
            return c.json({serverDay: formatServerDay(outcome.serverDay), duplicate: outcome.duplicate, dropped}, INGEST_SUCCESS_STATUS.event);
        },
    };

    const app = new Hono();
    const route = <K extends IngestKind>(kind: K): void => {
        app.post(INGEST_PATHS[kind].slice(TELEMETRY_INGEST_PREFIX.length), admit, sizeLimit, handler(kind, writers[kind]));
    };
    route("daily");
    route("heartbeat");
    route("event");
    return app;
}
