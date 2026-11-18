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

try {
    // 0. tray mode in the settings (read by the page, passed to the shell).
    writeFileSync(join(t, "state", "settings.json"), JSON.stringify({"nbook.editor/autoSave": "off", "nbook.desktop/closeLastWindow": "tray"}));
    log(`step 0 settings written: ${readText(join(t, "state", "settings.json"), "utf8").trim()}`);
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("rpc online", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    await until("tray created log", async () => logLines(/desktop\.tray\.(created|create-failed)/u)[0] ?? null, 30_000);
    log(`step 1 shell.log tray lines: ${JSON.stringify(logLines(/desktop\.tray/u))}`);
    await sleep(1500);
    log(`step 1 tray buttons (UIA, filter NeuroBook): ${JSON.stringify(await uia("list"))}`);

    // 2. Close the last window: tray mode keeps the app in the background.
    const pidsBefore = [...(await appPids())];
    await closeWindowViaPage();
    await until("window closed", async () => (await visibleWindows()).length === 0 ? true : null, 20_000);
    await sleep(2500);
    const pidsAfter = [...(await appPids())];
    log(`step 2 after closing the last window: visible windows=${(await visibleWindows()).length}, app processes before=${pidsBefore.length} after=${pidsAfter.length}, server answering=${(await fetch("http://127.0.0.1:4517/api/runtime/work").then((r) => r.status).catch(() => "no"))}`);
    log(`step 2 tray tooltip (UIA): ${JSON.stringify(await uia("list"))}`);
    log(`step 2 shell.log: ${JSON.stringify(logLines(/background|window-closed|tray/iu).slice(-6))}`);

    // 3. Tray: invoke the icon, read the menu, open NeuroBook.
    log(`step 3 tray window: ${(await trayWindow()) === null ? "none" : "found"}; click: ${await clickTray("left")}`);
    await sleep(1200);
    log(`step 3 popup windows: ${JSON.stringify(await uia("menuwin"))}`);
    log(`step 3 menu items: ${JSON.stringify(await uia("menu"))}`);
    log(`step 3 choose open: ${await chooseMenuItem(1)}`);
    await until("window reopened", async () => (await visibleWindows())[0] ?? null, 30_000);
    await sleep(1500);
    log(`step 3 after tray open: windows=${(await visibleWindows()).length} pages=${(await pages()).length}`);

    // 4. Minimized window restored by tray open.
    const win = (await visibleWindows())[0];
    u.ShowWindow(win, 6); await sleep(1000);
    log(`step 4 minimized: ${describe(win)}`);
    await clickTray("left"); await sleep(1200); await chooseMenuItem(1); await sleep(1800);
    log(`step 4 after tray open: ${describe(win)}`);

    // 5. Second launch while running in the background (start-menu reopen path): close, then launch again.
    await closeWindowViaPage();
    await until("window closed again", async () => (await visibleWindows()).length === 0 ? true : null, 20_000);
    await sleep(2000);
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    await until("window after second launch", async () => (await visibleWindows())[0] ?? null, 30_000);
    log(`step 5 second launch while in background: windows=${(await visibleWindows()).length}, shell processes=${[...(await appPids())].length}`);

    // 5b. Server killed while the app is in the background: the shell asks (restart / later) with the "no windows open" wording; restart brings the server back and the tray stays.
    await closeWindowViaPage();
    await until("window closed 2b", async () => (await visibleWindows()).length === 0 ? true : null, 20_000);
    await sleep(1500);
    const serverPid = Number(/desktop\.server\.ready pid=(\d+)/u.exec(shellLog().filter((l) => l.includes("desktop.server.ready")).at(-1) ?? "")?.[1]);
    process.kill(serverPid);
    log(`step 5b killed server pid ${serverPid}`);
    const shellPage = await until("shell dialog page", async () => (await targets()).find((x) => x.type === "page" && x.url.startsWith("views://")) ?? null, 30_000);
    await sleep(800);
    log(`step 5b dialog text: ${JSON.stringify(String(await evaluate(shellPage.webSocketDebuggerUrl, "document.body.innerText")).replace(/\s+/gu, " ").slice(0, 200))}; visible windows=${(await visibleWindows()).length}`);
    log(`step 5b tray tooltip: ${JSON.stringify(await uia("list"))}`);
    await evaluate(shellPage.webSocketDebuggerUrl, "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('重新启动服务'))?.click(); true");
    await until("server back", async () => (await fetch("http://127.0.0.1:4517/api/runtime/work").then((r) => r.status === 200).catch(() => false)) ? true : null, 60_000);
    await sleep(1500);
    log(`step 5b after restart: server answering=${await fetch("http://127.0.0.1:4517/api/runtime/work").then((r) => r.status).catch(() => "no")}, visible windows=${(await visibleWindows()).length}, tray=${JSON.stringify(await uia("list"))}`);
    log(`step 5b shell.log: ${JSON.stringify(logLines(/server\.(exited|ready|stopped)|restart/iu).slice(-4))}`);
    // The server came back with no window open: open one through the tray before the next step.
    log(`step 5b reopen via tray: ${await clickTray("left")}`);
    await sleep(800);
    log(`step 5b ${await chooseMenuItem(1)}`);
    await until("window after restart", async () => (await visibleWindows())[0] ?? null, 30_000);

    // 6. Close again, then quit from the tray (no work running -> exits).
    await closeWindowViaPage();
    await until("window closed 3", async () => (await visibleWindows()).length === 0 ? true : null, 20_000);
    await sleep(2000);
    log(`step 6 click: ${await clickTray("right")}`);
    await sleep(800);
    await sleep(1200);
    log(`step 6 choose quit: ${await chooseMenuItem(2)}`);
    await until("app gone", async () => (await appPids()).size === 0 ? true : null, 40_000);
    await sleep(1500);
    log(`step 6 after tray quit: app processes=${(await appPids()).size}, tray buttons=${JSON.stringify(await uia("list"))}`);
    log(`step 6 shell.log tail: ${JSON.stringify(logLines(/exit|tray\.removed|stopp/iu).slice(-5))}`);
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    log(`shell.log tray lines: ${JSON.stringify(logLines(/tray|background/iu).slice(-8))}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
