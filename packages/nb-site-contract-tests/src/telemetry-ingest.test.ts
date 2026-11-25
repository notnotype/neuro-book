/**
 * 统计的三个写入口的黑盒合同（docs/specs/telemetry/protocol.md；docs/specs/site/telemetry-ingest.md 输出 1 到 4、8、9、10、
 * 时序与失败表；docs/specs/site/operations.md 的来源地址、按主机名分派与输出 6 的备份）：起真实的 `nb-site` 进程，只经 HTTP 与数据目录的
 * 文件看它。断言只用 Spec 写明的状态码、码、字段与响应头；日志只看 Spec 写明的 `http.request` 那一行与它的 `durationMs`。
 *
 * 所有请求都来自 127.0.0.1，同一个进程上的用例共用一份限流额度，所以除限流的几组外都给很大的额度。
 * 随时间变化的行为（服务端日、限流的时间窗）经测试控制入口拨时间；拨过的时间只往前走，几个用例共用一个进程时，
 * 每个用例都从 `advanceClock` 返回的当前时间算期望值，不假定别的用例拨过多少。
 *
 * 时间预算：起进程放在各组的 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 *
 * 本文件测不到、在别处的：
 * - 聚合的数（输出 5、6、7、11，验收 1 的“那一天的聚合数不变”）：第一版没有读聚合的接口，在统计包的 `aggregate.test.ts`、
 *   `purge.test.ts`，t11 的看板接口再补黑盒。这里只从文件看两条弱的：到期删除之后数据目录里找不到上报编号（C15），
 *   备份的副本里有聚合进去的应用版本、没有上报编号（C16）。
 * - 删除前先聚合、聚合出错时这一轮删不删、截断检查点做不完、批间让出与 `close()` 收手：要造库的状态，在统计包的
 *   `purge.test.ts`、`index.test.ts`。
 * - 心跳“库里没有 3 条可分辨的记录”（验收 2）、IPv6 按前 64 位与前 48 位计、来源数的上限：合同测试只能从 127.0.0.1 发请求、
 *   不读库的表，在统计包的 `store.test.ts`、`rate-limit.test.ts`。
 * - 验收 4 的“同时账号的登录接口正常”：账号模块还没有登录接口，t07 加进“库被占着写”那一组。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {copyFile} from "node:fs/promises";
import {join} from "node:path";

import {INGEST_MAX_BODY_BYTES, LATEST_ANONYMOUS_MANIFEST, LATEST_USAGE_MANIFEST, TELEMETRY_API_PREFIX, type IngestKind} from "@notnotype/nb-site-telemetry-contract";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {backupsDir, listBackups} from "./testing/backup";
import {holdWriteLock} from "./testing/fault";
import {dataFilesContaining} from "./testing/files";
import {requestJson, useSiteSandbox, type LogLine, type SiteProcess} from "./testing/site";
import {dailyReport, errorOwners, eventReport, heartbeatReport, newReportId, sendReport, SITE_HOST, TELEMETRY_HOST, usageSegment, type IngestResponse, type Report} from "./testing/telemetry";

const sandbox = useSiteSandbox("nb-site-contract-tests telemetry-ingest.test.ts");

const SETUP_TIMEOUT_MS = 30_000;

/** 不测限流的进程给的额度：一个文件里所有请求加起来都到不了。 */
const LARGE_LIMIT = {NB_SITE_TELEMETRY_RATE_LIMIT: "100000"};

const DAY_MS = 86_400_000;
/** 限流的对齐时间窗（`site.telemetry-ingest` 输出 9：每小时的 0、10、20 分起）。 */
const WINDOW_MS = 600_000;

/** `ms` 那一刻的 UTC 日期，`YYYY-MM-DD`（协议输出 1 的 `serverDay`）。 */
function utcDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** 进程看到的当前时间：拨 1 毫秒，取它返回的 `now`。 */
function serverNow(site: SiteProcess): Promise<number> {
    return site.advanceClock(1);
}

