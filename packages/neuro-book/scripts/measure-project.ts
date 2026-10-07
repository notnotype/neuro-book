/**
 * 实测项目子进程的启动时间与常驻内存（docs/specs/runtime/projects.md 输出第 12 条）：用生产打包产物的
 * `project.js`，经项目管理器反复打开、关闭同一个项目，每次记从请求打开到取得租约的时间，以及子进程就绪后
 * 的 RSS（读 `/proc/<pid>/status`，只支持 Linux）。
 *
 *   bun run build:server && bun scripts/measure-project.ts [次数，缺省 10]
 */

import {readFile, rm} from "node:fs/promises";
import {mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createProjectManager} from "../src/server/projects/manager";
import {createProjectRegistry} from "../src/server/projects/registry";

const packageRoot = resolve(import.meta.dir, "..");
const entry = join(packageRoot, "dist", "server", "project.js");
const rounds = Number(process.argv[2] ?? "10");

async function rssMegabytes(pid: number): Promise<number> {
    const status = await readFile(`/proc/${String(pid)}/status`, "utf8");
    const kilobytes = Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1]);
    return Math.round((kilobytes / 1024) * 10) / 10;
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
        await mkdir(join(root, "Book"), {recursive: true});
        const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
        const parent = createApplication(
            {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {keys: [], plugins: [], gates: [], remote: node},
        );
        await parent.startup;
        const registry = createProjectRegistry({stateRoot, cwd: root});
        const registered = await registry.register("Book");
        if (!registered.ok) throw new Error(registered.detail);
        const manager = createProjectManager({
            application: parent,
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
        const rss: number[] = [];
        for (let round = 1; round <= rounds; round += 1) {
            const began = performance.now();
            const result = await manager.acquire("book", "measure");
            if (result.status !== "acquired") throw new Error(`第 ${String(round)} 轮打开失败：${result.reason} ${result.detail}`);
            startMs.push(Math.round((performance.now() - began) * 10) / 10);
            const listed = await manager.list();
            const pid = listed.ok ? listed.value[0]?.pid : null;
            if (pid === null || pid === undefined) throw new Error("没有拿到子进程 pid");
            rss.push(await rssMegabytes(pid));
            const ended = new Promise<void>((done) => result.lease.revoked.addEventListener("abort", () => done(), {once: true}));
            result.lease.release();
            await ended;
            console.log(JSON.stringify({round, generation: result.lease.generation, startMs: startMs.at(-1), rssMB: rss.at(-1)}));
        }
        await parent.stop();
        console.log(JSON.stringify({
            bun: Bun.version,
            platform: `${process.platform}-${process.arch}`,
            rounds,
            startMs: {p50: percentile(startMs, 0.5), p95: percentile(startMs, 0.95), max: Math.max(...startMs)},
            rssMB: {p50: percentile(rss, 0.5), max: Math.max(...rss)},
        }));
        return 0;
    } finally {
        await rm(root, {recursive: true, force: true});
    }
}

process.exit(await main());
