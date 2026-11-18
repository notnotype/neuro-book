/**
 * 桌面快捷方式的 Windows 端口（docs/specs/runtime/desktop-shell.md 输出 33）：判定与串行在核心 `src/desktop/desktop-shortcut.ts`，
 * 这里只做一次动作。读写 `.lnk` 照 Electrobun 2.0.6 自己的做法（`createWindowsShortcutFile`、`deleteWindowsShortcutIfTargets`）
 * 用 Windows PowerShell 的 `WScript.Shell`，所以建出来的快捷方式与安装程序建的一样，卸载程序也认。
 *
 * 脚本是固定的，路径、文件名与动作经环境变量传进去，以 `-EncodedCommand`（UTF-16LE）交给 PowerShell：路径里的引号（包括 PowerShell
 * 也当作引号的弯引号）、方括号、中文都不经过脚本文本，也不经过命令行的转义。重查现状与删、建在同一条命令里，两次 PowerShell 之间
 * 没有空档；建的时候先写同目录的临时名，再用不覆盖的改名换上，同名文件已在就不动。
 */

import {execFile} from "node:child_process";
import {dirname, join} from "node:path";

import type {ShortcutAction, ShortcutPort, ShortcutResult} from "../../../src/desktop/desktop-shortcut";

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not [IO.Path]::IsPathRooted($desktop)) { 'no-desktop'; exit 0 }
$lnk = [IO.Path]::Combine($desktop, $env:NBOOK_LNK_NAME)
$target = [IO.Path]::GetFullPath($env:NBOOK_LNK_TARGET)
function Test-Ours([string]$path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }
    try { $current = (New-Object -ComObject WScript.Shell).CreateShortcut($path).TargetPath } catch { return $false }
    if ([string]::IsNullOrWhiteSpace($current)) { return $false }
    $current = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($current))
    return [string]::Equals($current, $target, [StringComparison]::OrdinalIgnoreCase)
}
$exists = Test-Path -LiteralPath $lnk
if ($env:NBOOK_LNK_ACTION -eq 'ensure-absent') {
    if (-not $exists) { 'absent'; exit 0 }
    if (-not (Test-Ours $lnk)) { 'kept-other'; exit 0 }
    Remove-Item -LiteralPath $lnk -Force
    'removed'; exit 0
}
if ($exists) { if (Test-Ours $lnk) { 'present' } else { 'kept-other' }; exit 0 }
$temporary = [IO.Path]::Combine($desktop, '.NeuroBook-' + [Guid]::NewGuid().ToString('N') + '.lnk')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($temporary)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $env:NBOOK_LNK_WORKDIR
$shortcut.IconLocation = $target
$shortcut.WindowStyle = 1
$shortcut.Save()
try {
    [IO.File]::Move($temporary, $lnk)
} catch {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $lnk) { 'kept-other'; exit 0 }
    throw
}
'created'
`;

const ENCODED = Buffer.from(SCRIPT, "utf16le").toString("base64");
const OUTCOMES = new Set(["removed", "created", "absent", "present", "kept-other"]);

/** 快捷方式的文件名：同 Electrobun 的 `windowsDisplayName`（stable 是应用名，其它频道加括号说明）。 */
export function shortcutFileName(appName: string, channel: string): string {
    const suffix = channel === "stable" ? "" : channel === "canary" ? " (Canary)" : channel === "dev" ? " (Development)" : ` (${channel})`;
    return `${appName}${suffix}.lnk`;
}

/** 安装目录里的 `launcher.exe` 与工作目录取自主进程所在的 `app\bin`（安装事实已核对过程序在那里）。 */
export function createWindowsShortcutPort(fileName: string, execPath: string): ShortcutPort {
    const bin = dirname(execPath);
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return {
        apply(action: ShortcutAction, signal: AbortSignal): Promise<ShortcutResult> {
            const env = {...process.env, NBOOK_LNK_ACTION: action, NBOOK_LNK_NAME: fileName, NBOOK_LNK_TARGET: join(bin, "launcher.exe"), NBOOK_LNK_WORKDIR: bin};
            return new Promise((resolve) => {
                execFile(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", ENCODED], {env, signal, windowsHide: true, encoding: "utf8", timeout: 30_000}, (error, stdout, stderr) => {
                    const outcome = stdout.trim().split(/\r?\n/u).at(-1) ?? "";
                    if (error === null && OUTCOMES.has(outcome)) {
                        resolve({ok: true, outcome: outcome as "removed" | "created" | "absent" | "present" | "kept-other"});
                        return;
                    }
                    const reason = error === null ? (outcome === "no-desktop" ? "the desktop folder is unavailable" : `unexpected output ${JSON.stringify(outcome)}`) : `${error.message}${stderr.trim() === "" ? "" : ` stderr=${stderr.trim().slice(0, 500)}`}`;
                    resolve({ok: false, reason});
                });
            });
        },
    };
}
