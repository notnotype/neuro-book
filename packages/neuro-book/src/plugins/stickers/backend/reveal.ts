/**
 * “在文件夹中显示”要打开的路径与授权（docs/specs/agent/stickers.md 输出 37）：按 id 从当前目录取，不收界面给的路径。用户的包要求
 * 真实路径正是用户的表情包根下的这个文件夹（文件夹或上一级没被换成链接）；插件的包要求它仍在目录里（插件撤回后根就拿掉了）。
 * 系统调用之前最后一瞬被换掉不在承诺内。交回 null 时按“表情包不在”处理。
 */

import {realpath} from "node:fs/promises";
import {join} from "node:path";

import type {StickerCatalog} from "./catalog";

export async function revealPath(catalog: Pick<StickerCatalog, "item" | "rootVersion">, userRoot: string, id: string): Promise<string | null> {
    const item = catalog.item(id);
    if (item === undefined || item.entry.problem?.code === "symlink") return null;
    // 撤回先删根的登记，目录项要等排队的重扫才拿掉：这一段窗口里旧项还在，按根是否还登记着判。
    if (item.entry.source !== "user") return catalog.rootVersion(item.root) === undefined ? null : item.directory;
    const [root, real] = await Promise.all([realpath(userRoot).catch(() => null), realpath(item.directory).catch(() => null)]);
    return root !== null && real === join(root, item.entry.folder) ? real : null;
}
