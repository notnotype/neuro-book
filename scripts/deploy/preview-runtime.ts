/** 供 CLI 和合同测试共享的 runtime owner 文件名。 */
export const PREVIEW_RUNTIME_OWNER_FILE = "runtime-owner.json";
export const PREVIEW_RUNTIME_LEASE_FILE = "runtime.lease";
import {createConnection, createServer} from "node:net";
import {spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {check as checkLock, lock as acquireLock} from "proper-lockfile";
import {spawnOwnedProcess, type OwnedProcessLease} from "@notnotype/owned-process";
import {waitForApplicationReady} from "nbook/shared/application-ready";
import {shutdownNativeProduct} from "nbook/shared/product-runtime-shutdown";

export const PREVIEW_RUNTIME_SCHEMA = "nbook.preview-runtime/v1";
export const PREVIEW_RUNTIME_HEARTBEAT_MS = 10_000;
export const PREVIEW_RUNTIME_MAX_LIFETIME_MS = 20 * 60_000;
export const PREVIEW_RUNTIME_PRODUCT_STARTUP_TIMEOUT_MS = 120_000;
export const PREVIEW_RUNTIME_SOURCE_DEV_STARTUP_TIMEOUT_MS = 180_000;

export type PreviewRuntimeMode = "product" | "source-dev";

export type PreviewRuntimeOptions = {
    repoRoot: string;
    taskRoot: string;
    operationId: string;
    mode: "auto" | PreviewRuntimeMode;
    port: number;
    expectedVersion: string;
    stateRoot: string;
    cacheRoot: string;
    browserMediaRoot: string;
    /** 迁移完成后向隔离 State Root 注入本次预览所需的示例配置。 */
    prepareStateRoot?: (stateRoot: string, mode: PreviewRuntimeMode) => Promise<void>;
};

export type PreviewRuntimeHandle = {
    mode: PreviewRuntimeMode;
    url: string;
    port: number;
    startupNonce: string;
    ready: Promise<void>;
    stop(): Promise<void>;
    readonly stopResult: "graceful" | "forced" | "failed" | null;
    productAttempt: "not-attempted" | "ready" | "unavailable" | "failed";
    fallbackReason?: string;
};
type RuntimeOwner = {
    schema: typeof PREVIEW_RUNTIME_SCHEMA;
    operationId: string;
    pid: number;
    mode: PreviewRuntimeMode;
    port: number;
    stateRoot: string;
    cacheRoot: string;
    startedAt: string;
    heartbeatAt: string;
    startupNoncePresent: true;
    shutdownTokenRef: "memory-only";
};

type ActiveProcess = {
    mode: PreviewRuntimeMode;
    port: number;
    token: string;
    stageRoot?: string;
    lease: OwnedProcessLease;
    completion: Promise<NativeProductExit>;
};

type NativeProductExit = {
    code: number | null;
    signal: string | null;
};

type ProductAttempt = {
    status: PreviewRuntimeHandle["productAttempt"];
    reason?: string;
};

const OWNER_FILE = "runtime-owner.json";
const LEASE_FILE = "runtime.lease";
const STALE_RUNTIME_OWNER_MS = 24 * 60 * 60 * 1000;
const PRODUCT_ACCEPTANCE_ROOT = ".agent/product-runtime-acceptance";
const PRODUCT_STAGE_SCRIPT = "scripts/deploy/product-runtime.mjs";

/**
 * 启动一个带隔离 State/Cache、动态 loopback 端口和可验证关闭协议的预览服务。
 * Product 只在 auto/product 模式先尝试；auto 仅允许一次 Source Dev fallback。
 */
export async function startPreviewRuntime(options: PreviewRuntimeOptions): Promise<PreviewRuntimeHandle> {
    const normalized = normalizeOptions(options);
    await mkdir(normalized.taskRoot, {recursive: true});
    await sweepStaleRuntimeOwners(dirname(normalized.taskRoot), normalized.taskRoot);
    const roots = ownedRoots(normalized.taskRoot);
    const leasePath = resolve(normalized.taskRoot, LEASE_FILE);
    await writeFile(leasePath, "", {encoding: "utf8", flag: "a"});
    const releaseLeaseRaw = await acquireLock(leasePath, {
        realpath: false,
        stale: 60_000,
        update: PREVIEW_RUNTIME_HEARTBEAT_MS,
        retries: {retries: 0},
    });
    let leaseReleased = false;
    const releaseLease = async (): Promise<void> => {
        if (leaseReleased) return;
        leaseReleased = true;
        await releaseLeaseRaw();
        await rm(leasePath, {force: true});
    };
    try {
        await prepareOwnedRoots(roots);
        await migrateStateRoots(normalized, roots);
        await prepareConfiguredStateRoots(normalized, roots);
    } catch (error) {
        await releaseLease().catch(() => undefined);
        await removeOwnedRoots(roots).catch(() => undefined);
        throw error;
    }
    const startupNonce = randomBytes(32).toString("base64url");
    const shutdownToken = randomBytes(32).toString("base64url");
    let requestedPort: number;
    try {
        requestedPort = await reserveLoopbackPort(normalized.port);
    } catch (error) {
        await releaseLease().catch(() => undefined);
        await removeOwnedRoots(roots).catch(() => undefined);
        throw error;
    }
    const startedAt = new Date().toISOString();
    let active: ActiveProcess | null = null;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let lifetimeTimer: NodeJS.Timeout | undefined;
    let signalHandlersInstalled = false;
    let stopPromise: Promise<void> | null = null;
    let stopResult: PreviewRuntimeHandle["stopResult"] = null;
    let stopped = false;
    let selectedMode: PreviewRuntimeMode = normalized.mode === "source-dev" ? "source-dev" : "product";
    let productAttempt: ProductAttempt = normalized.mode === "source-dev"
        ? {status: "not-attempted"}
        : {status: "unavailable"};

    const ownerPath = resolve(normalized.taskRoot, OWNER_FILE);
    const writeOwnerMarker = async (): Promise<void> => {
        const selected = selectedRoots(selectedMode, roots);
        if (!isContained(normalized.taskRoot, selected.stateRoot) || !isContained(normalized.taskRoot, selected.cacheRoot)) {
            throw new Error("Preview Runtime owner marker 路径越出 taskRoot。");
        }
        const owner: RuntimeOwner = {
            schema: PREVIEW_RUNTIME_SCHEMA,
            operationId: normalized.operationId,
            pid: process.pid,
            mode: selectedMode,
            port: requestedPort,
            stateRoot: selected.stateRoot,
            cacheRoot: selected.cacheRoot,
            startedAt,
            heartbeatAt: new Date().toISOString(),
            startupNoncePresent: true,
            shutdownTokenRef: "memory-only",
        };
        await writeJsonAtomic(ownerPath, owner);
    };

    const stop = async (): Promise<void> => {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
            if (stopped) return;
            stopped = true;
            clearTimeout(lifetimeTimer);
            clearInterval(heartbeatTimer);
            removeSignalHandlers();

            const processToStop = active;
            let shutdownFailure: unknown;
            if (processToStop) {
                try {
                    const shutdownResult = await shutdownNativeProduct({
                        port: processToStop.port,
                        token: processToStop.token,
                        host: "127.0.0.1",
                        completion: processToStop.completion,
                        forceTerminate: async () => {
                            await processToStop.lease.terminate("shutdown");
                        },
                    });
                    stopResult = shutdownResult;
                } catch (error) {
                    try {
                        await processToStop.lease.terminate("shutdown");
                        stopResult = "forced";
                    } catch (forceFailure) {
                        stopResult = "failed";
                        shutdownFailure = new AggregateError(
                            [asError(error), asError(forceFailure)],
                            "Preview Runtime graceful 与强制关闭均失败",
                        );
                    }
                }
            } else {
                stopResult = "graceful";
            }

            const portClosed = await waitForPortClosed(requestedPort, 5_000);
            if (!portClosed) {
                const errors = [new Error(`Preview Runtime 端口仍可达：127.0.0.1:${String(requestedPort)}`)];
                if (shutdownFailure) errors.unshift(asError(shutdownFailure));
                throw new AggregateError(errors, "Preview Runtime 关闭后端口仍未释放");
            }

            if (processToStop?.mode === "product" && processToStop.stageRoot) {
                try {
                    await cleanupProductStage(normalized, processToStop.stageRoot);
                } catch (error) {
                    const errors = [asError(error)];
                    if (shutdownFailure) errors.unshift(asError(shutdownFailure));
                    throw new AggregateError(errors, "Product stage 清理失败");
                }
            }
            if (shutdownFailure) throw asError(shutdownFailure);

            await rm(ownerPath, {force: true});
            await releaseLease();
            await removeOwnedRoots(roots);
        })();
        return stopPromise;
    };

    const requestShutdown = (): void => {
        void stop().catch(() => undefined);
    };
    const installSignalHandlers = (): void => {
        if (signalHandlersInstalled) return;
        signalHandlersInstalled = true;
        process.once("SIGINT", requestShutdown);
        process.once("SIGTERM", requestShutdown);
    };
    const removeSignalHandlers = (): void => {
        if (!signalHandlersInstalled) return;
        signalHandlersInstalled = false;
        process.off("SIGINT", requestShutdown);
        process.off("SIGTERM", requestShutdown);
    };

    try {
        installSignalHandlers();
        if (normalized.mode !== "source-dev") {
            try {
                await stageProduct(normalized, startupNonce, shutdownToken);
                const productRoots = selectedRoots("product", roots);
                active = await startProcess(normalized, "product", productRoots, requestedPort, startupNonce, shutdownToken);
                selectedMode = "product";
                productAttempt = {status: "ready"};
            } catch (error) {
                productAttempt = {
                    status: isProductUnavailable(error) ? "unavailable" : "failed",
                    reason: safeErrorMessage(error),
                };
                if (normalized.mode === "product") {
                    await stopAfterStartupFailure(active, normalized, roots, ownerPath, releaseLease, requestedPort, error);
                    throw error;
                }
                if (active) {
                    await stopActiveProcess(active).catch(() => undefined);
                    active = null;
                }
                await cleanupProductStageIfPresent(normalized).catch(() => undefined);
                selectedMode = "source-dev";
            }
        }
        if (!active) {
            const devRoots = selectedRoots("source-dev", roots);
            active = await startProcess(normalized, "source-dev", devRoots, requestedPort, startupNonce, shutdownToken);
            selectedMode = "source-dev";
        }

        await writeOwnerMarker();
        heartbeatTimer = setInterval(() => {
            void writeOwnerMarker().catch(() => undefined);
        }, PREVIEW_RUNTIME_HEARTBEAT_MS);
        lifetimeTimer = setTimeout(() => {
            void stop().catch(() => undefined);
        }, PREVIEW_RUNTIME_MAX_LIFETIME_MS);

        const handle: PreviewRuntimeHandle = {
            mode: selectedMode,
            url: `http://127.0.0.1:${String(requestedPort)}`,
            port: requestedPort,
            startupNonce,
            ready: Promise.resolve(),
            get stopResult() { return stopResult; },
            productAttempt: productAttempt.status,
            ...(productAttempt.reason ? {fallbackReason: productAttempt.reason} : {}),
            stop,
        };
        return handle;
    } catch (error) {
        removeSignalHandlers();
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        if (active) await stopActiveProcess(active).catch(() => undefined);
        await cleanupProductStageIfPresent(normalized).catch(() => undefined);
        await rm(ownerPath, {force: true}).catch(() => undefined);
        await removeOwnedRoots(roots).catch(() => undefined);
        await releaseLease().catch(() => undefined);
        throw error;
    }
}

