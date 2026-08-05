import {randomBytes} from "node:crypto";
import {createInterface} from "node:readline";
import {createServer} from "node:net";
import {app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog} from "electron";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {
    spawnOwnedProcess,
    type OwnedProcessCompletion,
    type OwnedProcessLease,
} from "@notnotype/owned-process";
import {PRODUCT_BUN_RUNTIME_ARGS} from "nbook/shared/product-runtime-contract";
import {
    desktopSupervisorLine,
    parseDesktopCapability,
    parseDesktopInstallationManifest,
    parseDesktopSupervisorEvent,
    parseDesktopSettings,
    patchDesktopSettings,
    DEFAULT_DESKTOP_SETTINGS,
    type DesktopSettings,
    type DesktopStatus,
    type DesktopSupervisorEvent,
} from "nbook/shared/desktop-contract";
import {auditProductContract, type ContractAudit} from "../../shared/src/contract-audit";

type DesktopConfig = {
    imageRoot: string;
    applicationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    manager: string;
    bun: string;
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

let window: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let running: RunningProduct | null = null;
let remoteStatus: DesktopStatus | null = null;
let closing: Promise<void> | null = null;
let allowWindowClose = false;
let desktopSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;

/** 从显式环境或 Portable 根读取 Manager/Product 配置。 */
function readConfig(): DesktopConfig {
    const required = (key: string): string => {
        const value = process.env[key]?.trim();
        if (!value) throw new Error(`Electron spike 缺少环境变量：${key}`);
        return value;
    };
    const explicitKeys = [
        "T140_PRODUCT_IMAGE_ROOT", "T140_APPLICATION_ROOT", "T140_STATE_ROOT", "T140_CACHE_ROOT", "T140_DESKTOP_ROOT",
        "T140_MANAGER", "T140_BUN_EXECUTABLE", "T140_PORT",
    ];
    if (explicitKeys.some((key) => Boolean(process.env[key]?.trim()))) {
        const port = Number(process.env.T140_PORT ?? "0");
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Electron spike 的 T140_PORT 必须是 0-65535 的整数。");
        return {
            imageRoot: resolve(required("T140_PRODUCT_IMAGE_ROOT")),
            applicationRoot: resolve(required("T140_APPLICATION_ROOT")),
            stateRoot: resolve(required("T140_STATE_ROOT")),
            cacheRoot: resolve(required("T140_CACHE_ROOT")),
            desktopRoot: resolve(required("T140_DESKTOP_ROOT")),
            manager: resolve(required("T140_MANAGER")),
            bun: required("T140_BUN_EXECUTABLE"),
            port,
            remoteUrl: process.env.T140_REMOTE_URL?.trim() || null,
        };
    }
    const portableRoot = resolve(process.resourcesPath, "..", "..");
    const runtimeRoots = readRuntimeRoots(portableRoot);
    return {
        imageRoot: join(portableRoot, ".output"),
        applicationRoot: portableRoot,
        stateRoot: runtimeRoots.state,
        cacheRoot: runtimeRoots.cache,
        desktopRoot: runtimeRoots.desktop,
        manager: join(portableRoot, "manager", "neuro-book.mjs"),
        bun: join(portableRoot, "runtime", "bun.exe"),
        port: 0,
        remoteUrl: readRemoteUrl(runtimeRoots.desktop),
    };
}

/** 读取 Manager 写入的相对 locator；没有安装 locator 时保持 Portable 布局。 */
function readRuntimeRoots(root: string): {state: string; cache: string; desktop: string} {
    try {
        const value = JSON.parse(readFileSync(join(root, "desktop", "runtime-locators.json"), "utf8")) as {
            state?: {base?: string; path?: string};
            cache?: {base?: string; path?: string};
            desktop?: {base?: string; path?: string};
        };
        const home = process.env.USERPROFILE ?? process.env.HOME;
        const localAppData = resolve(process.env.LOCALAPPDATA ?? (home ? join(home, "AppData", "Local") : join(root, "data", ".desktop")));
        const userAppData = process.platform === "darwin"
            ? resolve(process.env.HOME ?? home ?? root, "Library", "Application Support")
            : localAppData;
        const userCache = process.platform === "darwin"
            ? resolve(process.env.HOME ?? home ?? root, "Library", "Caches")
            : resolve(process.env.XDG_CACHE_HOME ?? localAppData);
        const resolveLocator = (locator: {base?: string; path?: string} | undefined, fallback: string): string => {
            if (!locator?.path || !["installation-root", "local-app-data", "user-app-data", "user-cache"].includes(locator.base ?? "")) return fallback;
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
            state: resolveLocator(value.state, join(root, "data")),
            cache: resolveLocator(value.cache, join(root, ".cache")),
            desktop: resolveLocator(value.desktop, join(root, "data", ".desktop")),
        };
    } catch {
        return {state: join(root, "data"), cache: join(root, ".cache"), desktop: join(root, "data", ".desktop")};
    }
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
    const origin = new URL(url).origin;
    const response = await fetch(new URL("/api/app/desktop-capability", origin + "/"));
    if (!response.ok) throw new Error("远端 Desktop capability 请求失败：HTTP " + response.status);
    const capability = parseDesktopCapability(await response.json());
    return {
        schema: "nbook.desktop-bridge/v1",
        envelope: "electron",
        connection: "remote",
        version: capability.productVersion,
        origin,
        insecureRemote: new URL(origin).protocol === "http:",
        nativeWindowControls: true,
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
                rejectPromise(new Error("Electron spike 无法读取动态 loopback 端口。"));
                return;
            }
            const port = address.port;
            probe.close((error) => error ? rejectPromise(error) : resolvePromise(port));
        });
    });
}

