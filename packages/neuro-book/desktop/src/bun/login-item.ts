/**
 * 开机自启的登记（docs/specs/runtime/desktop-shell.md 输出 27）：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下以应用标识
 * 为值名的一项。该不该写由核心的 `loginItemPlan` 判断，解析在核心的 `login-item.ts`；这里只经 `reg` 读写（壳查 WebView2 也这样）。
 * 不是 Windows 时什么都不做。
 */

import {spawnSync} from "node:child_process";

import {runValueOf} from "../../../src/desktop/login-item";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** 这个值名现在登记的命令；没有为 null。查询本身失败时交回原因，调用方不能把它当成“没有登记”。 */
export function readLoginItem(name: string): {readonly command: string | null; readonly problem: string | null} {
    if (process.platform !== "win32") return {command: null, problem: null};
    const result = spawnSync("reg", ["query", RUN_KEY], {encoding: "utf8", windowsHide: true});
    if (result.error !== undefined) return {command: null, problem: `reg query failed to start: ${result.error.message}`};
    if (result.status !== 0) return {command: null, problem: `reg query exited ${String(result.status)}: ${result.stderr.trim()}`};
    return {command: runValueOf(result.stdout, name), problem: null};
}

/** 写或删；失败时交回原因（stderr 的文字只进日志）。 */
export function changeLoginItem(name: string, command: string | null): string | null {
    if (process.platform !== "win32") return null;
    const args = command === null ? ["delete", RUN_KEY, "/v", name, "/f"] : ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", command, "/f"];
    const result = spawnSync("reg", args, {encoding: "utf8", windowsHide: true});
    if (result.error !== undefined) return `reg ${args[0]!} failed to start: ${result.error.message}`;
    return result.status === 0 ? null : `reg ${args[0]!} exited ${String(result.status)}: ${result.stderr.trim()}`;
}
