// w00046 t14 probe: what the page-side Notification does in WebView2 in the desktop shell (permission prompt, toast appearance, click). Standalone Bun in the desktop session.
// Reads only the NeuroBook test app's own windows and pages (CDP on its WebView2 debugging port, user32 queries on its
// windows). No screen capture, no OS mouse or keyboard input. The test state root is t18\state (own project copy).
import {dlopen, FFIType, ptr} from "bun:ffi";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const [t, portText, outFile] = process.argv.slice(2);
const port = Number(portText);
const lines: string[] = [];
const log = (line: string) => { lines.push(line); console.log(line); };
const identifier = "io.github.notnotype.neurobook.t18test";

const u = dlopen("user32.dll", {
    FindWindowExW: {args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
    GetWindowThreadProcessId: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32},
    IsWindowVisible: {args: [FFIType.ptr], returns: FFIType.bool},
    GetClientRect: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool},
    GetWindowRect: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool},
    SendMessageTimeoutW: {args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64},
    ShowWindow: {args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool},
    IsZoomed: {args: [FFIType.ptr], returns: FFIType.bool},
    IsIconic: {args: [FFIType.ptr], returns: FFIType.bool},
    GetDpiForWindow: {args: [FFIType.ptr], returns: FFIType.u32},
    GetPropW: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
    PostMessageW: {args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.bool},
}).symbols;
const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");

async function appPids(): Promise<Set<number>> {
    const out = await new Response(Bun.spawn(["powershell", "-NoProfile", "-Command", `Get-Process | Where-Object { $_.Path -like '*${identifier}*' } | ForEach-Object { $_.Id }`], {stdout: "pipe"}).stdout).text();
    return new Set(out.split(/\r?\n/u).map((s) => Number(s.trim())).filter((n) => n > 0));
}
function windowsOf(pids: Set<number>): any[] {
    const found: any[] = [];
    let hwnd: any = null;
    const cls = wide("BasicWindowClass");
    for (;;) {
        hwnd = u.FindWindowExW(null, hwnd, ptr(cls), null);
        if (hwnd === null) break;
        const pid = new Uint32Array(1);
        u.GetWindowThreadProcessId(hwnd, ptr(pid));
        if (pids.has(pid[0]!) && u.IsWindowVisible(hwnd)) found.push(hwnd);
    }
    return found;
}
const size = (fn: "GetClientRect" | "GetWindowRect", hwnd: any) => { const r = new Int32Array(4); u[fn](hwnd, ptr(r)); return `${r[2]! - r[0]!}x${r[3]! - r[1]!}`; };
/** WM_GETMINMAXINFO from another process: the system marshals the structure; read ptMinTrackSize. 2 s timeout, abort if hung. */
function minTrack(hwnd: any): string {
    const info = new Int32Array(10);
    const result = new BigUint64Array(1);
    const ok = u.SendMessageTimeoutW(hwnd, 0x24, 0n, ptr(info), 0x0002, 2000, ptr(result));
    return ok === 0 || ok === 0n ? "timeout" : `${info[6]}x${info[7]}`;
}
const describe = (hwnd: any) => `window ${size("GetWindowRect", hwnd)} client ${size("GetClientRect", hwnd)} minTrack ${minTrack(hwnd)} dpi ${u.GetDpiForWindow(hwnd)} zoomed=${u.IsZoomed(hwnd)} iconic=${u.IsIconic(hwnd)}`;

async function targets(): Promise<Array<{type: string; url: string; webSocketDebuggerUrl: string}>> {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { return []; }
}
const pages = async () => (await targets()).filter((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1"));
async function evaluate(ws: string, expression: string): Promise<any> {
    const socket = new WebSocket(ws);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    const res: any = await new Promise((r) => { socket.addEventListener("message", (e) => r(JSON.parse(String(e.data))), {once: true}); socket.send(JSON.stringify({id: 1, method: "Runtime.evaluate", params: {expression, returnByValue: true, awaitPromise: true}})); });
    socket.close();
    return res.result?.result?.value;
}
async function until<T>(label: string, probe: () => Promise<T | null | false | undefined> | T | null | false | undefined, ms = 60_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
        const v = await probe();
        if (v !== null && v !== false && v !== undefined) return v as T;
        if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
        await Bun.sleep(300);
    }
}
const sleep = (ms: number) => Bun.sleep(ms);


import {existsSync, writeFileSync, readFileSync as readText} from "node:fs";

const uia = async (mode: string, arg = "NeuroBook"): Promise<string[]> => {
    const proc = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(t, "tray-uia.ps1"), mode, arg], {stdout: "pipe", stderr: "pipe"});
    const text = await new Response(proc.stdout).text();
    return text.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
};
const shellLog = (): string[] => { try { return readText(join(t, "state", "logs", "desktop", "shell.log"), "utf8").split(/\r?\n/u).filter((l) => l !== ""); } catch { return []; } };
const logLines = (pattern: RegExp) => shellLog().filter((l) => pattern.test(l)).map((l) => l.slice(0, 200));
const visibleWindows = async () => windowsOf(await appPids());

