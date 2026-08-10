import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createInterface} from "node:readline";
import {createServer} from "node:net";
import {app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, screen, shell} from "electron";
import {existsSync, readFileSync} from "node:fs";
import {mkdir as mkdirAsync, readFile as readFileAsync, writeFile as writeFileAsync} from "node:fs/promises";
import {homedir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {
    spawnOwnedProcess,
    type OwnedProcessCompletion,
    type OwnedProcessLease,
} from "@notnotype/owned-process";
import {PRODUCT_BUN_RUNTIME_ARGS} from "nbook/shared/product-runtime-contract";
import {
    desktopSupervisorLine,
    DESKTOP_MENU_COMMAND_IDS,
    parseDesktopCapability,
    parseDesktopInstallationManifest,
    parseDesktopSupervisorEvent,
    parseDesktopSettings,
    patchDesktopSettings,
    desktopRemoteOrigin,
    DEFAULT_DESKTOP_SETTINGS,
    type DesktopSettings,
    type DesktopAppearance,
    type DesktopMenuCommandId,
    type DesktopStatus,
    type DesktopSupervisorEvent,
} from "nbook/shared/desktop-contract";
import {ElectronDiagnostics} from "nbook/desktop/electron/src/diagnostics";
import {
    isCanonicalInstalledRoot,
    requireInstalledManifest,
} from "nbook/desktop/shared/src/installed-root";
import {
    materializeMachineManagerScript,
    materializeMachineProductImage,
} from "nbook/desktop/shared/src/manager-runtime";
import {auditProductContract, type ContractAudit} from "../../shared/src/contract-audit";

type DesktopConfig = {
    imageRoot: string;
    productExecutionImageRoot: string | null;
    applicationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manager: string;
    managerBun: string;
    privatePathEntries: string[];
    port: number;
    remoteUrl: string | null;
};

type RunningProduct = {
    config: DesktopConfig;
    startupNonce: string;
    version: string;
    lease: OwnedProcessLease;
    audit: ContractAudit;
    shutdown: () => Promise<"graceful" | "forced">;
};

type StartupAction = "retry" | "repair" | "open-logs" | "quit";

type WindowState = {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    fullscreen: boolean;
};

const DEFAULT_WINDOW_STATE: WindowState = {x: 80, y: 80, width: 1280, height: 840, maximized: false, fullscreen: false};
const SUPERVISOR_START_TIMEOUT_MS = 45_000;
const WINDOW_LOAD_TIMEOUT_MS = 45_000;
const startupStartedAt = performance.now();
const managerEntry = process.argv.includes("--manager-gui");
const diagnostics = new ElectronDiagnostics();
let windowStateWrite: Promise<void> = Promise.resolve();

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let running: RunningProduct | null = null;
let remoteStatus: DesktopStatus | null = null;
let startupActionResolver: ((action: StartupAction) => void) | null = null;

function desktopPlatform(): DesktopStatus["platform"] {
    if (process.platform === "win32") return "windows";
    if (process.platform === "darwin") return "macos";
    return "linux";
}

function desktopMenuPresentation(): DesktopStatus["menuPresentation"] {
    return process.platform === "darwin" ? "native" : "renderer";
}

function desktopWindowControls(): DesktopStatus["windowControls"] {
    if (process.platform === "win32") return "overlay";
    if (process.platform === "darwin") return "traffic-lights";
    return "custom";
}

function applyTitleBarAppearance(appearance: DesktopAppearance): void {
    if (process.platform !== "win32" || !window) return;
    window.setTitleBarOverlay(appearance === "dark"
        ? {color: "#1f1f1f", symbolColor: "#cccccc", height: 36}
        : {color: "#f4ecd8", symbolColor: "#5b4e3d", height: 36});
}
let closing: Promise<void> | null = null;
let allowWindowClose = false;
let desktopSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
let startupStage = "正在启动 NeuroBook...";
let reportedStartupStage = "";
let startupError = "";

/** 从显式环境或 Portable 根读取 Manager/Product 配置。 */
function readConfig(): DesktopConfig {
    const required = (key: string): string => {
        const value = process.env[key]?.trim();
        if (!value) throw new Error(`Electron Desktop development config 缺少环境变量：${key}`);
        return value;
    };
    const explicitKeys = [
        "NBOOK_DESKTOP_DEV_PRODUCT_IMAGE_ROOT", "NBOOK_DESKTOP_DEV_APPLICATION_ROOT", "NBOOK_DESKTOP_DEV_STATE_ROOT",
        "NBOOK_DESKTOP_DEV_CACHE_ROOT", "NBOOK_DESKTOP_DEV_DESKTOP_ROOT", "NBOOK_DESKTOP_DEV_MANAGER",
        "NBOOK_DESKTOP_DEV_BUN_EXECUTABLE", "NBOOK_DESKTOP_DEV_PORT",
    ];
    const allowDevelopmentConfig = process.env.NBOOK_DESKTOP_DEVELOPMENT === "1" || process.argv.includes("--headless");
    if (allowDevelopmentConfig && explicitKeys.some((key) => Boolean(process.env[key]?.trim()))) {
        const port = Number(process.env.NBOOK_DESKTOP_DEV_PORT ?? "0");
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Electron Desktop development config 的 NBOOK_DESKTOP_DEV_PORT 必须是 0-65535 的整数。");
        return {
            imageRoot: resolve(required("NBOOK_DESKTOP_DEV_PRODUCT_IMAGE_ROOT")),
            productExecutionImageRoot: null,
            applicationRoot: resolve(required("NBOOK_DESKTOP_DEV_APPLICATION_ROOT")),
            stateRoot: resolve(required("NBOOK_DESKTOP_DEV_STATE_ROOT")),
            cacheRoot: resolve(required("NBOOK_DESKTOP_DEV_CACHE_ROOT")),
            desktopRoot: resolve(required("NBOOK_DESKTOP_DEV_DESKTOP_ROOT")),
            manager: resolve(required("NBOOK_DESKTOP_DEV_MANAGER")),
            managerBun: required("NBOOK_DESKTOP_DEV_BUN_EXECUTABLE"),
            privatePathEntries: [],
            port,
            remoteUrl: process.env.NBOOK_DESKTOP_DEV_REMOTE_URL?.trim() || null,
        };
    }
    const portableRoot = resolve(process.resourcesPath, "..", "..");
    const runtimeRoots = readRuntimeRoots(portableRoot);
    requireInstalledManifest(portableRoot, runtimeRoots.desktop);
    const privatePathEntries = readManagedToolPathEntries(portableRoot, runtimeRoots.desktop);
    return {
        imageRoot: join(portableRoot, ".output"),
        productExecutionImageRoot: null,
        applicationRoot: portableRoot,
        stateRoot: runtimeRoots.state,
        cacheRoot: runtimeRoots.cache,
        desktopRoot: runtimeRoots.desktop,
        manager: join(portableRoot, "manager", "neuro-book.mjs"),
        managerBun: resolveManagerRuntime(portableRoot, runtimeRoots.desktop),
        privatePathEntries,
        port: 0,
        remoteUrl: readRemoteUrl(runtimeRoots.desktop),
    };
}

/** Windows 单实例身份固定在用户级目录，不随 Portable 的安装根变化。 */
function desktopIdentityRoot(): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
    if (process.platform === "win32") return resolve(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "NeuroBook", "desktop");
    if (process.platform === "darwin") return resolve(home, "Library", "Application Support", "NeuroBook", "desktop");
    return resolve(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "NeuroBook", "desktop");
}

