/**
 * 用系统的文件管理器打开应用所在机器上一个已有的目录（Skill 页的“打开 Skill 文件夹”、表情包页的“在文件夹中显示”）。不建目录：
 * 要先建的由调用方自己建；路径是不是该打开的那个（授权）也由调用方判断，这里只核对它现在是目录、不是链接。没有桌面时不尝试打开，
 * 交回 `no-desktop`，界面把路径写进通知。
 */

import {lstat, realpath, stat} from "node:fs/promises";

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

/** `revealFolder` 的结果：打开了，或说明为什么没打开的码（界面按码取文字，原因原文只进诊断）。 */
export type RevealFolderResult =
    | {readonly ok: true}
    | {readonly ok: false; readonly code: "missing" | "not-directory" | "not-accessible" | "no-desktop" | "open-failed"; readonly detail?: string};

/**
 * 打开一个由设置给出、可能是链接或还不存在的目录（首次启动向导打开作品目录，docs/specs/runtime/desktop-shell.md 输出 34）。
 * 先按真实路径解析（链接、目录别名照常认），再区分不存在（新用户的作品目录还没建，界面当作正常状态）、不是目录、无权访问。
 */
export async function revealFolder(path: string, env: Readonly<Record<string, string | undefined>>, platform: string): Promise<RevealFolderResult> {
    let resolved: string;
    try {
        resolved = await realpath(path);
        if (!(await stat(resolved)).isDirectory()) return {ok: false, code: "not-directory"};
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return {ok: false, code: "missing"};
        if (code === "ENOTDIR") return {ok: false, code: "not-directory"};
        return {ok: false, code: "not-accessible", detail: error instanceof Error ? error.message : String(error)};
    }
    if (desktopReach(env, platform) !== "yes") return {ok: false, code: "no-desktop"};
    try {
        await open(resolved);
        return {ok: true};
    } catch (error) {
        return {ok: false, code: "open-failed", detail: error instanceof Error ? error.message : String(error)};
    }
}