/** 统一的自有进程启动路径；ready 前任何自然退出都由 ready helper 判定为失败。 */
async function startProcess(
    options: NormalizedOptions,
    mode: PreviewRuntimeMode,
    roots: RuntimeRootsForMode,
    port: number,
    startupNonce: string,
    shutdownToken: string,
): Promise<ActiveProcess> {
    const bun = resolveBunExecutable();
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: String(port),
        NUXT_PORT: String(port),
        NITRO_PORT: String(port),
        NEURO_BOOK_APPLICATION_ROOT: options.repoRoot,
        NEURO_BOOK_STATE_ROOT: roots.stateRoot,
        NEURO_BOOK_CACHE_ROOT: roots.cacheRoot,
        NEURO_BOOK_STARTUP_NONCE: startupNonce,
        NEURO_BOOK_SHUTDOWN_TOKEN: shutdownToken,
        NEURO_BOOK_PRODUCT_OPERATION_ID: options.operationId,
        BUN: bun,
    };
    let command: string;
    let args: string[];
    let cwd = options.repoRoot;
    let stageRoot: string | undefined;
    if (mode === "product") {
        command = bun;
        args = ["--no-install", PRODUCT_STAGE_SCRIPT, "start"];
        stageRoot = resolve(options.repoRoot, PRODUCT_ACCEPTANCE_ROOT, options.operationId);
        environment.NEURO_BOOK_PRODUCT_STAGE_DIR = relative(options.repoRoot, stageRoot).replaceAll("\\", "/");
    } else {
        command = bun;
        args = ["--no-install", "run", "dev:runtime"];
    }

    const lease = spawnOwnedProcess({
        command,
        args,
        cwd,
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "inherit",
        windowsHide: false,
        graceMs: 2_000,
        hardKillWaitMs: 5_000,
    });
    const completion = lease.completion.then((result) => ({
        code: result.exitCode,
        signal: result.signal,
    }));
    try {
        await waitForApplicationReady(
            port,
            options.expectedVersion,
            completion,
            mode === "product"
                ? PREVIEW_RUNTIME_PRODUCT_STARTUP_TIMEOUT_MS
                : PREVIEW_RUNTIME_SOURCE_DEV_STARTUP_TIMEOUT_MS,
            startupNonce,
        );
    } catch (error) {
        await lease.terminate("startup-failure").catch(() => undefined);
        throw classifyStartupFailure(error);
    }
    return {mode, port, token: shutdownToken, stageRoot, lease, completion};
}

