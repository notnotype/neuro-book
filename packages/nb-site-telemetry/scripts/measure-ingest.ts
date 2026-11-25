/**
 * 写入口的吞吐与延迟测量（w00037 t06 计划的“测量”一节；做法照计划的探针 5）。不是测试，不进 `bun test`；改了写入、校验或
 * 聚合时手动跑一次，数字写进 Task 记录。
 *
 *     bun packages/nb-site-telemetry/scripts/measure-ingest.ts [每轮毫秒数，缺省 10000]
 *     bun packages/nb-site-telemetry/scripts/measure-ingest.ts --batches [行数，缺省 20000]
 *
 * 起真实的 `nb-site serve`，钉在 0、1 两个核上。被测程序与合同测试取法相同：设了 `NB_SITE_SERVER_COMMAND`（JSON 数组的 argv，
 * 例如镜像打好的 `["bun","--no-env-file","/abs/dist/image/server.js"]`）就用它；没设时按路径起同一个检出里的源码入口
 * `nb-site-server/src/main.ts`（本包不能依赖入口包，只按路径起）。启动时打印实际起的命令。
 * 压测端是另一个进程，钉在其余的核上，每轮 C 个并发循环发请求。每日上报带使用段与两项错误（走校验与存储里最重的那条路径），每份的编号都不同。
 * 最后两轮是最坏的输入：每份带满第 1 版能有的 27 项错误、应用版本在 64 个之间轮换；其中一轮同时每秒经测试控制入口跑一次
 * 任务 `aggregate`（`site.telemetry-ingest` 的时序：聚合与写入并发时写入不被阻塞超过 1 秒），另报每次聚合的用时。
 * 限流额度给到上限，数据目录建在系统临时目录下、跑完删掉。需要 Linux 的 `taskset` 与至少 3 个核。
 *
 * `--batches` 不起进程：在本进程里用真的模块（连接参数与两个任务都是产品的）写满最坏输入的一天，再跑一次 `aggregate`、
 * 把时钟拨到到期后跑一次 `purge`，量事件循环在这期间最长停了多久（两次让出之间的最大间隔，也就是最慢的一批）。
 * 定 `AGGREGATE_BATCH_ROWS`、`PURGE_BATCH_ROWS` 时看这个数。
 */

import {randomBytes} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {availableParallelism, tmpdir} from "node:os";
import {join} from "node:path";

import {INGEST_PATHS, LATEST_ANONYMOUS_MANIFEST, LATEST_USAGE_MANIFEST, type IngestKind} from "@notnotype/nb-site-telemetry-contract";

import {AGGREGATE_BATCH_ROWS} from "../src/aggregate";
import {DAY_MS, serverDayAt} from "../src/days";
import {PURGE_BATCH_ROWS} from "../src/purge";
import {createTelemetryStore} from "../src/store";
import {createTestModule} from "../src/testing/module";
import {openTelemetryTestDb} from "../src/testing/db";
import {validateReport} from "../src/validate";

const TELEMETRY_URL = "https://telemetry.measure.test";
const SERVER_ENTRY = join(import.meta.dir, "../../nb-site-server/src/main.ts");
const SERVER_COMMAND_ENV = "NB_SITE_SERVER_COMMAND";

/** 被测程序的 argv（不含子命令）：见文件头。设得不对时报错，不退回缺省，免得量错对象。 */
function serverCommand(): string[] {
    const raw = process.env[SERVER_COMMAND_ENV];
    if (raw === undefined || raw === "") return [process.execPath, SERVER_ENTRY];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string" && part !== "")) {
        throw new Error(`${SERVER_COMMAND_ENV} must be a JSON array of non-empty strings`);
    }
    return parsed as string[];
}

/** 压测端发哪一种请求体：`daily-worst` 是带满错误项、版本轮换的每日上报。 */
type LoadKind = "daily" | "daily-worst" | "heartbeat";

/** 每一轮：发哪一种、几个并发、要不要同时每秒跑一次聚合。 */
const ROUNDS: readonly {readonly kind: LoadKind; readonly concurrency: number; readonly aggregating?: true}[] = [
    {kind: "daily", concurrency: 100},
    {kind: "daily", concurrency: 10},
    {kind: "heartbeat", concurrency: 100},
    {kind: "daily-worst", concurrency: 100},
    {kind: "daily-worst", concurrency: 100, aggregating: true},
];

function keysOf(table: Readonly<Record<string, unknown>> | undefined, field: string): string[] {
    const keys = table === undefined ? [] : Object.keys(table);
    if (keys.length === 0) throw new Error(`manifest field ${field} has no listed values`);
    return keys;
}

