/**
 * 桌面壳的 Electrobun 主进程（docs/specs/runtime/desktop-shell.md）：实现 `src/desktop/` 核心要的端口，把窗口事件送进去。
 * 流程与规则都在核心里（`DesktopShell`、`WindowCoordinator`），这里只做 Electrobun 能做的事：
 *
 * - 关窗：`will-close` 里同步设 `{allow: false}`（Electrobun 只在同步段里看这个应答）再交给协调器；真正关窗用 `win.close()`，
 *   它不经 `will-close`。窗口没了（`close` 事件）才告诉协调器。
 * - 退出：`before-quit` 一律同步否决，直到核心说可以退（`exit`）才放行一次。
 * - 对话框：壳自己开的小窗口，不用 `Utils.showMessageBox`（它在 Windows 上同步阻塞主线程）；只有缺 WebView2 时用它，那时什么
 *   都还没运行。
 * - 桥：产品窗口是沙箱网页视图（没有 RPC），页面经预加载脚本与 `__electrobunSendToHost` 发固定形状的消息；壳经
 *   `executeJavascript` 派发 `nbook-desktop` 事件。消息按网页视图 id 认窗口，按代次认询问；同一页面里的脚本都能发（插件完全信任）。
 */

import Electrobun, {BrowserWindow, PATHS, Screen, Utils} from "electrobun/main";
import {spawnSync} from "node:child_process";
import {appendFileSync, mkdirSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";

import {systemClock} from "../../../src/desktop/deadline";
import {DesktopShell} from "../../../src/desktop/shell";
import type {ShellPorts, StartupView} from "../../../src/desktop/shell";
import {resolveDesktopStateRoot} from "../../../src/desktop/state-root";
import type {CloseReason, OpenTarget, WindowId, WindowPort} from "../../../src/desktop/windows";
import {PRODUCT_VERSION} from "../../../src/shared/product";

import {PRELOAD} from "./preload";

const SHELL_VIEW = "views://shell/index.html";
const DEFAULT_SIZE = {width: 1280, height: 800};
const WEBVIEW2_DOWNLOAD = "https://developer.microsoft.com/microsoft-edge/webview2/";

/** 程序根目录：`Resources` 的上一层；便携包解压出来就是这一层，便携标记写在这里。 */
const programRoot = dirname(PATHS.RESOURCES_FOLDER);
const payload = join(PATHS.RESOURCES_FOLDER, "app", "neurobook");

let logFile: string | null = null;
function log(event: string, error?: unknown): void {
    if (logFile === null) return;
    const detail = error === undefined ? "" : ` ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    try {
        appendFileSync(logFile, `${new Date().toISOString()} ${event}${detail}\n`);
    } catch {
        // 日志写不了没有别处可报；壳照常运行。
    }
}

/** WebView2 运行时装了没有（输出 20）：读 EdgeUpdate 登记的 WebView2 客户端键，机器级与用户级各看一处。 */
function hasWebView2(): boolean {
    if (process.platform !== "win32") return true;
    const key = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    const places = [`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${key}`, `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${key}`, `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${key}`];
    return places.some((place) => {
        const result = spawnSync("reg", ["query", place, "/v", "pv"], {encoding: "utf8", windowsHide: true});
        const version = /pv\s+REG_SZ\s+(\S+)/u.exec(result.stdout)?.[1];
        return result.status === 0 && version !== undefined && version !== "0.0.0.0";
    });
}

interface ManagedWindow {
    readonly win: BrowserWindow;
    kind: "shell" | "page";
}

async function main(): Promise<void> {
    if (!hasWebView2()) {
        const {response} = await Utils.showMessageBox({type: "error", title: "NeuroBook", message: "需要 Microsoft Edge WebView2 运行时", detail: "这台电脑没有装 WebView2，NeuroBook 的窗口打不开。装好之后再打开 NeuroBook。", buttons: ["打开下载页", "退出"], defaultId: 0, cancelId: 1});
        if (response === 0) Utils.openExternal(WEBVIEW2_DOWNLOAD);
        Utils.quit(1);
        return;
    }

    const root = await resolveDesktopStateRoot({env: process.env, cwd: process.cwd(), programRoot, platform: process.platform, home: homedir()});
    if (root.ok) {
        const dir = join(root.stateRoot, "logs", "desktop");
        mkdirSync(dir, {recursive: true});
        logFile = join(dir, "shell.log");
    }
    log(`start version=${PRODUCT_VERSION} bun=${Bun.version} programRoot=${programRoot} root=${JSON.stringify(root)}`);

    const windows = new Map<WindowId, ManagedWindow>();
    const dialogs = new Map<string, BrowserWindow>();
    let view: StartupView = {kind: "starting"};
    let serverOrigin: string | null = null;
    let quitAllowed = false;
    let shell!: DesktopShell;

    const render = (win: BrowserWindow, state: unknown): void => {
        win.webview.executeJavascript(`window.__nbookShell && window.__nbookShell.render(${JSON.stringify(state)})`);
    };
    const dispatch = (win: BrowserWindow, detail: unknown): void => {
        win.webview.executeJavascript(`window.dispatchEvent(new CustomEvent("nbook-desktop", {detail: ${JSON.stringify(detail)}}))`);
    };
    const parse = (event: unknown): Record<string, unknown> | null => {
        const detail = (event as {data?: {detail?: unknown}}).data?.detail;
        if (typeof detail === "object" && detail !== null) return detail as Record<string, unknown>;
        if (typeof detail !== "string") return null;
        try {
            const parsed: unknown = JSON.parse(detail);
            return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
        } catch {
            return null;
        }
    };
    const isServerUrl = (url: string): boolean => {
        try {
            return serverOrigin !== null && new URL(url).origin === serverOrigin;
        } catch {
            return false;
        }
    };
    const isWebUrl = (url: string): boolean => /^https?:\/\//u.test(url);

    /** 产品窗口与启动页窗口：沙箱、预加载、导航规则；事件接到协调器。 */
    const openManaged = (target: OpenTarget): WindowId => {
        const url = target.kind === "page" ? target.url : SHELL_VIEW;
        if (target.kind === "page") serverOrigin = new URL(target.url).origin;
        const win = new BrowserWindow({title: "NeuroBook", url, frame: centered(DEFAULT_SIZE), sandbox: true, preload: PRELOAD, navigationRules: JSON.stringify(navigationRules())});
        const id = win.id as WindowId;
        windows.set(id, {win, kind: target.kind === "page" ? "page" : "shell"});
        win.on("will-close", (event: {response?: {allow: boolean}}) => {
            event.response = {allow: false};
            shell.windows.closeRequested(id);
        });
        win.on("close", () => {
            windows.delete(id);
            shell.windows.closed(id);
        });
        win.webview.on("host-message", (event: unknown) => {
            const message = parse(event);
            if (message === null) return;
            onWindowMessage(id, win, message);
        });
        win.webview.on("will-navigate", (event: unknown) => {
            const url = String((event as {data?: {detail?: unknown}}).data?.detail ?? "");
            if (!isServerUrl(url) && !url.startsWith("views://") && isWebUrl(url)) Utils.openExternal(url);
        });
        return id;
    };

    const onWindowMessage = (id: WindowId, win: BrowserWindow, message: Record<string, unknown>): void => {
        switch (message.type) {
            case "shell-ready":
                if (windows.get(id)?.kind === "shell") render(win, view);
                return;
            case "action":
                if (typeof message.action === "string") shell.startupAction(message.action as never);
                return;
            case "title":
                if (typeof message.title === "string") win.setTitle(message.title === "" ? "NeuroBook" : message.title);
                return;
            case "open-window": {
                const url = typeof message.url === "string" ? message.url : "";
                if (isServerUrl(url)) shell.windows.pageWindowRequested(url);
                else if (isWebUrl(url)) Utils.openExternal(url);
                return;
            }
            case "close-ack":
                if (typeof message.generation === "number") shell.windows.pageAcked(id, message.generation);
                return;
            case "close-answer":
                if (typeof message.generation === "number" && (message.answer === "allow" || message.answer === "deny")) shell.windows.pageAnswered(id, message.generation, message.answer);
                return;
        }
    };

    /** 对话框：壳的小窗口，按钮的结果交给 `onAction`；用户直接关掉它算 `onDismiss`。 */
    const openDialog = (key: string, state: unknown, onAction: (action: string) => void, onDismiss: () => void): void => {
        const existing = dialogs.get(key);
        if (existing !== undefined) {
            render(existing, state);
            existing.activate();
            return;
        }
        const win = new BrowserWindow({title: "NeuroBook", url: SHELL_VIEW, frame: centered({width: 480, height: 260}), sandbox: true});
        dialogs.set(key, win);
        let handled = false;
        win.webview.on("host-message", (event: unknown) => {
            const message = parse(event);
            if (message?.type === "shell-ready") render(win, state);
            if (message?.type === "action" && typeof message.action === "string" && !handled) {
                handled = true;
                onAction(message.action);
            }
        });
        win.on("close", () => {
            dialogs.delete(key);
            if (!handled) {
                handled = true;
                onDismiss();
            }
        });
    };
    const closeDialog = (key: string): void => {
        const win = dialogs.get(key);
        dialogs.delete(key);
        win?.close();
    };

    const windowPort: WindowPort = {
        open: openManaged,
        load(id, url) {
            const managed = windows.get(id);
            if (managed === undefined) return;
            serverOrigin = new URL(url).origin;
            managed.win.webview.setNavigationRules(navigationRules());
            managed.kind = "page";
            managed.win.webview.loadURL(url);
        },
        commitClose: (id) => windows.get(id)?.win.close(),
        askPage(id, generation, reason: CloseReason) {
            const managed = windows.get(id);
            if (managed !== undefined) dispatch(managed.win, {type: "close-query", generation, reason});
        },
        endAsk(id, generation) {
            const managed = windows.get(id);
            if (managed !== undefined) dispatch(managed.win, {type: "close-end", generation});
        },
        showNotResponding(id) {
            openDialog(`not-responding:${String(id)}`, {kind: "not-responding"}, (action) => {
                closeDialog(`not-responding:${String(id)}`);
                shell.windows.dialogChose(id, action === "force" ? "force" : action === "cancel" ? "cancel" : "wait");
            }, () => shell.windows.dialogChose(id, "wait"));
        },
        closeNotResponding: (id) => closeDialog(`not-responding:${String(id)}`),
    };

    let pendingRestartFailure: string | null = null;
    const ports: ShellPorts = {
        windows: windowPort,
        startupView(next) {
            view = next;
            for (const managed of windows.values()) if (managed.kind === "shell") render(managed.win, next);
        },
        askServerExited(exitCode, logDir) {
            const state = pendingRestartFailure === null ? {kind: "server-exited", exitCode, logDir} : {kind: "restart-failed", detail: pendingRestartFailure};
            pendingRestartFailure = null;
            return new Promise((resolve) => {
                openDialog("server-exited", state, (action) => {
                    closeDialog("server-exited");
                    resolve(action === "restart" ? "restart" : "later");
                }, () => resolve("later"));
            });
        },
        tellRestartFailed(detail) {
            pendingRestartFailure = detail;
        },
        openPath: (path) => void Utils.openPath(path),
        exit(code) {
            log(`exit ${String(code)}`);
            quitAllowed = true;
            Utils.quit(code);
        },
    };

    Electrobun.events.on("before-quit", (event: {response?: {allow: boolean}}) => {
        if (!quitAllowed) event.response = {allow: false};
    });

    const env = {...process.env};
    shell = new DesktopShell({
        root,
        version: PRODUCT_VERSION,
        server: {bun: process.execPath, entry: join(payload, "server", "main.js"), webRoot: join(payload, "web"), env},
        ports,
        clock: systemClock,
        report: log,
    });
    await shell.run();

    /** 输出 11：先拦住全部（`^*`），再放行启动页与当前服务端的精确来源；最后匹配到的那条生效。 */
    function navigationRules(): string[] {
        return serverOrigin === null ? ["^*", "views://*"] : ["^*", "views://*", `${serverOrigin}/*`];
    }
}

/** 缺省大小居中；工作区放不下时取它的九成（输出 10）。 */
function centered(size: {width: number; height: number}): {x: number; y: number; width: number; height: number} {
    const area = Screen.getPrimaryDisplay().workArea;
    if (area.width <= 0 || area.height <= 0) return {x: 120, y: 80, ...size};
    const width = Math.min(size.width, Math.floor(area.width * 0.9));
    const height = Math.min(size.height, Math.floor(area.height * 0.9));
    return {x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height};
}

void main().catch((error: unknown) => {
    log("fatal", error);
    Utils.quit(1);
});
