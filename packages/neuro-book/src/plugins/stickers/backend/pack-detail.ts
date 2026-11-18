/**
 * 表情包页的一个表情包（docs/specs/agent/stickers.md 输出 26、27）：目录里的项加文件夹的身份令牌。整份序列化后至多
 * `BROWSER_BYTES_MAX` 字节（远程调用单条消息有上限，超了整个窗口断开）：表情至多 500 个、说明有长度上限，放不下的只可能是 extras，
 * 从后面截，总数照实（页面写“还有 N 张没列出”）。
 */

import {BROWSER_BYTES_MAX, packSummary, stickerImageUrl} from "../shared/contracts";
import type {StickerPackDetail} from "../shared/contracts";
import type {StickerPackItem} from "./catalog";

const encoder = new TextEncoder();
const size = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

export function packDetail(item: StickerPackItem, token: string | null): StickerPackDetail {
    const {entry} = item;
    const detail: StickerPackDetail = {
        summary: packSummary(entry, item.counts),
        listed: item.listed,
        token,
        stickers: entry.stickers.map((sticker) => ({
            name: sticker.name,
            file: sticker.file,
            ...(sticker.description === undefined ? {} : {description: sticker.description}),
            common: sticker.common,
            width: sticker.width,
            height: sticker.height,
            bytes: sticker.bytes,
            url: stickerImageUrl(entry.id, sticker),
        })),
        extras: [],
    };
    let bytes = size(detail);
    const extras: StickerPackDetail["extras"] = [];
    for (const extra of item.extras) {
        const value = {file: extra.file, reason: extra.reason, raw: extra.raw, width: extra.width, height: extra.height, bytes: extra.bytes, url: stickerImageUrl(entry.id, extra)};
        // 加一项多出它自己与一个逗号。
        const added = size(value) + 1;
        if (bytes + added > BROWSER_BYTES_MAX) break;
        bytes += added;
        extras.push(value);
    }
    return {...detail, extras};
}
