// w00046 t18 Windows acceptance: minimum window size, window buttons, back to bookshelf. Standalone Bun in the desktop session.
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

try {
    Bun.spawn(["cmd", "/c", join(t, "launch.cmd")], {stdout: "ignore", stderr: "ignore"});
    // 1. 启动页阶段：第一个窗口出现就读一次（此刻多半还在启动页，不应登记）。
    const first = await until("first window", async () => windowsOf(await appPids())[0] ?? null, 60_000);
    const early = (await pages()).length;
    log(`startup phase (product pages=${early}): ${describe(first)}`);
    const page = await until("product page", async () => (await pages())[0] ?? null, 120_000);
    await until("workbench ready", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-workbench-root]')?.getAttribute('data-rpc-state') === 'online' || document.querySelector('[data-bookshelf-page]') !== null"), 60_000);
    await sleep(1000);
    // 2. 首个窗口（启动页换成产品页）。
    log(`first window as product page: ${describe(first)}`);
    // 3. 最大化、最小化、还原。
    u.ShowWindow(first, 3); await sleep(1500);
    log(`maximized: ${describe(first)}`);
    u.ShowWindow(first, 9); await sleep(1200);
    u.ShowWindow(first, 6); await sleep(1200);
    log(`minimized: ${describe(first)}`);
    u.ShowWindow(first, 9); await sleep(1200);
    log(`restored: ${describe(first)}`);
    // 4. 第二个产品窗口（页面 window.open，壳开新的产品窗口）。
    const before = new Set(windowsOf(await appPids()).map(String));
    await evaluate(page.webSocketDebuggerUrl, "window.open(location.href, '_blank'); true");
    const second = await until("second window", async () => windowsOf(await appPids()).find((h) => !before.has(String(h))) ?? null, 60_000);
    await until("second page", async () => (await pages()).length >= 2, 60_000);
    await sleep(1500);
    log(`second window: ${describe(second)}`);
    // 5. 关掉第二个，再开一个。
    const secondPage = (await pages()).find((p) => p.webSocketDebuggerUrl !== page.webSocketDebuggerUrl)!;
    await evaluate(secondPage.webSocketDebuggerUrl, "document.querySelector('[data-desktop-control=close]').click(); true");
    await until("second closed", async () => (await pages()).length === 1, 60_000);
    const before2 = new Set(windowsOf(await appPids()).map(String));
    await evaluate(page.webSocketDebuggerUrl, "window.open(location.href, '_blank'); true");
    const third = await until("third window", async () => windowsOf(await appPids()).find((h) => !before2.has(String(h))) ?? null, 60_000);
    await until("third page", async () => (await pages()).length >= 2, 60_000);
    await sleep(1500);
    log(`window opened after closing one: ${describe(third)}`);
    const thirdPage = (await pages()).find((p) => p.webSocketDebuggerUrl !== page.webSocketDebuggerUrl)!;
    await evaluate(thirdPage.webSocketDebuggerUrl, "document.querySelector('[data-desktop-control=close]').click(); true");
    await until("third closed", async () => (await pages()).length === 1, 60_000);
    // 6. 窗口按钮与标志在页面里的几何（样子另用 PrintWindow 拍）。
    log(`page: ${JSON.stringify(await evaluate(page.webSocketDebuggerUrl, `(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return {controls: r('[data-desktop-controls]'), close: r('[data-desktop-control=close]'), brand: r('[data-titlebar-brand]'), brandIsButton: document.querySelector('[data-titlebar-brand]')?.tagName, innerWidth, innerHeight}; })()`))}`);
    // 7. 改了文件不保存、点标志回书架：WebView2 是否弹出离开询问。
    // The app now starts on the bookshelf (no project auto-open): open the test book first (one click on its card navigates to ?project=book).
    if (await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-bookshelf-page]') !== null")) {
        await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-book-card]')?.click(); true").catch(() => undefined);
        await sleep(3000);
        await until("workbench of the book", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-explorer-row]') !== null").catch(() => false), 60_000);
        log("opened the test book from the bookshelf");
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => socket.addEventListener("open", r, {once: true}));
    let nextId = 1;
    const dialogs: any[] = [];
    const call = (method: string, params: unknown = {}) => new Promise<any>((resolve) => { const id = nextId++; const onMessage = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.method === "Page.javascriptDialogOpening") dialogs.push(m.params); if (m.id === id) { socket.removeEventListener("message", onMessage); resolve(m); } }; socket.addEventListener("message", onMessage); socket.send(JSON.stringify({id, method, params})); });
    socket.addEventListener("message", (e) => { const m = JSON.parse(String(e.data)); if (m.method === "Page.javascriptDialogOpening" && !dialogs.includes(m.params)) dialogs.push(m.params); });
    await call("Page.enable");
    // Expand notes (twisty) until a.md is listed, then double-click it.
    await until("a.md row", async () => {
        await call("Runtime.evaluate", {expression: "(() => { if (!document.querySelector('[data-explorer-row=\"project://notes/a.md\"]')) document.querySelector('[data-explorer-row=\"project://notes\"] [data-explorer-twisty]')?.click(); return true; })()"});
        await sleep(700);
        return evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-explorer-row=\"project://notes/a.md\"]') !== null");
    }, 30_000);
    await call("Runtime.evaluate", {expression: "document.querySelector('[data-explorer-row=\"project://notes/a.md\"]')?.dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); true"});
    await until("editor open", async () => evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-editor-tab-label]')?.textContent?.includes('a.md') ?? false"), 20_000);
    await sleep(1000);
    await call("Runtime.evaluate", {expression: "(() => { const el = document.querySelector('[data-editor-group] [contenteditable=true], [data-editor-group] textarea'); el?.focus(); return el !== null; })()"});
    await call("Input.insertText", {text: "unsaved "});
    await sleep(800);
    const dirty = await evaluate(page.webSocketDebuggerUrl, "document.querySelector('[data-editor-tab][aria-selected=\"true\"]')?.outerHTML.slice(0, 300)");
    log(`editor tab after typing: ${String(dirty).replace(/\s+/gu, " ")}`);
    // The click may open a beforeunload prompt, which holds this evaluate until the prompt is handled: do not wait for it.
    void call("Runtime.evaluate", {expression: "document.querySelector('button[data-titlebar-brand]').click(); true"});
    await sleep(3000);
    // A beforeunload prompt blocks Runtime.evaluate on the page until it is handled, so handle the dialogs first and read the url only with a deadline.
    const withDeadline = <T,>(promise: Promise<T>, fallback: T) => Promise.race([promise, new Promise<T>((r) => setTimeout(() => r(fallback), 4000))]);
    log(`after clicking the brand with unsaved text: dialogs=${JSON.stringify(dialogs.map((d) => [d.type, d.message]))}`);
    for (const _ of [...dialogs]) await withDeadline(call("Page.handleJavaScriptDialog", {accept: false}), null);
    await sleep(1000);
    log(`after cancelling: url=${await withDeadline(evaluate(page.webSocketDebuggerUrl, "location.href"), "(no answer in 4 s)")}`);
    socket.close();
    // 8. 壳日志里的最小尺寸诊断。
    const shellLog = readFileSync(join(t, "state", "logs", "desktop", "shell.log"), "utf8").split(/\r?\n/u).filter((l) => l.includes("min-size") || l.includes("adopt-failed"));
    log(`shell.log min-size lines: ${shellLog.length === 0 ? "(none)" : shellLog.slice(-3).join(" | ")}`);
    log("RESULT ok");
} catch (error) {
    log(`RESULT failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
    await Bun.write(outFile, lines.join("\n") + "\n");
}