/** 启动 Manager Supervisor，并等待同一 requestId 的 ready 与 full verified 事件。 */
async function launchProduct(config: DesktopConfig): Promise<RunningProduct> {
    const resolvedConfig = {...config, port: await selectPort(config.port)};
    const audit = await auditProductContract(resolvedConfig.imageRoot);
    if (audit.unsafeEntries.length > 0) throw new Error(`Electron spike 拒绝不安全 Product Contract：${audit.unsafeEntries.join(",")}`);
    const startupNonce = randomBytes(32).toString("base64url");
    const requestId = randomBytes(16).toString("hex");
    const lease = spawnOwnedProcess({
        command: resolvedConfig.bun,
        args: [...PRODUCT_BUN_RUNTIME_ARGS, resolvedConfig.manager, "--root", resolvedConfig.applicationRoot, "desktop", "supervise"],
        cwd: resolvedConfig.applicationRoot,
        env: {...process.env, T140_BUN_EXECUTABLE: resolvedConfig.bun},
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        windowsHide: true,
        graceMs: 1_000,
        hardKillWaitMs: 5_000,
    });
    lease.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[manager] ${chunk.toString()}`));
    const output = lease.stdout;
    if (!output || !lease.stdin) {
        await lease.terminate("startup-failure").catch(() => undefined);
        throw new Error("Electron Supervisor 缺少 NDJSON stdin/stdout pipe。 ");
    }
    const reader = createInterface({input: output, crlfDelay: Infinity});
    const ready = waitForSupervisor(reader, lease.completion, requestId, startupNonce);
    lease.stdin.write(desktopSupervisorLine({
        schema: "nbook.desktop-supervisor/v1",
        requestId,
        type: "start",
        startupNonce,
        port: resolvedConfig.port,
    }));
    try {
        const observed = await ready;
        const runtime = {...resolvedConfig, port: observed.port};
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
): Promise<{port: number; version: string}> {
    return await new Promise<{port: number; version: string}>((resolvePromise, rejectPromise) => {
        let readyPort: number | undefined;
        let readyVersion = "";
        let verified = false;
        let settled = false;
        const finish = (error?: Error): void => {
            if (settled) return;
            if (error) {
                settled = true;
                rejectPromise(error);
            } else if (readyPort !== undefined && verified) {
                settled = true;
                resolvePromise({port: readyPort, version: readyVersion});
            }
        };
        reader.on("line", (line) => {
            try {
                const event = parseDesktopSupervisorEvent(JSON.parse(line) as unknown);
                if (event.requestId !== requestId) return;
                if (event.type === "ready") {
                    if (event.startupNonce !== startupNonce) throw new Error("Supervisor ready nonce 与本次启动不一致。");
                    readyPort = Number(new URL(event.url).port);
                    readyVersion = event.version;
                } else if (event.type === "verified" && event.verification === "full") {
                    verified = true;
                } else if (event.type === "failure") {
                    throw new Error(`Manager Supervisor 失败：${event.code} ${event.message}`);
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

function createSplash(): BrowserWindow {
    const value = new BrowserWindow({width: 440, height: 260, frame: false, resizable: false, show: true, alwaysOnTop: true, webPreferences: {sandbox: true}});
    void value.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent("<body style='margin:0;background:#15171a;color:#eef2f4;font:16px sans-serif;display:grid;place-items:center'><main><strong>NeuroBook</strong><p>正在启动本地服务...</p></main></body>")}`);
    return value;
}

function installMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: "File", submenu: [{label: "Settings", click: () => window?.webContents.send("neurobook:menu", "file.settings")}, {label: "Quit", click: () => void closeApplication()}]},
        {label: "View", submenu: [{role: "reload"}, {role: "resetZoom"}, {role: "zoomIn"}, {role: "zoomOut"}]},
        {label: "Help", submenu: [{label: "About NeuroBook", click: () => window?.webContents.send("neurobook:menu", "help.about")} ]},
    ]));
}

function installTray(): void {
    if (tray) return;
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("NeuroBook");
    tray.setContextMenu(Menu.buildFromTemplate([
        {label: "显示 NeuroBook", click: () => { window?.show(); }},
        {label: "设置", click: () => { window?.show(); window?.webContents.send("neurobook:menu", "file.settings"); }},
        {type: "separator"},
        {label: "退出", click: () => void closeApplication()},
    ]));
    tray.on("click", () => window?.show());
}

