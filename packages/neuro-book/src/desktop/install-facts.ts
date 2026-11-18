/**
 * 这次运行算不算安装版（docs/specs/runtime/desktop-shell.md 输出 34 的“安装事实”）。开机自启（输出 27）、桌面快捷方式（输出 33）
 * 与首次启动向导都按这一个判据，壳启动时算一次。
 *
 * 不能只看更新器算不算得出通道根：Electrobun 2.0.6 对开发构建也会按 `version.json` 推出一个 dev 通道根，在 Windows 上也只比
 * 可执行文件所在目录的上上级是不是标识目录（`Updater.ts` 的 `resolveInstalledChannelRootForPlatform`）。所以另外核对频道、
 * 便携标记，以及程序是不是正好在通道根的 `app\bin` 里（安装程序把应用放在那里，主进程 `bun.exe` 与 `launcher.exe` 同在）。
 */

import {posix, win32} from "node:path";

export interface InstallRun {
    /** 版本信息里的发布频道；开发构建是 `dev`。 */
    readonly channel: string;
    /** 程序根目录里有便携标记。 */
    readonly portable: boolean;
    /** 更新器给的通道根；取不到为 null。 */
    readonly channelRoot: string | null;
    /** 主进程的可执行文件（`process.execPath`）。 */
    readonly execPath: string;
    readonly platform: string;
}

export function isInstalledRun(run: InstallRun): boolean {
    if (run.channel === "" || run.channel === "dev" || run.portable || run.channelRoot === null) return false;
    const path = run.platform === "win32" ? win32 : posix;
    const expected = path.resolve(run.channelRoot, "app", "bin");
    const actual = path.resolve(path.dirname(run.execPath));
    // Windows 的路径不分大小写；别的平台照原样比。
    return run.platform === "win32" ? expected.toLowerCase() === actual.toLowerCase() : expected === actual;
}