/** 把进程的时钟拨到下一个限流窗口的开头，之后的请求落在一个新的窗口里。 */
async function toNextWindow(site: SiteProcess): Promise<void> {
    const now = await serverNow(site);
    await site.advanceClock(WINDOW_MS - (now % WINDOW_MS));
}

/** 进程写出这个请求的 `http.request` 那一行（按响应头 `X-Request-Id` 找）。日志与响应各走各的管道，要等它到。 */
async function requestLine(site: SiteProcess, response: {readonly headers: Headers}): Promise<LogLine> {
    const requestId = response.headers.get("X-Request-Id");
    if (requestId === null) throw new Error("response has no X-Request-Id");
    return waitUntil("http.request line for the request", () => site.logs().find((line) => line.event === "http.request" && line.requestId === requestId));
}

/** 比较用：状态码与响应体。 */
function outcome(response: {readonly status: number; readonly body: unknown}): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

/** 盖在请求缺省头上的几个头；值为 null 的去掉。 */
type Headers_ = Readonly<Record<string, string | null>>;

const invalid = (field: string | null) => ({status: 400, body: {code: "invalid_report", field}});

/** 进程的两路输出与数据目录里找不到 `needle`；找到时报出在哪里。 */
function placesContaining(site: SiteProcess, dataDir: string, needle: string): string[] {
    const output = [site.stdout().includes(needle) ? ["stdout"] : [], site.stderr().includes(needle) ? ["stderr"] : []].flat();
    return [...output, ...dataFilesContaining(dataDir, needle)];
}