/** Product stage 只接受现有 verified image；命令本身复用既有 Builder 验证。 */
async function stageProduct(options: NormalizedOptions, startupNonce: string, shutdownToken: string): Promise<void> {
    const stageRoot = resolve(options.repoRoot, PRODUCT_ACCEPTANCE_ROOT, options.operationId);
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        NEURO_BOOK_PRODUCT_OPERATION_ID: options.operationId,
        NEURO_BOOK_PRODUCT_STAGE_DIR: relative(options.repoRoot, stageRoot).replaceAll("\\", "/"),
        NEURO_BOOK_STARTUP_NONCE: startupNonce,
        NEURO_BOOK_SHUTDOWN_TOKEN: shutdownToken,
    };
    const outputRoot = resolve(options.repoRoot, ".output");
    if (!await pathExists(resolve(outputRoot, "runtime-image.json")) || !await pathExists(resolve(outputRoot, "runtime-image.ready"))) {
        throw new PreviewRuntimeStartupError("product-unavailable", "Product Runtime verified manifest 或 ready marker 不存在。");
    }
    await runCommand(resolveBunExecutable(), ["--no-install", PRODUCT_STAGE_SCRIPT, "stage"], options.repoRoot, environment);
}

/** Product stage 清理只通过 product-runtime.mjs cleanup，不直接删除验收目录。 */
async function cleanupProductStage(options: NormalizedOptions, stageRoot: string): Promise<void> {
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        NEURO_BOOK_PRODUCT_OPERATION_ID: options.operationId,
        NEURO_BOOK_PRODUCT_STAGE_DIR: relative(options.repoRoot, stageRoot).replaceAll("\\", "/"),
    };
    await runCommand(resolveBunExecutable(), ["--no-install", PRODUCT_STAGE_SCRIPT, "cleanup", options.operationId], options.repoRoot, environment);
}

