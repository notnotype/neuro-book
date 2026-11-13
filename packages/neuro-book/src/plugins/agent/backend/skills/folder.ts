/**
 * Skill 页的“打开 Skill 文件夹”（docs/specs/agent/skills.md 输出 25）：在应用所在的机器上用系统的文件管理器打开用户的 Skill 文件夹，
 * 还没有就先建。没有桌面时不尝试打开，交回 `no-desktop`，界面把路径写进通知。
 */

import {mkdir} from "node:fs/promises";

import open from "open";

import {desktopReach} from "nbook/shared/desktop";

export type OpenFolderResult = {readonly ok: true} | {readonly ok: false; readonly code: "no-desktop" | "open-failed"; readonly detail?: string};

export async function openFolder(path: string, env: Readonly<Record<string, string | undefined>>, platform: string): Promise<OpenFolderResult> {
    await mkdir(path, {recursive: true});
    if (desktopReach(env, platform) !== "yes") return {ok: false, code: "no-desktop"};
    try {
        await open(path);
        return {ok: true};
    } catch (error) {
        return {ok: false, code: "open-failed", detail: error instanceof Error ? error.message : String(error)};
    }
}