function installNavigationGuards(): void {
    window?.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window?.webContents.on("will-navigate", (event, targetUrl) => {
        const expected = running ? `http://127.0.0.1:${String(running.config.port)}` : remoteStatus?.origin;
        if (!expected || new URL(targetUrl).origin !== expected) event.preventDefault();
    });
}

async function closeApplication(): Promise<void> {
    if (closing) return await closing;
    closing = (async () => {
        if (running) {
            const result = await running.shutdown();
            console.log(JSON.stringify({kind: "electron-shutdown", result}));
            running = null;
        }
        allowWindowClose = true;
        tray?.destroy();
        tray = null;
        app.quit();
    })();
    return await closing;
}

async function main(): Promise<void> {
    const config = readConfig();
    // These paths must be fixed before the single-instance lock and before Electron creates a session.
    app.setPath("userData", config.desktopRoot);
    app.setPath("sessionData", join(config.desktopRoot, "webview"));
    app.setPath("logs", join(config.desktopRoot, "logs"));
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    app.on("second-instance", () => window?.show());
    await app.whenReady();
    await loadDesktopSettings(config.desktopRoot);
    ipcMain.handle("t140:status", (event) => {
        assertTrustedFrame(event);
        return running ? {
            schema: "nbook.desktop-bridge/v1",
            envelope: "electron",
            connection: "local",
            version: running.version,
            origin: `http://127.0.0.1:${String(running.config.port)}`,
            insecureRemote: false,
            nativeWindowControls: true,
        } : remoteStatus;
    });
    ipcMain.handle("t140:settings", (event) => { assertTrustedFrame(event); return desktopSettings; });
    ipcMain.handle("t140:settings:update", async (event, patch: unknown) => {
        assertTrustedFrame(event);
        desktopSettings = patchDesktopSettings(desktopSettings, patch as never);
        await saveDesktopSettings(config.desktopRoot);
        applyDesktopSettings();
        return desktopSettings;
    });
    ipcMain.on("t140:window", (event, command: string) => {
        assertTrustedFrame(event);
        if (command === "show") window?.show();
        else if (command === "hide") window?.hide();
        else if (command === "quit") void closeApplication();
    });
    ipcMain.on("t140:menu", (event, command: string) => {
        assertTrustedFrame(event);
        if (command === "file.settings") window?.webContents.send("neurobook:menu", command);
        else if (command === "file.quit") void closeApplication();
        else if (command === "view.reload") void window?.webContents.reload();
    });
    installMenu();
    const headless = process.argv.includes("--t140-headless") || process.argv.includes("--headless");
    if (config.remoteUrl) remoteStatus = await probeRemote(config.remoteUrl);
    if (!headless) splash = createSplash();
    if (!config.remoteUrl) running = await launchProduct(config);
    if (headless) {
        console.log(JSON.stringify(config.remoteUrl
            ? {kind: "electron-remote-ready", origin: remoteStatus?.origin, version: remoteStatus?.version}
            : {kind: "electron-headless-ready", port: running?.config.port, contract: running?.audit.schema}));
        const holdMs = Number(process.env.T140_HOLD_MS ?? "0");
        if (Number.isInteger(holdMs) && holdMs > 0) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, holdMs));
        await closeApplication();
        return;
    }
    window = new BrowserWindow({
        width: 1280,
        height: 840,
        show: false,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
        ...(process.platform === "win32" ? {titleBarOverlay: {color: "#15171a", symbolColor: "#eef2f4", height: 36}} : {}),
        webPreferences: {preload: resolve(import.meta.dirname, "preload.mjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true},
    });
    installNavigationGuards();
    await window.loadURL(config.remoteUrl ?? `http://127.0.0.1:${String(running?.config.port)}/`);
    splash?.close();
    splash = null;
    applyDesktopSettings();
    window.show();
    window.on("close", (event) => {
        if (allowWindowClose) return;
        if (desktopSettings.closeBehavior === "quit") {
            event.preventDefault();
            void closeApplication();
            return;
        }
        if (desktopSettings.closeBehavior === "tray" || desktopSettings.trayEnabled) {
            if (desktopSettings.closeBehavior === "tray") {
                event.preventDefault();
                window?.hide();
                return;
            }
            event.preventDefault();
            void confirmCloseToTray();
            return;
        }
        event.preventDefault();
        void closeApplication();
    });
    window.on("closed", () => { window = null; void closeApplication(); });
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
    else { tray?.destroy(); tray = null; }
}

app.on("before-quit", (event) => {
    if (closing || allowWindowClose) return;
    event.preventDefault();
    void closeApplication();
});

void main().catch((error: unknown) => {
    console.error(error);
    splash?.close();
    process.exitCode = 1;
    app.quit();
});
