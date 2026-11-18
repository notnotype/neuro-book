/**
 * 写法的包段（docs/specs/agent/stickers.md 输出 14、41）：写文件夹名；全部有效的表情包里有同名文件夹时写 id，否则按文件夹名认包时
 * 认不出（输出 7）。槽与浏览器目录都在完整目录上算：浏览器目录按预算会整包丢弃，在那里算会漏掉同名的包。
 */

import type {StickerPackEntry} from "./contracts";

/** 每个有效表情包的包段，按 id 查。无效的表情包不进写法，不在结果里。 */
export function writingSegments(packs: readonly Pick<StickerPackEntry, "id" | "folder" | "status">[]): ReadonlyMap<string, string> {
    const valid = packs.filter((pack) => pack.status === "ok");
    const folders = new Map<string, number>();
    for (const pack of valid) folders.set(pack.folder, (folders.get(pack.folder) ?? 0) + 1);
    return new Map(valid.map((pack) => [pack.id, (folders.get(pack.folder) ?? 0) > 1 ? pack.id : pack.folder]));
}
