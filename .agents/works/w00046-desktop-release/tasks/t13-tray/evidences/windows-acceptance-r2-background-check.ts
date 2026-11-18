// w00046 t13 Windows acceptance: tray icon, background mode, tray open/quit. Standalone Bun in the desktop session.
// Reads only the NeuroBook test app's own windows and pages (CDP on its WebView2 debugging port, user32 queries on its
// windows). No screen capture, no OS mouse or keyboard input. The test state root is t18\state (own project copy).
import {dlopen, FFIType, ptr} from "bun:ffi";
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
const NT = `Add-Type -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);' -Name N -Namespace W; `;
const suspend = (pid: number) => PS(`${NT}$p=[System.Diagnostics.Process]::GetProcessById(${pid}); [W.N]::NtSuspendProcess($p.Handle)`);
const resume = (pid: number) => PS(`${NT}$p=[System.Diagnostics.Process]::GetProcessById(${pid}); [W.N]::NtResumeProcess($p.Handle)`);
const serverStatus = () => fetch("http://127.0.0.1:4517/api/runtime/work", {signal: AbortSignal.timeout(3000)}).then((r) => String(r.status)).catch(() => "no-answer");
const dialogPage = async () => (await targets()).find((x) => x.type === "page" && x.url.startsWith("views://")) ?? null;
const dialogText = async (p: {webSocketDebuggerUrl: string}) => String(await evaluate(p.webSocketDebuggerUrl, "document.body.innerText")).replace(/\s+/gu, " ").slice(0, 240);
async function cdpKey(ws: string, key: string, code: string, vk: number): Promise<void> {
    const socket = new WebSocket(ws);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    let id = 0;
    const call = (method: string, params: object) => new Promise<void>((r) => { id += 1; const mine = id; const on = (e: MessageEvent) => { if (JSON.parse(String(e.data)).id === mine) { socket.removeEventListener("message", on as any); r(); } }; socket.addEventListener("message", on as any); socket.send(JSON.stringify({id: mine, method, params})); });
    await call("Input.dispatchKeyEvent", {type: key === "Enter" ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, ...(key === "Enter" ? {text: "\r"} : {})});
    await call("Input.dispatchKeyEvent", {type: "keyUp", key, code, windowsVirtualKeyCode: vk});
    socket.close();
}
const clickButton = (ws: string, label: string) => evaluate(ws, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(label)})); if (!b) return 'no-button'; b.click(); return 'clicked'; })()`);
/** Window of the shell dialog (small window, not the product window): the visible app window whose client area is smaller than 700x500. */
async function dialogWindow(): Promise<any | null> {
    for (const w of windowsOf(await appPids())) { const r = new Int32Array(4); u.GetClientRect(w, ptr(r)); if (r[2]! < 700 && r[3]! < 500) return w; }
    return null;
}
const trayQuit = async () => { await clickTray("right"); await sleep(900); return chooseMenuItem(2); };
const serverPidNow = () => Number(/desktop\.server\.ready pid=(\d+)/u.exec(shellLog().filter((l) => l.includes("desktop.server.ready")).at(-1) ?? "")?.[1]);
const toBackground = async () => { await closeWindowViaPage(); await until("window closed", async () => (await visibleWindows()).length === 0 ? true : null, 20_000); await sleep(1500); };


const WAIT_MIN = Number(process.env.T13_WAIT_MIN ?? "30");
try {
    writeFileSync(join(t, "state", "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.desktop/closeLastWindow": "tray"}));
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("rpc online", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    await until("tray created log", async () => logLines(/desktop\.tray\.(created|create-failed)/u)[0] ?? null, 30_000);
    const pid0 = serverPidNow();
    await toBackground();
    const started = Date.now();
    log(`background since ${new Date(started).toISOString()}; server pid ${pid0}; processes=${(await appPids()).size}`);
    while (Date.now() - started < WAIT_MIN * 60_000) {
        await sleep(120_000);
        const mem = await PS(`(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*io.github.notnotype.neurobook*' } | Measure-Object WorkingSetSize -Sum).Sum / 1MB`);
        log(`t+${Math.round((Date.now() - started) / 60000)}min: server=${await serverStatus()} processes=${(await appPids()).size} windows=${(await visibleWindows()).length} workingSetMB=${mem.trim().slice(0, 8)}`);
    }
    log(`tooltip after wait: ${JSON.stringify(await uia("list"))}`);
    log(`tray click: ${await clickTray("left")}`);
    await sleep(1200);
    log(`choose open: ${await chooseMenuItem(1)}`);
    await until("window after wait", async () => (await visibleWindows())[0] ?? null, 40_000);
    const page2 = await until("product page 2", async () => (await pages())[0] ?? null, 60_000);
    await until("rpc online 2", async () => evaluate(page2.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    log(`after wait: window opened, page online; server pid same=${serverPidNow() === pid0}; shell.log restarts=${JSON.stringify(logLines(/server\.(exited|restart)/iu))}`);
    log(`tray after open tooltip: ${JSON.stringify(await uia("list"))}`);
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    log(`shell.log tail: ${JSON.stringify(shellLog().slice(-8).map((l) => l.slice(0, 200)))}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