const daily = LATEST_ANONYMOUS_MANIFEST.daily;
const usage = LATEST_USAGE_MANIFEST.usage.fields;

/**
 * 使用段：缺省两项错误（换两个 owner：`owner` 与 `code` 的组合不许重复）；`worst` 时每个 owner 的每个码各一项
 * （第 1 版是 27 项），次数分档随 `index` 轮换，让聚合里的格子尽量多。
 */
function usageSegment(index: number, worst: boolean): Record<string, unknown> {
    const errors = usage.errors;
    if (errors?.kind !== "list") throw new Error("manifest usage.errors is not a list");
    const owner = errors.item.fields.owner;
    const code = errors.item.fields.code;
    const count = errors.item.fields.count;
    if (owner?.kind !== "value" || code?.kind !== "dependent" || count?.kind !== "value") throw new Error("manifest usage.errors fields changed shape");
    const buckets = keysOf(count.values, "usage.errors.count");
    const owners = keysOf(owner.values, "usage.errors.owner");
    const items = worst
        ? owners.flatMap((name, o) => keysOf(code.valuesBy[name], "usage.errors.code").map((value, c) => ({owner: name, code: value, count: buckets[(index + o + c) % buckets.length]})))
        : owners.slice(0, 2).map((name) => ({owner: name, code: keysOf(code.valuesBy[name], "usage.errors.code")[0], count: buckets[1]}));
    const first = (field: (typeof usage)[string] | undefined, name: string): string => keysOf(field?.kind === "value" ? field.values : undefined, name)[0]!;
    return {errors: items, crashes: first(usage.crashes, "usage.crashes"), upgrade: first(usage.upgrade, "usage.upgrade")};
}

/** 第 `index` 份请求体的对象。`worst` 时应用版本在 64 个之间轮换、各维度的取值打散。 */
function reportOf(kind: LoadKind, index: number): Record<string, unknown> {
    const pick = (name: string, salt: number): string => {
        const values = keysOf(daily[name]?.values, name);
        return kind === "daily-worst" ? values[(index * salt + salt) % values.length]! : values[0]!;
    };
    if (kind === "heartbeat") return {manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version}, appVersion: "0.17.0", form: pick("form", 1)};
    const worst = kind === "daily-worst";
    return {
        manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version, usage: LATEST_USAGE_MANIFEST.version},
        reportId: `m${process.pid.toString(36)}x${index.toString(36).padStart(24, "0")}`,
        appVersion: worst ? `0.${String(index % 64)}.0` : "0.17.0",
        channel: pick("channel", 2),
        form: pick("form", 3),
        osVersion: pick("osVersion", 5),
        arch: pick("arch", 7),
        locale: pick("locale", 11),
        region: pick("region", 13),
        daysSinceLast: (index % 28) + 1,
        installWeek: "older",
        usageEnabled: true,
        noticeSeen: pick("noticeSeen", 17),
        usage: usageSegment(index, worst),
    };
}

function bodyOf(kind: LoadKind, index: number): string {
    return JSON.stringify(reportOf(kind, index));
}

function post(url: string, kind: IngestKind, body: string): Promise<Response> {
    return fetch(new URL(INGEST_PATHS[kind].slice(1), url), {method: "POST", headers: {Host: new URL(TELEMETRY_URL).host, "Content-Type": "application/json"}, body});
}

/** 压测端：在子进程里跑，结果作为一行 JSON 写到标准输出。 */
async function load(url: string, kind: LoadKind, concurrency: number, durationMs: number): Promise<void> {
    const path: IngestKind = kind === "heartbeat" ? "heartbeat" : "daily";
    const latencies: number[] = [];
    const statuses: Record<string, number> = {};
    let next = 0;
    let failures = 0;
    let firstFailure: string | undefined;
    const end = performance.now() + durationMs;
    const worker = async (): Promise<void> => {
        while (performance.now() < end) {
            const body = bodyOf(kind, next++);
            const started = performance.now();
            try {
                const response = await post(url, path, body);
                await response.arrayBuffer();
                latencies.push(performance.now() - started);
                statuses[response.status] = (statuses[response.status] ?? 0) + 1;
            } catch (error) {
                failures += 1;
                firstFailure ??= String(error);
            }
        }
    };
    const started = performance.now();
    await Promise.all(Array.from({length: concurrency}, worker));
    const seconds = (performance.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    const at = (p: number): number => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? Number.NaN;
    console.log(JSON.stringify({kind, concurrency, requests: latencies.length, perSecond: Math.round(latencies.length / seconds), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: latencies.at(-1), statuses, failures, firstFailure}));
}

/** 读进程入口的标准输出直到 `site.listening`，之后接着读空管道（每个请求一行日志，不读会把管道写满）。 */
async function listen(stdout: ReadableStream<Uint8Array>, counter: {lines: number}): Promise<string> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let url: string | undefined;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) throw new Error("serve exited before site.listening");
        buffered += decoder.decode(value, {stream: true});
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            counter.lines += 1;
            if (url === undefined && line.includes('"site.listening"')) url = (JSON.parse(line) as {url: string}).url;
        }
        if (url !== undefined) break;
    }
    void (async () => {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) return;
            for (const byte of value) if (byte === 10) counter.lines += 1;
        }
    })();
    return url;
}

