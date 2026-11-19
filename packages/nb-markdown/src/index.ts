/**
 * `@notnotype/nb-markdown` 的纯 TS 入口：不引 DOM 与编辑内核，浏览器与后端（字数）都能用。语言与编解码器、组件在各自的
 * 入口里（见包的 README）。
 */

export * from "./link-syntax";
export * from "./markdown-dialect";
export {namesOf} from "./names";
export type {SyntaxNameSource} from "./names";
export {say} from "./locale";
export type {MarkdownLocale, MarkdownText} from "./locale";
export {isStickerName, isStickerPack, parseSticker, STICKER_NAME_MAX, STICKER_PACK_MAX, stickerAt, stickerColonEscapes, stickerEndingAt} from "./stickers";
export type {ResolvedSticker, StickerPreview, StickerRef, StickerResolver} from "./stickers";
export {classifyScheme, decodeTarget, lastSegment, pathPart, relativeAddress, relativeTarget, schemeOf, schemeTargets, showsAsChip} from "./targets";
export type {MarkdownTargets, Target, TargetKind} from "./targets";
