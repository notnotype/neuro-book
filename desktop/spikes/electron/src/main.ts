import {randomBytes} from "node:crypto";
import {createInterface} from "node:readline";
import {createServer} from "node:net";
import {app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, screen} from "electron";
import {readFileSync} from "node:fs";
import {mkdir as mkdirAsync, readFile as readFileAsync, writeFile as writeFileAsync} from "node:fs/promises";
import {homedir} from "node:os";
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
    desktopRemoteOrigin,
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

type WindowState = {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    fullscreen: boolean;
};

const DEFAULT_WINDOW_STATE: WindowState = {x: 80, y: 80, width: 1280, height: 840, maximized: false, fullscreen: false};
let windowStateWrite: Promise<void> = Promise.resolve();

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
    const response = await fetch(new URL("/api/app/desktop-capability", origin + "/"), {redirect: "error"});
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
        await flushWindowState();
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

/** 读取并钳制窗口状态；显示器变化时至少保留一段可见标题栏。 */
async function loadWindowState(root: string): Promise<WindowState> {
    try {
        const value = JSON.parse(await readFileAsync(join(root, "window-state.json"), "utf8")) as Partial<WindowState>;
        if (!["x", "y", "width", "height"].every((key) => Number.isInteger(value[key as keyof WindowState]))) throw new Error("窗口坐标不是整数。");
        if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 640 || value.height < 480) throw new Error("窗口尺寸不受支持。");
        const displays = screen.getAllDisplays();
        const display = displays.find((item) => item.bounds.x <= value.x! && value.x! < item.bounds.x + item.bounds.width)
            ?? screen.getPrimaryDisplay();
        const area = display.workArea;
        const width = Math.min(value.width!, Math.max(640, area.width));
        const height = Math.min(value.height!, Math.max(480, area.height));
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

async function main(): Promise<void> {
    const config = readConfig();
    // Session/profile 属于当前安装；单实例身份必须使用稳定的用户级根，不能随 Portable 变化。
    app.setPath("userData", desktopIdentityRoot());
    app.setPath("sessionData", join(config.desktopRoot, "webview"));
    app.setPath("logs", join(config.desktopRoot, "logs"));
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
    const savedWindowState = await loadWindowState(config.desktopRoot);
    window = new BrowserWindow({
        x: savedWindowState.x,
        y: savedWindowState.y,
        width: savedWindowState.width,
        height: savedWindowState.height,
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
        queueWindowStateSave(config.desktopRoot);
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
    for (const eventName of ["move", "resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) {
        window.on(eventName, () => queueWindowStateSave(config.desktopRoot));
    }
    window.on("closed", () => { queueWindowStateSave(config.desktopRoot); window = null; void closeApplication(); });
    if (savedWindowState.maximized) window.maximize();
    if (savedWindowState.fullscreen) window.setFullScreen(true);
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
