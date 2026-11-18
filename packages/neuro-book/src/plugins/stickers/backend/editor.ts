/**
 * 表情包页的写入（docs/specs/agent/stickers.md 输出 28 到 34）：都经文件服务写 `user://stickers/…`，只写用户的包。
 *
 * 并发：`user://` 只由服务端进程写，同一个包的写入在这里按包名排队（改包名同时锁新旧两个名字，按码元顺序取）；锁里从磁盘重读清单与
 * 文件夹，不用目录的缓存；写完在锁里 `catalog.refresh`，返回时目录已是写完的样子。别的程序同时改同一个文件只能尽力而为：条件写
 * 冲突时报 `pack-changed`。导入、导出、复制另有一把归档锁，取锁顺序是先归档锁再包锁（见 `archive` 的调用方）。
 *
 * 失败一律映射成表情包页的码，不透传文件服务的码与宿主路径。
 */

import {randomUUID} from "node:crypto";
import {readdir, readFile} from "node:fs/promises";
import {join} from "node:path";

import {isStickerName} from "@notnotype/nb-markdown";

import type {Baseline, WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";

import type {ArchiveCode, EditCode} from "../shared/contracts";
import {FOLDER_NAME, MANIFEST_FILE, MANIFEST_MAX_BYTES, packId, REPLACED_PREFIX, STAGING_PREFIX, STICKERS_PER_PACK_MAX, TEXT_MAX} from "../shared/contracts";
import {isImageFileName, parseManifest} from "../shared/manifest";
import {ARCHIVE_LIMITS, packNameFrom, unpackZip, zipPack} from "./archive";
import type {StickerCatalog, StickerPackItem} from "./catalog";
import {checkImage} from "./catalog";
import {prepareImage, uploadName} from "./prepare-image";


/** 导入遇到同名的包时交回的信息：页面据此问“替换还是另存”（输出 36）。`token` 是已有的包的文件夹令牌，替换时带回。 */
export interface ImportConflict {
    readonly existing: {readonly id: string; readonly title: string; readonly count: number; readonly files: readonly string[]; readonly token: string | null};
    /** 另存时会用的包名。 */
    readonly copyAs: string | null;
}

export type Edited<T, Code extends string = EditCode> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: Code; readonly detail: string; readonly conflict?: ImportConflict};

/** 页面给的表情定位：清单里写的或推出来的名字（没写名字的认不出的图为 null）加文件名。 */
export interface StickerTarget {
    readonly file: string;
    readonly name: string | null;
}

export interface StickerChange {
    /** 空串或 null：去掉 `name`，用文件名。 */
    readonly name?: string | null;
    /** 空串或 null：去掉说明。 */
    readonly description?: string | null;
    readonly common?: boolean;
}

/** 复制插件的包至多读这么多字节（同导出，复制出来的一定能导出）。 */
export const COPY_BYTES_MAX = 64 * 1024 * 1024;
/** 归档锁的排队上限（在跑的那个不算）。 */
const ARCHIVE_QUEUE_MAX = 4;
/** 加图时同名顺延的次数。 */
const NAME_TRIES = 50;

const USER = "user";
const ROOT = `${USER}://stickers`;
const packAddress = (folder: string): string => `${ROOT}/${folder}`;
const fileAddress = (folder: string, file: string): string => `${ROOT}/${folder}/${file}`;
const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stemOf = (file: string): string => file.slice(0, file.lastIndexOf("."));
const encoder = new TextEncoder();

/** 编辑清单途中发现不能写：从 `files.update` 的回调里抛出，在外面接住。 */
class EditAbort extends Error {
    constructor(readonly code: EditCode, detail: string) {
        super(detail);
    }
}

const failed = <T, Code extends string = EditCode>(code: Code, detail: string): Edited<T, Code> => ({ok: false, code, detail});

function filesFailure(code: string): EditCode {
    switch (code) {
        case "conflict":
        case "source-changed":
            return "pack-changed";
        case "not-found":
        case "root-gone":
            return "pack-missing";
        case "permission-denied":
            return "permission-denied";
        case "too-large":
            return "too-large";
        default:
            return "write-failed";
    }
}

/** 按键排队的锁：一个键同时只有一个持有者，后来的按到达顺序等。 */
class KeyedLocks {
    readonly #tails = new Map<string, Promise<void>>();