/** 读取 Manager 写入的相对 locator；没有安装 locator 时保持 Portable 布局。 */
function readRuntimeRoots(root: string): {state: string; cache: string; desktop: string} {
    const locatorPath = join(root, "desktop", "runtime-locators.json");
    let text: string;
    try {
        text = readFileSync(locatorPath, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            if (existsSync(join(root, "desktop", "desktop-installation.json")) || isCanonicalInstalledRoot(root)) {
                throw new Error("Installed Desktop 缺少 runtime-locators.json，请通过 Manager Repair 修复。");
            }
            return {state: join(root, "data"), cache: join(root, ".cache"), desktop: join(root, "data", ".desktop")};
        }
        throw error;
    }
    const value = JSON.parse(text) as {
        schema?: string;
        state?: {base?: string; path?: string};
        cache?: {base?: string; path?: string};
        desktop?: {base?: string; path?: string};
    };
    if (value.schema !== "nbook.desktop-installation-runtime/v1") throw new Error("Desktop runtime locator schema 不受支持。");
    const home = process.env.USERPROFILE ?? process.env.HOME;
    const localAppData = resolve(process.env.LOCALAPPDATA ?? (home ? join(home, "AppData", "Local") : join(root, "data", ".desktop")));
    const userAppData = process.platform === "darwin"
        ? resolve(process.env.HOME ?? home ?? root, "Library", "Application Support")
        : localAppData;
    const userCache = process.platform === "darwin"
        ? resolve(process.env.HOME ?? home ?? root, "Library", "Caches")
        : resolve(process.env.XDG_CACHE_HOME ?? localAppData);
    const resolveLocator = (locator: {base?: string; path?: string} | undefined, label: string): string => {
        if (!locator?.path || !["installation-root", "local-app-data", "user-app-data", "user-cache"].includes(locator.base ?? "") || !safeLocatorPath(locator.path)) {
            throw new Error(`${label} runtime locator 非法。`);
        }
        const base = locator.base === "installation-root"
            ? root
            : locator.base === "local-app-data"
                ? localAppData
                : locator.base === "user-app-data"
                    ? userAppData
                    : userCache;
        return join(base, ...locator.path.split(/[\\/]/u));
    };
    return {
        state: resolveLocator(value.state, "state"),
        cache: resolveLocator(value.cache, "cache"),
        desktop: resolveLocator(value.desktop, "desktop"),
    };
}

/** 即使 Installed locator 损坏，也要先显示启动页而不是静默退出。 */
function startupFallbackConfig(): DesktopConfig {
    const portableRoot = resolve(process.resourcesPath, "..", "..");
    const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
    const localAppData = process.env.LOCALAPPDATA
        ?? (process.platform === "darwin"
            ? join(home, "Library", "Application Support")
            : join(home, "AppData", "Local"));
    return {
        imageRoot: join(portableRoot, ".output"),
        productExecutionImageRoot: null,
        applicationRoot: portableRoot,
        stateRoot: join(localAppData, "NeuroBook", "data"),
        cacheRoot: join(localAppData, "NeuroBook", "cache"),
        desktopRoot: join(localAppData, "NeuroBook", "desktop"),
        manager: join(portableRoot, "manager", "neuro-book.mjs"),
        managerBun: join(portableRoot, "runtime", process.platform === "win32" ? "bun.exe" : "bun"),
        privatePathEntries: [],
        port: 0,
        remoteUrl: null,
    };
}

function resolveManagerRuntime(root: string, desktopRoot: string): string {
    const manifestPath = join(desktopRoot, "desktop-installation.json");
    if (!existsSync(manifestPath)) return join(root, "runtime", "bun.exe");
    const manifest = parseDesktopInstallationManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
    const runtime = manifest.providers.managerRuntime;
    if (manifest.connection.mode === "local" && runtime.provider !== "managed") {
        throw new Error("Desktop Local 的 Manager Runtime 必须由安装包托管，请通过 Manager Repair 修复。");
    }
    return runtime.provider === "managed" ? join(root, ...runtime.path.split(/[\\/]/u)) : runtime.executable;
}

