/**
 * 用系统的文件管理器打开应用所在机器上一个已有的目录（Skill 页的“打开 Skill 文件夹”、表情包页的“在文件夹中显示”）。不建目录：
 * 要先建的由调用方自己建；路径是不是该打开的那个（授权）也由调用方判断，这里只核对它现在是目录、不是链接。没有桌面时不尝试打开，
 * 交回 `no-desktop`，界面把路径写进通知。
 */

import {lstat} from "node:fs/promises";

import open from "open";

import {desktopReach} from "nbook/shared/desktop";

export type OpenFolderResult = {readonly ok: true} | {readonly ok: false; readonly code: "no-desktop" | "open-failed"; readonly detail?: string};

export async function openExistingFolder(path: string, env: Readonly<Record<string, string | undefined>>, platform: string): Promise<OpenFolderResult> {
    const info = await lstat(path).catch(() => null);
    if (info === null || !info.isDirectory()) return {ok: false, code: "open-failed", detail: info === null ? "文件夹不在" : "不是文件夹"};
    if (desktopReach(env, platform) !== "yes") return {ok: false, code: "no-desktop"};
    try {
        await open(path);
        return {ok: true};
    } catch (error) {
        return {ok: false, code: "open-failed", detail: error instanceof Error ? error.message : String(error)};
    }
}