/** The shell's hidden tray window (class TrayWindowClass, message-only or top-level) of this app; null when there is no tray icon. */
async function trayWindow(): Promise<any | null> {
    const pids = await appPids();
    const cls = wide("TrayWindowClass");
    for (const parent of [null, -3n as any]) {
        let hwnd: any = null;
        for (;;) {
            hwnd = u.FindWindowExW(parent === null ? null : (parent as any), hwnd, ptr(cls), null);
            if (hwnd === null) break;
            const pid = new Uint32Array(1);
            u.GetWindowThreadProcessId(hwnd, ptr(pid));
            if (pids.has(pid[0]!)) return hwnd;
        }
    }
    return null;
}
/** What Windows sends the tray window when the icon is clicked: callback message WM_USER+100, lParam = WM_LBUTTONUP / WM_RBUTTONUP (Electrobun 2.0.6 TrayWindowProc). Not OS mouse input. */
async function clickTray(button: "left" | "right"): Promise<string> {
    const hwnd = await trayWindow();
    if (hwnd === null) return "no-tray-window";
    return u.PostMessageW(hwnd, 0x464, 1n, button === "left" ? 0x202n : 0x205n) ? `posted ${button}` : "post-failed";
}

/** The open popup menu (class #32768) owned by this app; keys go to it as window messages (no OS keyboard input). */
async function popupMenu(): Promise<any | null> {
    const pids = await appPids();
    const cls = wide("#32768");
    let hwnd: any = null;
    for (;;) {
        hwnd = u.FindWindowExW(null, hwnd, ptr(cls), null);
        if (hwnd === null) return null;
        const pid = new Uint32Array(1);
        u.GetWindowThreadProcessId(hwnd, ptr(pid));
        if (pids.has(pid[0]!) && u.IsWindowVisible(hwnd)) return hwnd;
    }
}
/** Select the n-th item (1-based, separators skipped by the menu itself) and press Enter. */
async function chooseMenuItem(n: number): Promise<string> {
    const menu = await until("popup menu", async () => popupMenu(), 5000).catch(() => null);
    if (menu === null) return "no-popup";
    for (let i = 0; i < n; i += 1) { u.PostMessageW(menu, 0x100, 0x28n, 0n); await sleep(250); }
    u.PostMessageW(menu, 0x100, 0x0dn, 0n);
    return `chose item ${n}`;
}
const closeWindowViaPage = async () => {
    const p = (await pages())[0];
    if (p === undefined) throw new Error("no product page to close");
    await evaluate(p.webSocketDebuggerUrl, "document.querySelector('[data-desktop-control=close]').click(); true").catch(() => undefined);
};


import {mkdirSync, rmSync, writeFileSync as writeFile, readdirSync, existsSync as exists, readFileSync as readText} from "node:fs";


import {writeFileSync as writeFile} from "node:fs";

const uiaToast = async (): Promise<string[]> => {
    const proc = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(t, "toast-uia.ps1")], {stdout: "pipe", stderr: "pipe"});
    return (await new Response(proc.stdout).text()).split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
};

const scanWindows = async (): Promise<string[]> => {
    const proc = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(t, "toast-scan.ps1")], {stdout: "pipe", stderr: "pipe"});
    return (await new Response(proc.stdout).text()).split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
};
/** Windows owned by the app that are dialogs (#32770): the permission prompt. */
async function dialogs(): Promise<Array<{hwnd: any; text: string}>> {
    const pids = await appPids();
    const cls = wide("#32770");
    const out: Array<{hwnd: any; text: string}> = [];
    let hwnd: any = null;
    for (;;) {
        hwnd = u.FindWindowExW(null, hwnd, ptr(cls), null);
        if (hwnd === null) break;
        const pid = new Uint32Array(1);
        u.GetWindowThreadProcessId(hwnd, ptr(pid));
        if (pids.has(pid[0]!) && u.IsWindowVisible(hwnd)) out.push({hwnd, text: ""});
    }
    return out;
}

