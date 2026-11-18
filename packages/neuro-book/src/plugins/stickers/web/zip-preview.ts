/**
 * 导入同名时“要导入的”那一侧的预览（docs/specs/agent/stickers.md 输出 36）：在浏览器里读本地的 zip，取前几张图画缩略图、数图片个数，
 * 不经服务端（冲突时服务端什么都没写）。只解压要画的那几张（大小有上限），读不出就只给 null。
 */

import {unzipSync} from "fflate";

const IMAGE_TYPES: Readonly<Record<string, string>> = {png: "image/png", gif: "image/gif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg"};
const PREVIEW_COUNT = 4;
/** 只为预览解压的单张上限。 */
const PREVIEW_BYTES = 2 * 1024 * 1024;

export interface ZipPreview {
    readonly title: string | null;
    readonly count: number | null;
    readonly items: ReadonlyArray<{readonly url: string; readonly label: string}>;
}

const extensionOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const isImage = (name: string): boolean => IMAGE_TYPES[extensionOf(name)] !== undefined && !name.split("/").some((segment) => segment.startsWith(".") || segment === "__MACOSX");

export async function previewZip(file: File): Promise<ZipPreview> {
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 先只读目录（不解压）：数图片、挑前几张。
        const names: string[] = [];
        unzipSync(bytes, {filter: (entry) => {
            if (!entry.name.endsWith("/") && isImage(entry.name)) names.push(entry.name);
            return false;
        }});
        const wanted = new Set(names.sort().slice(0, PREVIEW_COUNT));
        const files = unzipSync(bytes, {filter: (entry) => wanted.has(entry.name) && entry.originalSize <= PREVIEW_BYTES});
        const items = Object.entries(files).map(([name, data]) => ({url: URL.createObjectURL(new Blob([data], {type: IMAGE_TYPES[extensionOf(name)]})), label: name}));
        const folder = names[0]?.includes("/") === true ? names[0].split("/")[0] ?? null : null;
        return {title: folder, count: names.length, items};
    } catch {
        return {title: null, count: null, items: []};
    }
}
