/**
 * 清单 `stickers.json` 的形状核对（docs/specs/agent/stickers.md 的“输入与前置条件”与输出 2–4）：分三层，整份读不懂或形状不对的
 * 让表情包无效；可选字段不合规的只忽略那个字段；单个表情不合规的只隔离它。文件与图片的核对在服务端的目录里做。
 */

import {isStickerName} from "@notnotype/nb-markdown";

import {IMAGE_TYPES, STICKERS_PER_PACK_MAX, TEXT_MAX} from "./contracts";

export interface ManifestSticker {
    readonly name: string;
    readonly file: string;
    readonly when?: string;
    readonly common: boolean;
}

export type ManifestItem = {readonly ok: true; readonly sticker: ManifestSticker} | {readonly ok: false; readonly index: number; readonly reason: string};

export type ManifestResult =
    | {readonly ok: false; readonly detail: string}
    | {readonly ok: true; readonly title?: string; readonly description?: string; readonly ignored: readonly string[]; readonly items: readonly ManifestItem[]; readonly truncated: number};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const shortText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && [...value].length <= TEXT_MAX;

/** 表情包文件夹里的单段文件名，扩展名是允许的几种。 */
function fileProblem(file: unknown): string | null {
    if (typeof file !== "string" || file === "" || file === "." || file === ".." || /[/\\]/u.test(file) || file.includes("\0")) return "file 不是表情包文件夹里的单段文件名";
    const dot = file.lastIndexOf(".");
    return dot > 0 && IMAGE_TYPES[file.slice(dot + 1).toLowerCase()] !== undefined ? null : "file 的扩展名不是 png、gif、webp、jpg、jpeg";
}

export function parseManifest(value: unknown): ManifestResult {
    if (!isObject(value)) return {ok: false, detail: "清单不是对象"};
    if (!Array.isArray(value.stickers)) return {ok: false, detail: "stickers 不是数组"};
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
    const seen = new Set<string>();
    const items: ManifestItem[] = [];
    const listed = value.stickers.slice(0, STICKERS_PER_PACK_MAX);
    listed.forEach((raw: unknown, index) => {
        if (!isObject(raw)) return items.push({ok: false, index, reason: "不是对象"});
        const {name, file, when, common} = raw;
        if (typeof name !== "string" || !isStickerName(name)) return items.push({ok: false, index, reason: "name 不合规则"});
        const normalized = name.normalize("NFC");
        if (seen.has(normalized)) return items.push({ok: false, index, reason: `name ${normalized} 重名`});
        const problem = fileProblem(file);
        if (problem !== null) return items.push({ok: false, index, reason: problem});
        if (when !== undefined && !shortText(when)) return items.push({ok: false, index, reason: "when 不是 1 到 200 个字符的文字"});
        if (common !== undefined && typeof common !== "boolean") return items.push({ok: false, index, reason: "common 不是布尔值"});
        seen.add(normalized);
        return items.push({ok: true, sticker: {name: normalized, file: file as string, ...(when === undefined ? {} : {when: when as string}), common: common === true}});
    });
    return {ok: true, ...(title === undefined ? {} : {title}), ...(description === undefined ? {} : {description}), ignored, items, truncated: value.stickers.length - listed.length};
}