describe("写入口的回应（协议输出 1 到 9、11、12，Smoke）", () => {
    let site: SiteProcess;
    let dataDir: string;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: LARGE_LIMIT});
    }, SETUP_TIMEOUT_MS);

    it("C1 合格的每日上报：200，serverDay 是进程时钟的 UTC 日期、不是重发、没有丢弃；拨过 1 天后另一份的 serverDay 跟着走（输出 1，site 输出 2）", async () => {
        const now = await serverNow(site);
        const first = await sendReport(site.url, "daily", dailyReport());
        expect(outcome(first)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: false, dropped: []}});

        const later = await site.advanceClock(DAY_MS);
        const second = await sendReport(site.url, "daily", dailyReport({withUsage: true}));
        expect(outcome(second)).toEqual({status: 200, body: {serverDay: utcDate(later), duplicate: false, dropped: []}});
    });

    it("C2 同一份发两次：都是 200，第二次是重发；拨过 1 天再发，serverDay 仍是第一次的（输出 2，验收 1）", async () => {
        const now = await serverNow(site);
        const report = dailyReport();
        const first = await sendReport(site.url, "daily", report);
        const again = await sendReport(site.url, "daily", report);
        await site.advanceClock(DAY_MS);
        const nextDay = await sendReport(site.url, "daily", {...report, channel: "canary"});
        expect(outcome(first)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: false, dropped: []}});
        expect(outcome(again)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: true, dropped: []}});
        // 重发的内容与第一次不同也按重发处理（输出 2）。
        expect(outcome(nextDay)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: true, dropped: []}});
    });

    it("C3 顶层与嵌套的不认识字段：200，dropped 写点分路径、数组里的不带下标且不重复（输出 3，验收 2）", async () => {
        const segment = usageSegment();
        const [item] = segment.errors as Report[];
        // 第二项换一个 owner：同一个 owner 与 code 的组合只许出现一次。
        const second = {...item, owner: errorOwners()[1], x: 2};
        const base = dailyReport({withUsage: true});
        const report = {
            ...base,
            extra: true,
            manifest: {...(base.manifest as Report), x: 1},
            usage: {...segment, x: 1, errors: [{...item, x: 1}, second]},
        };
        const response = await sendReport(site.url, "daily", report);
        expect(response.status).toBe(200);
        const body = response.body as {readonly serverDay: string; readonly dropped: readonly string[]; readonly duplicate: boolean};
        expect(body.duplicate).toBe(false);
        expect([...body.dropped].sort()).toEqual(["extra", "manifest.x", "usage.errors.x", "usage.x"]);
        // “其余字段照常记入”：同一个编号再发一次是重发、回第一次的服务端日，说明第一次确实记入了。
        expect(outcome(await sendReport(site.url, "daily", report))).toMatchObject({status: 200, body: {serverDay: body.serverDay, duplicate: true}});
    });

    it("C4 按清单逐个字段造不合格的值：缺字段、不在取值表里、整数越界、写法不对，各自 400 并指向那个字段（输出 4、12）", async () => {
        const cases: [string, Report][] = [];
        const daily = (): Report => dailyReport({withUsage: true});
        // 清单第 1 版的每个匿名档字段：缺了、或取一个哪个字段都不收的值。
        // usageEnabled 不为真而带了使用段时先报 usage（输出 13 的先后），测它自己时用不带使用段的上报。
        for (const name of ["manifest", "reportId", ...Object.keys(LATEST_ANONYMOUS_MANIFEST.daily)]) {
            const base = (): Report => (name === "usageEnabled" ? dailyReport() : daily());
            const missing = base();
            delete missing[name];
            cases.push([name, missing]);
            if (name !== "manifest") cases.push([name, {...base(), [name]: "not-a-listed-value"}]);
        }
        const withUsage = (usage: Report): Report => ({...daily(), usage: {...usageSegment(), ...usage}});
        const errorItem = (usage: Report): Report => withUsage({errors: [{...((usageSegment().errors as Report[])[0] as Report), ...usage}]});
        cases.push(
            ["osVersion", {...daily(), osVersion: "linux-6"}],
            ["locale", {...daily(), locale: "en"}],
            ["daysSinceLast", {...daily(), daysSinceLast: 0}],
            ["daysSinceLast", {...daily(), daysSinceLast: 29}],
            ["appVersion", {...daily(), appVersion: "v0.17.0"}],
            ["appVersion", {...daily(), appVersion: `0.17.0-${"a".repeat(32)}`}],
            ["installWeek", {...daily(), installWeek: "2026-48"}],
            ["reportId", {...daily(), reportId: "too-short"}],
            ["manifest.anonymous", {...daily(), manifest: {anonymous: 0, usage: LATEST_USAGE_MANIFEST.version}}],
            // 第 1 版的码表在每个 `owner` 名下都只有 other。
            ["usage.errors.0.code", errorItem({code: "provider.timeout"})],
            ["usage.errors.0.count", errorItem({count: "3"})],
            ["usage.errors.0.owner", errorItem({owner: "nbook.not-a-plugin"})],
            ["usage.crashes", withUsage({crashes: "lots"})],
        );
        const event = (overrides: Report): Report => ({...eventReport(), ...overrides});
        const eventCases: [string, Report][] = [
            ["kind", event({kind: "freeze"})],
            ["code", event({code: "provider.timeout"})],
            ["manifest.usage", event({manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version}})],
        ];
        // 几十个请求并发发出，一个用例里逐条比对；失败信息里带着字段名，拆成几十个用例反而难读。
        const [dailyResults, eventResults] = await Promise.all([
            Promise.all(cases.map(async ([field, report]) => ({field, got: outcome(await sendReport(site.url, "daily", report))}))),
            Promise.all(eventCases.map(async ([field, report]) => ({field, got: outcome(await sendReport(site.url, "event", report))}))),
        ]);
        for (const {field, got} of [...dailyResults, ...eventResults]) expect({field, got}).toEqual({field, got: invalid(field)});
    });

    it("C5 匿名档版本比服务端新：200；使用档版本比服务端新：200，使用段整段丢弃并列在 dropped 里；两种都被记入（输出 5，验收 4）", async () => {
        const now = await serverNow(site);
        const anonymousReport = {...dailyReport(), manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version + 1}};
        const newerAnonymous = await sendReport(site.url, "daily", anonymousReport);
        expect(outcome(newerAnonymous)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: false, dropped: []}});
        // 使用段的内容不看：里面写什么都整段丢弃。
        const usageReport = {
            ...dailyReport({withUsage: true}),
            manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version, usage: LATEST_USAGE_MANIFEST.version + 1},
            usage: {errors: "anything", future: 1},
        };
        const newerUsage = await sendReport(site.url, "daily", usageReport);
        expect(outcome(newerUsage)).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: false, dropped: ["usage"]}});
        // “匿名档字段被记入”：同一个编号再发一次是重发，回第一次的服务端日。
        expect(outcome(await sendReport(site.url, "daily", anonymousReport))).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: true, dropped: []}});
        expect(outcome(await sendReport(site.url, "daily", usageReport))).toEqual({status: 200, body: {serverDay: utcDate(now), duplicate: true, dropped: ["usage"]}});
    });

    it("C6 usageEnabled 为假却带使用段：400，指向 usage（输出 6，验收 3）", async () => {
        const report = {...dailyReport({withUsage: true}), usageEnabled: false};
        expect(outcome(await sendReport(site.url, "daily", report))).toEqual(invalid("usage"));
    });

    it("C7 心跳：204，没有响应体（输出 7，Smoke）", async () => {
        // 用原始的 fetch：底座的 JSON 助手不收空的响应体。
        const response = await fetch(new URL("v1/heartbeat", site.url), {
            method: "POST",
            headers: {Host: TELEMETRY_HOST, "Content-Type": "application/json"},
            body: JSON.stringify(heartbeatReport()),
        });
        expect(response.status).toBe(204);
        expect(await response.text()).toBe("");
    });

    it("C8 立即事件：202，响应体与每日上报同形；重发是 duplicate（输出 8，Smoke）", async () => {
        const now = await serverNow(site);
        const report = eventReport();
        const first = await sendReport(site.url, "event", report);
        const again = await sendReport(site.url, "event", report);
        expect(outcome(first)).toEqual({status: 202, body: {serverDay: utcDate(now), duplicate: false, dropped: []}});
        expect(outcome(again)).toEqual({status: 202, body: {serverDay: utcDate(now), duplicate: true, dropped: []}});
        // 立即事件与每日上报的编号各自去重：用同一个编号的每日上报不是重发。
        const daily = await sendReport(site.url, "daily", {...dailyReport(), reportId: report.reportId});
        expect(outcome(daily)).toMatchObject({status: 200, body: {duplicate: false}});
    });

    it("C9 带 Cookie 与 Authorization：照常 200；标准输出、标准错误与数据目录的文件里都没有它们（输出 9）", async () => {
        const cookie = "nbCookieValue-Qz81Lm";
        const credential = "nbBearerValue-Wx52Kp";
        const response = await sendReport(site.url, "daily", dailyReport(), {headers: {Cookie: `session=${cookie}`, Authorization: `Bearer ${credential}`}});
        expect(response.status).toBe(200);
        await requestLine(site, response);
        for (const needle of [cookie, credential]) expect({needle, found: placesContaining(site, dataDir, needle)}).toEqual({needle, found: []});
    });

    it("C11 请求体恰好 16384 字节不是 413；16385 字节与分块传输的大请求体 413、16384 字节的分块请求 200；过大且内容类型不对时先报内容类型（输出 11、13）", async () => {
        const padded = (bytes: number): string => {
            const report = dailyReport();
            const bare = JSON.stringify({...report, pad: ""});
            return JSON.stringify({...report, pad: "x".repeat(bytes - Buffer.byteLength(bare))});
        };
        const exact = padded(INGEST_MAX_BODY_BYTES);
        const over = padded(INGEST_MAX_BODY_BYTES + 1);
        expect([Buffer.byteLength(exact), Buffer.byteLength(over)]).toEqual([INGEST_MAX_BODY_BYTES, INGEST_MAX_BODY_BYTES + 1]);

        const accepted = await sendReport(site.url, "daily", undefined, {body: exact});
        expect(outcome(accepted)).toMatchObject({status: 200, body: {dropped: ["pad"]}});
        expect(outcome(await sendReport(site.url, "daily", undefined, {body: over}))).toEqual({status: 413, body: {code: "payload_too_large"}});

        // 流式的请求体没有 Content-Length，按分块传输发：服务端边读边数。
        const chunked = (text: string): ReadableStream<Uint8Array> =>
            new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(text));
                    controller.close();
                },
            });
        expect(outcome(await sendReport(site.url, "daily", undefined, {body: chunked(padded(20_000))}))).toEqual({status: 413, body: {code: "payload_too_large"}});
        // 不超过上限的分块请求照常收：服务端把读过的块重新交给后面的步骤。
        expect(outcome(await sendReport(site.url, "daily", undefined, {body: chunked(padded(INGEST_MAX_BODY_BYTES))}))).toMatchObject({status: 200, body: {duplicate: false, dropped: ["pad"]}});

        expect(outcome(await sendReport(site.url, "daily", undefined, {body: over, headers: {"Content-Type": "text/plain"}}))).toEqual(invalid(null));
    });

    it("C12 内容类型不是 application/json、或带压缩：400，field 为 null；带参数与大小写不同的 application/json、identity 编码照收（输入一节，输出 12）", async () => {
        const rejected = await Promise.all(
            ([{"Content-Type": "text/plain"}, {"Content-Type": "text/plain;application/json"}, {"Content-Type": null}, {"Content-Encoding": "gzip"}] as Headers_[]).map(async (headers) => ({
                headers,
                got: outcome(await sendReport(site.url, "daily", dailyReport(), {headers})),
            })),
        );
        for (const {headers, got} of rejected) expect({headers, got}).toEqual({headers, got: invalid(null)});

        const accepted = await Promise.all(
            ([{"Content-Type": "application/json; charset=utf-8"}, {"Content-Type": "Application/JSON"}, {"Content-Encoding": "identity"}] as Headers_[]).map(async (headers) => ({
                headers,
                status: (await sendReport(site.url, "daily", dailyReport(), {headers})).status,
            })),
        );
        for (const {headers, status} of accepted) expect({headers, status}).toEqual({headers, status: 200});
    });

    it("C18 只有写入口主机上的 POST 能到写入口：GET 与跨域预检 404、不回跨域头；写入口路径发到站点主机 404；主机名不分大小写、不看端口、忽略末尾的点", async () => {
        const get = await sendReport(site.url, "daily", undefined, {method: "GET"});
        const preflight = await sendReport(site.url, "daily", undefined, {method: "OPTIONS", headers: {Origin: "https://example.test", "Access-Control-Request-Method": "POST"}});
        const onSite = await sendReport(site.url, "daily", dailyReport(), {headers: {Host: SITE_HOST}});
        // 站点主机上现在还没有别的接口（两个模块的站点子应用都是空的），这一条到 t07 有了登录接口才分得出两个主机。
        const sitePathOnIngest = await requestJson(new URL(`${TELEMETRY_API_PREFIX.slice(1)}/anything`, site.url).href, {headers: {Host: TELEMETRY_HOST}});
        const spelled = await sendReport(site.url, "daily", dailyReport(), {headers: {Host: `${TELEMETRY_HOST.toUpperCase()}.:8443`}});

        expect([get.status, preflight.status, onSite.status, sitePathOnIngest.status]).toEqual([404, 404, 404, 404]);
        expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(spelled.status).toBe(200);
    });
});

