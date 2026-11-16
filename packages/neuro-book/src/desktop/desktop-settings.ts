/**
 * 壳这一侧的桌面专属设置（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）。设置的拥有者是服务端的 `nbook.settings`，值由
 * 页面交来（`desktop-settings` 消息）；壳只把最后收到的值存成缓存，用途只有一个：下次启动时，在页面交来值之前先用上次的缩放。
 * 缓存不是设置：读不到、坏了、形状不对都按缺省，页面就绪后按页面交来的值纠正。
 */

import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

import {Value} from "typebox/value";

import {DesktopSettingValuesSchema} from "../shared/desktop-bridge";
import type {DesktopSettingValues} from "../shared/desktop-bridge";

/** 页面还没交来值、也没有缓存时用的值，与 `nbook.desktop` 各项的缺省一致。 */
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettingValues = Object.freeze({zoom: 1, openAtLogin: false});

/** 读缓存：没有时 `values` 为 null；读不了或内容不合法时也为 null，并交回原因（壳写日志）。 */
export async function readDesktopSettingsCache(file: string): Promise<{readonly values: DesktopSettingValues | null; readonly problem: string | null}> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {values: null, problem: null};
        return {values: null, problem: `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`};
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (Value.Check(DesktopSettingValuesSchema, parsed)) return {values: parsed, problem: null};
        return {values: null, problem: `${file} does not hold desktop settings`};
    } catch (error) {
        return {values: null, problem: `${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`};
    }
}

/** 写一次缓存：先写临时文件再改名，中途退出不留下半份。同一个文件的写入要经 `createDesktopSettingsCacheWriter` 串行。 */
export async function writeDesktopSettingsCache(file: string, values: DesktopSettingValues): Promise<void> {
    await mkdir(dirname(file), {recursive: true});
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(values)}\n`);
    await rename(temporary, file);
}

/**
 * 缓存的写入者：按到达顺序一次写一份，最后一次的值最后落盘。几个窗口会接连交来值，并发写同一个临时文件会互相覆盖、改名失败。
 * 失败交给 `failed`（壳写日志），不影响后面的写入。
 */
export function createDesktopSettingsCacheWriter(file: string, failed: (error: unknown) => void): {write(values: DesktopSettingValues): Promise<void>} {
    let tail: Promise<void> = Promise.resolve();
    return {
        write(values) {
            tail = tail.then(() => writeDesktopSettingsCache(file, values)).catch(failed);
            return tail;
        },
    };
}

/** 两份值是否相同（壳据此去重：几个窗口会各交一次同样的值）。 */
export function sameDesktopSettings(left: DesktopSettingValues, right: DesktopSettingValues): boolean {
    return left.zoom === right.zoom && left.openAtLogin === right.openAtLogin;
}

/** 开机自启（`openAtLogin`）在注册表 Run 项上该做什么的依据。 */
export interface LoginItemFacts {
    readonly openAtLogin: boolean;
    /** 安装版：程序在 Electrobun 的通道根下（便携版与开发构建不是）。 */
    readonly managed: boolean;
    /** 状态根来自缺省位置（不是 `NBOOK_STATE_ROOT`，也不是便携）：Run 项带不上一次性的环境变量。 */
    readonly defaultStateRoot: boolean;
    /** 这个值名现在登记的命令；没有为 null。值名是应用标识，只由本程序写。 */
    readonly existing: string | null;
    /** 要登记的命令（安装目录里的 launcher.exe）。 */
    readonly command: string;
}

export type LoginItemPlan = {readonly action: "add" | "remove"} | {readonly action: "none"; readonly reason: string | null};

/**
 * 该不该改 Run 项。只有安装版、用缺省状态根的这次运行才管它：开着而登记不同就写（安装目录换了也覆盖），关着而有登记就删。
 * 不满足条件的运行（便携、开发构建、设了 `NBOOK_STATE_ROOT`）不碰已有的登记：它可能是缺省状态根那边开的，这次读到的
 * 是另一份设置。
 */
export function loginItemPlan(facts: LoginItemFacts): LoginItemPlan {
    if (!facts.managed) return {action: "none", reason: facts.openAtLogin ? "not an installed app" : null};
    if (!facts.defaultStateRoot) return {action: "none", reason: facts.openAtLogin ? "the state root is not the default one" : null};
    if (facts.openAtLogin) return facts.existing === facts.command ? {action: "none", reason: null} : {action: "add"};
    return facts.existing === null ? {action: "none", reason: null} : {action: "remove"};
}