    async with<T>(keys: readonly string[], run: () => Promise<T>): Promise<T> {
        const releases: Array<() => void> = [];
        for (const key of [...new Set(keys)].sort(byCodeUnit)) releases.push(await this.#acquire(key));
        try {
            return await run();
        } finally {
            for (const release of releases.reverse()) release();
        }
    }

    async #acquire(key: string): Promise<() => void> {
        const previous = this.#tails.get(key) ?? Promise.resolve();
        let release = (): void => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tail = previous.then(() => held);
        this.#tails.set(key, tail);
        await previous;
        return () => {
            release();
            if (this.#tails.get(key) === tail) this.#tails.delete(key);
        };
    }
}

/** 清单里一项按名字算出的表情名（写了名字用名字，没写用文件名），NFC。 */
function derivedName(entry: Record<string, unknown>): string | null {
    const named = typeof entry.name === "string" ? entry.name : typeof entry.file === "string" ? stemOf(entry.file) : null;
    return named === null ? null : named.normalize("NFC");
}

/**
 * 找页面指的那一项：文件名相同，名字与清单里写的原样一致（`null` 是没写名字）；不止一项或没有都不改。按原样而不按推出来的名字比：
 * 同一个文件在清单里写了两项（一项省略名字、一项写了与文件名主干相同的名字）时，两项的定位值不同，才能各改各的。
 */
function findEntry(list: readonly unknown[], target: StickerTarget): number {
    const matches = list.flatMap((entry, index) => {
        if (!isObject(entry) || entry.file !== target.file) return [];
        const raw = typeof entry.name === "string" ? entry.name : null;
        return raw === target.name ? [index] : [];
    });
    if (matches.length !== 1) throw new EditAbort("sticker-missing", matches.length === 0 ? `清单里没有 ${target.file}` : `清单里 ${target.file} 不止一项对得上`);
    return matches[0]!;
}

function serialize(raw: Record<string, unknown>): string {
    const stickers = raw.stickers;
    if (Array.isArray(stickers) && stickers.length > STICKERS_PER_PACK_MAX) throw new EditAbort("manifest-full", `清单至多 ${String(STICKERS_PER_PACK_MAX)} 项`);
    const text = `${JSON.stringify(raw, null, 2)}\n`;
    if (encoder.encode(text).length > MANIFEST_MAX_BYTES) throw new EditAbort("manifest-full", "清单超过 256 KiB");
    return text;
}

function textField(value: string | null | undefined, code: EditCode, label: string): string | null {
    if (value === undefined || value === null || value.trim() === "") return null;
    if ([...value].length > TEXT_MAX) throw new EditAbort(code, `${label}至多 ${String(TEXT_MAX)} 个字符`);
    return value;
}

export interface StickerEditorOptions {
    readonly files: () => WorkspaceFiles;
    readonly catalog: Pick<StickerCatalog, "item" | "refresh" | "rootVersion">;
}


export class StickerEditor {
    readonly #options: StickerEditorOptions;
    readonly #locks = new KeyedLocks();
    /** 导入、导出、复制同时只做一个，多的排队，队列满了得 `busy`。 */
    #archiveWaiting = 0;

    constructor(options: StickerEditorOptions) {
        this.#options = options;
    }

    get #files(): WorkspaceFiles {
        return this.#options.files();
    }

    /** 归档锁：先取它再取包锁（改名、导入、导出、复制都按这个顺序）。 */
    async #archived<T, Code extends string>(run: () => Promise<Edited<T, Code>>): Promise<Edited<T, Code | "busy">> {
        // 在跑的那个也算一个，排队的至多 `ARCHIVE_QUEUE_MAX` 个。
        if (this.#archiveWaiting > ARCHIVE_QUEUE_MAX) return failed("busy", "正在导入、导出或复制别的表情包，稍后再试");
        this.#archiveWaiting += 1;
        try {
            return await this.#locks.with(["\u0000archive"], run);
        } finally {
            this.#archiveWaiting -= 1;
        }
    }