function readManagedToolPathEntries(root: string, desktopRoot: string): string[] {
    const manifestPath = join(desktopRoot, "desktop-installation.json");
    if (!existsSync(manifestPath)) return [];
    const manifest = parseDesktopInstallationManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
    const entries: string[] = [];
    for (const tool of [manifest.providers.tools.rg, manifest.providers.tools.git]) {
        if (tool.provider === "managed") entries.push(resolve(root, tool.path.split(/[\\/]/u).slice(0, -1).join("/")));
        if (tool.provider === "managed" && "bashPath" in tool && tool.bashPath) {
            entries.push(resolve(root, tool.bashPath.split(/[\\/]/u).slice(0, -1).join("/")));
        }
    }
    return [...new Set(entries)];
}

function samePath(left: string, right: string): boolean {
    const a = resolve(left);
    const b = resolve(right);
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function productEnvironment(config: DesktopConfig): NodeJS.ProcessEnv {
    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    const privatePath = config.privatePathEntries.length > 0
        ? [...config.privatePathEntries, currentPath].filter(Boolean).join(process.platform === "win32" ? ";" : ":")
        : currentPath;
    const environment: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: privatePath,
        Path: privatePath,
        NODE_PATH: undefined,
        AUTH_ADMIN_PASSWORD: undefined,
        NEURO_BOOK_CACHE_ROOT: config.cacheRoot,
        ...(config.productExecutionImageRoot
            ? {NEURO_BOOK_PRODUCT_EXECUTION_IMAGE_ROOT: config.productExecutionImageRoot}
            : {}),
    };
    for (const key of Object.keys(environment)) {
        if (key.startsWith("NBOOK_DESKTOP_DEV_")) delete environment[key];
    }
    return environment;
}

