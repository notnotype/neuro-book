/**
 * Windows 冒烟的操作系统一侧：进程、关窗、UI 自动化读文字、注册表、调试端口上的页面、本机更新源、证据。只在 Windows 上用。
 *
 * 几个约束（w00046 t11 计划的 Windows 冒烟两节与切片 1 的探针 evidences/cdp-probe-r1.txt）：
 * - 关窗用 `PostMessageW(WM_CLOSE)`，与用户点关闭走同一条路（关闭前询问、有序停止）；窗口枚举只在登录的桌面会话里有效，
 *   所以整个冒烟要在桌面会话里跑（GitHub 的 windows runner 本来就是；本机经计划任务放进去）。
 * - 页面经 WebView2 的远程调试端口驱动（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 由启动器一路传给 WebView2）。更新器拉起的新版本
 *   不带这个环境变量，那一次只能用 UI 自动化读窗口里的文字。
 * - 只读产品自己的窗口与页面；截图只截 WebView 页面本身，不截屏幕。
 */

import {dlopen, FFIType, JSCallback, type Pointer} from "bun:ffi";
import {appendFileSync, existsSync} from "node:fs";
import {cp, mkdir, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {chromium, type Browser, type Page} from "@playwright/test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

export class SmokeFailure extends Error {}

export type RunResult = {code: number; stdout: string; stderr: string};

export async function run(argv: readonly string[], options: {cwd?: string; env?: Record<string, string | undefined>} = {}): Promise<RunResult> {
    const child = Bun.spawn([...argv], {cwd: options.cwd, env: options.env, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

/** 跑一段 PowerShell，交回 stdout；失败时抛出。脚本经 `-EncodedCommand` 传（UTF-16LE 的 base64），不经引号转义。 */
export async function powershell(script: string): Promise<string> {
    const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`, "utf16le").toString("base64");
    const result = await run(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
    if (result.code !== 0) throw new SmokeFailure(`PowerShell 失败（退出码 ${String(result.code)}）：${result.stderr.trim()}`);
    return result.stdout;
}

/** PowerShell 的 `ConvertTo-Json` 对一项输出对象、对零项输出空：统一成数组。 */
function jsonList<T>(text: string): T[] {
    if (text.trim() === "") return [];
    const value = JSON.parse(text) as T | T[];
    return Array.isArray(value) ? value : [value];
}

export type ProcessInfo = {pid: number; ppid: number; name: string; path: string | null};

export async function processes(): Promise<ProcessInfo[]> {
    const text = await powershell("Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=$_.Name; path=$_.ExecutablePath} } | ConvertTo-Json -Compress");
    return jsonList<ProcessInfo>(text);
}

/** 可执行文件在 `dir` 下的进程（安装目录或便携目录里的启动器、壳与随包的 Bun）。 */
export async function processesUnder(dir: string): Promise<ProcessInfo[]> {
    const prefix = `${dir.replace(/[\\/]+$/u, "")}\\`.toLowerCase();
    return (await processes()).filter((entry) => entry.path !== null && entry.path.toLowerCase().startsWith(prefix));
}

/** 结束进程树（收尾用，不是被测的关闭路径）。 */
export async function killTree(pid: number): Promise<void> {
    await run(["taskkill", "/PID", String(pid), "/T", "/F"]);
}

const WM_CLOSE = 0x0010;

/** 给这些进程的可见顶层窗口发 `WM_CLOSE`，交回发出的个数。 */
export function postClose(pids: readonly number[]): number {
    const owners = new Set(pids);
    const user32 = dlopen("user32.dll", {
        EnumWindows: {args: [FFIType.function, FFIType.i64], returns: FFIType.i32},
        GetWindowThreadProcessId: {args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32},
        IsWindowVisible: {args: [FFIType.ptr], returns: FFIType.i32},
        PostMessageW: {args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32},
    });
    const found: Pointer[] = [];
    const owner = new Uint32Array(1);
    const callback = new JSCallback((hwnd: Pointer) => {
        user32.symbols.GetWindowThreadProcessId(hwnd, owner);
        if (owners.has(owner[0]!) && user32.symbols.IsWindowVisible(hwnd) !== 0) found.push(hwnd);
        return 1;
    }, {args: [FFIType.ptr, FFIType.i64], returns: FFIType.i32});
    try {
        user32.symbols.EnumWindows(callback, 0);
        for (const hwnd of found) user32.symbols.PostMessageW(hwnd, WM_CLOSE, 0, 0);
    } finally {
        callback.close();
        user32.close();
    }
    return found.length;
}

export type WindowTexts = {pid: number; title: string; texts: string[]};

/** UI 自动化读这些进程的顶层窗口里的按钮与文字（WebView2 把页面的可访问树交给 UI 自动化）。不截屏。 */
export async function windowTexts(pids: readonly number[]): Promise<WindowTexts[]> {
    if (pids.length === 0) return [];
    const text = await powershell(`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$pids = @(${pids.join(",")})
$root = [Windows.Automation.AutomationElement]::RootElement
$out = @()
foreach ($win in $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)) {
  if ($pids -notcontains $win.Current.ProcessId) { continue }
  $texts = @()
  foreach ($e in $win.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) { if ($e.Current.Name) { $texts += $e.Current.Name } }
  $out += [pscustomobject]@{pid=[int]$win.Current.ProcessId; title=$win.Current.Name; texts=$texts}
}
ConvertTo-Json -Compress -Depth 4 -InputObject @($out)`);
    return jsonList<WindowTexts>(text);
}

/** 安装器登记的卸载项（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<标识>.stable`，t01 runner 探针）。没装时为 null。 */
export async function uninstallEntry(identifier: string): Promise<{uninstallString: string; displayName: string} | null> {
    const text = await powershell(`$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${identifier}.stable'
if (Test-Path $k) { $p = Get-ItemProperty $k; [pscustomobject]@{uninstallString=$p.UninstallString; displayName=$p.DisplayName} | ConvertTo-Json -Compress }`);
    return text.trim() === "" ? null : (JSON.parse(text) as {uninstallString: string; displayName: string});
}

/** `UninstallString` 拆成程序与参数：程序可能带引号。 */
export function splitCommand(command: string): string[] {
    const parts = command.match(/"[^"]*"|\S+/gu) ?? [];
    return parts.map((part) => part.replace(/^"|"$/gu, ""));
}

export const localAppData = (): string => {
    const value = process.env.LOCALAPPDATA;
    if (value === undefined || value === "") throw new SmokeFailure("没有 LOCALAPPDATA：这个冒烟只在 Windows 上跑");
    return value;
};
/** 通道根：安装版装在它的 `app\` 下，更新状态与安装锁也在这里（desktop-shell、desktop-update 的“输入与前置条件”）。 */
export const channelRoot = (identifier: string): string => join(localAppData(), identifier, "stable");
/** `runtime.cli` 的平台缺省状态根，与 `nbook` 共用。 */
export const defaultStateRoot = (): string => join(localAppData(), "NeuroBook");

/** 起启动器（不等它）。`env` 整份替换子进程环境。 */
export function launch(exe: string, env: Record<string, string | undefined>): number {
    const child = Bun.spawn([exe], {env, stdin: "ignore", stdout: "ignore", stderr: "ignore"});
    child.unref();
    return child.pid;
}

/** 本机一个空闲端口。 */
export function freePort(): number {
    const server = Bun.listen({hostname: "127.0.0.1", port: 0, socket: {data() {}}});
    const port = server.port;
    server.stop(true);
    return port;
}

/** 等一个可观察的状态（`waitUntil`），冒烟里的时长都是秒级，间隔缺省 500 毫秒。 */
export function waitFor<T>(label: string, probe: () => T | Promise<T>, timeoutMs: number, intervalMs = 500): ReturnType<typeof waitUntil<T>> {
    return waitUntil(label, probe, {timeoutMs, intervalMs});
}

/** 经调试端口连上产品页面（`http://127.0.0.1:<端口>/` 的那个，不是启动页）。 */
export async function connectPage(port: number, timeoutMs = 120_000): Promise<{browser: Browser; page: Page}> {
    const browser = await waitFor("WebView2 的调试端口起来", async () => {
        try {
            return await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`, {timeout: 5_000});
        } catch {
            return null;
        }
    }, timeoutMs, 1_000);
    const page = await waitFor("产品页面出现", () => browser.contexts().flatMap((context) => context.pages()).find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//u.test(candidate.url())) ?? null, timeoutMs, 500);
    return {browser, page};
}

/**
 * 本机静态更新源：与 GitHub Release 的下载地址同样的平铺布局（t10 的 `t10-serve.ts` 同一种写法）。每个请求记一行进 `log`：
 * `<时间> <方法> <路径与查询串> <状态> <字节>`。`serve(dir)` 换成另一个目录（换源）。
 */
export function feedServer(port: number, log: string): {serve(dir: string): void; stop(): void} {
    let root: string | null = null;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(request) {
            const url = new URL(request.url);
            const name = decodeURIComponent(url.pathname.slice(1));
            const file = root !== null && name !== "" && !/[\\/]|\.\./u.test(name) ? Bun.file(join(root, name)) : null;
            const exists = file !== null && (await file.exists());
            appendFileSync(log, `${new Date().toISOString()} ${request.method} ${url.pathname}${url.search} ${exists ? 200 : 404} ${exists ? file.size : 0}\n`);
            return exists ? new Response(file) : new Response("not found", {status: 404});
        },
    });
    return {
        serve(dir) {
            root = dir;
            appendFileSync(log, `${new Date().toISOString()} serve ${dir}\n`);
        },
        stop: () => void server.stop(true),
    };
}

/** 失败时也要留下的东西：复制存在的文件与目录，写进程列表。复制失败只记下，不遮掉原始错误。 */
export async function collectEvidence(target: string, sources: Readonly<Record<string, string>>): Promise<void> {
    await mkdir(target, {recursive: true});
    const notes: string[] = [];
    for (const [name, source] of Object.entries(sources)) {
        if (!existsSync(source)) {
            notes.push(`${name}: 不在（${source}）`);
            continue;
        }
        try {
            await cp(source, join(target, name), {recursive: true});
            notes.push(`${name}: ${source}`);
        } catch (error) {
            notes.push(`${name}: 复制失败 ${(error as Error).message}`);
        }
    }
    try {
        await writeFile(join(target, "processes.json"), `${JSON.stringify(await processes(), null, 2)}\n`);
    } catch (error) {
        notes.push(`processes.json: ${(error as Error).message}`);
    }
    await writeFile(join(target, "sources.txt"), `${notes.join("\n")}\n`);
}

/** 通道根下更新器的结果文件（Electrobun 2.0.6 的 `.electrobun-update-*.result.json`）。 */
export async function updaterResultFiles(root: string): Promise<string[]> {
    if (!existsSync(root)) return [];
    return (await readdir(root)).filter((name) => /^\.electrobun-update-.*\.result\.json$/u.test(name)).map((name) => join(root, name));
}
