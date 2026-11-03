/**
 * 实测项目子进程的启动时间与常驻内存（docs/specs/runtime/projects.md 输出第 12 条）：用生产打包产物的
 * `project.js`，经项目管理器反复打开、关闭同一个项目，每次记从请求打开到取得租约的时间，以及子进程就绪后
 * 的 RSS（读 `/proc/<pid>/status`，只支持 Linux）。
 *
 * 服务端装诊断与真实的 Storage：项目实例里 `nbook.projects` 的统计入口打开时读、停止时写 user 分区的记录，与产品一样
 * 经服务端完成（输出第 16 条）。
 *
 * `--sample <文件数>`：项目目录先放一份 Files 样本（`files-sample.ts`，缺省参数下约 3000 个 Markdown），另记首次统计的
 * 耗时（子进程诊断 `projects.stats.scanned` 的 `durationMs`），RSS 改在首扫完成后读。
 *
 * `--world <项目目录>`：把那个项目的世界日志与活页夹（`.nbook/world/`、`manuscripts.binder/`）复制进来，另记世界打开的
 * 耗时（子进程诊断 `canon.world.opened` 的 `durationMs`），RSS 改在世界打开后读。三百万字的世界由
 * `CANON_SCALE_KEEP=1 bun scripts/perf/canon-scale.ts` 生成并留下。
 *
 *   bun run build:server && bun scripts/measure-project.ts [次数，缺省 10] [--sample 3000] [--world <项目目录>]
 */

import {cp, readdir, readFile, rm} from "node:fs/promises";
import {mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "../src/application";
import {createConsoleExporterFactory, createConsoleFallback} from "../src/plugins/diagnostics/web/console-exporter";
import {storageBackendPlugin} from "../src/plugins/storage/backend/plugin";
import {createProjectManager} from "../src/server/projects/manager";
import {createProjectRegistry} from "../src/server/projects/registry";
import {stateRootKey} from "../src/shared/host";
import {writeSample} from "./files-sample";

const packageRoot = resolve(import.meta.dir, "..");
const entry = join(packageRoot, "dist", "server", "project.js");
const sampleFlag = process.argv.indexOf("--sample");
const sampleCount = sampleFlag < 0 ? null : Number(process.argv[sampleFlag + 1] ?? "3000");
const worldFlag = process.argv.indexOf("--world");
const worldSource = worldFlag < 0 ? null : (process.argv[worldFlag + 1] ?? null);
const rounds = Number(process.argv.slice(2).find((argument, index, all) => !argument.startsWith("--") && all[index - 1] !== "--sample" && all[index - 1] !== "--world") ?? "10");
/** 等首扫的上限：样本很大或机器很慢时报错，不无限等。 */
const SCAN_DEADLINE_MS = 120_000;

async function rssMegabytes(pid: number): Promise<number> {
    const status = await readFile(`/proc/${String(pid)}/status`, "utf8");
    const kilobytes = Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1]);
    return Math.round((kilobytes / 1024) * 10) / 10;
}

/** 子进程日志里这一代的某条诊断（首次统计、世界打开）的耗时；还没写出时为 null。 */
async function recordedDuration(logDirectory: string, instanceId: string, event: string): Promise<number | null> {
    // 日志目录在子进程第一次写诊断时才建：还没有就是还没写到。
    const names = await readdir(logDirectory).catch(() => []);
    for (const name of names.filter((item) => item.endsWith(".jsonl"))) {
        for (const line of (await readFile(join(logDirectory, name), "utf8")).split("\n")) {
            if (line === "") continue;
            // 日志行把来源身份放在 `data.$source`（`jsonl-exporter.ts` 的 formatDiagnosticLine）。
            const record = JSON.parse(line) as {event: string; data: {durationMs?: number; $source?: {instanceId?: string}}};
            if (record.event === event && record.data.$source?.instanceId === instanceId) return record.data.durationMs ?? null;
        }
    }
    return null;
}