function safeLocatorPath(path: string): boolean {
    return path.length > 0
        && !path.startsWith("/")
        && !path.startsWith("\\")
        && !path.includes(":")
        && !path.includes("\0")
        && path.split(/[\\/]/u).every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** 读取安装清单的远端 origin；损坏清单直接阻止启动，绝不回退到本地 Product。 */
function readRemoteUrl(desktopRoot: string): string | null {
    try {
        const manifest = parseDesktopInstallationManifest(JSON.parse(readFileSync(join(desktopRoot, "desktop-installation.json"), "utf8")) as unknown);
        return manifest.connection.mode === "remote" ? manifest.connection.baseUrl : null;
    } catch (error) {
        if (error instanceof Error && error.message.includes("ENOENT")) return null;
        throw error;
    }
}

/** 远端 Desktop 只能在服务端明确声明 Bridge 兼容后打开。 */
async function probeRemote(url: string): Promise<DesktopStatus> {
    const origin = desktopRemoteOrigin(url, new URL(url).protocol === "http:");
    const response = await fetch(new URL("/api/app/desktop-capability", origin + "/"), {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("远端 Desktop capability 请求失败：HTTP " + response.status);
    const capability = parseDesktopCapability(await response.json());
    return {
        schema: "nbook.desktop-bridge/v2",
        envelope: "electron",
        connection: "remote",
        version: capability.productVersion,
        origin,
        insecureRemote: new URL(origin).protocol === "http:",
        platform: desktopPlatform(),
        menuPresentation: desktopMenuPresentation(),
        windowControls: desktopWindowControls(),
    };
}

/** 选择一个当前未监听的 IPv4 loopback 端口。 */
async function selectPort(requested: number): Promise<number> {
    if (requested !== 0) return requested;
    return await new Promise<number>((resolvePromise, rejectPromise) => {
        const probe = createServer();
        probe.once("error", rejectPromise);
        probe.listen({host: "127.0.0.1", port: 0}, () => {
            const address = probe.address();
            if (!address || typeof address === "string") {
                probe.close();
                rejectPromise(new Error("Electron Desktop 无法读取动态 loopback 端口。"));
                return;
            }
            const port = address.port;
            probe.close((error) => error ? rejectPromise(error) : resolvePromise(port));
        });
    });
}

/** 更新启动页阶段；正式 Product 页面加载后不再向渲染器发送启动事件。 */
function setStartupStage(stage: string): void {
    startupStage = stage;
    startupError = "";
    if (stage !== reportedStartupStage) {
        reportedStartupStage = stage;
        diagnostics.info({
            kind: "electron-startup-stage",
            stage,
            elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
        });
    }
    if (!window || window.isDestroyed() || !isStartupPage(window.webContents.getURL())) return;
    window.webContents.send("neurobook:startup-stage", stage);
}

/** 向本地启动页投影错误，不把错误信息写入 Product 或 Desktop Bridge。 */
function setStartupError(message: string): void {
    startupError = message;
    if (!window || window.isDestroyed() || !isStartupPage(window.webContents.getURL())) return;
    window.webContents.send("neurobook:startup-error", message);
}

/** 启动 Manager Supervisor；窗口启动页可见后等待 Manager 完成验证、迁移和 Product ready。 */
async function launchProduct(config: DesktopConfig): Promise<RunningProduct> {
    setStartupStage("检查 Product Runtime...");
    const resolvedConfig = {...config, port: await selectPort(config.port)};
    const executionImageRoot = await materializeMachineProductImage(
        resolvedConfig.imageRoot,
        resolvedConfig.cacheRoot,
    );
    const runtimeConfig = {
        ...resolvedConfig,
        productExecutionImageRoot: samePath(executionImageRoot, resolvedConfig.imageRoot) ? null : executionImageRoot,
    };
    const managerExecutable = await materializeMachineManagerScript(runtimeConfig.manager, runtimeConfig.cacheRoot);
    const audit = await auditProductContract(runtimeConfig.imageRoot);
    if (audit.unsafeEntries.length > 0) throw new Error(`Electron Desktop 拒绝不安全 Product Contract：${audit.unsafeEntries.join(",")}`);
    const startupNonce = randomBytes(32).toString("base64url");
    const requestId = randomBytes(16).toString("hex");
    const lease = spawnOwnedProcess({
        command: runtimeConfig.managerBun,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, managerExecutable, "--root", runtimeConfig.applicationRoot, "desktop", "supervise"],
        cwd: runtimeConfig.applicationRoot,
        env: productEnvironment(runtimeConfig),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    diagnostics.info({
        kind: "electron-manager-spawned",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    lease.stderr?.on("data", (chunk: Buffer) => diagnostics.error({
        kind: "electron-manager-stderr",
        message: chunk.toString().slice(0, 16 * 1024),
    }));
    const output = lease.stdout;
    if (!output || !lease.stdin) {
        await lease.terminate("startup-failure").catch(() => undefined);
        throw new Error("Electron Supervisor 缺少 NDJSON stdin/stdout pipe。 ");
    }
    const reader = createInterface({input: output, crlfDelay: Infinity});
    setStartupStage("启动本地服务...");
    const ready = waitForSupervisor(reader, lease.completion, requestId, startupNonce, (error) => {
        setStartupStage("Product 后台验证失败，正在关闭...");
        void lease.terminate("startup-failure").catch(() => undefined);
        diagnostics.error({
            kind: "electron-background-verification-failure",
            message: error.message,
            stack: error.stack,
        });
    });
    lease.stdin.write(desktopSupervisorLine({
        schema: "nbook.desktop-supervisor/v1",
        requestId,
        type: "start",
        startupNonce,
        port: resolvedConfig.port,
    }));
    try {
        const observed = await ready;
        const runtime = {...runtimeConfig, port: observed.port};
        const shutdown = async (): Promise<"graceful" | "forced"> => {
            if (lease.stdin?.writable) {
                lease.stdin.write(desktopSupervisorLine({schema: "nbook.desktop-supervisor/v1", requestId, type: "stop"}));
                lease.stdin.end();
            }
            const result = await Promise.race([
                lease.completion,
                new Promise<null>((resolvePromise) => setTimeout(() => resolvePromise(null), 30_000)),
            ]);
            if (result === null) {
                await lease.terminate("shutdown");
                return "forced";
            }
            return result.exitCode === 0 && result.signal === null ? "graceful" : "forced";
        };
        return {config: runtime, startupNonce, version: observed.version, lease, audit, shutdown};
    } catch (error) {
        reader.close();
        await lease.terminate("startup-failure").catch(() => undefined);
        throw error;
    }
}

async function waitForSupervisor(
    reader: ReturnType<typeof createInterface>,
    completion: Promise<OwnedProcessCompletion>,
    requestId: string,
    startupNonce: string,
    onBackgroundFailure: (error: Error) => void,
): Promise<{port: number; version: string}> {
    return await new Promise<{port: number; version: string}>((resolvePromise, rejectPromise) => {
        let readyPort: number | undefined;
        let readyVersion = "";
        let settled = false;
        let backgroundFailureReported = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error): void => {
            if (settled) return;
            if (error) {
                settled = true;
                if (timer) clearTimeout(timer);
                rejectPromise(error);
            } else if (readyPort !== undefined) {
                settled = true;
                if (timer) clearTimeout(timer);
                resolvePromise({port: readyPort, version: readyVersion});
            }
        };
        timer = setTimeout(() => finish(new Error("Manager Supervisor ready 超时。")), SUPERVISOR_START_TIMEOUT_MS);
        reader.on("line", (line) => {
            try {
                const event = parseDesktopSupervisorEvent(JSON.parse(line) as unknown);
                if (event.requestId !== requestId) return;
                if (event.type === "stage") {
                    const stageLabels = {
                        "full-verify": "完整验证 Product...",
                        migration: "执行数据迁移...",
                        "starting-product": "启动本地服务...",
                        "waiting-ready": "等待本地服务就绪...",
                        "stopping-product": "正在关闭本地服务...",
                        repairing: "正在修复 Product 回执...",
                    } as const;
                    setStartupStage(stageLabels[event.stage] ?? "正在处理桌面启动阶段...");
                    if (event.stage === "migration") {
                        diagnostics.info({
                            kind: "electron-migration-stage",
                            elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
                        });
                    } else if (event.stage === "starting-product") {
                        diagnostics.info({
                            kind: "electron-product-spawned",
                            elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
                        });
                    }
                } else if (event.type === "ready") {
                    setStartupStage("本地服务已就绪，正在打开 NeuroBook...");
                    diagnostics.info({
                        kind: "electron-product-ready",
                        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
                    });
                    if (event.startupNonce !== startupNonce) throw new Error("Supervisor ready nonce 与本次启动不一致。");
                    readyPort = Number(new URL(event.url).port);
                    readyVersion = event.version;
                } else if (event.type === "verified" && event.verification === "full") {
                    setStartupStage("Product 后台验证完成。");
                } else if (event.type === "failure") {
                    const error = new Error(`Manager Supervisor 失败：${event.code} ${event.message}`);
                    if (settled) {
                        if (!backgroundFailureReported) {
                            backgroundFailureReported = true;
                            onBackgroundFailure(error);
                        }
                        return;
                    }
                    throw error;
                }
                finish();
            } catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        });
        void completion.then((result) => {
            if (!settled) finish(new Error(`Manager Supervisor 在 ready 前退出：${JSON.stringify(result)}`));
        }, (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    });
}

/** 当前 Electron Envelope 自己携带的启动页；它不是 Product 页面，也不消费 Desktop Bridge。 */
function startupPagePath(): string {
    return resolve(import.meta.dirname, "startup.html");
}

function startupPageUrl(): string {
    return pathToFileURL(startupPagePath()).href;
}

function isStartupPage(url: string): boolean {
    return url === startupPageUrl();
}

/** 在启动失败时提供可重复的恢复入口，不把 Manager 修复逻辑复制到 Electron。 */
async function repairProduct(config: DesktopConfig): Promise<void> {
    setStartupStage("正在修复 Product 回执...");
    const requestId = randomBytes(16).toString("hex");
    const lease = spawnOwnedProcess({
        command: config.managerBun,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, config.manager, "--root", config.applicationRoot, "desktop", "supervise"],
        cwd: config.applicationRoot,
        env: productEnvironment(config),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    if (!lease.stdout || !lease.stdin) {
        await lease.terminate("startup-failure").catch(() => undefined);
        throw new Error("Manager 修复通道不可用。" );
    }
    const reader = createInterface({input: lease.stdout, crlfDelay: Infinity});
    const result = new Promise<void>((resolvePromise, rejectPromise) => {
        reader.on("line", (line) => {
            try {
                const event = parseDesktopSupervisorEvent(JSON.parse(line) as unknown);
                if (event.requestId !== requestId) return;
                if (event.type === "verified" && event.verification === "full") resolvePromise();
                else if (event.type === "failure") rejectPromise(new Error(`Manager 修复失败：${event.code} ${event.message}`));
            } catch (error) {
                rejectPromise(error instanceof Error ? error : new Error(String(error)));
            }
        });
        void lease.completion.then((completion) => {
            rejectPromise(new Error(`Manager 修复进程提前退出：${JSON.stringify(completion)}`));
        }, rejectPromise);
    });
    lease.stdin.write(desktopSupervisorLine({schema: "nbook.desktop-supervisor/v1", requestId, type: "repair"}));
    try {
        await result;
    } finally {
        reader.close();
        if (lease.stdin.writable) lease.stdin.end();
        const completed = await Promise.race([
            lease.completion.then(() => true, () => true),
            new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 5_000)),
        ]);
        if (!completed) await lease.terminate("shutdown").catch(() => undefined);
    }
}

/**
 * Installed Desktop 的修复可能需要 UAC；由正式 Manager GUI 承接交互和提升，
 * Electron 启动页只负责打开入口并继续等待用户重试。
 */
async function openManagerGui(config: DesktopConfig): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, ["--manager-gui"], {
            cwd: config.applicationRoot,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
        });
        child.once("error", rejectPromise);
        child.once("spawn", () => {
            child.unref();
            diagnostics.info({kind: "electron-manager-gui-opened"});
            resolvePromise();
        });
    });
}

/** 启动失败后让用户选择恢复动作；Installed 交给 Manager GUI，Portable 复用 Supervisor。 */
async function recoverStartup(config: DesktopConfig, error: unknown): Promise<boolean> {
    let failure = error;
    while (true) {
        const message = failure instanceof Error ? failure.message : String(failure);
        setStartupError(message);
        const action = await waitForStartupAction();
        if (action === "quit") return false;
        if (action === "open-logs") {
            await shell.openPath(join(config.stateRoot, "logs")).catch(() => undefined);
            continue;
        }
        if (action === "repair") {
            try {
                if (isCanonicalInstalledRoot(config.applicationRoot)) {
                    await openManagerGui(config);
                    failure = new Error("NeuroBook Manager 已打开；完成修复后请点击重试。");
                    continue;
                }
                await repairProduct(config);
            } catch (repairError) {
                failure = repairError;
                continue;
            }
        }
        startupError = "";
        setStartupStage("重新启动本地服务...");
        return true;
    }
}

/** 只接受启动页自身发出的固定动作，不让 Product 页面获得恢复能力。 */
function waitForStartupAction(): Promise<StartupAction> {
    if (!window || window.isDestroyed() || !isStartupPage(window.webContents.getURL())) {
        return Promise.resolve("quit");
    }
    return new Promise<StartupAction>((resolvePromise) => {
        startupActionResolver = resolvePromise;
    });
}

/**
 * 配置/locator 错误会在 main() 中阻塞等待恢复动作，因此必须在进入恢复循环前
 * 注册 handler；放到正常 Desktop Bridge 初始化之后会让启动页四个按钮永久失效。
 */
function installStartupActionHandler(): void {
    ipcMain.on("neurobook:desktop:startup-action", (event, action: string) => {
        assertStartupFrame(event);
        if (action !== "retry" && action !== "repair" && action !== "open-logs" && action !== "quit") {
            throw new Error("启动恢复动作不受支持。");
        }
        startupActionResolver?.(action);
        startupActionResolver = null;
    });
}

/** 将原生菜单和自绘标题栏统一投影到 Desktop Menu Contract。 */
function runElectronMenuCommand(command: DesktopMenuCommandId): void {
    switch (command) {
        case "file.quit":
            void closeApplication();
            return;
        case "edit.undo":
            window?.webContents.undo();
            return;
        case "edit.redo":
            window?.webContents.redo();
            return;
        case "edit.cut":
            window?.webContents.cut();
            return;
        case "edit.copy":
            window?.webContents.copy();
            return;
        case "edit.paste":
            window?.webContents.paste();
            return;
        case "edit.select-all":
            window?.webContents.selectAll();
            return;
        case "view.reload":
            void window?.webContents.reload();
            return;
        case "view.zoom-in":
            updateElectronZoom("in");
            return;
        case "view.zoom-out":
            updateElectronZoom("out");
            return;
        case "view.zoom-reset":
            updateElectronZoom("reset");
            return;
        case "file.open":
        case "file.settings":
        case "help.documentation":
        case "help.about":
            window?.webContents.send("neurobook:menu", command);
            return;
    }
}

/** 修改并持久化 Electron 的页面缩放。 */
function updateElectronZoom(target: "in" | "out" | "reset"): void {
    const zoomFactor = target === "reset"
        ? 1
        : Math.min(2, Math.max(0.75, desktopSettings.zoomFactor + (target === "in" ? 0.05 : -0.05)));
    desktopSettings = patchDesktopSettings(desktopSettings, {zoomFactor});
    applyDesktopSettings();
    void saveDesktopSettings(readConfig().desktopRoot);
}

function installMenu(): void {
    const command = (id: DesktopMenuCommandId): (() => void) => () => runElectronMenuCommand(id);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: "File", submenu: [
            {label: "Open", click: command("file.open")},
            {label: "Settings", click: command("file.settings")},
            {label: "Quit", click: command("file.quit")},
        ]},
        {label: "Edit", submenu: [
            {label: "Undo", click: command("edit.undo")},
            {label: "Redo", click: command("edit.redo")},
            {type: "separator"},
            {label: "Cut", click: command("edit.cut")},
            {label: "Copy", click: command("edit.copy")},
            {label: "Paste", click: command("edit.paste")},
            {label: "Select All", click: command("edit.select-all")},
        ]},
        {label: "View", submenu: [
            {label: "Reload", click: command("view.reload")},
            {label: "Zoom In", click: command("view.zoom-in")},
            {label: "Zoom Out", click: command("view.zoom-out")},
            {label: "Reset Zoom", click: command("view.zoom-reset")},
        ]},
        {label: "Help", submenu: [
            {label: "Documentation", click: command("help.documentation")},
            {label: "About NeuroBook", click: command("help.about")},
        ]},
    ]));
}