describe("限流（协议输出 10，site.telemetry-ingest 输出 9）", () => {
    const LIMIT = 5;
    let site: SiteProcess;

    beforeAll(async () => {
        site = await sandbox.start({dataDir: await sandbox.dataDir(), env: {NB_SITE_TELEMETRY_RATE_LIMIT: String(LIMIT)}});
    }, SETUP_TIMEOUT_MS);

    /** 同一个来源在一个窗口里的额度：三个写入口合计。 */
    const oneOfEach = (index: number): [IngestKind, Report] => {
        const kinds: IngestKind[] = ["daily", "heartbeat", "event"];
        const kind = kinds[index % kinds.length]!;
        return [kind, kind === "daily" ? dailyReport() : kind === "heartbeat" ? heartbeatReport() : eventReport()];
    };

    it("C10 三个写入口合计到额度之后回 429 与 Retry-After；被限流的那份没被记入，窗口过后恢复", async () => {
        await toNextWindow(site);
        const statuses: number[] = [];
        for (let index = 0; index < LIMIT; index += 1) statuses.push((await sendReport(site.url, ...oneOfEach(index))).status);
        const report = dailyReport();
        const limited = await sendReport(site.url, "daily", report);

        expect(statuses).toEqual([200, 204, 202, 200, 204]);
        expect(outcome(limited)).toEqual({status: 429, body: {code: "rate_limited"}});
        const retryAfter = limited.headers.get("Retry-After");
        expect(retryAfter).toMatch(/^\d+$/u);
        // 刚进窗口就用完了额度：要等到这个窗口结束，至多 10 分钟。
        expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
        expect(Number(retryAfter)).toBeLessThanOrEqual(WINDOW_MS / 1000);

        await site.advanceClock(Number(retryAfter) * 1000);
        const retried = await sendReport(site.url, "daily", report);
        expect(outcome(retried)).toMatchObject({status: 200, body: {duplicate: false}});
    });

    it("C10 后来被判 400、413 的请求也计入额度", async () => {
        await toNextWindow(site);
        const counted = [
            await sendReport(site.url, "daily", undefined, {body: "{not json"}),
            await sendReport(site.url, "daily", {...dailyReport(), channel: "nightly"}),
            await sendReport(site.url, "daily", undefined, {body: JSON.stringify({...dailyReport(), pad: "x".repeat(INGEST_MAX_BODY_BYTES)})}),
            await sendReport(site.url, "daily", dailyReport()),
            await sendReport(site.url, "heartbeat", heartbeatReport()),
        ];
        const limited = await sendReport(site.url, "daily", dailyReport());
        expect(counted.map((response) => response.status)).toEqual([400, 400, 413, 200, 204]);
        expect(limited.status).toBe(429);
    });

    it("C12 内容类型或编码不对的请求不占额度：先发十个，额度照样是完整的", async () => {
        await toNextWindow(site);
        const wrong: number[] = [];
        for (let index = 0; index < 2 * LIMIT; index += 1) {
            const headers: Headers_ = index % 2 === 0 ? {"Content-Type": "text/plain"} : {"Content-Encoding": "gzip"};
            wrong.push((await sendReport(site.url, "daily", dailyReport(), {headers})).status);
        }
        const statuses: number[] = [];
        for (let index = 0; index < LIMIT; index += 1) statuses.push((await sendReport(site.url, ...oneOfEach(index))).status);
        const limited = await sendReport(site.url, "daily", dailyReport());
        expect(wrong).toEqual(new Array<number>(2 * LIMIT).fill(400));
        expect(statuses).toEqual([200, 204, 202, 200, 204]);
        expect(limited.status).toBe(429);
    });
});