async function cleanupProductStageIfPresent(options: NormalizedOptions): Promise<void> {
    const stageRoot = resolve(options.repoRoot, PRODUCT_ACCEPTANCE_ROOT, options.operationId);
    if (!await pathExists(stageRoot)) return;
    await cleanupProductStage(options, stageRoot);
}

/** 既有 shutdownNativeProduct 已负责 graceful→force；此函数保留 idempotent 调用边界。 */
async function stopActiveProcess(active: ActiveProcess): Promise<void> {
    await shutdownNativeProduct({
        port: active.port,
        token: active.token,
        host: "127.0.0.1",
        completion: active.completion,
        forceTerminate: async () => {
            await active.lease.terminate("shutdown");
        },
    });
}

async function stopAfterStartupFailure(
    active: ActiveProcess | null,
    options: NormalizedOptions,
    roots: RuntimeRoots,
    ownerPath: string,
    releaseLease: () => Promise<void>,
    port: number,
    originalError: unknown,
): Promise<void> {
    if (active) await stopActiveProcess(active).catch(() => undefined);
    await waitForPortClosed(port, 5_000);
    await cleanupProductStageIfPresent(options).catch(() => undefined);
    await rm(ownerPath, {force: true}).catch(() => undefined);
    await removeOwnedRoots(roots).catch(() => undefined);
    await releaseLease().catch(() => undefined);
    void originalError;
}

