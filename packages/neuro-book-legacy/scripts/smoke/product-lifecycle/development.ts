import {readFile, stat, utimes} from "node:fs/promises";
import {resolve, join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {spawnOwnedProcess, type OwnedProcessCompletion, type OwnedProcessLease} from "@notnotype/owned-process";
import type {CheckId, SmokeContext} from "./types";

type LeaseOwner = {
    schema: string;
    leaseId: string;
    kind: "runtime" | "migration";
    pid: number;
    acquiredAt: string;
    runtime: "bun" | "node";
    runtimeVersion: string;
};

type LeaseSnapshot = {
    owner: LeaseOwner | null;
    heartbeatAt: string | null;
    lockExists: boolean;
};

type DevRun = {
    lease: OwnedProcessLease;
    port: number;
    url: string;
    leasePath: string;
    outputLines: Array<{at: number; line: string}>;
};

const STARTUP_TIMEOUT_MS = 90_000;
const RELOAD_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 500;
const LOCK_RELEASE_TIMEOUT_MS = 6_000;
const HOT_RELOAD_SOURCE = "server/api/hello.get.ts";

/** 运行开发模式真实进程、热重载和SIGTERM生命周期检查（仅执行调用方选择的L7/L8）。 */
export async function runDevelopmentChecks(ctx: SmokeContext): Promise<void> {
    if (ctx.selected.has("L7")) {
        await ctx.check("L7", async (observe) => {
            const stateRoot = join(ctx.tempRoot, "product-lifecycle", "development-l7");
            let run: DevRun | undefined;
            try {
                await ctx.prepare(stateRoot, "L7");
                run = await launchDev(ctx, "L7", stateRoot);
                const initial = await waitForReady(ctx, "L7", run, STARTUP_TIMEOUT_MS);
                if (initial.owner?.kind !== "runtime") {
                    throw new Error(`开发服务就绪但runtime lease kind异常：${initial.owner?.kind ?? "absent"}。`);
                }
                observe({
                    id: "L7.dev-ready",
                    result: "pass",
                    evidence: `Node Nuxt dev已就绪：port=${run.port}，pid=${String(initial.owner?.pid ?? "unknown")}，leaseId=${initial.owner?.leaseId ?? "unknown"}，heartbeat=${initial.heartbeatAt ?? "absent"}。`,
                });

                const baselineLeaseId = initial.owner?.leaseId;
                if (!baselineLeaseId) {
                    throw new Error("开发服务已响应但没有可读取的runtime lease owner leaseId。");
                }
                const sourcePath = resolve(ctx.appRoot, HOT_RELOAD_SOURCE);
                const triggerAt = await touchSourceWithoutChangingBytes(ctx, "L7", sourcePath);
                ctx.log("L7", `热重载触发已完成：source=${sourcePath}，triggerAt=${new Date(triggerAt).toISOString()}，仅utimes且已恢复原mtime。`);

                const reloaded = await waitForReload(ctx, "L7", run, baselineLeaseId, triggerAt, RELOAD_TIMEOUT_MS);
                const heartbeatEvidence = reloaded.heartbeatAt ?? "absent";
                observe({
                    id: "L7.hot-reload",
                    result: "pass",
                    evidence: `已观察热重载开始与完成：开始=${reloaded.startedEvidence}；完成=${reloaded.completedEvidence}；owner leaseId由${baselineLeaseId}变为${reloaded.owner.leaseId}；heartbeat=${heartbeatEvidence}；health=${reloaded.healthStatus}。`,
                });
            } catch (error) {
                observe({id: "L7.error", result: "fail", evidence: errorMessage(error)});
                throw error;
            } finally {
                await disposeDevRun(ctx, "L7", run);
            }
        });
    }

    if (ctx.selected.has("L8")) {
        await ctx.check("L8", async (observe) => {
            const stateRoot = join(ctx.tempRoot, "product-lifecycle", "development-l8");
            let run: DevRun | undefined;
            try {
                await ctx.prepare(stateRoot, "L8");
                run = await launchDev(ctx, "L8", stateRoot);
                const ready = await waitForReady(ctx, "L8", run, STARTUP_TIMEOUT_MS);
                if (ready.owner?.kind !== "runtime") {
                    throw new Error(`开发服务就绪但runtime lease kind异常：${ready.owner?.kind ?? "absent"}。`);
                }
                if (!ready.owner) {
                    throw new Error("开发服务就绪但无法读取runtime lease owner，不能向实际dev进程发SIGTERM。");
                }
                if (ready.owner.runtime !== "node") {
                    throw new Error(`开发服务runtime不是Node：${ready.owner.runtime}@${ready.owner.runtimeVersion}。`);
                }
                if (ready.owner.pid === process.pid) {
                    throw new Error("runtime lease owner.pid指向smoke宿主进程，拒绝发送SIGTERM。");
                }

                const ownerPid = ready.owner.pid;
                ctx.log("L8", `向实际Nuxt dev进程发送SIGTERM：pid=${ownerPid}，leaseId=${ready.owner.leaseId}。`);
                process.kill(ownerPid, "SIGTERM");
                const completion = await waitForCompletion(run.lease, SHUTDOWN_TIMEOUT_MS);
                const releasedSnapshot = await waitForLockRelease(run.leasePath, LOCK_RELEASE_TIMEOUT_MS);
                const completionEvidence = `code=${String(completion?.exitCode ?? null)} signal=${String(completion?.signal ?? null)}`;
                const lockEvidence = `leaseLock=${releasedSnapshot.lockExists ? "present" : "released"} ownerFile=${releasedSnapshot.owner ? "present" : "absent"}`;
                ctx.log("L8", `SIGTERM终态：${completionEvidence}；${lockEvidence}。`);

                if (!completion) {
                    throw new Error(`SIGTERM后${SHUTDOWN_TIMEOUT_MS}ms内dev进程未完成：${completionEvidence}。`);
                }
                observe({
                    id: "L8.sigterm",
                    result: "pass",
                    evidence: `已向Node Nuxt dev实际进程pid=${ownerPid}发送SIGTERM并在有限时间内完成：${completionEvidence}；${lockEvidence}。`,
                });
                if (releasedSnapshot.lockExists) {
                    throw new Error(`SIGTERM后runtime lease锁未释放：${run.leasePath}。`);
                }
            } catch (error) {
                observe({id: "L8.error", result: "fail", evidence: errorMessage(error)});
                throw error;
            } finally {
                await disposeDevRun(ctx, "L8", run);
            }
        });
    }
}

async function launchDev(ctx: SmokeContext, id: CheckId, stateRoot: string): Promise<DevRun> {
    const port = await ctx.freePort();
    const inherited = await ctx.environment(stateRoot, true);
    const env: NodeJS.ProcessEnv = {
        ...inherited,
        NEURO_BOOK_REPOSITORY_ROOT: ctx.repoRoot,
        NEURO_BOOK_APPLICATION_ROOT: ctx.appRoot,
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_CACHE_ROOT: join(stateRoot, "cache"),
        NEURO_BOOK_LOG_DIR: join(stateRoot, "logs"),
        PORT: String(port),
        NUXT_PORT: String(port),
        NITRO_PORT: String(port),
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        NUXT_HOST: "127.0.0.1",
        NUXT_TELEMETRY_DISABLED: "1",
    };
    const lease = spawnOwnedProcess({
        // `nuxt.mjs` has a Node shebang in the package, but invoking Node explicitly
        // keeps this check on the real Node dev runtime even when smoke itself is Bun.
        command: process.platform === "win32" ? "node.exe" : "node",
        args: [resolve(ctx.repoRoot, "node_modules/nuxt/bin/nuxt.mjs"), "dev", "--no-fork", "--port", String(port)],
        cwd: ctx.appRoot,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
        windowsHide: false,
    });
    const run: DevRun = {
        lease,
        port,
        url: `http://127.0.0.1:${String(port)}`,
        leasePath: join(stateRoot, "workspace", ".nbook", "agent", "migrations", "runtime.lease"),
        outputLines: [],
    };
    attachRawOutput(ctx, id, run, lease.stdout, "stdout");
    attachRawOutput(ctx, id, run, lease.stderr, "stderr");
    ctx.log(id, `已启动Node Nuxt dev --no-fork：port=${port}，stateRoot=${stateRoot}，leasePath=${run.leasePath}。`);
    return run;
}

function attachRawOutput(
    ctx: SmokeContext,
    id: CheckId,
    run: DevRun,
    stream: NodeJS.ReadableStream | undefined,
    label: string,
): void {
    if (!stream) return;
    let pending = "";
    stream.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        ctx.log(id, `[${label}] ${text}`);
        pending += text;
        const lines = pending.split(/\r?\n/u);
        pending = lines.pop() ?? "";
        for (const line of lines) {
            if (!line) continue;
            run.outputLines.push({at: Date.now(), line});
            if (run.outputLines.length > 2_000) run.outputLines.shift();
        }
    });
}