function rssMb(pid: number): number {
    const match = /^VmRSS:\s+(\d+) kB$/mu.exec(readFileSync(`/proc/${String(pid)}/status`, "utf8"));
    return match === null ? Number.NaN : Math.round(Number(match[1]) / 1024);
}

async function main(durationMs: number): Promise<void> {
    const cores = availableParallelism();
    if (cores < 3) throw new Error("measure-ingest needs at least 3 cores: 2 for the server, the rest for the load");
    const dataDir = mkdtempSync(join(tmpdir(), "nb-site-measure-"));
    // 同时跑聚合的那一轮经测试控制入口触发任务（`site.operations` 输出 11）；它只许监听本机回环，这里本来就是。
    const testControlToken = randomBytes(36).toString("base64url");
    const env = {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NB_SITE_DATA_DIR: dataDir,
        NB_SITE_URL: "https://site.measure.test",
        NB_SITE_TELEMETRY_URL: TELEMETRY_URL,
        NB_SITE_SESSION_SECRET: randomBytes(36).toString("base64url"),
        NB_SITE_HOST: "127.0.0.1",
        NB_SITE_PORT: "0",
        NB_SITE_TELEMETRY_RATE_LIMIT: "1000000",
        NB_SITE_TEST_CONTROL: testControlToken,
    };
    const command = serverCommand();
    console.log(`server command: ${JSON.stringify(command)} serve`);
    const server = Bun.spawn(["taskset", "-c", "0,1", ...command, "serve"], {env, stdout: "pipe", stderr: "inherit"});
    const logLines = {lines: 0};
    try {
        const url = await listen(server.stdout, logLines);
        for (const kind of ["daily", "daily-worst"] as const) {
            const check = await post(url, "daily", bodyOf(kind, 0));
            const checked = (await check.json()) as {readonly dropped?: readonly string[]};
            if (check.status !== 200 || checked.dropped?.length !== 0) throw new Error(`sample ${kind} report is not accepted cleanly: ${String(check.status)} ${JSON.stringify(checked)}`);
        }
        console.log(`server pid ${String(server.pid)} on cores 0,1; load on cores 2-${String(cores - 1)}; ${String(durationMs)} ms per round`);
        for (const round of ROUNDS) {
            if (round.aggregating === true) {
                // 先把前几轮积下的行算完（没有写入同时进来），这一轮量的是追平之后每秒一次的聚合。
                const started = performance.now();
                const status = await runAggregate(url, testControlToken);
                console.log(`backlog aggregate (no load): status ${String(status)}, ${(performance.now() - started).toFixed(0)} ms`);
            }
            const loader = Bun.spawn(["taskset", "-c", `2-${String(cores - 1)}`, process.execPath, import.meta.path, "--load", url, round.kind, String(round.concurrency), String(durationMs)], {
                stdout: "pipe",
                stderr: "inherit",
            });
            const aggregations = round.aggregating === true ? aggregateEverySecond(url, testControlToken) : undefined;
            const output = await new Response(loader.stdout).text();
            if ((await loader.exited) !== 0) throw new Error(`load process failed for ${round.kind}`);
            const aggregated = await aggregations?.stop();
            const result = JSON.parse(output) as {kind: string; concurrency: number; requests: number; perSecond: number; p50: number; p95: number; p99: number; max: number; statuses: Record<string, number>; failures: number};
            const ms = (value: number): string => value.toFixed(1);
            console.log(
                `${result.kind} C=${String(result.concurrency)}${aggregated === undefined ? "" : " + aggregate every second"}: ${String(result.requests)} requests, ${String(result.perSecond)}/s, p50 ${ms(result.p50)} p95 ${ms(result.p95)} p99 ${ms(result.p99)} max ${ms(result.max)} ms, statuses ${JSON.stringify(result.statuses)}, failures ${String(result.failures)}`,
            );
            if (aggregated !== undefined) {
                const sorted = [...aggregated.durations].sort((a, b) => a - b);
                console.log(`  aggregate runs: ${String(sorted.length)}, statuses ${JSON.stringify(aggregated.statuses)}, duration median ${ms(sorted[Math.floor(sorted.length / 2)] ?? Number.NaN)} max ${ms(sorted.at(-1) ?? Number.NaN)} ms`);
            }
        }
        console.log(`server RSS ${String(rssMb(server.pid))} MB, ${String(logLines.lines)} log lines`);
    } finally {
        server.kill("SIGTERM");
        await server.exited;
        rmSync(dataDir, {recursive: true, force: true});
    }
}

