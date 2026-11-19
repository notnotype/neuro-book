/**
 * 表情写法（docs/specs/agent/stickers.md 的“表情写法”）：`:名字:` 与 `:包/名字:`。读法、写出时的转义、编辑器的输入规则与宿主的
 * 表情目录都用这里的同一个判断，几处对“是不是写法”的回答一致。纯 TS，后端的表情目录与提示词也用它。
 */

/** 表情名至多这么多个码点（NFC 之后）。 */
export const STICKER_NAME_MAX = 32;
/** 包段至多这么多个字符。 */
export const STICKER_PACK_MAX = 128;

/**
 * 写法的形状。名字的后续字符多收 `\p{M}`：文件里的名字可能是 NFD（macOS 的文件名），组合附加符号在 NFC 之后多数并进字母，
 * 长度与字符集在规范化之后再核对（`stickerAt`）。
 */
const SHAPE = /:(?:([a-z0-9._-]{1,128})\/)?([\p{L}_][\p{L}\p{M}\p{N}_-]*):/uy;
const NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;
const PACK = /^[a-z0-9._-]{1,128}$/u;

export interface StickerRef {
    /** 写法的原文（未规范化）。 */
    readonly raw: string;
    /** 包段，不带包为 null。 */
    readonly pack: string | null;
    /** NFC 规范化后的名字。 */
    readonly name: string;
}

/** 表情名合不合规则：NFC 之后 1 到 32 个码点，Unicode 字母、数字、`_`、`-`，第一个是字母或 `_`。 */
export function isStickerName(name: string): boolean {
    const normalized = name.normalize("NFC");
    return NAME.test(normalized) && [...normalized].length <= STICKER_NAME_MAX;
}

/** 包段合不合规则（文件夹名或表情包 id）。 */
export const isStickerPack = (pack: string): boolean => PACK.test(pack);

/** `text` 的 `index` 处是不是一个写法；是则交回它，否则为 null。前后紧挨什么字都认。 */
export function stickerAt(text: string, index: number): StickerRef | null {
    if (text.charCodeAt(index) !== 0x3a) return null;
    SHAPE.lastIndex = index;
    const matched = SHAPE.exec(text);
    if (matched === null) return null;
    const name = (matched[2] as string).normalize("NFC");
    if (!isStickerName(name)) return null;
    return {raw: matched[0], pack: matched[1] ?? null, name};
}

/** 一整段文字是不是恰好一个写法（宿主按原文查表情时用）。 */
export function parseSticker(raw: string): StickerRef | null {
    const ref = stickerAt(raw, 0);
    return ref !== null && ref.raw.length === raw.length ? ref : null;
}

/** 以 `text` 结尾的那个写法（编辑器打出结尾的冒号时用）；没有为 null。 */
export function stickerEndingAt(text: string): StickerRef | null {
    // 写法里只有开头、结尾与包段后面的 `/` 之前可能出现冒号以外的分隔，开头的冒号是倒数第二个冒号。
    const end = text.length - 1;
    if (end < 0 || text.charCodeAt(end) !== 0x3a) return null;
    const start = text.lastIndexOf(":", end - 1);
    if (start < 0) return null;
    const ref = stickerAt(text, start);
    return ref !== null && start + ref.raw.length === text.length ? ref : null;
}

/**
 * 一段普通文字里要转义的冒号：从前往后，每个能开出写法的冒号都转义。不跳过认出的写法：开头的冒号转义之后，它结尾的冒号可能
 * 开出下一个写法（`:a:b:` 要写成 `\:a\:b:`）。
 */
export function stickerColonEscapes(text: string): ReadonlySet<number> {
    const positions = new Set<number>();
    for (let index = text.indexOf(":"); index >= 0; index = text.indexOf(":", index + 1)) {
        if (stickerAt(text, index) !== null) positions.add(index);
    }
    return positions;
}

/** 宿主查到的表情。 */
export interface ResolvedSticker {
    readonly url: string;
    readonly width: number;
    readonly height: number;
    /** 认到的表情包 id。给了才能按贴纸显示（`stickerDisplayCss`）；可选，旧宿主不用改。 */
    readonly pack?: string;
    /** 表情包的显示名，预览的标题用；没有时标题只写名字。 */
    readonly packTitle?: string;
    /** 显示它的块被替换、卸载时调用一次。 */
    release(): void;
}

/** 表情预览里长边不到它的图放大到它（docs/specs/agent/stickers.md 输出 46，ImagePreviewDialog 的 `minSize`）。 */
export const STICKER_PREVIEW_MIN_SIZE = 320;

/** 点开大图预览时交给宿主的（docs/specs/agent/stickers.md 输出 46）。 */
export interface StickerPreview {
    /** 写法的原文，“复制写法”复制它。 */
    readonly raw: string;
    readonly url: string;
    /** NFC 规范化后的表情名。 */
    readonly name: string;
    readonly packTitle?: string;
    readonly width: number;
    readonly height: number;
}

/**
 * 宿主的表情目录：按写法查表情，认不出为 null。目录还没取到时等到取到为止（期间显示占位）；`signal` 触发后结果丢弃。
 */
export type StickerResolver = (ref: StickerRef, signal: AbortSignal) => Promise<ResolvedSticker | null>;