describe("不留来源地址（site.telemetry-ingest 输出 8、9，验收 3）", () => {
    /** 可信代理转发来的来源地址，几种写法：IPv4 本身、IPv4 映射的 IPv6 两种写法；另有一个 IPv6 来源。 */
    const SOURCE = "203.0.113.77";
    const MAPPED = "::ffff:203.0.113.77";
    const MAPPED_HEX = "::ffff:cb00:714d";
    const SOURCE_V6 = "2001:db8:77::77";
    const NEEDLES = [SOURCE, MAPPED, MAPPED_HEX, "cb00:714d", SOURCE_V6, "2001:db8:77:"];
    const LIMIT = 3;

    let site: SiteProcess;
    let dataDir: string;
    let responses: Record<string, IngestResponse>;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: {NB_SITE_TRUSTED_PROXIES: "127.0.0.1/32", NB_SITE_TELEMETRY_RATE_LIMIT: String(LIMIT)}});
        const from = (address: string) => ({"X-Forwarded-For": address});
        responses = {
            recorded: await sendReport(site.url, "daily", dailyReport(), {headers: from(SOURCE)}),
            invalid: await sendReport(site.url, "daily", {...dailyReport(), region: "mars"}, {headers: from(MAPPED)}),
            tooLarge: await sendReport(site.url, "daily", undefined, {headers: from(MAPPED_HEX), body: JSON.stringify({...dailyReport(), pad: "x".repeat(INGEST_MAX_BODY_BYTES)})}),
            // 前三个是同一个来源的三种写法，额度 3 已用完。
            limited: await sendReport(site.url, "daily", dailyReport(), {headers: from(MAPPED)}),
            wrongType: await sendReport(site.url, "daily", dailyReport(), {headers: {...from(SOURCE), "Content-Type": "text/plain"}}),
            otherSource: await sendReport(site.url, "heartbeat", heartbeatReport(), {headers: from(SOURCE_V6)}),
            // 对端是可信代理而没给转发头：取不到来源地址。
            noForwarded: await sendReport(site.url, "daily", dailyReport()),
        };
        // 停掉进程再看：输出收齐、库文件与日志文件都已落盘。
        await site.stop();
    }, SETUP_TIMEOUT_MS);

    it("可信代理转发的来源照常限流：同一个地址的几种写法算同一个来源", () => {
        const statuses = Object.fromEntries(Object.entries(responses).map(([name, response]) => [name, response.status]));
        expect(statuses).toEqual({recorded: 200, invalid: 400, tooLarge: 413, limited: 429, wrongType: 400, otherSource: 204, noForwarded: 503});
    });

    it("C13 取不到来源地址时回 503 unavailable", () => {
        expect(outcome(responses.noForwarded!)).toEqual({status: 503, body: {code: "unavailable"}});
    });

    it("C13 记入、拒收、过大、限流之后，进程的输出与数据目录的文件里找不到来源地址的任何写法", () => {
        for (const needle of NEEDLES) expect({needle, found: placesContaining(site, dataDir, needle)}).toEqual({needle, found: []});
    });
});

