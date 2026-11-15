/**
 * 开机自启的登记（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下
 * 以应用标识为值名的一项，值是安装目录里 launcher.exe 的命令行。该不该写由核心的 `loginItemPlan` 判断，这里只读写注册表，经
 * `reg`（壳查 WebView2 也这样做）。不是 Windows 时什么都不做。
 */

import {spawnSync} from "node:child_process";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** 这个值名现在登记的命令；没有为 null。查询失败（没有这个值以外的错误）时交回原因。 */
export function readLoginItem(name: string): {readonly command: string | null; readonly problem: string | null} {
    if (process.platform !== "win32") return {command: null, problem: null};
    const result = spawnSync("reg", ["query", RUN_KEY, "/v", name], {encoding: "utf8", windowsHide: true});
    if (result.status !== 0) return {command: null, problem: null};
    // 一行是“    <值名>    REG_SZ    <命令>”：值名里可能有点，命令里可能有空格，所以按 REG_SZ 切。
    const line = result.stdout.split(/\r?\n/u).find((entry) => entry.includes("REG_SZ"));
    const command = line === undefined ? null : line.slice(line.indexOf("REG_SZ") + "REG_SZ".length).trim();
    return command === null ? {command: null, problem: `unexpected reg output for ${name}`} : {command, problem: null};
}

/** 写或删；失败时交回原因（stderr 的文字只进日志）。 */
export function changeLoginItem(name: string, command: string | null): string | null {
    if (process.platform !== "win32") return null;
    const args = command === null ? ["delete", RUN_KEY, "/v", name, "/f"] : ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", command, "/f"];
    const result = spawnSync("reg", args, {encoding: "utf8", windowsHide: true});
    return result.status === 0 ? null : `reg ${args[0]!} exited ${String(result.status)}: ${result.stderr.trim()}`;
}
