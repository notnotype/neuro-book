// w00046 t16 Windows acceptance: native drop target and a real directory drop into the plugins page. Standalone Bun in the desktop session.
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

const walkChildren = (parent: any, depth = 0): any[] => {
    const out: any[] = [];
    let child: any = null;
    for (;;) {
        child = u.FindWindowExW(parent, child, null, null);
        if (child === null) break;
        out.push(child);
        if (depth < 6) out.push(...walkChildren(child, depth + 1));
    }
    return out;
};
const dropProp = wide("OleDropTargetInterface");
const hasDropTarget = (hwnd: any) => u.GetPropW(hwnd, ptr(dropProp)) !== null;

try {
    writeFile(join(t, "state", "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    // A plugin folder: manifest, a subfolder with 250 files (readEntries returns at most 100 per call), a node_modules the page must skip.
    const src = join(t, "dropsrc", "WinHello");
    rmSync(join(t, "dropsrc"), {recursive: true, force: true});
    mkdirSync(join(src, "assets"), {recursive: true});
    mkdirSync(join(src, "node_modules", "dep"), {recursive: true});
    writeFile(join(src, "package.json"), JSON.stringify({publisher: "example", name: "winhello", version: "1.0.0", displayName: "WinHello", engines: {neurobook: ">=0.1.0"}}));
    for (let i = 0; i < 250; i += 1) writeFile(join(src, "assets", `f${String(i).padStart(3, "0")}.txt`), `file ${i}`);
    writeFile(join(src, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    log(`prepared ${src}: 251 files to upload, node_modules skipped`);

    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("rpc online", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    if (await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-bookshelf-page]') !== null")) {
        await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-book-card]')?.click(); true").catch(() => undefined);
        await sleep(3000);
    }
    await until("workbench", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-window-state') === 'ready'").catch(() => false), 60_000);
    // Native side: is a COM drop target registered on the product window (WebView2 AllowExternalDrop)?
    const win = await until("window", async () => windowsOf(await appPids())[0] ?? null, 30_000);
    const all = [win, ...walkChildren(win)];
    log(`native drop target (OleDropTargetInterface window property): top-level=${hasDropTarget(win)}, on ${all.filter(hasDropTarget).length} of ${all.length} windows in the window tree`);

    // Open the plugins page in the settings window.
    // The settings window may already be open (layout restored from the previous run): only click when it is not.
    if (!(await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-settings-window]') !== null"))) await evaluate(page.webSocketDebuggerUrl, "document.querySelector(\"[data-activity-item='nbook.settings']\").click(); true");
    await until("settings window", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-settings-window]') !== null"), 30_000);
    await evaluate(page.webSocketDebuggerUrl, "document.querySelector(\"[data-settings-nav='nbook.plugins.installed']\").click(); true");
    await until("plugins page", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-plugins-page]') !== null"), 30_000);
    await sleep(800);

    // Real drag events through the browser's own drag pipeline (CDP Input.dispatchDragEvent with a file path): the page sees a DataTransfer whose item is a directory entry.
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    let nextId = 1;
    const call = (method: string, params: unknown = {}) => new Promise<any>((resolve) => { const id = nextId++; const on = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id === id) { socket.removeEventListener("message", on); resolve(m); } }; socket.addEventListener("message", on); socket.send(JSON.stringify({id, method, params})); });
    const rect = await evaluate(page.webSocketDebuggerUrl, "(() => { const b = document.querySelector('[data-plugins-page]').getBoundingClientRect(); return {x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height / 2, 200))}; })()");
    const data = {items: [], files: [src], dragOperationsMask: 1};
    const types = ["dragEnter", "dragOver", "drop"];
    for (const type of types) { const r = await call("Input.dispatchDragEvent", {type, x: rect.x, y: rect.y, data}); log(`dispatchDragEvent ${type}: ${r.error ? JSON.stringify(r.error) : "ok"}`); await sleep(type === "drop" ? 0 : 300); }
    const preview = await until("install dialog", async () => evaluate(page.webSocketDebuggerUrl, "[...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText).find((x) => x.includes('安装插件')) ?? null"), 60_000).catch(async () => `(no dialog) problem=${await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-plugin-problem]')?.innerText ?? null")}`);
    log(`after the drop: ${JSON.stringify(String(preview).replace(/\s+/gu, " ").slice(0, 260))}`);
    const uploadsDir = join(t, "state", "plugin-uploads");
    log(`staging dir while previewing: ${exists(uploadsDir) ? readdirSync(uploadsDir).length : "absent"} upload(s)`);
    await evaluate(page.webSocketDebuggerUrl, "[...document.querySelectorAll('[role=dialog]')].find((d) => d.innerText.includes('安装插件'))?.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === '安装') b.click(); }); true");
    await until("row pending", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-plugin-row=\"example.winhello\"] [data-plugin-pending=\"install\"]') !== null"), 60_000);
    await sleep(1500);
    const installed = join(t, "state", "plugins", "example.winhello", "1.0.0");
    log(`installed: manifest=${exists(join(installed, "package.json"))}, assets files=${exists(join(installed, "assets")) ? readdirSync(join(installed, "assets")).length : 0}, node_modules=${exists(join(installed, "node_modules"))}`);
    log(`staging dir after install: ${exists(uploadsDir) ? readdirSync(uploadsDir).length : "absent"} upload(s)`);
    socket.close();
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