describe("库被别的进程占着写（site.telemetry-ingest 输出 10，验收 4）", () => {
    let site: SiteProcess;
    let dataDir: string;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: LARGE_LIMIT});
        await site.ready();
    }, SETUP_TIMEOUT_MS);

    // 验收 4 的“同时账号的登录接口正常”：账号模块还没有登录接口，t07 加进这个用例。
    it("C14 三个写入口立即回 503 unavailable，不等锁；存活检查与站点主机照常回应；放锁后照常写入，进程没重启", async () => {
        const release = holdWriteLock(dataDir, "telemetry");
        let locked: IngestResponse[];
        let live: {readonly status: number};
        let siteHost: {readonly status: number};
        try {
            locked = [
                await sendReport(site.url, "daily", dailyReport()),
                await sendReport(site.url, "heartbeat", heartbeatReport()),
                await sendReport(site.url, "event", eventReport()),
                await sendReport(site.url, "daily", dailyReport({withUsage: true})),
            ];
            live = await requestJson(`${site.url}health/live`);
            siteHost = await requestJson(new URL(`${TELEMETRY_API_PREFIX.slice(1)}/anything`, site.url).href, {headers: {Host: SITE_HOST}});
        } finally {
            release();
        }
        const after = await sendReport(site.url, "daily", dailyReport());

        expect(locked.map(outcome)).toEqual(new Array(locked.length).fill({status: 503, body: {code: "unavailable"}}));
        // “立即”看服务端自己记的处理时长，不用测试进程计时：负载高时测试进程这边的时间不准。等锁的话至少是等锁的时长。
        const durations = await Promise.all(locked.map(async (response) => (await requestLine(site, response)).durationMs));
        for (const duration of durations) expect(duration).toBeLessThan(200);
        expect(live.status).toBe(200);
        expect(siteHost.status).toBe(404);
        expect(after.status).toBe(200);
        expect(site.exitCode).toBeNull();
        expect(site.logs().filter((line) => line.event === "site.listening")).toHaveLength(1);
    });
});