/** 生成本次任务的四个独立 State/Cache 根；不允许清理范围越出 taskRoot。 */
function ownedRoots(taskRoot: string): RuntimeRoots {
    return {
        productState: resolve(taskRoot, "product-state"),
        devState: resolve(taskRoot, "dev-state"),
        productCache: resolve(taskRoot, "product-cache"),
        devCache: resolve(taskRoot, "dev-cache"),
    };
}

async function prepareOwnedRoots(roots: RuntimeRoots): Promise<void> {
    await Promise.all([
        prepareStateRoot(roots.productState),
        prepareStateRoot(roots.devState),
        mkdir(roots.productCache, {recursive: true}),
        mkdir(roots.devCache, {recursive: true}),
    ]);
}

async function migrateStateRoots(options: NormalizedOptions, roots: RuntimeRoots): Promise<void> {
    await Promise.all([
        migrateStateRoot(options, roots.productState, roots.productCache, "product"),
        migrateStateRoot(options, roots.devState, roots.devCache, "source-dev"),
    ]);
}

async function prepareConfiguredStateRoots(options: NormalizedOptions, roots: RuntimeRoots): Promise<void> {
    const prepare = options.prepareStateRoot;
    if (!prepare) return;
    await Promise.all([
        prepare(roots.productState, "product"),
        prepare(roots.devState, "source-dev"),
    ]);
}

async function migrateStateRoot(
    options: NormalizedOptions,
    stateRoot: string,
    cacheRoot: string,
    mode: PreviewRuntimeMode,
): Promise<void> {
    const result = await runJsonCommand(
        resolveBunExecutable(),
        ["--no-install", "scripts/db/migrate-application-state.ts", "--apply", "--root", resolve(stateRoot, "workspace"), "--run-id", `${options.operationId}-${mode}`],
        options.repoRoot,
        {
            ...process.env,
            NEURO_BOOK_APPLICATION_ROOT: options.repoRoot,
            NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_CACHE_ROOT: cacheRoot,
        },
    );
    if (result.status !== "already_current" && result.status !== "complete") {
        throw new PreviewRuntimeStartupError("product-failed", `隔离 State Root 迁移未完成：${result.status}`);
    }
}
async function prepareStateRoot(stateRoot: string): Promise<void> {
    await mkdir(stateRoot, {recursive: true});
    await writeFile(resolve(stateRoot, "config.yaml"), "auth:\n  enabled: false\n", {encoding: "utf8", flag: "w"});
}