try {
    writeFile(join(t, "state", "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("rpc online", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    let nextId = 1;
    const call = (method: string, params: unknown = {}) => new Promise<any>((resolve) => { const id = nextId++; const on = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id === id) { socket.removeEventListener("message", on); resolve(m); } }; socket.addEventListener("message", on); socket.send(JSON.stringify({id, method, params})); });
    const gesture = async (expression: string) => (await call("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true, userGesture: true})).result?.result?.value;
    log(`Notification support / initial permission: ${JSON.stringify(await gesture("typeof Notification === 'undefined' ? 'no Notification' : Notification.permission"))}`);
    log(`secure context: ${JSON.stringify(await gesture("isSecureContext"))}, origin: ${JSON.stringify(await gesture("location.origin"))}`);

    // 1. Permission request in a user gesture; the shell may show a Win32 message box. Poll for it while the request is pending.
    void gesture("window.__perm = 'pending'; Notification.requestPermission().then((p) => { window.__perm = p; }); true");
    let dialogSeen = false;
    for (let i = 0; i < 20; i += 1) {
        await sleep(500);
        const found = await dialogs();
        if (found.length > 0) { dialogSeen = true; log(`permission prompt: a Win32 dialog (#32770) of the app is visible (${found.length})`); break; }
        if (String(await gesture("window.__perm")) !== "pending") break;
    }
    log(`prompt shown: ${dialogSeen}; permission result now: ${JSON.stringify(await gesture("window.__perm"))}`);
    if (dialogSeen) {
        // Accept it: click the dialog's first button (Yes) with BM_CLICK; text of the dialog and button read through UIA below is not needed.
        const d = (await dialogs())[0]!;
        const yes = u.FindWindowExW(d.hwnd, null, ptr(wide("Button")), null);
        if (yes !== null) u.PostMessageW(yes, 0x00f5, 0n, 0n);
        await sleep(1500);
        log(`after accepting: permission=${JSON.stringify(await gesture("window.__perm"))}, Notification.permission=${JSON.stringify(await gesture("Notification.permission"))}`);
    }
    const permission = String(await gesture("Notification.permission"));
    if (permission !== "granted") throw new Error(`permission is ${permission}; no notification probe possible`);

    // 2. Show a notification with the window in front; record events.
    await gesture("window.__events = []; window.__n = new Notification('NeuroBook t14 探针', {body: '页面一侧的 Notification', tag: 't14'}); for (const k of ['show','click','close','error']) window.__n.addEventListener(k, () => window.__events.push(k + '@' + Date.now())); true");
    await sleep(1200);
    log(`window in front, windows right after the notification: ${JSON.stringify(await scanWindows())}`);
    await sleep(1300);
    log(`window in front: events=${JSON.stringify(await gesture("window.__events.map((e) => e.split('@')[0])"))}; toast UIA: ${JSON.stringify(await uiaToast())}`);

    // 3. Minimized window: notify again, look for the toast, then click it (UIA Invoke) and see whether onclick fires and the window comes back.
    const win = windowsOf(await appPids())[0];
    u.ShowWindow(win, 6); await sleep(1000);
    await gesture("window.__events = []; window.__n = new Notification('NeuroBook t14 探针（最小化）', {body: '窗口在最小化时', tag: 't14b'}); for (const k of ['show','click','close','error']) window.__n.addEventListener(k, () => window.__events.push(k + '@' + Date.now())); true");
    await sleep(2500);
    const toast = await uiaToast();
    log(`window minimized: events=${JSON.stringify(await gesture("window.__events.map((e) => e.split('@')[0])"))}; toast UIA: ${JSON.stringify(toast)}`);
    const clicked = (await uiaToast().then(async () => { const p = Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(t, "toast-uia.ps1"), "click"], {stdout: "pipe"}); return (await new Response(p.stdout).text()).trim(); }));
    await sleep(2500);
    log(`clicked the toast (UIA invoke): ${JSON.stringify(clicked)}; events=${JSON.stringify(await gesture("window.__events.map((e) => e.split('@')[0])"))}; window iconic=${u.IsIconic(win)}`);
    socket.close();
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
