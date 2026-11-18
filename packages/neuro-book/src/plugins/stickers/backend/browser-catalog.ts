/**
 * 交给浏览器的目录与概要（docs/specs/agent/stickers.md 输出 18、19）：浏览器目录只带显示要用的字段，合计至多 `BROWSER_STICKERS_MAX`
 * 个表情；两者序列化后都至多 `BROWSER_BYTES_MAX` 字节。按 id 的码元顺序取，放不下的表情包整包不进，写诊断：远程调用的单条消息有大小
 * 上限，超了会让整个窗口断开。
 */

import {BROWSER_BYTES_MAX, BROWSER_STICKERS_MAX, packSummary, stickerImageUrl} from "../shared/contracts";
import type {BrowserStickerPack, ExtraCounts, StickerPackEntry, StickerPackSummary} from "../shared/contracts";

type Report = (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;

const encoder = new TextEncoder();

/** 逐项装进预算：一项放不下就跳过它（后面更小的照样能进）。交回装进的与跳过的 id。 */
function withinBudget<T>(items: readonly {readonly id: string; readonly value: T; readonly stickers: number}[]): {readonly kept: T[]; readonly skipped: string[]} {
    const kept: T[] = [];
    const skipped: string[] = [];
    let stickers = 0;
    // 数组的方括号与项之间的逗号。
    let bytes = 2;
    for (const item of items) {
        const size = encoder.encode(JSON.stringify(item.value)).length + 1;
        if (stickers + item.stickers > BROWSER_STICKERS_MAX || bytes + size > BROWSER_BYTES_MAX) {
            skipped.push(item.id);
            continue;
        }
        stickers += item.stickers;
        bytes += size;
        kept.push(item.value);
    }
    return {kept, skipped};
}

export function browserCatalog(packs: readonly StickerPackEntry[], report: Report): BrowserStickerPack[] {
    const {kept, skipped} = withinBudget(packs.filter((pack) => pack.status === "ok" && pack.stickers.length > 0).map((pack) => ({
        id: pack.id,
        stickers: pack.stickers.length,
        value: {id: pack.id, folder: pack.folder, stickers: pack.stickers.map((sticker) => ({name: sticker.name, width: sticker.width, height: sticker.height, url: stickerImageUrl(pack.id, sticker)}))},
    })));
    if (skipped.length > 0) report("catalog-truncated", `浏览器目录放不下（合计超过 ${String(BROWSER_STICKERS_MAX)} 个表情或 ${String(BROWSER_BYTES_MAX)} 字节），这些表情包不进：${skipped.join("、")}`, {skipped});
    return kept;
}

/** 设置页的表情包概要：同样有字节预算，表情数不限（概要里没有表情）。 */
export function browserSummaries(packs: readonly StickerPackEntry[], report: Report, counts: (id: string) => ExtraCounts | undefined = () => undefined): StickerPackSummary[] {
    const {kept, skipped} = withinBudget(packs.map((pack) => ({id: pack.id, stickers: 0, value: packSummary(pack, counts(pack.id))})));
    if (skipped.length > 0) report("catalog-truncated", `表情包概要放不下（超过 ${String(BROWSER_BYTES_MAX)} 字节），这些表情包不列：${skipped.join("、")}`, {skipped, summaries: true});
    return kept;
}