/** 经测试控制入口跑一次 `aggregate`，跑完才返回状态码。 */
async function runAggregate(url: string, token: string): Promise<number> {
    const response = await fetch(new URL("test-control/jobs/run", url), {
        method: "POST",
        headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
        body: JSON.stringify({module: "telemetry", job: "aggregate"}),
    });
    await response.arrayBuffer();
    return response.status;
}

/**
 * 每秒经测试控制入口跑一次 `aggregate`，一次跑完才排下一次；记下每次的用时（包括它在任务队列里等的时间）与状态码。
 * `stop()` 等正在跑的那一次结束。
 */
function aggregateEverySecond(url: string, token: string): {stop(): Promise<{durations: number[]; statuses: Record<string, number>}>} {
    const durations: number[] = [];
    const statuses: Record<string, number> = {};
    let stopped = false;
    const loop = (async () => {
        while (!stopped) {
            const started = performance.now();
            const status = await runAggregate(url, token);
            durations.push(performance.now() - started);
            statuses[status] = (statuses[status] ?? 0) + 1;
            const wait = 1000 - (performance.now() - started);
            if (wait > 0 && !stopped) await Bun.sleep(wait);
        }
    })();
    return {
        stop: async () => {
            stopped = true;
            await loop;
            return {durations, statuses};
        },
    };
}

/** 事件循环在 `work` 期间最长停了多久：一条 `setImmediate` 链记下相邻两次轮到它的间隔。 */
async function maxStall(work: () => Promise<void>): Promise<{maxMs: number; totalMs: number}> {
    let last = performance.now();
    let maxMs = 0;
    let running = true;
    const tick = (): void => {
        const now = performance.now();
        maxMs = Math.max(maxMs, now - last);
        last = now;
        if (running) setImmediate(tick);
    };
    setImmediate(tick);
    const started = performance.now();
    await work();
    running = false;
    return {maxMs, totalMs: performance.now() - started};
}

/** `--batches`：见文件头。写入走真的存储，时间都取同一天的正午。 */
async function measureBatches(rows: number): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "nb-site-measure-batches-"));
    try {
        const db = openTelemetryTestDb(dir);
        const test = createTestModule(db);
        const store = createTelemetryStore(db);
        const day = serverDayAt(test.clock.now());
        const started = performance.now();
        for (let index = 0; index < rows; index += 1) {
            const result = validateReport("daily", reportOf("daily-worst", index), day);
            if (!result.ok) throw new Error(`worst-case report is invalid at ${result.field}`);
            store.recordDaily(result.record, test.clock.now());
        }
        console.log(`${String(rows)} worst-case daily reports written in ${(performance.now() - started).toFixed(0)} ms (27 error items each, 64 app versions)`);

        const aggregate = await maxStall(() => test.run("aggregate"));
        console.log(`aggregate: ${String(Math.ceil(rows / AGGREGATE_BATCH_ROWS))} batches of ${String(AGGREGATE_BATCH_ROWS)}, longest stall ${aggregate.maxMs.toFixed(1)} ms, total ${aggregate.totalMs.toFixed(0)} ms`);
        test.clock.set(test.clock.now() + 8 * DAY_MS);
        const purge = await maxStall(() => test.run("purge"));
        console.log(`purge: ${String(Math.ceil(rows / PURGE_BATCH_ROWS))} batches of ${String(PURGE_BATCH_ROWS)} (secure_delete on), longest stall ${purge.maxMs.toFixed(1)} ms, total ${purge.totalMs.toFixed(0)} ms`);
        db.close();
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
}

const args = process.argv.slice(2);
if (args[0] === "--load") {
    const [, url, kind, concurrency, durationMs] = args;
    if (url === undefined || (kind !== "daily" && kind !== "daily-worst" && kind !== "heartbeat")) throw new Error("usage: measure-ingest.ts --load <url> <daily|daily-worst|heartbeat> <concurrency> <ms>");
    await load(url, kind, Number(concurrency), Number(durationMs));
} else if (args[0] === "--batches") {
    await measureBatches(Number(args[1] ?? 20_000));
} else {
    await main(Number(args[0] ?? 10_000));
}