describe("重启之后（site.telemetry-ingest 的时序：重启不丢、去重仍有效）", () => {
    let report: Report;
    let first: IngestResponse;
    let afterRestart: IngestResponse;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        const before = await sandbox.start({dataDir, env: LARGE_LIMIT});
        report = {...dailyReport(), reportId: newReportId()};
        first = await sendReport(before.url, "daily", report);
        await before.stop();
        const after = await sandbox.start({dataDir, env: LARGE_LIMIT});
        afterRestart = await sendReport(after.url, "daily", report);
    }, SETUP_TIMEOUT_MS);

    it("C17 记入一份，停进程再起：重发是 duplicate，serverDay 是第一次的", () => {
        expect(first.status).toBe(200);
        const {serverDay} = first.body as {readonly serverDay: string};
        expect(outcome(afterRestart)).toEqual({status: 200, body: {serverDay, duplicate: true, dropped: []}});
    });
});

describe("原始上报到期删除（site.telemetry-ingest 输出 3，验收 1）", () => {
    let site: SiteProcess;
    let dataDir: string;

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: LARGE_LIMIT});
    }, SETUP_TIMEOUT_MS);

    /** 把进程的时钟拨到第 `day` 个服务端日的开头之后一分钟：落在一天的开头，用例跑多久都不会跨到下一天。 */
    async function toDay(day: number): Promise<void> {
        await site.advanceClock(day * DAY_MS + 60_000 - (await serverNow(site)));
    }

    it("C15 保留 7 天：拨到第 7 天跑 purge，数据目录里还找得到上报编号、重发是重发；拨到第 8 天跑 purge，找不到、重发不是重发", async () => {
        const report = {...dailyReport(), reportId: newReportId()};
        const recorded = await sendReport(site.url, "daily", report);
        expect(recorded.status).toBe(200);
        const day = Math.floor(Date.parse(`${(recorded.body as {readonly serverDay: string}).serverDay}T00:00:00Z`) / DAY_MS);

        await toDay(day + 7);
        expect(outcome(await site.runJob("telemetry", "purge"))).toEqual({status: 200, body: {status: "done"}});
        const keptIn = dataFilesContaining(dataDir, report.reportId as string);
        const resent = await sendReport(site.url, "daily", report);

        await toDay(day + 8);
        expect(outcome(await site.runJob("telemetry", "purge"))).toEqual({status: 200, body: {status: "done"}});
        const leftIn = dataFilesContaining(dataDir, report.reportId as string);
        const afterPurge = await sendReport(site.url, "daily", report);

        expect(keptIn).not.toEqual([]);
        expect(outcome(resent)).toMatchObject({status: 200, body: {duplicate: true}});
        expect(leftIn).toEqual([]);
        expect(outcome(afterPurge)).toMatchObject({status: 200, body: {duplicate: false}});
    });
});

