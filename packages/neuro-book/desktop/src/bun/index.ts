/**
 * 桌面壳的 Electrobun 主进程（docs/specs/runtime/desktop-shell.md）：实现 `src/desktop/` 核心要的端口，把窗口事件送进去。
 * 流程与规则都在核心里（`DesktopShell`、`WindowCoordinator`），这里只做 Electrobun 能做的事：
 *
 * - 关窗：`will-close` 里同步设 `{allow: false}`（Electrobun 只在同步段里看这个应答）再交给协调器；真正关窗用 `win.close()`，
 *   它不经 `will-close`。窗口没了（`close` 事件）才告诉协调器。
 * - 退出：`before-quit` 一律同步否决，直到核心说可以退（`exit`）才放行一次；否决之后把这次退出请求交给协调器
 *   （`quitRequested`），由它像用户逐个关窗一样询问、停止（输出 19）。
 * - 对话框：壳自己开的小窗口，不用 `Utils.showMessageBox`（它在 Windows 上同步阻塞主线程）；只有缺 WebView2 时用它，那时什么
 *   都还没运行。
 * - 桥：产品窗口是沙箱网页视图（没有 RPC），页面经预加载脚本与 `__electrobunSendToHost` 发固定形状的消息；壳经
 *   `executeJavascript` 派发 `nbook-desktop` 事件。消息按网页视图 id 认窗口，按代次认询问；同一页面里的脚本都能发（插件完全信任）。
 * - 更新（docs/specs/runtime/desktop-update.md）：`UpdaterPort` 接 Electrobun 2.0.6 的 `Updater`，规则都在核心
 *   （`src/desktop/update.ts`、`update-install.ts`）。更新器的事件不用来判断结果（`error` 是检查、下载、换上共用的通道），每次调用
 *   之后读它的状态；`before-quit` 在取桌面锁之前放行（`DesktopShell.acceptsQuit`），换上要经它结束进程。
 */

