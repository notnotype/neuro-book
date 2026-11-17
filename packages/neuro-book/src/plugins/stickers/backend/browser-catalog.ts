/**
 * 浏览器目录（docs/specs/agent/stickers.md 输出 18）：只带显示要用的字段，合计至多 `BROWSER_STICKERS_MAX` 个表情；按 id 的码元
 * 顺序取，放不下的表情包整包不进，写诊断。远程调用的单条消息有大小上限，目录不设上限会让整个窗口断开。
 */

import {BROWSER_STICKERS_MAX, stickerImageUrl} from "../shared/contracts";
import type {BrowserStickerPack, StickerPackEntry} from "../shared/contracts";

export function browserCatalog(packs: readonly StickerPackEntry[], report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): BrowserStickerPack[] {
    const result: BrowserStickerPack[] = [];
    const skipped: string[] = [];
    let total = 0;
    for (const pack of packs) {
        if (pack.status !== "ok" || pack.stickers.length === 0) continue;
        if (total + pack.stickers.length > BROWSER_STICKERS_MAX) {
            skipped.push(pack.id);
            continue;
        }
        total += pack.stickers.length;
        result.push({id: pack.id, folder: pack.folder, stickers: pack.stickers.map((sticker) => ({name: sticker.name, width: sticker.width, height: sticker.height, url: stickerImageUrl(pack.id, sticker)}))});
    }
    if (skipped.length > 0) report("catalog-truncated", `表情合计超过 ${String(BROWSER_STICKERS_MAX)} 个，这些表情包不进浏览器目录：${skipped.join("、")}`, {skipped});
    return result;
}