function installTray(): void {
    if (tray) return;
    const packagedIconPath = resolve(process.resourcesPath, "icon.ico");
    const iconPath = existsSync(packagedIconPath) ? packagedIconPath : resolve(import.meta.dirname, "icon.ico");
    const icon = nativeImage.createFromPath(iconPath);
    const iconEmpty = icon.isEmpty();
    tray = new Tray(iconEmpty ? nativeImage.createEmpty() : icon);
    tray.setToolTip("NeuroBook");
    tray.setContextMenu(Menu.buildFromTemplate([
        {label: "显示 NeuroBook", click: () => { window?.show(); }},
        {label: "设置", click: () => { window?.show(); window?.webContents.send("neurobook:menu", "file.settings"); }},
        {type: "separator"},
        {label: "退出", click: () => void closeApplication()},
    ]));
    tray.on("click", () => {
        if (window?.isMinimized()) window.restore();
        window?.show();
        window?.focus();
    });
    diagnostics.info({kind: "electron-tray-installed", iconPath, iconEmpty});
}

function installNavigationGuards(): void {
    window?.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window?.webContents.on("will-navigate", (event, targetUrl) => {
        if (isStartupPage(targetUrl)) return;
        const expected = running ? `http://127.0.0.1:${String(running.config.port)}` : remoteStatus?.origin;
        if (!expected || new URL(targetUrl).origin !== expected) event.preventDefault();
    });
}