async function waitForReady(ctx: SmokeContext, id: CheckId, run: DevRun, timeoutMs: number): Promise<LeaseSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "unreachable";
    let lastBody = "";
    while (Date.now() < deadline) {
        const snapshot = await readLeaseSnapshot(run.leasePath);
        const health = await probeHealth(run.url);
        lastStatus = health.status;
        lastBody = health.body;
        ctx.log(id, `dev就绪采样：status=${health.status}${health.status === "200" ? "" : ` body=${health.body}`} leaseId=${snapshot.owner?.leaseId ?? "absent"} heartbeat=${snapshot.heartbeatAt ?? "absent"}。`);
        if (health.status === "200" && snapshot.owner && healthyHeartbeat(snapshot)) return snapshot;
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Node Nuxt dev在${timeoutMs}ms内未就绪：lastStatus=${lastStatus}，lastBody=${lastBody}，leasePath=${run.leasePath}，recentOutput=${JSON.stringify(run.outputLines.slice(-12).map((entry) => entry.line))}。`);
}

async function waitForReload(
    ctx: SmokeContext,
    id: CheckId,
    run: DevRun,
    baselineLeaseId: string,
    triggerAt: number,
    timeoutMs: number,
): Promise<{owner: LeaseOwner; heartbeatAt: string | null; startedEvidence: string; completedEvidence: string; healthStatus: string}> {
    const deadline = Date.now() + timeoutMs;
    let changedOwner: LeaseOwner | null = null;
    let lastHealth = "unreachable";
    let startedEvidence = "尚未观察到重载输出";
    let completedEvidence = "尚未观察到重载完成输出";
    while (Date.now() < deadline) {
        const snapshot = await readLeaseSnapshot(run.leasePath);
        const recentLines = run.outputLines.filter((entry) => entry.at >= triggerAt);
        const startLine = recentLines.find((entry) => /(?:hmr|reload|rebuild|compiled|built|dev-|nitro)/iu.test(entry.line));
        if (startLine && startedEvidence === "尚未观察到重载输出") {
            startedEvidence = `raw=${JSON.stringify(startLine.line)}`;
            ctx.log(id, `观察到热重载开始证据：${startedEvidence}。`);
        }
        if (snapshot.owner && snapshot.owner.leaseId !== baselineLeaseId) {
            changedOwner ??= snapshot.owner;
            if (startedEvidence === "尚未观察到重载输出") {
                startedEvidence = `runtime lease owner变化：leaseId=${snapshot.owner.leaseId}`;
                ctx.log(id, `观察到热重载开始证据：${startedEvidence}。`);
            }
        }
        const health = await probeHealth(run.url);
        lastHealth = health.status;
        ctx.log(id, `热重载采样：status=${health.status}${health.status === "200" ? "" : ` body=${health.body}`} leaseId=${snapshot.owner?.leaseId ?? "absent"} heartbeat=${snapshot.heartbeatAt ?? "absent"}。`);
        const completionLine = recentLines.find((entry) => /(?:available|ready|compiled|built|warmed|reloaded)/iu.test(entry.line));
        if (completionLine) completedEvidence = `raw=${JSON.stringify(completionLine.line)}`;
        if (changedOwner && health.status === "200" && healthyHeartbeat(snapshot) && startedEvidence !== "尚未观察到重载输出") {
            if (completedEvidence === "尚未观察到重载完成输出") {
                completedEvidence = `health=200且leaseId=${changedOwner.leaseId}已重新持有`;
            }
            return {
                owner: changedOwner,
                heartbeatAt: snapshot.heartbeatAt,
                startedEvidence,
                completedEvidence,
                healthStatus: health.status,
            };
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`热重载在${timeoutMs}ms内没有形成可验证的开始/完成证据：lastHealth=${lastHealth}，baselineLeaseId=${baselineLeaseId}，started=${startedEvidence}，completed=${completedEvidence}。`);
}

async function probeHealth(url: string): Promise<{status: string; body: string}> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
        const response = await fetch(`${url}/api/app/version`, {
            signal: controller.signal,
            headers: {accept: "application/json"},
        });
        const body = (await response.text()).slice(0, 512).replace(/\s+/gu, " ");
        return {status: String(response.status), body};
    } catch (error) {
        return {status: error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable", body: errorMessage(error)};
    } finally {
        clearTimeout(timeout);
    }
}

async function touchSourceWithoutChangingBytes(ctx: SmokeContext, id: CheckId, sourcePath: string): Promise<number> {
    const before = await readFile(sourcePath);
    const beforeStat = await stat(sourcePath);
    const triggerAt = Date.now();
    const triggerMtimeMs = Math.max(triggerAt, beforeStat.mtimeMs + 2_000);
    await utimes(sourcePath, beforeStat.atimeMs / 1_000, triggerMtimeMs / 1_000);
    await sleep(350);
    await utimes(sourcePath, beforeStat.atimeMs / 1_000, beforeStat.mtimeMs / 1_000);
    const after = await readFile(sourcePath);
    if (!before.equals(after)) {
        throw new Error(`热重载触发文件bytes发生变化，拒绝继续：${sourcePath}。`);
    }
    ctx.log(id, `热重载触发文件bytes校验通过：${sourcePath}，原mtime=${new Date(beforeStat.mtimeMs).toISOString()}。`);
    return triggerAt;
}

async function readLeaseSnapshot(leasePath: string): Promise<LeaseSnapshot> {
    const [owner, lock] = await Promise.all([
        readFile(leasePath, "utf8").then((raw) => parseLeaseOwner(raw), (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }),
        stat(`${leasePath}.lock`).then((value) => value, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; }),
    ]);
    return {
        owner,
        heartbeatAt: lock?.mtime.toISOString() ?? null,
        lockExists: lock !== null,
    };
}

function healthyHeartbeat(snapshot: LeaseSnapshot): boolean {
    if (!snapshot.lockExists || !snapshot.heartbeatAt) return false;
    const ageMs = Date.now() - Date.parse(snapshot.heartbeatAt);
    return Number.isFinite(ageMs) && ageMs < 30_000;
}


function parseLeaseOwner(raw: string): LeaseOwner | null {
    try {
        const value = JSON.parse(raw) as Partial<LeaseOwner>;
        if (
            typeof value.leaseId !== "string"
            || (value.kind !== "runtime" && value.kind !== "migration")
            || typeof value.pid !== "number"
            || (value.runtime !== "node" && value.runtime !== "bun")
        ) return null;
        return value as LeaseOwner;
    } catch (error) {
        console.error(`解析开发租约失败：${errorMessage(error)}`);
        return null;
    }
}

async function waitForCompletion(lease: OwnedProcessLease, timeoutMs: number): Promise<OwnedProcessCompletion | null> {
    return await Promise.race([
        lease.completion,
        sleep(timeoutMs).then(() => null),
    ]);
}

async function waitForLockRelease(leasePath: string, timeoutMs: number): Promise<LeaseSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let snapshot = await readLeaseSnapshot(leasePath);
    while (snapshot.lockExists && Date.now() < deadline) {
        await sleep(200);
        snapshot = await readLeaseSnapshot(leasePath);
    }
    return snapshot;
}

async function disposeDevRun(ctx: SmokeContext, id: CheckId, run: DevRun | undefined): Promise<void> {
    if (!run) return;
    try {
        await run.lease.terminate("shutdown");
        ctx.log(id, "finally已调用Owned Process terminate(shutdown)收口开发进程树。");
    } catch (error) {
        ctx.log(id, `finally收口开发进程树失败：${errorMessage(error)}`);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