async function removeOwnedRoots(roots: RuntimeRoots): Promise<void> {
    await Promise.all([
        rm(roots.productState, {recursive: true, force: true}),
        rm(roots.devState, {recursive: true, force: true}),
        rm(roots.productCache, {recursive: true, force: true}),
        rm(roots.devCache, {recursive: true, force: true}),
    ]);
}

type RuntimeRoots = {
    productState: string;
    devState: string;
    productCache: string;
    devCache: string;
};

type RuntimeRootsForMode = {
    stateRoot: string;
    cacheRoot: string;
};

function selectedRoots(mode: PreviewRuntimeMode, roots: RuntimeRoots): RuntimeRootsForMode {
    return mode === "product"
        ? {stateRoot: roots.productState, cacheRoot: roots.productCache}
        : {stateRoot: roots.devState, cacheRoot: roots.devCache};
}

type NormalizedOptions = PreviewRuntimeOptions & {
    repoRoot: string;
    taskRoot: string;
    stateRoot: string;
    cacheRoot: string;
};
function normalizeOptions(options: PreviewRuntimeOptions): NormalizedOptions {
    const repoRoot = resolve(options.repoRoot);
    const taskRoot = resolve(options.taskRoot);
    const stateRoot = resolve(options.stateRoot);
    const cacheRoot = resolve(options.cacheRoot);
    if (!isAbsolute(options.repoRoot) || !isAbsolute(options.taskRoot) || !isAbsolute(options.stateRoot) || !isAbsolute(options.cacheRoot)) {
        throw new Error("Preview Runtime repoRoot、taskRoot、stateRoot、cacheRoot 必须是绝对路径。");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.operationId)) {
        throw new Error("Preview Runtime operationId 非法。");
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
        throw new Error(`Preview Runtime 端口非法：${String(options.port)}`);
    }
    if (!options.expectedVersion.trim()) throw new Error("Preview Runtime expectedVersion 不能为空。");
    if (!isAbsolute(options.browserMediaRoot)) throw new Error("Preview Runtime browserMediaRoot 必须是绝对路径。");
    const expectedStateRoot = resolve(taskRoot, options.mode === "source-dev" ? "dev-state" : "product-state");
    const expectedCacheRoot = resolve(taskRoot, options.mode === "source-dev" ? "dev-cache" : "product-cache");
    if (stateRoot !== expectedStateRoot || cacheRoot !== expectedCacheRoot) {
        throw new Error("Preview Runtime state/cache 必须是 taskRoot 下与运行模式对应的隔离根。");
    }
    return {...options, repoRoot, taskRoot, stateRoot, cacheRoot};
}

async function reserveLoopbackPort(preferredPort: number): Promise<number> {
    if (preferredPort > 0) {
        if (await isPortReachable(preferredPort)) throw new Error(`Preview Runtime 端口已被占用：${String(preferredPort)}`);
        return preferredPort;
    }
    const server = createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise()));
    if (!port) throw new Error("Preview Runtime 无法取得动态 loopback 端口。");
    return port;
}

async function waitForPortClosed(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!await isPortReachable(port)) return true;
        await delay(250);
    }
    return !await isPortReachable(port);
}

async function isPortReachable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolvePromise) => {
        const socket = createConnection({host: "127.0.0.1", port});
        const finish = (result: boolean): void => {
            socket.removeAllListeners();
            socket.destroy();
            resolvePromise(result);
        };
        socket.setTimeout(500, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
    });
}

