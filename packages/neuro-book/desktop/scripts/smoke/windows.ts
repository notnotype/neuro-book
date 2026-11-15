/**
 * Windows 冒烟的操作系统一侧：进程、关窗、UI 自动化读文字、注册表、调试端口上的页面、证据。只在 Windows 上用。本机更新源在 `feed.ts`。
 *
 * 几个约束（w00046 t11 计划的 Windows 冒烟两节与切片 1 的探针 evidences/cdp-probe-r1.txt）：
 * - 关窗用 `PostMessageW(WM_CLOSE)`，与用户点关闭走同一条路（关闭前询问、有序停止）；窗口枚举只在登录的桌面会话里有效，
 *   所以整个冒烟要在桌面会话里跑（GitHub 的 windows runner 本来就是；本机经计划任务放进去）。
 * - 页面经 WebView2 的远程调试端口驱动（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 由启动器一路传给 WebView2）。更新器拉起的新版本
 *   不带这个环境变量，那一次只能用 UI 自动化读窗口里的文字。
 * - 只读产品自己的窗口与页面；截图只截 WebView 页面本身，不截屏幕。
 */

import {dlopen, FFIType, JSCallback, type Pointer} from "bun:ffi";
import {existsSync} from "node:fs";
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

/** 嵌进 PowerShell 源码的字符串字面量（单引号，内部的 `'` 写成 `''`）：路径与标识来自命令行，不能让它们改变脚本。 */
function psLiteral(value: string): string {
    return `'${value.replace(/'/gu, "''")}'`;
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

/**
 * 在一个 PowerShell 进程里反复用 UI 自动化读 `dir` 下的进程的顶层窗口（WebView2 把页面的可访问树交给 UI 自动化），
 * 读到含 `needle` 的文字就交回它；到 `timeoutMs` 没读到交回 null。不截屏。
 * 一个进程里循环而不是每次起一个：一次性的通知只停 3.2 秒（nb-ui 的 success 缺省时长），每次起 PowerShell 来不及。
 */
export async function watchWindowText(dir: string, needle: string, timeoutMs: number): Promise<string | null> {
    const text = await powershell(`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$dir = ${psLiteral(`${dir.replace(/[\\/]+$/u, "")}\\`)}
$needle = ${psLiteral(needle)}
$deadline = (Get-Date).AddMilliseconds(${String(timeoutMs)})
$root = [Windows.Automation.AutomationElement]::RootElement
while ((Get-Date) -lt $deadline) {
  $pids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [int]$_.ProcessId })
  foreach ($win in $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)) {
    if ($pids -notcontains $win.Current.ProcessId) { continue }
    foreach ($e in $win.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) {
      $name = $e.Current.Name
      if ($name -and $name.Contains($needle)) { $name; exit 0 }
    }
  }
  Start-Sleep -Milliseconds 200
}`);
    const found = text.trim();
    return found === "" ? null : found;
}

/** 安装器登记的卸载项（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<标识>.stable`，t01 runner 探针）。没装时为 null。 */
export async function uninstallEntry(identifier: string): Promise<{uninstallString: string; displayName: string} | null> {
    const text = await powershell(`$k = ${psLiteral(`HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${identifier}.stable`)}
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
export async function connectPage(port: number, webViewData: string, timeoutMs = 120_000): Promise<{browser: Browser; page: Page}> {
    let browser: Browser;
    try {
        browser = await waitFor("WebView2 的调试端口起来", async () => {
            try {
                return await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`, {timeout: 5_000});
            } catch {
                return null;
            }
        }, timeoutMs, 1_000);
    } catch (error) {
        // 端口没起来时，看这份浏览器数据的 WebView2 进程带没带调试端口：没带说明复用了一个先前起来的浏览器进程。
        const running = await webViewProcesses(webViewData).catch((failure: unknown) => [{pid: 0, commandLine: `（读不到：${String(failure)}）`}]);
        const lines = running.map((entry) => `${String(entry.pid)} ${entry.commandLine.includes("--remote-debugging-port") ? "带调试端口" : "不带调试端口"}：${entry.commandLine.slice(0, 400)}`);
        const policies = await webView2Policies().catch((failure: unknown) => `（读不到：${String(failure)}）`);
        throw new SmokeFailure(`${error instanceof Error ? error.message : String(error)}；端口 ${String(port)}；${webViewData} 的 WebView2 进程：${lines.length === 0 ? "没有" : lines.join(" | ")}；WebView2 的注册表策略：${policies}`);
    }
    const page = await waitFor("产品页面出现", () => browser.contexts().flatMap((context) => context.pages()).find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//u.test(candidate.url())) ?? null, timeoutMs, 500);
    return {browser, page};
}

const WEBVIEW2_POLICY = "HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments";

/**
 * WebView2 附加参数的注册表策略（当前用户，按宿主程序名，值为 null 时删掉）。WebView2 在没有环境变量
 * `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 时读它（CreateCoreWebView2EnvironmentWithOptions 的说明）。只给一次性的 CI 机器用：
 * 它对这个用户下所有同名宿主程序都生效，开发机上不写。
 */
export async function setWebView2PolicyArgs(exeName: string, args: string | null): Promise<void> {
    const result = args === null ? await run(["reg", "delete", WEBVIEW2_POLICY, "/v", exeName, "/f"]) : await run(["reg", "add", WEBVIEW2_POLICY, "/v", exeName, "/t", "REG_SZ", "/d", args, "/f"]);
    // 删一个本来就没有的值不算失败。
    if (result.code !== 0 && args !== null) throw new SmokeFailure(`写 WebView2 的注册表策略失败：${result.stderr.trim()}`);
}

/** 注册表里 WebView2 的策略（排查调试端口没起来时用）。 */
export async function webView2Policies(): Promise<string> {
    const results = await Promise.all(["HKCU", "HKLM"].map((root) => run(["reg", "query", `${root}\\Software\\Policies\\Microsoft\\Edge\\WebView2`, "/s"])));
    return results.map((result) => result.stdout.trim()).filter((text) => text !== "").join(" | ") || "没有";
}

export type WebViewProcess = {pid: number; commandLine: string};

/** 用 `userDataDir` 这份浏览器数据的 WebView2 进程（`msedgewebview2.exe`，命令行里带这个目录）。它们不在应用的安装目录下。 */
export async function webViewProcesses(userDataDir: string): Promise<WebViewProcess[]> {
    const text = await powershell(`$dir = ${psLiteral(userDataDir)}
Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId; commandLine=[string]$_.CommandLine} } | ConvertTo-Json -Compress`);
    return jsonList<WebViewProcess>(text);
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