async function loadWindowUrl(targetUrl: string): Promise<void> {
    if (!window) throw new Error("Electron 主窗口尚未创建。");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            window.loadURL(targetUrl),
            new Promise<never>((_, rejectPromise) => {
                timeout = setTimeout(() => rejectPromise(new Error(`Desktop 页面加载超时：${targetUrl}`)), WINDOW_LOAD_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function closeApplication(
    finalEvent?: (shutdown: "graceful" | "forced" | null) => Record<string, unknown>,
): Promise<void> {
    if (closing) return await closing;
    closing = (async () => {
        await flushWindowState();
        let shutdown: "graceful" | "forced" | null = null;
        if (running) {
            shutdown = await running.shutdown();
            diagnostics.info({kind: "electron-shutdown", result: shutdown});
            running = null;
        }
        if (finalEvent) diagnostics.info(finalEvent(shutdown));
        allowWindowClose = true;
        tray?.destroy();
        tray = null;
        await diagnostics.flush();
        app.quit();
    })();
    return await closing;
}

/** 读取并钳制窗口状态；显示器变化时至少保留一段可见标题栏。 */
async function loadWindowState(root: string): Promise<WindowState> {
    try {
        const value = JSON.parse(await readFileAsync(join(root, "window-state.json"), "utf8")) as Partial<WindowState>;
        if (!["x", "y", "width", "height"].every((key) => Number.isInteger(value[key as keyof WindowState]))) throw new Error("窗口坐标不是整数。");
        const widthValue = value.width;
        const heightValue = value.height;
        const storedWidth = typeof widthValue === "number" ? widthValue : Number.NaN;
        const storedHeight = typeof heightValue === "number" ? heightValue : Number.NaN;
        if (!Number.isInteger(storedWidth) || !Number.isInteger(storedHeight) || storedWidth < 640 || storedHeight < 480) throw new Error("窗口尺寸不受支持。");
        const displays = screen.getAllDisplays();
        const display = displays.find((item) => item.bounds.x <= value.x! && value.x! < item.bounds.x + item.bounds.width)
            ?? screen.getPrimaryDisplay();
        const area = display.workArea;
        const width = Math.min(storedWidth, Math.max(640, area.width));
        const height = Math.min(storedHeight, Math.max(480, area.height));
        const x = Math.max(area.x - width + 80, Math.min(value.x!, area.x + area.width - 80));
        const y = Math.max(area.y - 36, Math.min(value.y!, area.y + area.height - 80));
        return {x, y, width, height, maximized: value.maximized === true, fullscreen: value.fullscreen === true};
    } catch {
        return DEFAULT_WINDOW_STATE;
    }
}

/** 保存窗口位置、最大化和全屏状态，写入 Desktop Local Root 而不是 Product/State。 */
function queueWindowStateSave(root: string): void {
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized(),
        fullscreen: window.isFullScreen(),
    };
    windowStateWrite = windowStateWrite.then(async () => {
        await mkdirAsync(root, {recursive: true});
        await writeFileAsync(join(root, "window-state.json"), `${JSON.stringify(state, null, 4)}\n`, "utf8");
    }).catch(() => undefined);
}

async function flushWindowState(): Promise<void> {
    await windowStateWrite;
}

async function createInteractiveWindow(config: DesktopConfig): Promise<void> {
    const savedWindowState = await loadWindowState(config.desktopRoot);
    window = new BrowserWindow({
        x: savedWindowState.x,
        y: savedWindowState.y,
        width: savedWindowState.width,
        height: savedWindowState.height,
        show: false,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
        ...(process.platform === "win32" ? {titleBarOverlay: {color: "#f4ecd8", symbolColor: "#5b4e3d", height: 36}} : {}),
        webPreferences: {preload: resolve(import.meta.dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true},
    });
    installNavigationGuards();
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
        diagnostics.error({kind: "electron-preload-error", preloadPath, message: error.message});
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame) diagnostics.error({kind: "electron-load-error", errorCode, errorDescription, validatedURL});
    });
    window.webContents.on("render-process-gone", (_event, details) => {
        diagnostics.error({kind: "electron-render-process-gone", reason: details.reason, exitCode: details.exitCode});
    });
    window.webContents.on("unresponsive", () => {
        diagnostics.error({kind: "electron-render-unresponsive"});
    });
    window.on("close", (event) => {
        queueWindowStateSave(config.desktopRoot);
        if (allowWindowClose) return;
        if (desktopSettings.closeBehavior === "quit") {
            event.preventDefault();
            void closeApplication();
            return;
        }
        if (desktopSettings.closeBehavior === "tray") {
            event.preventDefault();
            if (desktopSettings.trayEnabled) window?.hide();
            else void closeApplication();
            return;
        }
        if (desktopSettings.closeBehavior === "ask" && desktopSettings.trayEnabled) {
            event.preventDefault();
            void confirmCloseToTray();
            return;
        }
        event.preventDefault();
        void closeApplication();
    });
    const saveWindowState = () => queueWindowStateSave(config.desktopRoot);
    window.on("move", saveWindowState);
    window.on("resize", saveWindowState);
    window.on("maximize", () => {
        diagnostics.info({kind: "electron-window-state", state: "maximized"});
        saveWindowState();
    });
    window.on("unmaximize", () => {
        diagnostics.info({kind: "electron-window-state", state: "restored"});
        saveWindowState();
    });
    window.on("enter-full-screen", saveWindowState);
    window.on("leave-full-screen", saveWindowState);
    window.on("closed", () => { queueWindowStateSave(config.desktopRoot); window = null; void closeApplication(); });
    if (savedWindowState.maximized) window.maximize();
    if (savedWindowState.fullscreen) window.setFullScreen(true);

    await window.loadFile(startupPagePath());
    applyDesktopSettings();
    window.show();
    window.focus();
    window.moveTop();
    diagnostics.info({
        kind: "electron-startup-page-visible",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    window.webContents.send("neurobook:startup-stage", startupStage);
    if (startupError) window.webContents.send("neurobook:startup-error", startupError);
}

async function main(): Promise<void> {
    const headless = process.argv.includes("--desktop-headless") || process.argv.includes("--headless");
    let config: DesktopConfig;
    let configError: Error | null = null;
    try {
        config = readConfig();
    } catch (error) {
        if (headless) throw error;
        config = startupFallbackConfig();
        configError = error instanceof Error ? error : new Error(String(error));
    }
    diagnostics.setLogRoot(join(config.stateRoot, "logs"));
    // Session/profile 属于当前安装；单实例身份必须使用稳定的用户级根，不能随 Portable 变化。
    app.setPath("userData", desktopIdentityRoot());
    app.setPath("sessionData", join(config.desktopRoot, "webview"));
    app.setPath("logs", join(config.stateRoot, "logs"));
    const launchData = {argv: process.argv.slice(1).slice(0, 32), cwd: process.cwd()};
    if (!app.requestSingleInstanceLock(launchData)) { app.quit(); return; }
    app.on("second-instance", (_event, commandLine, workingDirectory) => {
        if (window?.isMinimized()) window.restore();
        window?.show();
        window?.focus();
        const args = commandLine.slice(1, 33).map((value) => value.slice(0, 4096));
        window?.webContents.send("neurobook:second-instance", {args, cwd: workingDirectory.slice(0, 4096)});
    });
    await app.whenReady();
    installStartupActionHandler();
    diagnostics.info({
        kind: "electron-app-ready",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    await loadDesktopSettings(config.desktopRoot);
    diagnostics.info({
        kind: "electron-settings-loaded",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    if (!headless) await createInteractiveWindow(config);
    while (configError) {
        if (!await recoverStartup(config, configError)) {
            await closeApplication({kind: "electron-startup-failure", reason: configError.message});
            return;
        }
        try {
            config = readConfig();
            configError = null;
        } catch (error) {
            configError = error instanceof Error ? error : new Error(String(error));
        }
    }
    ipcMain.handle("neurobook:desktop:status", (event) => {
        assertTrustedFrame(event);
        return running ? {
            schema: "nbook.desktop-bridge/v2",
            envelope: "electron",
            connection: "local",
            version: running.version,
            origin: `http://127.0.0.1:${String(running.config.port)}`,
            insecureRemote: false,
            platform: desktopPlatform(),
            menuPresentation: desktopMenuPresentation(),
            windowControls: desktopWindowControls(),
        } : remoteStatus;
    });
    ipcMain.handle("neurobook:desktop:appearance", (event, appearance: unknown) => {
        assertTrustedFrame(event);
        if (appearance !== "light" && appearance !== "dark") throw new Error("Desktop appearance 不受支持。");
        applyTitleBarAppearance(appearance);
    });
    ipcMain.handle("neurobook:desktop:settings", (event) => { assertTrustedFrame(event); return desktopSettings; });
    ipcMain.handle("neurobook:desktop:settings:update", async (event, patch: unknown) => {
        assertTrustedFrame(event);
        desktopSettings = patchDesktopSettings(desktopSettings, patch as never);
        await saveDesktopSettings(config.desktopRoot);
        applyDesktopSettings();
        return desktopSettings;
    });
    ipcMain.on("neurobook:desktop:window", (event, command: string) => {
        assertTrustedFrame(event);
        if (command === "show") window?.show();
        else if (command === "hide") window?.hide();
        else if (command === "minimize") window?.minimize();
        else if (command === "toggle-maximize") {
            if (window?.isMaximized()) window.unmaximize();
            else window?.maximize();
        }
        else if (command === "close") window?.close();
        else if (command === "quit") void closeApplication();
    });
    ipcMain.on("neurobook:desktop:menu", (event, command: string) => {
        assertTrustedFrame(event);
        if (!DESKTOP_MENU_COMMAND_IDS.includes(command as DesktopMenuCommandId)) throw new Error("Desktop Menu command 不受支持。");
        runElectronMenuCommand(command as DesktopMenuCommandId);
    });
    installMenu();
    const localLaunch = config.remoteUrl
        ? null
        : (async (): Promise<void> => {
            while (!running) {
                try {
                    running = await launchProduct(config);
                } catch (error) {
                    if (headless || !await recoverStartup(config, error)) throw error;
                }
            }
        })();
    if (config.remoteUrl) {
        setStartupStage("检查远端 Desktop capability...");
        remoteStatus = await probeRemote(config.remoteUrl);
    } else if (localLaunch) await localLaunch;
    if (headless) {
        const forceShutdown = process.argv.includes("--desktop-force");
        diagnostics.info(config.remoteUrl
            ? {kind: "electron-remote-ready", origin: remoteStatus?.origin, version: remoteStatus?.version, elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100}
            : {kind: "electron-headless-ready", port: running?.config.port, contract: running?.audit.schema, elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100});
        const holdMs = process.argv.includes("--headless") ? Number(process.env.NBOOK_DESKTOP_DEV_HOLD_MS ?? "0") : 0;
        if (Number.isInteger(holdMs) && holdMs > 0) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, holdMs));
        if (forceShutdown && running) {
            await running.lease.terminate("shutdown");
            running = null;
            allowWindowClose = true;
            tray?.destroy();
            tray = null;
            diagnostics.info({kind: "electron-headless-shutdown", shutdown: "forced"});
            await diagnostics.flush();
            app.quit();
            return;
        }
        await closeApplication((shutdown) => ({
            kind: "electron-headless-shutdown",
            shutdown: shutdown ?? "graceful",
        }));
        return;
    }
    if (!window) throw new Error("Electron 主窗口未创建。");
    diagnostics.info({
        kind: "electron-renderer-load-start",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    await loadWindowUrl(config.remoteUrl ?? `http://127.0.0.1:${String(running?.config.port)}/`);
    const bridgeReady = await window.webContents.executeJavaScript("Boolean(window.neuroBookDesktop)", true);
    if (!bridgeReady) throw new Error("Electron Desktop Bridge 未注入，无法安全启动桌面页面。");
    diagnostics.info({
        kind: "electron-bridge-ready",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
    applyDesktopSettings();
    window.focus();
    window.moveTop();
    diagnostics.info({
        kind: "electron-window-ready",
        elapsedMs: Math.round((performance.now() - startupStartedAt) * 100) / 100,
    });
}

/** 首次关闭询问用户；选择可保存到 Desktop Local Root。 */
async function confirmCloseToTray(): Promise<void> {
    if (!window || closing) return;
    const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "NeuroBook",
        message: "关闭窗口时要怎么处理？",
        detail: "隐藏到系统托盘后，NeuroBook 会继续运行。",
        buttons: ["隐藏到托盘", "退出应用"],
        cancelId: 0,
        defaultId: 0,
        checkboxLabel: "记住这个选择",
    });
    if (result.checkboxChecked) {
        desktopSettings = patchDesktopSettings(desktopSettings, {closeBehavior: result.response === 0 ? "tray" : "quit"});
        await saveDesktopSettings(readConfig().desktopRoot);
    }
    if (result.response === 0) window.hide();
    else await closeApplication();
}

function assertTrustedFrame(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
    const frameUrl = event.senderFrame?.url;
    const expected = running ? `http://127.0.0.1:${String(running.config.port)}` : remoteStatus?.origin ?? null;
    if (!expected || !frameUrl || new URL(frameUrl).origin !== expected) throw new Error("Desktop Bridge 拒绝非当前 Product origin 的请求。");
}

function assertStartupFrame(event: Electron.IpcMainEvent): void {
    if (!event.senderFrame || !isStartupPage(event.senderFrame.url)) {
        throw new Error("启动恢复动作只允许由本地启动页发起。");
    }
}

async function loadDesktopSettings(root: string): Promise<void> {
    const {readFile, mkdir} = await import("node:fs/promises");
    await mkdir(root, {recursive: true});
    try {
        desktopSettings = parseDesktopSettings(JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as unknown);
    } catch {
        desktopSettings = DEFAULT_DESKTOP_SETTINGS;
    }
}

async function saveDesktopSettings(root: string): Promise<void> {
    const {writeFile, mkdir} = await import("node:fs/promises");
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "settings.json"), `${JSON.stringify(desktopSettings, null, 4)}\n`, "utf8");
}

function applyDesktopSettings(): void {
    if (window) window.webContents.setZoomFactor(desktopSettings.zoomFactor);
    if (desktopSettings.trayEnabled) installTray();
    else if (tray) {
        tray.destroy();
        tray = null;
        diagnostics.info({kind: "electron-tray-disabled"});
    }
}

app.on("before-quit", (event) => {
    if (managerEntry) return;
    if (closing || allowWindowClose) return;
    event.preventDefault();
    void closeApplication();
});

async function dispatchEntry(): Promise<void> {
    if (process.argv.includes("--manager-gui")) {
        const managerEntry = resolve(import.meta.dirname, "manager-main.mjs");
        const module = await import(pathToFileURL(managerEntry).href) as {runManagerGui: () => Promise<void>};
        await module.runManagerGui();
        return;
    }
    await main();
}

void dispatchEntry().catch(async (error: unknown) => {
    diagnostics.error({
        kind: "electron-fatal",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? {stack: error.stack} : {}),
    });
    startupActionResolver = null;
    process.exitCode = 1;
    await diagnostics.flush();
    app.quit();
});