async function sweepStaleRuntimeOwners(parentRoot: string, currentTaskRoot: string): Promise<void> {
    const entries = await readdir(parentRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidateRoot = resolve(parentRoot, entry.name);
        if (candidateRoot === resolve(currentTaskRoot)) continue;
        const ownerPath = resolve(candidateRoot, OWNER_FILE);
        let owner: Partial<RuntimeOwner>;
        try {
            owner = JSON.parse(await readFile(ownerPath, "utf8")) as Partial<RuntimeOwner>;
        } catch {
            continue;
        }
        if (owner.schema !== PREVIEW_RUNTIME_SCHEMA || typeof owner.heartbeatAt !== "string") continue;
        const heartbeat = Date.parse(owner.heartbeatAt);
        if (!Number.isFinite(heartbeat) || Date.now() - heartbeat < STALE_RUNTIME_OWNER_MS) continue;
        const leased = await checkLock(resolve(candidateRoot, LEASE_FILE), {realpath: false}).catch(() => false);
        if (leased) continue;
        if (!isDirectChild(parentRoot, candidateRoot)) continue;
        await rm(candidateRoot, {recursive: true, force: true});
    }
}

async function writeJsonAtomic(path: string, value: object): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {encoding: "utf8", flag: "wx"});
    try {
        await rename(temporary, path);
    } finally {
        await rm(temporary, {force: true}).catch(() => undefined);
    }
}

async function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {cwd, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true});
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
        });
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (code === 0 && !signal) {
                resolvePromise();
                return;
            }
            rejectPromise(new PreviewRuntimeStartupError(
                "product-failed",
                `Product Runtime 命令未成功退出：${signal ?? String(code ?? 1)}${stderr.trim() ? `；${stderr.trim()}` : ""}`,
            ));
        });
    });
}

async function runJsonCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
): Promise<{status?: string}> {
    const {promise, resolve: resolvePromise, reject: rejectPromise} = Promise.withResolvers<{status?: string}>();
    const child = spawn(command, args, {cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk.toString("utf8")}`.slice(-16_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000); });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
        if (code !== 0 || signal) {
            rejectPromise(new PreviewRuntimeStartupError(
                "product-failed",
                `Application State 迁移未成功退出：${signal ?? String(code ?? 1)}${stderr.trim() ? `；${stderr.trim()}` : ""}`,
            ));
            return;
        }
        try {
            resolvePromise(JSON.parse(stdout.trim()) as {status?: string});
        } catch (error) {
            rejectPromise(new PreviewRuntimeStartupError("product-failed", `Application State 迁移输出无效：${safeErrorMessage(error)}`));
        }
    });
    return promise;
}

function resolveBunExecutable(): string {
    return process.versions.bun ? process.execPath : process.env.BUN_EXECUTABLE?.trim() || "bun";
}

function classifyStartupFailure(error: unknown): PreviewRuntimeStartupError {
    if (error instanceof PreviewRuntimeStartupError) return error;
    return new PreviewRuntimeStartupError("product-failed", safeErrorMessage(error));
}

function isProductUnavailable(error: unknown): boolean {
    return error instanceof PreviewRuntimeStartupError && error.kind === "product-unavailable";
}

export class PreviewRuntimeStartupError extends Error {
    readonly kind: "product-unavailable" | "product-failed";

    constructor(kind: "product-unavailable" | "product-failed", message: string) {
        super(message);
        this.name = "PreviewRuntimeStartupError";
        this.kind = kind;
    }
}

function safeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function isContained(root: string, target: string): boolean {
    const relativePath = relative(resolve(root), resolve(target));
    return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function isDirectChild(parent: string, target: string): boolean {
    const relativePath = relative(resolve(parent), resolve(target));
    return relativePath !== "" && !relativePath.includes(sep) && !relativePath.startsWith("..");
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
