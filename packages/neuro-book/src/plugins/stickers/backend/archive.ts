/**
 * 表情包页的 zip（docs/specs/agent/stickers.md 输出 35、36）：导出是一个以包名命名的文件夹，导入收这种，或图片直接放在根上的。
 *
 * 导入先核对再落盘，核对全在内存里做：路径规则、两种形状、重名、上限都按实际解出的字节算（流式解压边解边数，超了立即终止，
 * 不信 zip 头里声明的大小）；不合格的整个不导入。只收清单与扩展名是图片的文件，别的文件与子文件夹忽略。
 */

import {Unzip, UnzipInflate, UnzipPassThrough, zipSync} from "fflate";

import {FOLDER_NAME, MANIFEST_FILE} from "../shared/contracts";
import {isImageFileName} from "../shared/manifest";
import {uploadName} from "./prepare-image";

export const ARCHIVE_LIMITS = {
    /** 导入的 zip 本身与导出的 zip。 */
    archiveBytes: 64 * 1024 * 1024,
    /** 解开后合计。 */
    totalBytes: 256 * 1024 * 1024,
    fileBytes: 32 * 1024 * 1024,
    /** zip 里的条目总数（含目录与被忽略的）。 */
    entries: 600,
} as const;

/** 往解压器里喂的块大小：块小，超限时已多解出的字节也小。 */
const CHUNK = 64 * 1024;

export type Unpacked =
    | {readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array>; readonly folder: string | null}
    | {readonly ok: false; readonly reason: string};

/** macOS 的压缩工具会顺带放进去的东西：忽略，不算路径不合规则。 */
const isMacJunk = (segments: readonly string[]): boolean => segments[0] === "__MACOSX" || segments[segments.length - 1] === ".DS_Store";

/** 一个路径段能不能写：非空、不是 `.` 或 `..`、不以点开头、没有路径分隔符、冒号与控制字符。 */
const segmentProblem = (segment: string): boolean => segment === "" || segment.startsWith(".") || /[\\:\u0000-\u001f\u007f]/u.test(segment);

export function unpackZip(archive: Uint8Array): Unpacked {
    if (archive.length > ARCHIVE_LIMITS.archiveBytes) return {ok: false, reason: "zip 超过 64 MiB"};
    const files = new Map<string, Uint8Array>();
    /** 选中的文件的完整路径（NFC、小写）：同一个文件名出现两次整个拒绝。 */
    const seen = new Set<string>();
    const depths = new Map<string, number>();
    let failure: string | null = null;
    let entries = 0;
    let total = 0;
    const unzipper = new Unzip();
    unzipper.register(UnzipInflate);
    unzipper.register(UnzipPassThrough);
    unzipper.onfile = (file) => {
        if (failure !== null) return;
        entries += 1;
        if (entries > ARCHIVE_LIMITS.entries) {
            failure = `条目太多：至多 ${String(ARCHIVE_LIMITS.entries)} 个`;
            return;
        }
        if (file.name.startsWith("/")) {
            failure = `路径不合规则：${file.name}`;
            return;
        }
        const segments = file.name.split("/");
        if (segments[segments.length - 1] === "") segments.pop();
        if (isMacJunk(segments)) return;
        if (segments.length === 0 || segments.some(segmentProblem)) {
            failure = `路径不合规则：${file.name}`;
            return;
        }
        // 目录项、太深的、不是清单与图片的：不读。
        if (file.name.endsWith("/") || segments.length > 2) return;
        const base = segments[segments.length - 1] as string;
        if (base !== MANIFEST_FILE && !(uploadName(base) && isImageFileName(base))) return;
        const key = segments.join("/").normalize("NFC").toLowerCase();
        if (seen.has(key)) {
            failure = `同一个文件名出现了两次：${file.name}`;
            return;
        }
        seen.add(key);
        const chunks: Uint8Array[] = [];
        let size = 0;
        file.ondata = (error, chunk, final) => {
            if (failure !== null) return;
            if (error !== null) {
                failure = `解压失败：${error.message}`;
                return;
            }
            size += chunk.length;
            total += chunk.length;
            if (size > ARCHIVE_LIMITS.fileBytes) failure = `${file.name} 太大`;
            else if (total > ARCHIVE_LIMITS.totalBytes) failure = "解压后合计太大";
            if (failure !== null) {
                file.terminate();
                return;
            }
            chunks.push(chunk);
            if (!final) return;
            const whole = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
                whole.set(part, offset);
                offset += part.length;
            }
            files.set(segments.join("/"), whole);
            depths.set(segments.join("/"), segments.length);
        };
        file.start();
    };
    try {
        for (let offset = 0; offset < archive.length && failure === null; offset += CHUNK) unzipper.push(archive.subarray(offset, offset + CHUNK), offset + CHUNK >= archive.length);
        if (archive.length === 0) unzipper.push(new Uint8Array(), true);
    } catch (error) {
        return {ok: false, reason: `读不了这个 zip：${error instanceof Error ? error.message : String(error)}`};
    }
    if (failure !== null) return {ok: false, reason: failure};

    const paths = [...files.keys()];
    if (paths.length === 0) return {ok: false, reason: "zip 里没有清单也没有图片"};
    const rootFiles = paths.filter((path) => depths.get(path) === 1);
    let folder: string | null = null;
    if (rootFiles.length === 0) {
        const folders = new Set(paths.map((path) => path.split("/")[0] as string));
        if (folders.size !== 1) return {ok: false, reason: "zip 里有多个文件夹，一个 zip 只放一个表情包"};
        folder = [...folders][0] as string;
    }
    const picked = new Map<string, Uint8Array>();
    for (const path of paths) {
        const depth = depths.get(path);
        if ((folder === null && depth === 1) || (folder !== null && path.startsWith(`${folder}/`))) picked.set(path.slice(path.lastIndexOf("/") + 1), files.get(path) as Uint8Array);
    }
    return {ok: true, files: picked, folder};
}

/** 文件夹名或 zip 文件名转成合规的包名；转不出（没有字母数字）交回 null。 */
export function packNameFrom(raw: string): string | null {
    const name = raw.replace(/\.zip$/iu, "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60).replace(/-+$/u, "");
    return FOLDER_NAME.test(name) ? name : null;
}

/** 打成 zip：一个以包名命名的文件夹，只存不压（图片再压省不下）。 */
export function zipPack(folder: string, files: ReadonlyArray<{readonly name: string; readonly bytes: Uint8Array}>): Uint8Array {
    return zipSync(Object.fromEntries(files.map((file) => [`${folder}/${file.name}`, [file.bytes, {level: 0}] as [Uint8Array, {level: 0}]])));
}
