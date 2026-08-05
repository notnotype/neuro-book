import {randomBytes} from "node:crypto";
import {app, BrowserWindow, ipcMain} from "electron";
import {createServer} from "node:net";
import {join, resolve} from "node:path";
import {
    spawnOwnedProcess,
    type OwnedProcessCompletion,
    type OwnedProcessLease,
} from "@notnotype/owned-process";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
} from "nbook/shared/product-runtime-contract";
import {shutdownNativeProduct} from "nbook/shared/product-runtime-shutdown";
import {auditProductContract, type ContractAudit} from "../../shared/src/contract-audit";

type DesktopConfig = {
    imageRoot: string;
    applicationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    launcher: string;
    bun: string;
    port: number;
};

type RunningProduct = {
    config: DesktopConfig;
    token: string;
    lease: OwnedProcessLease;
    audit: ContractAudit;
    shutdown: () => Promise<"graceful" | "forced">;
};

let window: BrowserWindow | null = null;
let running: RunningProduct | null = null;
let closing: Promise<void> | null = null;

/** 从显式环境读取 Desktop spike 配置；不读取 cwd 猜测 Product。 */
function readConfig(): DesktopConfig {
    const required = (key: string): string => {
        const value = process.env[key]?.trim();
        if (!value) throw new Error(`Electron spike 缺少环境变量：${key}`);
        return value;
    };
    const explicitKeys = [
        "T140_PRODUCT_IMAGE_ROOT",
        "T140_APPLICATION_ROOT",
        "T140_STATE_ROOT",
        "T140_CACHE_ROOT",
        "T140_LAUNCHER",
        "T140_BUN_EXECUTABLE",
        "T140_PORT",
    ];
    const hasExplicitConfig = explicitKeys.some((key) => Boolean(process.env[key]?.trim()));
    if (hasExplicitConfig) {
        const port = Number(process.env.T140_PORT ?? "0");
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("Electron spike 的 T140_PORT 必须是 0-65535 的整数。");
        }
        return {
            imageRoot: resolve(required("T140_PRODUCT_IMAGE_ROOT")),
            applicationRoot: resolve(required("T140_APPLICATION_ROOT")),
            stateRoot: resolve(required("T140_STATE_ROOT")),
            cacheRoot: resolve(required("T140_CACHE_ROOT")),
            launcher: resolve(required("T140_LAUNCHER")),
            bun: required("T140_BUN_EXECUTABLE"),
            port,
        };
    }

    // 打包后的 Electron 位于 <portable>/desktop，resources/app 是本入口的目录。
    // 从 resources 反推 portable root，避免依赖启动 cwd 或任何 T140 环境变量。
    const portableRoot = resolve(process.resourcesPath, "..", "..");
    return {
        imageRoot: join(portableRoot, "app", ".output"),
        applicationRoot: join(portableRoot, "app"),
        stateRoot: join(portableRoot, "data"),
        cacheRoot: join(portableRoot, ".cache"),
        launcher: join(portableRoot, "desktop", "product-launcher.mjs"),
        bun: join(portableRoot, "runtime", "bun.exe"),
        port: 0,
    };
}

/** 让系统分配一个 loopback 端口；关闭探测 socket 后立即交给 Product。 */
async function selectPort(requested: number): Promise<number> {
    if (requested !== 0) return requested;
    return await new Promise<number>((resolvePromise, rejectPromise) => {
        const probe = createServer();
        probe.once("error", rejectPromise);
        probe.listen({host: "127.0.0.1", port: 0}, () => {
            const address = probe.address();
            if (!address || typeof address === "string") {
                probe.close();
                rejectPromise(new Error("Electron spike 无法读取动态 loopback 端口。"));
                return;
            }
            const port = address.port;
            probe.close((error) => error ? rejectPromise(error) : resolvePromise(port));
        });
    });
}

