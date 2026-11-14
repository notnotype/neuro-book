/**
 * 桌面壳用哪个状态根（docs/specs/runtime/desktop-shell.md 的“输入与前置条件”与输出 24）：环境变量 `NBOOK_STATE_ROOT`、
 * 便携标记、`nbook` 的平台缺省，取第一个，规范成绝对路径后这次运行一直用它。便携版要求程序根目录可写：写不了时不改用
 * 安装版的状态根，交回错误由启动页说明。
 */

import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {defaultStateRoot} from "../cli/state-root";

/** 便携包根目录里的标记文件，只由发布流程打便携包时写入。 */
export const PORTABLE_MARKER = "NeuroBook.portable";

export interface DesktopStateRootInput {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** 壳进程的工作目录：相对的 `NBOOK_STATE_ROOT` 按它解析。 */
    readonly cwd: string;
    /** 程序根目录：便携包解压出来的那一层，便携标记与 `data\` 都在这里。 */
    readonly programRoot: string;
    readonly platform: NodeJS.Platform;
    readonly home: string;
}

export type DesktopStateRoot =
    | {readonly ok: true; readonly stateRoot: string; readonly portable: boolean; readonly source: "env" | "portable" | "default"}
    | {readonly ok: false; readonly reason: "portable-unwritable"; readonly path: string; readonly detail: string};

export async function resolveDesktopStateRoot(input: DesktopStateRootInput): Promise<DesktopStateRoot> {
    const fromEnv = input.env.NBOOK_STATE_ROOT?.trim();
    const portable = existsSync(join(input.programRoot, PORTABLE_MARKER));
    if (fromEnv) return {ok: true, stateRoot: resolve(input.cwd, fromEnv), portable, source: "env"};
    if (portable) {
        const stateRoot = join(input.programRoot, "data");
        // 真写一次才知道：只读介质、没有权限、被同步盘锁住，单看权限位都看不准。
        const probe = join(stateRoot, `.write-probe-${randomUUID()}`);
        try {
            await mkdir(stateRoot, {recursive: true});
            await writeFile(probe, "");
            await rm(probe, {force: true});
        } catch (error) {
            return {ok: false, reason: "portable-unwritable", path: stateRoot, detail: error instanceof Error ? error.message : String(error)};
        }
        return {ok: true, stateRoot, portable, source: "portable"};
    }
    return {ok: true, stateRoot: defaultStateRoot(input.platform, input.env, input.home), portable: false, source: "default"};
}
