/**
 * 浏览器一侧的表情目录（docs/specs/agent/stickers.md 输出 7–10、18）：订阅变化、取目录，按写法查表情。查询在目录取到之前等着，
 * 取到后按当时的目录回答；取不到（服务不可用）时都回答认不出，表情显示原文。
 */

import type {StickerRef, StickerResolver} from "@notnotype/nb-markdown";

import type {BrowserStickerPack, StickerDirectoryService} from "../shared/contracts";
import {rankedWinner} from "../shared/writing";

/**
 * 一个写法在目录里对应的表情（输出 7、8）；认不出为 null。带包的先按 id，再按包段（服务端分好级的，见 `shared/writing.ts`）；
 * 不带包的在有这个名字的包里按来源分级。
 */
export function findSticker(packs: readonly BrowserStickerPack[], ref: StickerRef): {readonly url: string; readonly width: number; readonly height: number} | null {
    const inPack = (pack: BrowserStickerPack) => pack.stickers.find((sticker) => sticker.name === ref.name) ?? null;
    if (ref.pack !== null) {
        const pack = packs.find((item) => item.id === ref.pack) ?? packs.find((item) => item.writing === ref.pack);
        return pack === undefined ? null : inPack(pack);
    }
    const found = packs.flatMap((pack) => {
        const sticker = inPack(pack);
        return sticker === null ? [] : [{source: pack.source, sticker}];
    });
    return rankedWinner(found)?.sticker ?? null;
}

export interface StickerDirectory extends StickerDirectoryService {
    readonly resolve: StickerResolver;
    /** 换上新取到的目录。 */
    set(packs: readonly BrowserStickerPack[]): void;
    /** 取目录失败：还没取到过时，等着的与之后的查询都回答认不出；取到过的留着用。 */
    failed(): void;
}

export function createStickerDirectory(): StickerDirectory {
    let packs: readonly BrowserStickerPack[] | null | undefined;
    const waiting: Array<() => void> = [];
    const listeners = new Set<() => void>();
    const changed = (): void => {
        for (const listener of [...listeners]) listener();
    };
    return {
        resolve: async (ref) => {
            if (packs === undefined) await new Promise<void>((resolve) => waiting.push(resolve));
            const found = packs === null || packs === undefined ? null : findSticker(packs, ref);
            return found === null ? null : {...found, release: () => undefined};
        },
        set(next) {
            packs = next;
            for (const wake of waiting.splice(0)) wake();
            changed();
        },
        failed() {
            if (packs !== undefined) return;
            packs = null;
            for (const wake of waiting.splice(0)) wake();
            changed();
        },
        current: () => packs ?? null,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