/** 在启动长期 Product 前执行一次幂等的 Product-owned migration。 */
async function prepareProduct(config: DesktopConfig): Promise<void> {
    const lease = spawnOwnedProcess({
        command: config.bun,
        args: [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            config.launcher,
            "prepare",
            "--image-root", config.imageRoot,
            "--application-root", config.applicationRoot,
            "--state-root", config.stateRoot,
            "--cache-root", config.cacheRoot,
            "--port", String(config.port),
            "--bun", config.bun,
        ],
        cwd: config.applicationRoot,
        env: {
            ...process.env,
            T140_BUN_EXECUTABLE: config.bun,
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    lease.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[prepare] ${chunk.toString()}`));
    lease.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[prepare] ${chunk.toString()}`));
    const result = await lease.completion;
    if (result.signal || result.exitCode !== 0) {
        throw new Error(`Product migration 失败：${result.signal ?? result.exitCode ?? 1}`);
    }
}

/** 启动共同 Product launcher，并只把 token 放入子进程环境。 */
async function launchProduct(config: DesktopConfig): Promise<RunningProduct> {
    const resolvedConfig = {...config, port: await selectPort(config.port)};
    const audit = await auditProductContract(resolvedConfig.imageRoot);
    if (audit.unsafeEntries.length > 0) {
        throw new Error(`Electron spike 拒绝不安全 Product Contract：${audit.unsafeEntries.join(",")}`);
    }
    await prepareProduct(resolvedConfig);
    const token = randomBytes(32).toString("hex");
    const lease = spawnOwnedProcess({
        command: resolvedConfig.bun,
        args: [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            resolvedConfig.launcher,
            "start",
            "--image-root", resolvedConfig.imageRoot,
            "--application-root", resolvedConfig.applicationRoot,
            "--state-root", resolvedConfig.stateRoot,
            "--cache-root", resolvedConfig.cacheRoot,
            "--port", String(resolvedConfig.port),
            "--bun", resolvedConfig.bun,
        ],
        cwd: resolvedConfig.applicationRoot,
        env: {
            ...process.env,
            [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: token,
            T140_BUN_EXECUTABLE: resolvedConfig.bun,
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    lease.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[product] ${chunk.toString()}`));
    lease.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[product] ${chunk.toString()}`));
    const shutdown = async (): Promise<"graceful" | "forced"> => await shutdownNativeProduct({
        port: resolvedConfig.port,
        token,
        completion: lease.completion.then(toNativeExit),
        forceTerminate: async () => { await lease.terminate("shutdown"); },
    });
    try {
        await waitForHealth(resolvedConfig.port, lease.completion);
    } catch (error) {
        await lease.terminate("startup-failure").catch(() => undefined);
        throw error;
    }
    return {config: resolvedConfig, token, lease, audit, shutdown};
}

/** 等待真实 Product version API；只认 HTTP 200，不以 child 存在判定 ready。 */
async function waitForHealth(port: number, completion: Promise<OwnedProcessCompletion>): Promise<void> {
    const deadline = Date.now() + 30_000;
    let lastError = "尚未响应";
    while (Date.now() < deadline) {
        const terminal = await Promise.race([
            completion.then((result) => result),
            new Promise<null>((resolvePromise) => setTimeout(() => resolvePromise(null), 100)),
        ]);
        if (terminal) throw new Error(`Product 在 health 前退出：${JSON.stringify(terminal)}`);
        try {
            const response = await fetch(`http://127.0.0.1:${String(port)}/api/app/version`, {
                signal: AbortSignal.timeout(500),
            });
            if (response.status === 200) return;
            lastError = `HTTP ${String(response.status)}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 150));
    }
    throw new Error(`Product health 超时：${lastError}`);
}

function toNativeExit(result: OwnedProcessCompletion): {code: number | null; signal: string | null} {
    return {code: result.exitCode, signal: result.signal};
}

/** 只允许将 loopback Product URL 载入窗口，拒绝页面导航和任意新窗口。 */
function installNavigationGuards(): void {
    window?.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window?.webContents.on("will-navigate", (event, targetUrl) => {
        if (!targetUrl.startsWith(`http://127.0.0.1:${String(running?.config.port)}/`)) event.preventDefault();
    });
}

/** 处理窗口关闭、Product drain 与 Owned Process 兜底，所有调用共享同一 Promise。 */
async function closeApplication(): Promise<void> {
    if (closing) return await closing;
    closing = (async () => {
        if (running) {
            const result = await running.shutdown();
            console.log(JSON.stringify({kind: "electron-shutdown", result}));
            running = null;
        }
        app.quit();
    })();
    return await closing;
}

async function main(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }
    app.on("second-instance", () => window?.show());
    await app.whenReady();
    ipcMain.handle("t140:status", () => running ? {
        port: running.config.port,
        contract: running.audit.schema,
        imageRoot: running.config.imageRoot,
    } : null);
    const config = readConfig();
    running = await launchProduct(config);
    if (process.argv.includes("--t140-headless") || process.argv.includes("--headless")) {
        console.log(JSON.stringify({kind: "electron-headless-ready", port: running.config.port, contract: running.audit.schema}));
        const holdMs = Number(process.env.T140_HOLD_MS ?? "0");
        if (Number.isInteger(holdMs) && holdMs > 0) {
            await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, holdMs));
        }
        await closeApplication();
        return;
    }
    window = new BrowserWindow({
        width: 1280,
        height: 840,
        show: true,
        webPreferences: {
            preload: resolve(import.meta.dirname, "preload.mjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
        },
    });
    installNavigationGuards();
    await window.loadURL(`http://127.0.0.1:${String(running.config.port)}/`);
    window.on("closed", () => { window = null; void closeApplication(); });
}

app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    void closeApplication();
});

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
});
