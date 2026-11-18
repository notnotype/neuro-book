/**
 * 表情选择器与补全的数据（docs/specs/agent/stickers.md 输出 39 到 43）：分组、搜索、认写法、最近用过。都是在浏览器目录上的同步计算：
 * 输入框的触发菜单要同步交回（`resolveTriggerMenu` 的约定），拼音库没到之前只按名字与包筛，到了之后调用方重算即可。
 */

import {parseSticker} from "@notnotype/nb-markdown";

import type {BrowserStickerPack, StickerPickerGroup, StickerPickerItem} from "../shared/contracts";
import {findSticker} from "./resolver";

/** 表情名每个汉字读音首字母连起来（`开心` 是 `kx`）；拼音库没加载时为 null。 */
export type Initials = ((text: string) => string) | null;

/** 用 `pinyin-pro` 的 `pinyin` 做出 `Initials`：非汉字原样连着（`nonZh: "consecutive"`），去掉空白、转小写。同斜杠菜单。 */
export function pinyinInitials(pinyin: typeof import("pinyin-pro").pinyin): (text: string) => string {
    return (text) => pinyin(text, {pattern: "first", toneType: "none", type: "array", nonZh: "consecutive"}).join("").replace(/\s+/gu, "").toLowerCase();
}

const pluginName = (pack: BrowserStickerPack): string | null => (pack.plugin === undefined ? null : pack.plugin.title ?? pack.plugin.id);

const itemsOf = (pack: BrowserStickerPack): StickerPickerItem[] => pack.stickers.map((sticker) => ({
    pack: pack.id,
    name: sticker.name,
    url: sticker.url,
    width: sticker.width,
    height: sticker.height,
    raw: `:${pack.writing}/${sticker.name}:`,
    packTitle: pack.title,
}));

/** 输出 39 的分组：我的在前（目录顺序），然后各插件的包。 */
export function pickerGroups(packs: readonly BrowserStickerPack[]): StickerPickerGroup[] {
    const mine = packs.filter((pack) => pack.source === "user");
    const plugins = packs.filter((pack) => pack.source !== "user").map((pack, index) => ({pack, index}));
    // 与表情包页的左栏同一个顺序（`pack-view.ts` 的 `railGroups`）：插件显示名的码元顺序，再按插件 id，同一插件内按目录顺序。
    const order = (entry: {pack: BrowserStickerPack; index: number}): [string, string, number] => [pluginName(entry.pack) ?? "", entry.pack.plugin?.id ?? "", entry.index];
    plugins.sort((left, right) => {
        const [a, b] = [order(left), order(right)];
        return a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] !== b[1] ? (a[1] < b[1] ? -1 : 1) : a[2] - b[2];
    });
    return [...mine, ...plugins.map((entry) => entry.pack)].map((pack) => ({id: pack.id, title: pack.title, plugin: pluginName(pack), items: itemsOf(pack)}));
}

/**
 * 输出 40 的搜索：`包/查询` 只在包段（文件夹名、id 或显示名）开头相符的表情包里找，`包/` 后面没有字时列这些包的全部、不受 `limit`。
 * 名字含查询、或读音首字母以查询开头的算匹配；名字以查询开头的排在前面，其余按分组顺序。
 */
export function searchStickers(groups: readonly StickerPickerGroup[], packs: readonly BrowserStickerPack[], query: string, limit: number, initials: Initials): StickerPickerItem[] {
    const slash = query.indexOf("/");
    const scope = slash < 0 ? null : query.slice(0, slash).toLowerCase();
    const wanted = (slash < 0 ? query : query.slice(slash + 1)).normalize("NFC").toLowerCase();
    const inScope = scope === null ? null : new Set(packs.filter((pack) => [pack.folder, pack.id, pack.title].some((name) => name.toLowerCase().startsWith(scope))).map((pack) => pack.id));
    const candidates = groups.filter((group) => inScope === null || inScope.has(group.id)).flatMap((group) => group.items);
    if (scope !== null && wanted === "") return candidates;
    const first: StickerPickerItem[] = [];
    const rest: StickerPickerItem[] = [];
    for (const item of candidates) {
        const name = item.name.toLowerCase();
        if (name.startsWith(wanted)) first.push(item);
        else if (name.includes(wanted) || initials?.(item.name).startsWith(wanted) === true) rest.push(item);
    }
    return [...first, ...rest].slice(0, limit);
}

/** 一条写法在目录里认不认得出；不是一个完整写法时为 false。 */
export function knownWriting(packs: readonly BrowserStickerPack[], raw: string): boolean {
    const ref = parseSticker(raw);
    return ref !== null && findSticker(packs, ref) !== null;
}

/** 最近用过的记录里的一项：表情包 id 与名字（输出 43）。 */
export interface RecentEntry {
    readonly pack: string;
    readonly name: string;
}

export const RECENT_MAX = 16;

/** 用过一个之后的新记录：放到最前、去掉重复、至多 `RECENT_MAX` 个。 */
export function withUsed(recent: readonly RecentEntry[], used: RecentEntry): RecentEntry[] {
    return [used, ...recent.filter((entry) => entry.pack !== used.pack || entry.name !== used.name)].slice(0, RECENT_MAX);
}

/** 记录换成目录里的表情；目录里已经没有的不列。 */
export function recentItems(groups: readonly StickerPickerGroup[], recent: readonly RecentEntry[]): StickerPickerItem[] {
    const byKey = new Map(groups.flatMap((group) => group.items).map((item) => [`${item.pack}\u0000${item.name}`, item]));
    return recent.flatMap((entry) => {
        const item = byKey.get(`${entry.pack}\u0000${entry.name}`);
        return item === undefined ? [] : [item];
    });
}
