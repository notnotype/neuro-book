/**
 * Skill 页的“打开 Skill 文件夹”（docs/specs/agent/skills.md 输出 25）：在应用所在的机器上用系统的文件管理器打开用户的 Skill 文件夹，
 * 还没有就先建。打开本身见 `nbook/backend/open-folder`。
 */

import {mkdir} from "node:fs/promises";

import {openExistingFolder} from "nbook/backend/open-folder";
import type {OpenFolderResult} from "nbook/backend/open-folder";

export type {OpenFolderResult};

export async function openFolder(path: string, env: Readonly<Record<string, string | undefined>>, platform: string): Promise<OpenFolderResult> {
    await mkdir(path, {recursive: true});
    return openExistingFolder(path, env, platform);
}
