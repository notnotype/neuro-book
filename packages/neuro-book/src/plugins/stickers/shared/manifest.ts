/**
 * 清单 `stickers.json` 的形状核对（docs/specs/agent/stickers.md 的“输入与前置条件”与输出 2–4）：分三层，整份读不懂或形状不对的
 * 让表情包无效；可选字段不合规的只忽略那个字段；单个表情不合规的只隔离它。清单没写表情列表时，表情由文件夹里的图片得出
 * （`stickersFromFiles`），名字规则与清单里的同一条。文件与图片的核对在服务端的目录里做。
 */

import {isStickerName} from "@notnotype/nb-markdown";

import {IMAGE_TYPES, STICKERS_PER_PACK_MAX, TEXT_MAX} from "./contracts";

export interface ManifestSticker {
    readonly name: string;
    readonly file: string;
    readonly description?: string;
    readonly common: boolean;
}

/** 不合规的一项：`label` 指出是哪一项（“第 N 项”或文件名），诊断里写成 `label：reason`。 */
export type ManifestItem = {readonly ok: true; readonly sticker: ManifestSticker} | {readonly ok: false; readonly label: string; readonly reason: string};

/** 一组表情与超出 500 项上限没认的项数。 */
export interface ManifestStickers {
    readonly items: readonly ManifestItem[];
    readonly truncated: number;
}

export type ManifestResult =
    | {readonly ok: false; readonly detail: string}
    | {
        readonly ok: true;
        readonly title?: string;
        readonly description?: string;
        readonly ignored: readonly string[];
        /** null：清单没写 `stickers`，表情按文件夹里的图片得出。 */
        readonly stickers: ManifestStickers | null;
    };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const shortText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && [...value].length <= TEXT_MAX;
const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** 扩展名是允许的几种之一时，交回去掉扩展名的部分；否则 null。 */
function imageStem(file: string): string | null {
    const dot = file.lastIndexOf(".");
    return dot > 0 && IMAGE_TYPES[file.slice(dot + 1).toLowerCase()] !== undefined ? file.slice(0, dot) : null;
}

/** 表情包文件夹里的单段文件名，扩展名是允许的几种。 */
function fileProblem(file: unknown): string | null {
    if (typeof file !== "string" || file === "" || file === "." || file === ".." || /[/\\]/u.test(file) || file.includes("\0")) return "file 不是表情包文件夹里的单段文件名";
    return imageStem(file) === null ? "file 的扩展名不是 png、gif、webp、jpg、jpeg" : null;
}

/** 按表情名规则与同包不重名核对一个名字；合规时记进 `seen`，交回规范化后的名字。 */
function claimName(name: string, seen: Set<string>): {readonly ok: true; readonly name: string} | {readonly ok: false; readonly reason: string} {
    const normalized = name.normalize("NFC");
    if (seen.has(normalized)) return {ok: false, reason: `name ${normalized} 重名`};
    seen.add(normalized);
    return {ok: true, name: normalized};
}

export function parseManifest(value: unknown): ManifestResult {
    if (!isObject(value)) return {ok: false, detail: "清单不是对象"};
    if (value.stickers !== undefined && !Array.isArray(value.stickers)) return {ok: false, detail: "stickers 写了但不是数组"};
    const ignored: string[] = [];
    const optional = (key: "title" | "description"): string | undefined => {
        const field = value[key];
        if (field === undefined) return undefined;
        if (shortText(field)) return field;
        ignored.push(key);
        return undefined;
    };
    const title = optional("title");
    const description = optional("description");
    const header = {ok: true as const, ...(title === undefined ? {} : {title}), ...(description === undefined ? {} : {description}), ignored};
    if (!Array.isArray(value.stickers)) return {...header, stickers: null};
    const seen = new Set<string>();
    const listed: readonly unknown[] = value.stickers.slice(0, STICKERS_PER_PACK_MAX);
    const items = listed.map((raw, index): ManifestItem => {
        const label = `第 ${String(index + 1)} 项`;
        const fail = (reason: string): ManifestItem => ({ok: false, label, reason});
        if (!isObject(raw)) return fail("不是对象");
        const {name, file, description: text, common} = raw;
        const problem = fileProblem(file);
        if (problem !== null) return fail(problem);
        // fileProblem 通过之后 file 是带图片扩展名的字符串，imageStem 不会是 null。
        const stem = imageStem(file as string) as string;
        const written = name === undefined ? stem : name;
        if (typeof written !== "string" || !isStickerName(written)) return fail(name === undefined ? `文件名 ${stem} 当不了表情名` : "name 不合规则");
        if (text !== undefined && !shortText(text)) return fail("description 不是 1 到 200 个字符的文字");
        if (common !== undefined && typeof common !== "boolean") return fail("common 不是布尔值");
        const claimed = claimName(written, seen);
        if (!claimed.ok) return fail(claimed.reason);
        return {ok: true, sticker: {name: claimed.name, file: file as string, ...(text === undefined ? {} : {description: text as string}), common: common === true}};
    });
    return {...header, stickers: {items, truncated: value.stickers.length - listed.length}};
}

/**
 * 清单没写表情列表时，由文件夹里的文件名得出表情：扩展名是图片的每个文件一个，按码元顺序，名字是去掉扩展名的部分，都算常用；
 * 别的文件不算表情、不报。纯函数，`files` 是文件夹里条目的名字（不含子文件夹）。
 */
export function stickersFromFiles(files: readonly string[]): ManifestStickers {
    const images = files.filter((file) => !file.startsWith(".") && imageStem(file) !== null).sort(byCodeUnit);
    const seen = new Set<string>();
    const items = images.slice(0, STICKERS_PER_PACK_MAX).map((file): ManifestItem => {
        const stem = imageStem(file) as string;
        if (!isStickerName(stem)) return {ok: false, label: file, reason: "文件名当不了表情名"};
        const claimed = claimName(stem, seen);
        return claimed.ok ? {ok: true, sticker: {name: claimed.name, file, common: true}} : {ok: false, label: file, reason: claimed.reason};
    });
    return {items, truncated: images.length - Math.min(images.length, STICKERS_PER_PACK_MAX)};
}