describe("备份里没有原始上报（site.operations 输出 6、验收 3 的后半；site.telemetry-ingest 的副作用一节）", () => {
    /** 特征明显、合乎版本号写法的应用版本：只会经聚合进副本。 */
    const appVersion = "77.66.55-c16marker";
    let report: Report;
    let recorded: IngestResponse;
    let backupDir: string | undefined;
    let restored: SiteProcess | undefined;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        const site = await sandbox.start({dataDir, env: LARGE_LIMIT});
        report = {...dailyReport(), reportId: newReportId(), appVersion};
        recorded = await sendReport(site.url, "daily", report);
        const backup = await sandbox.run("backup", {dataDir});
        if (backup.exitCode !== 0) throw new Error(`backup failed: ${backup.stderr}`);
        const [name] = listBackups(dataDir);
        if (name === undefined) return;
        backupDir = join(backupsDir(dataDir), name);
        // 副本拷进一个新的数据目录，单独起一个服务。
        const restoredDir = await sandbox.dataDir();
        for (const module of ["identity", "telemetry"]) await copyFile(join(backupDir, `${module}.db`), join(restoredDir, `${module}.db`));
        restored = await sandbox.start({dataDir: restoredDir, env: LARGE_LIMIT});
        await restored.ready();
    }, SETUP_TIMEOUT_MS);

    it("C16 记入一份之后备份：副本里找不到它的上报编号，找得到它的应用版本（进了聚合）；用副本起的服务就绪", async () => {
        expect(recorded.status).toBe(200);
        expect(backupDir).toBeDefined();
        expect(dataFilesContaining(backupDir!, report.reportId as string)).toEqual([]);
        expect(dataFilesContaining(backupDir!, appVersion)).toEqual(["telemetry.db"]);
        expect((await requestJson(`${restored!.url}health/ready`)).status).toBe(200);
    });
});
