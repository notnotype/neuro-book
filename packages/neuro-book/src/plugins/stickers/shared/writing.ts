/**
 * 按文件夹名认包的分级与写法的包段（docs/specs/agent/stickers.md 输出 7、8、14、41）。
 *
 * 分级：同名的候选按来源取最高的一级（我的、插件、内置），这一级里恰好一个才认得。包段：分级里胜出的写文件夹名，其余写 id。
 * 包段只在服务端的完整目录上算（槽与浏览器目录共用）：浏览器目录会丢掉空包、按预算整包丢弃，在那里重新分级会和服务端认成
 * 不同的包，所以浏览器按文件夹名认包时只找包段等于它的那个（`web/resolver.ts`）。
 */

import type {StickerPackEntry, StickerSource} from "./contracts";

/** 来源的级别，小的优先。 */
const SOURCE_RANK: Readonly<Record<StickerSource, number>> = {user: 0, plugin: 1, builtin: 2};

/** 一组同名的候选里分级胜出的那个；最高的一级不止一个、或没有候选时为 null。 */
export function rankedWinner<T extends {readonly source: StickerSource}>(candidates: readonly T[]): T | null {
    let best: T | null = null;
    let tied = false;
    for (const candidate of candidates) {
        if (best === null || SOURCE_RANK[candidate.source] < SOURCE_RANK[best.source]) {
            best = candidate;
            tied = false;
        } else if (SOURCE_RANK[candidate.source] === SOURCE_RANK[best.source]) {
            tied = true;
        }
    }
    return tied ? null : best;
}

type WritingPack = Pick<StickerPackEntry, "id" | "folder" | "status" | "source">;

/** 每个有效表情包的包段，按 id 查。无效的表情包不进写法，不在结果里。 */
export function writingSegments(packs: readonly WritingPack[]): ReadonlyMap<string, string> {
    const valid = packs.filter((pack) => pack.status === "ok");
    const byFolder = new Map<string, WritingPack[]>();
    for (const pack of valid) byFolder.set(pack.folder, [...(byFolder.get(pack.folder) ?? []), pack]);
    const winners = new Set([...byFolder.values()].map((group) => rankedWinner(group)?.id).filter((id) => id !== undefined));
    return new Map(valid.map((pack) => [pack.id, winners.has(pack.id) ? pack.folder : pack.id]));
}

/** 被我的同名包盖住的插件或内置的包（输出 25 的标注）：有效，且有同文件夹名的我的有效包。 */
export function shadowedByMine(packs: readonly WritingPack[]): ReadonlySet<string> {
    const mine = new Set(packs.filter((pack) => pack.status === "ok" && pack.source === "user").map((pack) => pack.folder));
    return new Set(packs.filter((pack) => pack.status === "ok" && pack.source !== "user" && mine.has(pack.folder)).map((pack) => pack.id));
}