function percentile(values: ReadonlyArray<number>, fraction: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

async function main(): Promise<number> {
    if (!(await Bun.file(entry).exists())) {
        console.error(`缺少 ${entry}：先运行 bun run build:server`);
        return 1;
    }
    const root = await createTestTmpRoot("neuro-book-measure-project", "measure-project");
    try {
        const stateRoot = join(root, "state");
        const sample = sampleCount === null ? null : await writeSample(join(root, "Book"), {count: sampleCount});
        await mkdir(join(root, "Book"), {recursive: true});
        if (worldSource !== null) {
            await cp(join(worldSource, ".nbook", "world"), join(root, "Book", ".nbook", "world"), {recursive: true});
            await cp(join(worldSource, "manuscripts.binder"), join(root, "Book", "manuscripts.binder"), {recursive: true});
        }
        const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
        const silent = {error: () => undefined};
        const parent = createApplication(
            {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {
                capabilities: [{id: "host.state-root", key: stateRootKey, create: () => ({path: stateRoot})}],
                plugins: [
                    createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
                    storageBackendPlugin,
                ],
                gates: [],
                remote: node,
            },
        );
        await parent.startup;
        const registry = createProjectRegistry({stateRoot, cwd: root});
        const registered = await registry.register("Book");
        if (!registered.ok) throw new Error(registered.detail);
        const manager = createProjectManager({
            application: parent,
            serverInstanceId: "hub",
            router: createRemoteRouter(node),
            registry,
            stateRoot,
            cwd: root,
            entry,
            // 释放后立即关闭，下一轮是冷启动。
            graceMs: 1,
            startMs: 30_000,
            stopMs: 20_000,
            record: () => undefined,
            output: {stdout: () => undefined, stderr: (text) => void process.stderr.write(text)},
        });
        const startMs: number[] = [];
        const scanMs: number[] = [];
        const worldMs: number[] = [];
        const rss: number[] = [];
        for (let round = 1; round <= rounds; round += 1) {
            const began = performance.now();
            const result = await manager.acquire("book", "measure");
            if (result.status !== "acquired") throw new Error(`第 ${String(round)} 轮打开失败：${result.reason} ${result.detail}`);
            startMs.push(Math.round((performance.now() - began) * 10) / 10);
            const listed = await manager.list();
            const pid = listed.ok ? listed.value[0]?.pid : null;
            if (pid === null || pid === undefined) throw new Error("没有拿到子进程 pid");
            const instanceId = `project:${registered.project.id}#${String(result.lease.generation)}`;
            const waitFor = async (event: string, what: string): Promise<number> => {
                const deadline = performance.now() + SCAN_DEADLINE_MS;
                let duration = await recordedDuration(join(stateRoot, "logs", "projects", registered.project.name), instanceId, event);
                while (duration === null) {
                    if (performance.now() > deadline) throw new Error(`第 ${String(round)} 轮等${what}超过 ${String(SCAN_DEADLINE_MS)} ms`);
                    await Bun.sleep(20);
                    duration = await recordedDuration(join(stateRoot, "logs", "projects", registered.project.name), instanceId, event);
                }
                return duration;
            };
            if (sample !== null) scanMs.push(await waitFor("projects.stats.scanned", "首次统计"));
            if (worldSource !== null) worldMs.push(await waitFor("canon.world.opened", "世界打开"));
            rss.push(await rssMegabytes(pid));
            const ended = new Promise<void>((done) => result.lease.revoked.addEventListener("abort", () => done(), {once: true}));
            result.lease.release();
            await ended;
            console.log(JSON.stringify({round, generation: result.lease.generation, startMs: startMs.at(-1), ...(sample === null ? {} : {scanMs: scanMs.at(-1)}), ...(worldSource === null ? {} : {worldMs: worldMs.at(-1)}), rssMB: rss.at(-1)}));
        }
        await parent.stop();
        console.log(JSON.stringify({
            bun: Bun.version,
            platform: `${process.platform}-${process.arch}`,
            rounds,
            ...(sample === null ? {} : {sample: {files: sample.count, totalBytes: sample.totalBytes}, scanMs: {p50: percentile(scanMs, 0.5), p95: percentile(scanMs, 0.95), max: Math.max(...scanMs)}}),
            ...(worldSource === null ? {} : {worldMs: {p50: percentile(worldMs, 0.5), p95: percentile(worldMs, 0.95), max: Math.max(...worldMs)}}),
            startMs: {p50: percentile(startMs, 0.5), p95: percentile(startMs, 0.95), max: Math.max(...startMs)},
            rssMB: {p50: percentile(rss, 0.5), max: Math.max(...rss)},
        }));
        return 0;
    } finally {
        await rm(root, {recursive: true, force: true});
    }
}

process.exit(await main());
