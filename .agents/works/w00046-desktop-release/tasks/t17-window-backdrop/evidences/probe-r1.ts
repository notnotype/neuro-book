// w00046 t13 Windows acceptance: tray icon, background mode, tray open/quit. Standalone Bun in the desktop session.
// Reads only the NeuroBook test app's own windows and pages (CDP on its WebView2 debugging port, user32 queries on its
// windows). No screen capture, no OS mouse or keyboard input. The test state root is t18\state (own project copy).
import {dlopen, FFIType, ptr, toArrayBuffer} from "bun:ffi";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const [t, portText, outFile] = process.argv.slice(2);
const port = Number(portText);
const lines: string[] = [];
const log = (line: string) => { lines.push(line); console.log(line); };
const identifier = "io.github.notnotype.neurobook";

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
    PostMessageW: {args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.bool},
}).symbols;
const g = dlopen("gdi32.dll", {
    CreateCompatibleDC: {args: [FFIType.ptr], returns: FFIType.ptr},
    CreateDIBSection: {args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr},
    SelectObject: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr},
    DeleteObject: {args: [FFIType.ptr], returns: FFIType.bool},
    DeleteDC: {args: [FFIType.ptr], returns: FFIType.bool},
}).symbols;
const pw = dlopen("user32.dll", {PrintWindow: {args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.bool}}).symbols;
const d = dlopen("dwmapi.dll", {
    DwmSetWindowAttribute: {args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32},
    DwmExtendFrameIntoClientArea: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32},
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



const PS = (script: string) => new Response(Bun.spawn(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {stdout: "pipe", stderr: "pipe"}).stdout).text();
async function cdp(ws: string, method: string, params: object = {}): Promise<any> {
    const socket = new WebSocket(ws);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    const res: any = await new Promise((r) => { socket.addEventListener("message", (e) => r(JSON.parse(String(e.data))), {once: true}); socket.send(JSON.stringify({id: 1, method, params})); });
    socket.close();
    return res;
}
/** PrintWindow (PW_RENDERFULLCONTENT) of one window into our own DIB; reports BGRA at sample points. Not a screen capture: only this window's own output. */
function sample(hwnd: any, points: Array<[string, number, number]>): string[] {
    const r = new Int32Array(4); u.GetWindowRect(hwnd, ptr(r));
    const w = r[2]! - r[0]!, h = r[3]! - r[1]!;
    const dc = g.CreateCompatibleDC(null);
    const bmi = new Int32Array([40, w, -h, 0x200001, 0, 0, 0, 0, 0, 0]); // BITMAPINFOHEADER: biSize, width, -height (top-down), planes=1|bitcount=32<<16
    const bitsPtr = new BigUint64Array(1);
    const bmp = g.CreateDIBSection(dc, ptr(bmi), 0, ptr(bitsPtr), null, 0);
    g.SelectObject(dc, bmp);
    const ok = pw.PrintWindow(hwnd, dc, 2);
    const buf = new Uint8Array(toArrayBuffer(Number(bitsPtr[0]) as any, 0, w * h * 4));
    const out = [`PrintWindow ok=${ok} size=${w}x${h}`];
    for (const [name, x, y] of points) { const o = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4; out.push(`  ${name} (${x},${y}) BGRA=${buf[o]},${buf[o + 1]},${buf[o + 2]},${buf[o + 3]}`); }
    g.DeleteObject(bmp); g.DeleteDC(dc);
    return out;
}
const dwmSet = (hwnd: any, attr: number, value: number): number => { const v = new Int32Array([value]); return d.DwmSetWindowAttribute(hwnd, attr, ptr(v), 4); };
const KEEP = Number(process.env.T17_KEEP_SEC ?? "0");

try {
    writeFileSync(join(t, "state", "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off"}));
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("workbench", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]') !== null"), 60_000);
    await sleep(1500);
    const hwnd = (await visibleWindows())[0];
    const win = await PS("(Get-CimInstance Win32_OperatingSystem).BuildNumber");
    log(`build ${win.trim()}; window: ${describe(hwnd)}`);
    const pts: Array<[string, number, number]> = [["titlebar-left", 60, 18], ["sidebar", 120, 300], ["editor", 600, 300], ["center", 640, 400]];
    log("BEFORE (default):"); for (const l of sample(hwnd, pts)) log(l);

    // 1. DWM: sheet of glass + Mica (type 2) + dark/light from the page.
    const dark = await evaluate(page.webSocketDebuggerUrl, "matchMedia('(prefers-color-scheme: dark)').matches");
    const margins = new Int32Array([-1, -1, -1, -1]);
    log(`DwmExtendFrameIntoClientArea=${d.DwmExtendFrameIntoClientArea(hwnd, ptr(margins))}; immersive dark(${dark})=${dwmSet(hwnd, 20, dark ? 1 : 0)}; SYSTEMBACKDROP_TYPE=Mica(2)=${dwmSet(hwnd, 38, 2)}`);
    await sleep(800);
    log("AFTER DWM only (page still opaque):"); for (const l of sample(hwnd, pts)) log(l);

    // 2. Page: transparent default background (CDP, the probe's stand-in for the shell's WEBVIEW2_DEFAULT_BACKGROUND_COLOR) + translucent outer panels via CSS.
    log(`CDP setDefaultBackgroundColorOverride: ${JSON.stringify((await cdp(page.webSocketDebuggerUrl, "Emulation.setDefaultBackgroundColorOverride", {color: {r: 0, g: 0, b: 0, a: 0}})).error ?? "ok")}`);
    const css = "html, body, #app, .nb-workbench-page { background: transparent !important; } [data-workbench-titlebar] { background: color-mix(in srgb, var(--bg-panel) 35%, transparent) !important; }";
    await evaluate(page.webSocketDebuggerUrl, `(() => { const s = document.createElement('style'); s.id = 't17-probe'; s.textContent = ${JSON.stringify(css)}; document.head.append(s); return true; })()`);
    await sleep(1500);
    log("AFTER transparent page + translucent title bar:"); for (const l of sample(hwnd, pts)) log(l);
    if (KEEP > 0) { log(`left on screen for ${KEEP}s for the developer to look at`); await sleep(KEEP * 1000); }
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
