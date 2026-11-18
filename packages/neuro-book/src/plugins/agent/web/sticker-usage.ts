/**
 * 哪些 Profile 明确选了某个表情包（docs/specs/agent/stickers.md 输出 33）：改包名之后它们要在 Profile 页重新勾选。只算“显式写了这个 id”
 * 的：声明的白名单是数组且含它，或用户在 Profile 设置里加了它且没去掉。声明 `"all"` 的不算（改名之后自动包含新 id）；后台 Profile
 * 不给人选，不列。
 */

import type {ProfileEntry} from "../shared/contracts";

export interface ProfileStickerBinding {
    readonly stickers?: {readonly added?: readonly string[]; readonly removed?: readonly string[]};
}

export function profilesUsingSticker(entries: readonly Pick<ProfileEntry, "key" | "name" | "stickers" | "hidden">[], settings: Readonly<Record<string, ProfileStickerBinding>>, packId: string): string[] {
    return entries
        .filter((entry) => {
            if (entry.hidden === true) return false;
            const binding = settings[entry.key]?.stickers;
            if (binding?.removed?.includes(packId) === true) return false;
            if (binding?.added?.includes(packId) === true) return true;
            const declared = entry.stickers?.allowed;
            return Array.isArray(declared) && declared.includes(packId);
        })
        .map((entry) => entry.name)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
