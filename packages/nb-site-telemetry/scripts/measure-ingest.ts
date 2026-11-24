/**
 * 写入口的吞吐与延迟测量（w00037 t06 计划的“测量”一节；做法照计划的探针 5）。不是测试，不进 `bun test`；改了写入、校验或
 * 聚合时手动跑一次，数字写进 Task 记录。
 *
 *     bun packages/nb-site-telemetry/scripts/measure-ingest.ts [每轮毫秒数，缺省 10000]
 *
 * 起真实的 `nb-site serve`，钉在 0、1 两个核上。被测程序与合同测试取法相同：设了 `NB_SITE_SERVER_COMMAND`（JSON 数组的 argv，
 * 例如镜像打好的 `["bun","--no-env-file","/abs/dist/image/server.js"]`）就用它；没设时按路径起同一个检出里的源码入口
 * `nb-site-server/src/main.ts`（本包不能依赖入口包，只按路径起）。启动时打印实际起的命令。
 * 压测端是另一个进程，钉在其余的核上，每轮 C 个并发循环发请求。每日上报带使用段与两项错误（走校验与存储里最重的那条路径），每份的编号都不同。
 * 限流额度给到上限，数据目录建在系统临时目录下、跑完删掉。需要 Linux 的 `taskset` 与至少 3 个核。
 */

import {randomBytes} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {availableParallelism, tmpdir} from "node:os";
import {join} from "node:path";

import {INGEST_PATHS, LATEST_ANONYMOUS_MANIFEST, LATEST_USAGE_MANIFEST, type IngestKind} from "@notnotype/nb-site-telemetry-contract";

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

/** 每一轮：压哪个写入口、几个并发。 */
const ROUNDS: readonly {readonly kind: Extract<IngestKind, "daily" | "heartbeat">; readonly concurrency: number}[] = [
    {kind: "daily", concurrency: 100},
    {kind: "daily", concurrency: 10},
    {kind: "heartbeat", concurrency: 100},
];

function keysOf(table: Readonly<Record<string, unknown>> | undefined, field: string): string[] {
    const keys = table === undefined ? [] : Object.keys(table);
    if (keys.length === 0) throw new Error(`manifest field ${field} has no listed values`);
    return keys;
}

const daily = LATEST_ANONYMOUS_MANIFEST.daily;
const usage = LATEST_USAGE_MANIFEST.usage.fields;

function usageSegment(): Record<string, unknown> {
    const errors = usage.errors;
    if (errors?.kind !== "list") throw new Error("manifest usage.errors is not a list");
    const owner = errors.item.fields.owner;
    const code = errors.item.fields.code;
    const count = errors.item.fields.count;
    if (owner?.kind !== "value" || code?.kind !== "dependent" || count?.kind !== "value") throw new Error("manifest usage.errors fields changed shape");
    // 两项错误换两个 owner：`owner` 与 `code` 的组合不许重复。
    const items = keysOf(owner.values, "usage.errors.owner")
        .slice(0, 2)
        .map((name) => ({owner: name, code: keysOf(code.valuesBy[name], "usage.errors.code")[0], count: keysOf(count.values, "usage.errors.count")[1]}));
    const first = (field: (typeof usage)[string] | undefined, name: string): string => keysOf(field?.kind === "value" ? field.values : undefined, name)[0]!;
    return {errors: items, crashes: first(usage.crashes, "usage.crashes"), upgrade: first(usage.upgrade, "usage.upgrade")};
}

function bodyOf(kind: "daily" | "heartbeat", index: number): string {
    const first = (name: string): string => keysOf(daily[name]?.values, name)[0]!;
    if (kind === "heartbeat") return JSON.stringify({manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version}, appVersion: "0.17.0", form: first("form")});
    return JSON.stringify({
        manifest: {anonymous: LATEST_ANONYMOUS_MANIFEST.version, usage: LATEST_USAGE_MANIFEST.version},
        reportId: `m${process.pid.toString(36)}x${index.toString(36).padStart(24, "0")}`,
        appVersion: "0.17.0",
        channel: first("channel"),
        form: first("form"),
        osVersion: first("osVersion"),
        arch: first("arch"),
        locale: first("locale"),
        region: first("region"),
        daysSinceLast: (index % 28) + 1,
        installWeek: "older",
        usageEnabled: true,
        noticeSeen: first("noticeSeen"),
        usage: usageSegment(),
    });
}

function post(url: string, kind: IngestKind, body: string): Promise<Response> {
    return fetch(new URL(INGEST_PATHS[kind].slice(1), url), {method: "POST", headers: {Host: new URL(TELEMETRY_URL).host, "Content-Type": "application/json"}, body});
}

/** 压测端：在子进程里跑，结果作为一行 JSON 写到标准输出。 */
async function load(url: string, kind: "daily" | "heartbeat", concurrency: number, durationMs: number): Promise<void> {
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
                const response = await post(url, kind, body);
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
    };
    const command = serverCommand();
    console.log(`server command: ${JSON.stringify(command)} serve`);
    const server = Bun.spawn(["taskset", "-c", "0,1", ...command, "serve"], {env, stdout: "pipe", stderr: "inherit"});
    const logLines = {lines: 0};
    try {
        const url = await listen(server.stdout, logLines);
        const check = await post(url, "daily", bodyOf("daily", 0));
        const checked = (await check.json()) as {readonly dropped?: readonly string[]};
        if (check.status !== 200 || checked.dropped?.length !== 0) throw new Error(`sample report is not accepted cleanly: ${String(check.status)} ${JSON.stringify(checked)}`);
        console.log(`server pid ${String(server.pid)} on cores 0,1; load on cores 2-${String(cores - 1)}; ${String(durationMs)} ms per round`);
        for (const round of ROUNDS) {
            const loader = Bun.spawn(["taskset", "-c", `2-${String(cores - 1)}`, process.execPath, import.meta.path, "--load", url, round.kind, String(round.concurrency), String(durationMs)], {
                stdout: "pipe",
                stderr: "inherit",
            });
            const output = await new Response(loader.stdout).text();
            if ((await loader.exited) !== 0) throw new Error(`load process failed for ${round.kind}`);
            const result = JSON.parse(output) as {kind: string; concurrency: number; requests: number; perSecond: number; p50: number; p95: number; p99: number; max: number; statuses: Record<string, number>; failures: number};
            const ms = (value: number): string => value.toFixed(1);
            console.log(
                `${result.kind} C=${String(result.concurrency)}: ${String(result.requests)} requests, ${String(result.perSecond)}/s, p50 ${ms(result.p50)} p95 ${ms(result.p95)} p99 ${ms(result.p99)} max ${ms(result.max)} ms, statuses ${JSON.stringify(result.statuses)}, failures ${String(result.failures)}`,
            );
        }
        console.log(`server RSS ${String(rssMb(server.pid))} MB, ${String(logLines.lines)} log lines`);
    } finally {
        server.kill("SIGTERM");
        await server.exited;
        rmSync(dataDir, {recursive: true, force: true});
    }
}

const args = process.argv.slice(2);
if (args[0] === "--load") {
    const [, url, kind, concurrency, durationMs] = args;
    if (url === undefined || (kind !== "daily" && kind !== "heartbeat")) throw new Error("usage: measure-ingest.ts --load <url> <daily|heartbeat> <concurrency> <ms>");
    await load(url, kind, Number(concurrency), Number(durationMs));
} else {
    await main(Number(args[0] ?? 10_000));
}