import Electrobun, {BrowserWindow, PATHS, Screen, Updater, Utils} from "electrobun/main";
import {spawnSync} from "node:child_process";
import {appendFileSync, mkdirSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";

import {systemClock} from "../../../src/desktop/deadline";
import {DesktopShell} from "../../../src/desktop/shell";
import type {ShellPorts, ShellUpdates, StartupView} from "../../../src/desktop/shell";
import {resolveDesktopStateRoot} from "../../../src/desktop/state-root";
import {scanApplyResults} from "../../../src/desktop/update-install";
import type {UpdaterPort} from "../../../src/desktop/update-install";
import type {OpenTarget, WindowId, WindowPort} from "../../../src/desktop/windows";
import {DESKTOP_EVENT, parsePageMessage} from "../../../src/shared/desktop-bridge";
import type {CloseReason, ShellMessage} from "../../../src/shared/desktop-bridge";
import {PRODUCT_VERSION} from "../../../src/shared/product";

import {PRELOAD} from "./preload";

const SHELL_VIEW = "views://shell/index.html";
const DEFAULT_SIZE = {width: 1280, height: 800};
const WEBVIEW2_DOWNLOAD = "https://developer.microsoft.com/microsoft-edge/webview2/";
/** “打开下载页”（desktop-update 输出 10）：最新 Release 的页面。 */
const DOWNLOAD_PAGE = "https://github.com/notnotype/neuro-book/releases/latest";

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

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 接 Electrobun 的更新器。读不到 `Resources/version.json`（开发运行）时不给更新。通道根取不到（不在
 * `%LOCALAPPDATA%\<identifier>\<channel>\app\` 下：便携、开发构建）时 `channelRoot` 为 null，核心只提示、不建安装级文件。
 */
async function desktopUpdates(): Promise<ShellUpdates | undefined> {
    const info = await Updater.getLocalInfo();
    if (info.version === "" || info.hash === "") {
        log("update.disabled version.json is unavailable");
        return undefined;
    }
    let channelRoot: string | null = null;
    try {
        channelRoot = await Updater.appDataFolder();
    } catch (error) {
        log("update.not-managed-install", error);
    }
    const identity = {identifier: info.identifier, channel: info.channel};
    const updater: UpdaterPort = {
        local: {version: info.version, hash: info.hash},
        async check() {
            try {
                // 不看 `updateAvailable`：它只比哈希，只升不降由核心按版本判断。
                const checked = await Updater.checkForUpdate();
                return checked.error === "" ? {ok: true, version: checked.version, hash: checked.hash} : {ok: false, error: checked.error};
            } catch (error) {
                return {ok: false, error: describe(error)};
            }
        },
        async download(target) {
            try {
                // 成功、失败都 resolve 为 undefined（失败被它自己写进 `updateInfo.error`），所以之后读状态判断。
                await Updater.downloadUpdate();
            } catch (error) {
                return {ok: false, error: describe(error)};
            }
            const state = Updater.updateInfo();
            if (state.updateReady && state.error === "" && state.hash === target.hash) return {ok: true};
            return {ok: false, error: state.error !== "" ? state.error : `prepared ${state.hash || "nothing"} instead of ${target.hash}`};
        },
        async apply() {
            // 只看这次调用之后新增的状态记录：走到“正在启动新版本”就是更新器已在结束进程；不按英文文字分支。
            const before = Updater.getStatusHistory().length;
            try {
                await Updater.applyUpdate();
            } catch (error) {
                return {failed: describe(error)};
            }
            const added = Updater.getStatusHistory().slice(before);
            if (added.some((entry) => entry.status === "launching-new-version")) return "exiting";
            return {failed: added.map((entry) => `${entry.status}: ${entry.message}`).join("; ") || "the updater did not start the update"};
        },
        async results() {
            if (channelRoot === null) return [];
            const results = await scanApplyResults(channelRoot, identity);
            if (results === null) log(`update.results-unreadable channelRoot=${channelRoot}`);
            return results;
        },
        helperRunning: updateHelperRunning,
    };
    return {updater, channelRoot, openDownloadPage: () => void Utils.openExternal(DOWNLOAD_PAGE)};
}

/**
 * 更新器的换上程序还在不在：它被复制成 `%TEMP%\electrobun-update-<事务号>.exe` 运行（Electrobun 2.0.6 `copyUpdateHelper`）。
 * 用 `tasklist` 的 CSV（第一列是映像名，不随系统语言变），不经 PowerShell。查不了时 null，核心按“还在”处理。
 */
async function updateHelperRunning(): Promise<boolean | null> {
    if (process.platform !== "win32") return null;
    try {
        const child = Bun.spawn(["tasklist", "/fo", "csv", "/nh"], {stdout: "pipe", stderr: "ignore", windowsHide: true});
        const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        if (code !== 0) {
            log(`update.tasklist-failed exit=${String(code)}`);
            return null;
        }
        return output.split(/\r?\n/u).some((line) => /^"electrobun-update-/iu.test(line));
    } catch (error) {
        log("update.tasklist-failed", error);
        return null;
    }
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
    const dispatch = (win: BrowserWindow, detail: ShellMessage): void => {
        win.webview.executeJavascript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_EVENT)}, {detail: ${JSON.stringify(detail)}}))`);
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
    /**
     * 页面要去别处的地址（输出 11、12）：服务端的精确来源交 `sameOrigin`，`http`、`https` 的外部地址交系统浏览器，别的不理。
     * 整页导航被导航规则拦下后、页面请求新窗口时都走这里。
     */
    const routeAway = (raw: unknown, sameOrigin: (url: string) => void): void => {
        if (typeof raw !== "string") return;
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            return;
        }
        if (serverOrigin !== null && url.origin === serverOrigin) sameOrigin(url.href);
        else if (url.protocol === "http:" || url.protocol === "https:") Utils.openExternal(url.href);
    };

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
        win.on("focus", () => shell.windows.focused(id));
        win.webview.on("host-message", (event: unknown) => {
            const message = parse(event);
            if (message === null) return;
            onWindowMessage(id, win, message);
        });
        // Electrobun 2.0.6 的 will-navigate 载荷是 JSON 字符串 `{url, allowed}`（SDK 不替它解析），new-window-open 已由 SDK 解成
        // `{url, isCmdClick, ...}`（解析失败时仍是字符串）；`parse` 两种都收。被导航规则放行的整页导航（同源、启动页）不用处理。
        win.webview.on("will-navigate", (event: unknown) => {
            const detail = parse(event);
            if (detail === null || detail.allowed === true) return;
            routeAway(detail.url, () => undefined);
        });
        // Ctrl 点击链接、按住 Ctrl 的前端路由跳转：SDK 自己的预加载与 WebView2 的导航事件截下后发 new-window-open（输出 12）。
        win.webview.on("new-window-open", (event: unknown) => {
            routeAway(parse(event)?.url, (url) => void shell.windows.pageWindowRequested(url));
        });
        return id;
    };

    const onWindowMessage = (id: WindowId, win: BrowserWindow, raw: Record<string, unknown>): void => {
        // 启动页（壳自己的页面）的两种消息。
        if (raw.type === "shell-ready") {
            if (windows.get(id)?.kind === "shell") render(win, view);
            return;
        }
        if (raw.type === "action") {
            if (typeof raw.action === "string") shell.startupAction(raw.action as never);
            return;
        }
        // 产品页面的消息：形状在共用的桥模块里校验。
        const message = parsePageMessage(raw);
        if (message === null) return;
        switch (message.type) {
            case "title":
                win.setTitle(message.title === "" ? "NeuroBook" : message.title);
                return;
            case "open-window":
                routeAway(message.url, (url) => void shell.windows.pageWindowRequested(url));
                return;
            case "close-ack":
                shell.windows.pageAcked(id, message.generation);
                return;
            case "close-answer":
                shell.windows.pageAnswered(id, message.generation, message.answer);
                return;
            case "page-ready":
                shell.windows.pageReady(id);
                return;
            case "page-gone":
                shell.windows.pageGone(id);
                return;
            case "update-choice":
                shell.updates?.choose(message.id, message.choice);
                return;
            case "update-hint-shown":
                shell.updates?.shown(message.id);
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
        sendHint(id, hintId, hint) {
            const managed = windows.get(id);
            if (managed !== undefined) dispatch(managed.win, {type: "update-hint", id: hintId, hint});
        },
        endHint(id, hintId) {
            const managed = windows.get(id);
            if (managed !== undefined) dispatch(managed.win, {type: "update-hint-end", id: hintId});
        },
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
        // 取桌面锁之前放行：那时没有服务端与页面，启动时换上要经这里结束进程（desktop-update 输出 8）。
        if (quitAllowed || shell.acceptsQuit) return;
        event.response = {allow: false};
        // SDK 只在这个同步段里看应答；发起关闭（询问页面、关启动页）放到下一轮事件循环，不在它的退出流程里操作窗口。
        setImmediate(() => shell.windows.quitRequested());
    });

    const env = {...process.env};
    const updates = await desktopUpdates();
    log(`update setup=${updates === undefined ? "none" : `channelRoot=${String(updates.channelRoot)} local=${updates.updater.local.version}/${updates.updater.local.hash}`}`);
    shell = new DesktopShell({
        root,
        version: PRODUCT_VERSION,
        server: {bun: process.execPath, entry: join(payload, "server", "main.js"), webRoot: join(payload, "web"), env},
        ports,
        clock: systemClock,
        report: log,
        updates,
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