    /** 只写用户的包；交回它的文件夹名。 */
    #userPack(id: string): Edited<StickerPackItem> {
        const item = this.#options.catalog.item(id);
        if (item === undefined) return failed("pack-missing", `没有表情包 ${id}`);
        if (item.entry.source !== "user") return failed("not-user-pack", `${id} 不是用户的表情包`);
        return {ok: true, value: item};
    }

    /** 在包锁里做一件事，写完刷新目录；`run` 抛出的 `EditAbort` 变成失败。 */
    async #write<T, Code extends string = EditCode>(folders: readonly string[], run: () => Promise<Edited<T, Code>>): Promise<Edited<T, Code | EditCode>> {
        return this.#locks.with(folders, async () => {
            let result: Edited<T, Code>;
            try {
                result = await run();
            } catch (error) {
                if (error instanceof EditAbort) return failed(error.code, error.message);
                throw error;
            }
            try {
                await this.#options.catalog.refresh(USER);
            } catch (error) {
                return result.ok ? failed("refresh-failed", `已写入，目录没刷新：${error instanceof Error ? error.message : String(error)}`) : result;
            }
            return result;
        });
    }

    /** 文件夹顶层的图片文件名（从磁盘列）。 */
    async #images(folder: string): Promise<string[]> {
        const listed = await this.#files.list(packAddress(folder));
        if (!listed.ok) throw new EditAbort(filesFailure(listed.code), listed.detail);
        if (!("entries" in listed.value)) throw new EditAbort("write-failed", "表情包文件夹列不出来");
        return listed.value.entries.filter((entry) => "kind" in entry && entry.kind === "file" && isImageFileName(entry.name)).map((entry) => entry.name).sort(byCodeUnit);
    }

    /** 读清单；没有清单为 null。 */
    async #readManifest(folder: string): Promise<Record<string, unknown> | null> {
        const read = await this.#files.read(fileAddress(folder, MANIFEST_FILE));
        if (!read.ok) {
            if (read.code === "not-found") return null;
            throw new EditAbort(filesFailure(read.code), read.detail);
        }
        return parseRaw(new TextDecoder().decode(read.value.bytes));
    }

    /**
     * 改清单（输出 28）：没有清单先排他写一份，有了就按读到的基线写回、冲突重读重算（文件服务的 `update`）。`change` 每次重算都重跑，
     * 核对写在它里面。没有表情列表时先补一个：文件夹里每张图片一项、都算常用，与改之前认的表情相同。
     */
    async #editManifest(folder: string, change: (raw: Record<string, unknown>) => void): Promise<void> {
        const images = await this.#images(folder);
        const edit = (raw: Record<string, unknown>): string => {
            if (raw.stickers === undefined) {
                if (images.length > STICKERS_PER_PACK_MAX) throw new EditAbort("manifest-full", `文件夹里有 ${String(images.length)} 张图，清单至多 ${String(STICKERS_PER_PACK_MAX)} 项`);
                raw.stickers = images.map((file) => ({file, common: true}));
            } else if (!Array.isArray(raw.stickers)) {
                throw new EditAbort("write-failed", "清单的 stickers 不是数组");
            }
            change(raw);
            return serialize(raw);
        };
        const address = fileAddress(folder, MANIFEST_FILE);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const updated = await this.#files.update(address, (text) => edit(parseRaw(text)));
            if (updated.ok) return;
            if (updated.code !== "not-found") throw new EditAbort(filesFailure(updated.code), updated.detail);
            const created = await this.#files.write(address, edit({}), {expect: "absent"});
            if (created.ok) return;
            // 刚有人建了清单：回去按它改。
            if (created.code !== "conflict") throw new EditAbort(filesFailure(created.code), created.detail);
        }
        throw new EditAbort("pack-changed", "清单在改的同时被别处反复改动");
    }

    async updatePack(id: string, change: {readonly title?: string | null; readonly description?: string | null}): Promise<Edited<null>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            const title = change.title === undefined ? undefined : textField(change.title, "title-invalid", "显示名");
            const description = change.description === undefined ? undefined : textField(change.description, "description-invalid", "说明");
            await this.#editManifestHeader(folder, (raw) => {
                if (title !== undefined) setOrDelete(raw, "title", title);
                if (description !== undefined) setOrDelete(raw, "description", description);
            });
            return {ok: true, value: null};
        });
    }

    /** 只改清单的头（显示名、说明）：没有表情列表的不补列表，免得把“按文件夹里的图片”变成固定的名单。 */
    async #editManifestHeader(folder: string, change: (raw: Record<string, unknown>) => void): Promise<void> {
        const address = fileAddress(folder, MANIFEST_FILE);
        const edit = (raw: Record<string, unknown>): string => {
            change(raw);
            return serialize(raw);
        };
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const updated = await this.#files.update(address, (text) => edit(parseRaw(text)));
            if (updated.ok) return;
            if (updated.code !== "not-found") throw new EditAbort(filesFailure(updated.code), updated.detail);
            const created = await this.#files.write(address, edit({}), {expect: "absent"});
            if (created.ok) return;
            if (created.code !== "conflict") throw new EditAbort(filesFailure(created.code), created.detail);
        }
        throw new EditAbort("pack-changed", "清单在改的同时被别处反复改动");
    }

    async updateSticker(id: string, target: StickerTarget, change: StickerChange): Promise<Edited<null>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            await this.#editManifest(folder, (raw) => {
                const list = raw.stickers as unknown[];
                const index = findEntry(list, target);
                const entry = {...(list[index] as Record<string, unknown>)};
                if (change.name !== undefined) {
                    const name = change.name === null || change.name.trim() === "" ? null : change.name.normalize("NFC");
                    const next = name ?? stemOf(target.file);
                    if (!isStickerName(next)) throw new EditAbort("name-invalid", name === null ? `文件名 ${stemOf(target.file)} 当不了表情名，要写一个名字` : `${next} 当不了表情名`);
                    const others = list.flatMap((other, at) => (at !== index && isObject(other) ? [derivedName(other)] : []));
                    if (others.includes(next)) throw new EditAbort("name-duplicate", `已经有表情叫 ${next}`);
                    setOrDelete(entry, "name", name);
                }
                if (change.description !== undefined) setOrDelete(entry, "description", textField(change.description, "description-invalid", "说明"));
                if (change.common !== undefined) entry.common = change.common;
                list[index] = entry;
            });
            return {ok: true, value: null};
        });
    }

    /** 删表情（输出 30）：有表情列表的删那一项，文件不再被别的项用到才删文件；没有列表的直接删文件。 */
    async deleteSticker(id: string, target: StickerTarget): Promise<Edited<null>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            const raw = await this.#readManifest(folder);
            if (raw !== null && Array.isArray(raw.stickers)) {
                let stillUsed = false;
                await this.#editManifest(folder, (current) => {
                    const list = current.stickers as unknown[];
                    list.splice(findEntry(list, target), 1);
                    stillUsed = list.some((entry) => isObject(entry) && entry.file === target.file);
                });
                if (stillUsed) return {ok: true, value: null};
            }
            // 只删包里的图片文件：清单、子目录与别的文件不是表情，页面也不该删它们；清单里指着已不在的文件时，删了这一项就完成。
            if (!(await this.#images(folder)).includes(target.file)) return raw !== null && Array.isArray(raw.stickers) ? {ok: true, value: null} : failed("sticker-missing", `${target.file} 不是这个包里的图片`);
            return this.#deleteFiles(folder, [target.file]);
        });
    }

    /** 加进来（输出 30）：在清单末尾加项（名字省略、不常用）。`"all"` 在锁里重列文件夹，不用页面看到的名单。 */
    async listFiles(id: string, files: readonly string[] | "all"): Promise<Edited<{readonly added: number}>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            const raw = await this.#readManifest(folder);
            // 没有表情列表的包里，文件夹里的图本来都是表情。
            if (raw === null || !Array.isArray(raw.stickers)) return {ok: true, value: {added: 0}};
            const images = new Set(await this.#images(folder));
            let added = 0;
            await this.#editManifest(folder, (current) => {
                const list = current.stickers as unknown[];
                const referenced = new Set(list.flatMap((entry) => (isObject(entry) && typeof entry.file === "string" ? [entry.file] : [])));
                const wanted = files === "all" ? [...images].sort(byCodeUnit) : files;
                added = 0;
                for (const file of wanted) {
                    if (!images.has(file) || referenced.has(file)) continue;
                    list.push({file});
                    referenced.add(file);
                    added += 1;
                }
            });
            return {ok: true, value: {added}};
        });
    }

    /** 删没加进来的图：清单里有这个文件（它是表情）或者包没有表情列表时不删，得 `sticker-missing`。 */
    async deleteFile(id: string, file: string): Promise<Edited<null>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            const raw = await this.#readManifest(folder);
            const list = raw !== null && Array.isArray(raw.stickers) ? raw.stickers : null;
            if (list === null || list.some((entry) => isObject(entry) && entry.file === file) || !(await this.#images(folder)).includes(file)) return failed("sticker-missing", `${file} 不是没加进来的图`);
            return this.#deleteFiles(folder, [file]);
        });
    }

    async #deleteFiles(folder: string, files: readonly string[]): Promise<Edited<null>> {
        const deleted = await this.#files.delete(files.map((file) => ({address: fileAddress(folder, file)})));
        if (!deleted.ok) return failed(filesFailure(deleted.code), deleted.detail);
        const failure = deleted.value.items.find((item) => item.status !== "done");
        if (failure !== undefined && failure.status === "failed" && failure.code !== "not-found") return failed(filesFailure(failure.code), failure.detail);
        return {ok: true, value: null};
    }

    /** 新建（输出 31）：在暂存里建好清单，再改名成正式包名，包名被用了得 `pack-exists`。 */
    async createPack(folder: string, title: string | null): Promise<Edited<{readonly id: string}>> {
        if (!FOLDER_NAME.test(folder)) return failed("folder-invalid", "包名只能是小写字母、数字与连字符，1 到 64 个，不以连字符开头或结尾");
        return this.#write([folder], async () => {
            const display = textField(title, "title-invalid", "显示名");
            const manifest = serialize(display === null ? {} : {title: display});
            const staging = `${STAGING_PREFIX}${randomUUID()}`;
            const written = await this.#files.write(fileAddress(staging, MANIFEST_FILE), manifest, {expect: "absent", createParents: true});
            if (!written.ok) return failed(filesFailure(written.code), written.detail);
            return this.#publish(staging, [folder]);
        });
    }

    /** 把暂存改名成正式包名：依次试 `candidates`，都被占了得 `pack-exists`；失败删掉暂存。 */
    async #publish(staging: string, candidates: readonly string[]): Promise<Edited<{readonly id: string}>> {
        for (const name of candidates) {
            const renamed = await this.#files.rename(packAddress(staging), name);
            if (renamed.ok) return {ok: true, value: {id: packId(USER, name)}};
            if (renamed.code !== "conflict") {
                await this.#discard(staging);
                return failed(filesFailure(renamed.code), renamed.detail);
            }
        }
        await this.#discard(staging);
        return failed("pack-exists", `包名 ${candidates[0] ?? ""} 已经被用了`);
    }

    /** 改包名（输出 33）：带页面拿到的文件夹令牌作这次改名的 `expected`，文件夹被别处换掉了得 `pack-changed`。 */
    async renamePack(id: string, folder: string, token: string): Promise<Edited<{readonly id: string}>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        if (!FOLDER_NAME.test(folder)) return failed("folder-invalid", "包名只能是小写字母、数字与连字符，1 到 64 个，不以连字符开头或结尾");
        const from = pack.value.entry.folder;
        if (folder === from) return {ok: true, value: {id}};
        return this.#write([from, folder], async () => {
            const renamed = await this.#files.rename(packAddress(from), folder, {expected: token});
            if (renamed.ok) return {ok: true, value: {id: packId(USER, folder)}};
            return renamed.code === "conflict" ? failed("pack-exists", `包名 ${folder} 已经被用了`) : failed(filesFailure(renamed.code), renamed.detail);
        });
    }

    /** 删除表情包（输出 34）：带令牌；没删完的照实报部分完成。 */
    async deletePack(id: string, token: string): Promise<Edited<null>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        return this.#write([folder], async () => {
            const deleted = await this.#files.delete([{address: packAddress(folder), expected: token}]);
            if (!deleted.ok) return failed(filesFailure(deleted.code), deleted.detail);
            const item = deleted.value.items[0];
            if (item === undefined || item.status === "done") return {ok: true, value: null};
            if (item.status === "failed") return failed(filesFailure(item.code), item.partial === undefined ? item.detail : `部分完成，以目录为准：${item.detail}`);
            return failed("write-failed", "没有删");
        });
    }

    /**
     * 复制到我的（输出 32）：插件或内置的包里的清单与顶层图片，合计至多 `COPY_BYTES_MAX`。先记下插件根的版本，写进暂存，提交前再核对一次，
     * 变了（插件途中撤回或换了版本）就丢弃暂存、得 `pack-changed`。
     */
    async copyPack(id: string): Promise<Edited<{readonly id: string}>> {
        const item = this.#options.catalog.item(id);
        if (item === undefined || item.entry.status !== "ok") return failed("pack-missing", `没有可用的表情包 ${id}`);
        const version = this.#options.catalog.rootVersion(item.root);
        const {folder} = item.entry;
        const staging = `${STAGING_PREFIX}${randomUUID()}`;
        const candidates = [folder, ...Array.from({length: 49}, (_, index) => `${folder}-${String(index + 2)}`)].filter((name) => FOLDER_NAME.test(name));
        return this.#archived(() => this.#write(candidates, async () => {
            const copied = await this.#copyInto(item.directory, staging);
            if (!copied.ok || this.#options.catalog.rootVersion(item.root) !== version || this.#options.catalog.item(id) === undefined) {
                await this.#discard(staging);
                return copied.ok ? failed("pack-changed", "复制途中表情包变了（插件换了版本或被停用），再试一次") : copied;
            }
            return this.#publish(staging, candidates);
        }));
    }

    /** 丢掉暂存（失败也不要紧：下次打开目录时按前缀清掉）。 */
    async #discard(staging: string): Promise<void> {
        await this.#files.delete([{address: packAddress(staging)}]);
    }

    /**
     * 撤回刚写的图片：先取身份令牌，再核对文件内容仍是刚写的那一份，才带令牌删除；令牌取不到、内容不是刚写的都不删（别人替换了它）。
     * 核对之后到删除之间文件又被换掉时，删除按令牌被拒绝。交回是否确认撤回了（文件已经不在也算）。
     */
    async #removeWritten(folder: string, name: string, written: Baseline): Promise<boolean> {
        const address = fileAddress(folder, name);
        const token = await this.#tokenOf(`${folder}/${name}`);
        const read = await this.#files.read(address);
        if (!read.ok) return read.code === "not-found";
        if (token === null) return false;
        if (read.value.baseline.hash !== written.hash) return false;
        const deleted = await this.#files.delete([{address, expected: token}]);
        if (!deleted.ok) return false;
        const item = deleted.value.items[0];
        return item !== undefined && (item.status === "done" || (item.status === "failed" && item.code === "not-found"));
    }

    /** 一个文件夹的身份令牌（`identify`）；不在为 null。 */
    async #tokenOf(folder: string): Promise<string | null> {
        const found = await this.#files.identify([packAddress(folder)]);
        const first = found.ok ? found.value.items[0] : undefined;
        return first !== undefined && "token" in first ? first.token : null;
    }

    /**
     * 加图片（输出 29）：核对、缩小，写进包里（撞名按 `-2`、`-3` 顺延）；有表情列表的再在清单末尾加一项（名字省略、不常用），这一步
     * 失败就把刚写的图删掉（带写完时取的令牌，不删别人刚放进来的同名文件）。没有表情列表、已经有 500 张图的包再加得 `manifest-full`。
     * 图片不合格得 `image-rejected`，`detail` 是稳定的原因码（`RejectReason`）。
     */
    async addImage(id: string, file: string, bytes: Uint8Array, signal?: AbortSignal): Promise<Edited<{readonly file: string; readonly resized: boolean}, EditCode | ArchiveCode>> {
        const pack = this.#userPack(id);
        if (!pack.ok) return pack;
        const {folder} = pack.value.entry;
        const prepared = await prepareImage(file, bytes);
        if (!prepared.ok) return failed("image-rejected", prepared.reason);
        return this.#write([folder], async () => {
            // 排队等锁期间客户端断开了：不写。图片一写进去就做完，不在中途停（清单与图片要一致）。
            if (signal?.aborted === true) return failed("request-aborted", "请求已取消");
            const raw = await this.#readManifest(folder);
            const listed = raw !== null && Array.isArray(raw.stickers);
            if (!listed && (await this.#images(folder)).length >= STICKERS_PER_PACK_MAX) return failed("manifest-full", `文件夹里已经有 ${String(STICKERS_PER_PACK_MAX)} 张图`);
            const dot = prepared.file.lastIndexOf(".");
            let name: string | null = null;
            let written: Baseline | null = null;
            for (let attempt = 1; attempt <= NAME_TRIES && name === null; attempt += 1) {
                const candidate = attempt === 1 ? prepared.file : `${prepared.file.slice(0, dot)}-${String(attempt)}${prepared.file.slice(dot)}`;
                if (!uploadName(candidate)) break;
                const result = await this.#files.write(fileAddress(folder, candidate), prepared.bytes, {expect: "absent"});
                if (result.ok) {
                    name = candidate;
                    written = result.value.baseline;
                } else if (result.code !== "conflict") return failed(filesFailure(result.code), result.detail);
            }
            if (name === null || written === null) return failed("pack-exists", `${prepared.file} 的名字都被用了`);
            if (listed) {
                try {
                    await this.#editManifest(folder, (current) => {
                        (current.stickers as unknown[]).push({file: name});
                    });
                } catch (error) {
                    const removed = await this.#removeWritten(folder, name, written);
                    if (error instanceof EditAbort) return failed(removed ? error.code : "write-failed", removed ? error.message : `部分完成，图片 ${name} 已写入但没能撤回，以目录为准：${error.message}`);
                    throw error;
                }
            }
            return {ok: true, value: {file: name, resized: prepared.resized}};
        });
    }

    /**
     * 导出（输出 35）：清单与文件夹顶层文件名合格的图片，只存不压；超过 600 项、求和超过 64 MiB、打出来的 zip 超过 64 MiB、没有图片、
     * 单个文件超过导入的单项上限、有只差大小写的重名都不导出，这样导出的一定能导回来。插件的包也能导出；无效的表情包不能。
     */
    async exportPack(id: string): Promise<Edited<{readonly name: string; readonly bytes: Uint8Array}, EditCode | ArchiveCode>> {
        const item = this.#options.catalog.item(id);
        if (item === undefined) return failed("pack-missing", `没有表情包 ${id}`);
        if (item.entry.status !== "ok") return failed("pack-invalid", "无效的表情包不能导出，先在文件夹里修好它");
        const {folder} = item.entry;
        return this.#archived(() => this.#locks.with([folder], async () => {
            const children = await readdir(item.directory, {withFileTypes: true}).catch(() => null);
            if (children === null) return failed("pack-missing", "表情包的文件夹读不了");
            const names = children.filter((child) => child.isFile() && (child.name === MANIFEST_FILE || uploadName(child.name))).map((child) => child.name).sort(byCodeUnit);
            const images = names.filter((name) => name !== MANIFEST_FILE);
            if (images.length === 0) return failed("export-empty", "没有图片，导出的包导不回来");
            if (names.length > ARCHIVE_LIMITS.entries) return failed("export-too-large", `超过 ${String(ARCHIVE_LIMITS.entries)} 个文件`);
            // 导入端把只差大小写或 NFC 的两个名字当同一个文件拒绝：区分大小写的文件系统上 `Happy.png` 与 `happy.png` 可以并存，导出时就不放行。
            const seen = new Set<string>();
            for (const name of names) {
                const key = name.normalize("NFC").toLowerCase();
                if (seen.has(key)) return failed("export-conflict", `${name} 与另一个文件只差大小写，导回时会被当成同一个文件`);
                seen.add(key);
            }
            const files: Array<{name: string; bytes: Uint8Array}> = [];
            let total = 0;
            for (const name of names) {
                const bytes = await readFile(join(item.directory, name)).catch(() => null);
                if (bytes === null) return failed("pack-changed", `读不了 ${name}`);
                if (bytes.length > ARCHIVE_LIMITS.fileBytes) return failed("export-too-large", `${name} 超过 32 MiB，导回时会被拒绝`);
                total += bytes.length;
                if (total > ARCHIVE_LIMITS.archiveBytes) return failed("export-too-large", "超过 64 MiB");
                files.push({name, bytes: new Uint8Array(bytes)});
            }
            const zipped = zipPack(folder, files);
            if (zipped.length > ARCHIVE_LIMITS.archiveBytes) return failed("export-too-large", "打成 zip 超过 64 MiB");
            return {ok: true, value: {name: `${folder}.zip`, bytes: zipped}};
        }));
    }

    /**
     * 导入 zip（输出 36）。先在内存里核对（路径、形状、重名、实际字节的上限、清单能解析、至少一张合格的图），再写进暂存；包名没被用就改名成
     * 正式包名。被用了且没给 `choice` 时交回冲突（不写任何东西）：`copy` 另存成下一个空的 `-N`；`replace` 带已有的包的令牌，把旧包挪开、
     * 换上新的、删旧的（第二步失败就把旧包改回来，改回也失败就留着，启动时写诊断）。
     */
    async importZip(archive: Uint8Array, zipName: string, choice?: {readonly mode: "copy"} | {readonly mode: "replace"; readonly token: string}, signal?: AbortSignal): Promise<Edited<{readonly id: string}, EditCode | ArchiveCode>> {
        // 函数调用不让 TS 按前一次判断收窄 `signal.aborted`（取消随时会发生）。
        const cancelled = (): boolean => signal?.aborted === true;
        return this.#archived(async () => {
            const unpacked = unpackZip(archive);
            if (!unpacked.ok) return failed("import-invalid", unpacked.reason);
            const base = packNameFrom(unpacked.folder ?? zipName);
            if (base === null) return failed("import-invalid", "转不出合规的包名（要有字母或数字），改一下文件夹或 zip 的名字");
            const manifestBytes = unpacked.files.get(MANIFEST_FILE);
            if (manifestBytes !== undefined) {
                if (manifestBytes.length > MANIFEST_MAX_BYTES) return failed("import-invalid", "清单超过 256 KiB");
                let json: unknown;
                try {
                    json = JSON.parse(new TextDecoder().decode(manifestBytes));
                } catch {
                    return failed("import-invalid", "清单读不懂");
                }
                const parsed = parseManifest(json);
                if (!parsed.ok) return failed("import-invalid", `清单不合规则：${parsed.detail}`);
            }
            let accepted = 0;
            for (const [name, bytes] of unpacked.files) if (name !== MANIFEST_FILE && (await checkImage(bytes, name)).ok) accepted += 1;
            if (accepted === 0) return failed("import-invalid", "zip 里没有合格的图片");

            const candidates = [base, ...Array.from({length: 49}, (_, index) => `${base}-${String(index + 2)}`)];
            return this.#write(candidates, async () => {
                if (cancelled()) return failed("request-aborted", "请求已取消");
                const exists = await this.#tokenOf(base);
                if (exists !== null && choice === undefined) return this.#conflict(base, exists, candidates);
                if (exists !== null && choice?.mode === "replace" && choice.token !== exists) return failed("pack-changed", "已有的表情包被别处改过，重新选择");
                if (exists === null && choice?.mode === "replace") return failed("pack-missing", "要替换的表情包已经不在了");
                const staging = `${STAGING_PREFIX}${randomUUID()}`;
                for (const [name, bytes] of unpacked.files) {
                    const written = cancelled() ? null : await this.#files.write(fileAddress(staging, name), bytes, {expect: "absent", createParents: true});
                    if (written === null || !written.ok) {
                        await this.#discard(staging);
                        return written === null ? failed("request-aborted", "请求已取消") : failed(filesFailure(written.code), written.detail);
                    }
                }
                // 改名成正式包名之前最后核对一次；改名开始后就做完。
                if (cancelled()) {
                    await this.#discard(staging);
                    return failed("request-aborted", "请求已取消");
                }
                if (choice?.mode === "replace") return this.#replace(staging, base, choice.token);
                return this.#publish(staging, exists === null ? [base] : candidates.slice(1));
            });
        });
    }

    /** 同名冲突时页面要的信息：已有的包的概况与令牌，另存时会用的包名。 */
    async #conflict(base: string, token: string, candidates: readonly string[]): Promise<Edited<never, "import-conflict">> {
        const item = this.#options.catalog.item(packId(USER, base));
        const free = await this.#files.identify(candidates.slice(1).map(packAddress));
        const index = free.ok ? free.value.items.findIndex((entry) => "code" in entry) : -1;
        return {
            ok: false,
            code: "import-conflict",
            detail: `已经有一个包名是 ${base} 的表情包`,
            conflict: {
                existing: {id: packId(USER, base), title: item?.entry.title ?? base, count: item?.entry.stickers.length ?? 0, files: (item?.entry.stickers ?? []).slice(0, 4).map((sticker) => sticker.file), token},
                copyAs: index < 0 ? null : (candidates[index + 1] ?? null),
            },
        };
    }

    /** 替换：旧包挪到 `.nbook-stickers-replaced-…`（这次改名带令牌），暂存改名成正式名，删掉旧的；换不上就把旧的改回来。 */
    async #replace(staging: string, base: string, token: string): Promise<Edited<{readonly id: string}>> {
        const moved = `${REPLACED_PREFIX}${base}-${randomUUID()}`;
        const away = await this.#files.rename(packAddress(base), moved, {expected: token});
        if (!away.ok) {
            await this.#discard(staging);
            return failed(away.code === "not-found" ? "pack-missing" : filesFailure(away.code), away.detail);
        }
        const placed = await this.#files.rename(packAddress(staging), base);
        if (!placed.ok) {
            const back = await this.#files.rename(packAddress(moved), base);
            await this.#discard(staging);
            return failed(back.ok ? filesFailure(placed.code) : "write-failed", back.ok ? placed.detail : `没换成，旧的表情包留在 ${moved}：${placed.detail}`);
        }
        await this.#files.delete([{address: packAddress(moved)}]);
        return {ok: true, value: {id: packId(USER, base)}};
    }

    /** 从插件或内置的包的文件夹（目录记下的真实目录，同扫描）读清单与顶层图片，跳过链接与别的文件，写进暂存。 */
    async #copyInto(directory: string, staging: string): Promise<Edited<null>> {
        const children = await readdir(directory, {withFileTypes: true}).catch(() => null);
        if (children === null) return failed("pack-missing", "要复制的表情包列不出来");
        const names = children.filter((child) => child.isFile() && (child.name === MANIFEST_FILE || isImageFileName(child.name))).map((child) => child.name).sort(byCodeUnit);
        let total = 0;
        for (const name of names) {
            const bytes = await readFile(join(directory, name)).catch(() => null);
            if (bytes === null) return failed("pack-changed", `读不了 ${name}`);
            total += bytes.length;
            if (total > COPY_BYTES_MAX) return failed("too-large", "要复制的表情包超过 64 MiB，不能复制");
            const written = await this.#files.write(fileAddress(staging, name), new Uint8Array(bytes), {expect: "absent", createParents: true});
            if (!written.ok) return failed(filesFailure(written.code), written.detail);
        }
        if (!names.includes(MANIFEST_FILE)) {
            const written = await this.#files.write(fileAddress(staging, MANIFEST_FILE), serialize({}), {expect: "absent", createParents: true});
            if (!written.ok) return failed(filesFailure(written.code), written.detail);
        }
        return {ok: true, value: null};
    }
}

function parseRaw(text: string): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new EditAbort("write-failed", "清单读不懂，先在文件夹里修好它");
    }
    if (!isObject(value)) throw new EditAbort("write-failed", "清单不是对象，先在文件夹里修好它");
    return value;
}

function setOrDelete(target: Record<string, unknown>, key: string, value: string | null): void {
    if (value === null) delete target[key];
    else target[key] = value;
}
