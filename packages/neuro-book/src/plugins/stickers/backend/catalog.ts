/**
 * 表情目录（docs/specs/agent/stickers.md 输出 1–6）：按根扫描表情包，核对清单与图片，监视用户的表情包文件夹，变了重扫并通知。
 *
 * 根有用户与插件两种来源：用户的一个，启动时给定并建好；插件的每个 `stickers.packs` 贡献一个，随贡献的发布与撤回增删。
 * 监视用非递归的 `fs.watch`：用户的根与其中每个表情包文件夹。任何一处变了都重扫整个用户的根（用户的表情包通常不多）。
 * 插件的表情包装在版本目录里、一次运行里不变，不监视。
 *
 * 图片在扫描时读一遍：按开头的字节判定类型、取宽高（`Bun.Image`）、算版本（修改时间与大小）。取图路由读的时候再判一次，
 * 扫描之后被换掉的文件不会按旧的结论给出去。
 */

import {watch, type FSWatcher} from "node:fs";
import {lstat, mkdir, readdir, readFile} from "node:fs/promises";
import {join, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {sniffImageType} from "nbook/shared/image-type";

import {FOLDER_NAME, IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_TYPES, MANIFEST_FILE, MANIFEST_MAX_BYTES, packId} from "../shared/contracts";
import type {StickerEntry, StickerPackEntry, StickerPackProblem, StickerSource} from "../shared/contracts";
import {parseManifest} from "../shared/manifest";

/** 文件变化合并成一次重扫的等待时长：解压、同步工具会连着改好几个文件。 */
const RESCAN_DELAY_MS = 150;

export interface StickerRoot {
    /** 根的稳定身份：用户的根是 `user`，插件的根是贡献 id。同 id 的表情包按它的码元顺序取先到的。 */
    readonly key: string;
    readonly source: StickerSource;
    /** 表情包 id 的前缀：用户的是 `user`，插件的是插件 id。 */
    readonly prefix: string;
    readonly root: string;
    readonly watch: boolean;
    readonly plugin?: {readonly id: string; readonly title: string | null};
}

/** 目录里的一项：条目加真实目录与所属根的 `key`。 */
export interface StickerPackItem {
    readonly entry: StickerPackEntry;
    readonly directory: string;
    readonly root: string;
}

export interface StickerCatalogOptions {
    readonly roots: readonly StickerRoot[];
    readonly clock: RuntimeClock;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** 扫描一个表情包时发现的、要写诊断的问题；与上一次相同时不再写（输出 5）。 */
interface PackFindings {
    readonly invalid?: StickerPackProblem;
    readonly ignored: readonly string[];
    readonly stickers: readonly string[];
}

export class StickerCatalog {
    readonly #options: StickerCatalogOptions;
    #roots: StickerRoot[];
    readonly #byRoot = new Map<string, Array<{readonly item: StickerPackItem; readonly findings: PackFindings}>>();
    #items = new Map<string, StickerPackItem>();
    /** 上一次写过诊断的问题，按表情包 id（JSON）。 */
    readonly #reported = new Map<string, string>();
    readonly #listeners = new Set<() => void>();
    readonly #watchers = new Map<string, FSWatcher>();
    readonly #pending = new Map<string, () => void>();
    #scanning: Promise<void> = Promise.resolve();
    #closed = false;

    private constructor(options: StickerCatalogOptions) {
        this.#options = options;
        this.#roots = [...options.roots];
    }

    /** 建好要监视的根（用户的表情包文件夹）并扫一遍。 */
    static async open(options: StickerCatalogOptions): Promise<StickerCatalog> {
        const catalog = new StickerCatalog(options);
        for (const root of options.roots) if (root.watch) await mkdir(root.root, {recursive: true});
        await catalog.#queue(async () => {
            for (const root of catalog.#roots) catalog.#byRoot.set(root.key, await catalog.#scanRoot(root));
            return catalog.#derive();
        });
        return catalog;
    }

    /** 全部表情包（含无效的），按 id 的码元顺序。 */
    list(): readonly StickerPackEntry[] {
        return [...this.#items.values()].map((item) => item.entry).sort((left, right) => byCodeUnit(left.id, right.id));
    }

    item(id: string): StickerPackItem | undefined {
        return this.#items.get(id);
    }

    onChanged(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async addRoot(root: StickerRoot): Promise<void> {
        await this.#queue(async () => {
            this.#roots = [...this.#roots.filter((candidate) => candidate.key !== root.key), root];
            this.#byRoot.set(root.key, await this.#scanRoot(root));
            return this.#derive();
        });
    }

    async removeRoot(key: string): Promise<void> {
        await this.#queue(async () => {
            this.#roots = this.#roots.filter((candidate) => candidate.key !== key);
            this.#byRoot.delete(key);
            return this.#derive();
        });
    }

    /** 等排队中的重扫做完（测试与停止用）。 */
    async settled(): Promise<void> {
        await this.#scanning;
    }

    async close(): Promise<void> {
        this.#closed = true;
        for (const cancel of this.#pending.values()) cancel();
        this.#pending.clear();
        for (const watcher of this.#watchers.values()) watcher.close();
        this.#watchers.clear();
        this.#listeners.clear();
        await this.#scanning;
    }

    /** 重扫一个接一个地做，免得后完成的旧结果盖掉新的；每次之后对一遍监视器，内容变了才通知。 */
    #queue(work: () => Promise<boolean>): Promise<void> {
        const run = this.#scanning.then(async () => {
            if (this.#closed) return;
            const changed = await work();
            this.#syncWatchers();
            if (changed) for (const listener of [...this.#listeners]) listener();
        });
        this.#scanning = run.catch((error: unknown) => this.#options.report("scan-failed", "表情目录重扫失败", {message: error instanceof Error ? error.message : String(error)}));
        return this.#scanning;
    }

    /** 由各根的扫描结果合成目录，写变了的诊断；交回内容是否变了。 */
    #derive(): boolean {
        const next = new Map<string, StickerPackItem>();
        for (const root of [...this.#roots].sort((left, right) => byCodeUnit(left.key, right.key))) {
            for (const {item, findings} of this.#byRoot.get(root.key) ?? []) {
                const kept = next.get(item.entry.id);
                if (kept !== undefined) {
                    this.#reportOnce(`duplicate:${item.entry.id}:${item.root}`, {}, () => this.#options.report("pack-duplicate", `表情包 ${item.entry.id} 被带来两次，用 ${kept.directory}，不列 ${item.directory}`, {id: item.entry.id, kept: kept.root, skipped: item.root}));
                    continue;
                }
                next.set(item.entry.id, item);
                this.#reportFindings(item.entry.id, findings);
            }
        }
        const changed = next.size !== this.#items.size || [...next].some(([id, item]) => {
            const before = this.#items.get(id);
            return before === undefined || before.directory !== item.directory || JSON.stringify(before.entry) !== JSON.stringify(item.entry);
        });
        this.#items = next;
        return changed;
    }

    #reportFindings(id: string, findings: PackFindings): void {
        this.#reportOnce(`pack:${id}`, findings.invalid ?? null, () => findings.invalid !== undefined && this.#options.report("pack-invalid", `表情包 ${id} 无效：${findings.invalid.code}`, {id, problem: findings.invalid}));
        this.#reportOnce(`fields:${id}`, findings.ignored, () => findings.ignored.length > 0 && this.#options.report("field-ignored", `表情包 ${id} 忽略了不合规则的字段 ${findings.ignored.join("、")}`, {id, fields: findings.ignored}));
        this.#reportOnce(`stickers:${id}`, findings.stickers, () => findings.stickers.length > 0 && this.#options.report("sticker-invalid", `表情包 ${id} 有 ${String(findings.stickers.length)} 项不列：${findings.stickers.join("；")}`, {id, stickers: findings.stickers}));
    }

    /** 问题与上一次写过的相同时不写（输出 5）。 */
    #reportOnce(key: string, value: unknown, write: () => unknown): void {
        const serialized = JSON.stringify(value);
        if (this.#reported.get(key) === serialized) return;
        this.#reported.set(key, serialized);
        write();
    }

    async #scanRoot(root: StickerRoot): Promise<Array<{readonly item: StickerPackItem; readonly findings: PackFindings}>> {
        const children = await readdir(root.root, {withFileTypes: true}).catch((error: unknown) => {
            if (errorCode(error) !== "ENOENT") this.#options.report("scan-failed", `读不了表情包文件夹 ${root.root}`, {source: root.source, message: error instanceof Error ? error.message : String(error)});
            return [];
        });
        const packs = [];
        // 按名字排序：readdir 的顺序随文件系统变，诊断的先后要稳定。文件与以点开头的条目不是表情包；链接照样列出，状态是无效。
        for (const child of children.sort((left, right) => byCodeUnit(left.name, right.name))) {
            if (child.name.startsWith(".") || !(child.isDirectory() || child.isSymbolicLink())) continue;
            packs.push(await this.#readPack(root, join(root.root, child.name), child.name, child.isSymbolicLink()));
        }
        return packs;
    }

    async #readPack(root: StickerRoot, directory: string, folder: string, link: boolean): Promise<{readonly item: StickerPackItem; readonly findings: PackFindings}> {
        const base = {id: packId(root.prefix, folder), folder, source: root.source, ...(root.plugin === undefined ? {} : {plugin: root.plugin})};
        const invalid = (problem: StickerPackProblem) => ({item: {directory, root: root.key, entry: {...base, title: folder, status: "invalid" as const, problem, stickers: []}}, findings: {invalid: problem, ignored: [], stickers: []}});
        if (link) return invalid({code: "symlink"});
        if (!FOLDER_NAME.test(folder)) return invalid({code: "folder-name"});
        const manifestPath = join(directory, MANIFEST_FILE);
        const info = await lstat(manifestPath).catch(() => null);
        if (info === null) return invalid({code: "manifest-missing"});
        if (!info.isFile()) return invalid({code: "manifest-unreadable", detail: `${MANIFEST_FILE} 不是普通文件`});
        if (info.size > MANIFEST_MAX_BYTES) return invalid({code: "manifest-too-large"});
        let json: unknown;
        try {
            json = JSON.parse(await readFile(manifestPath, "utf8"));
        } catch (error) {
            return invalid({code: "manifest-unreadable", detail: error instanceof Error ? error.message : String(error)});
        }
        const parsed = parseManifest(json);
        if (!parsed.ok) return invalid({code: "manifest-invalid", detail: parsed.detail});
        const problems: string[] = [];
        const stickers: StickerEntry[] = [];
        for (const item of parsed.items) {
            if (!item.ok) {
                problems.push(`第 ${String(item.index + 1)} 项${item.reason}`);
                continue;
            }
            const image = await readImage(join(directory, item.sticker.file), item.sticker.file);
            if (!image.ok) problems.push(`${item.sticker.name}：${image.reason}`);
            else stickers.push({...item.sticker, width: image.width, height: image.height, version: image.version});
        }
        if (parsed.truncated > 0) problems.push(`超过 500 项，后面 ${String(parsed.truncated)} 项不认`);
        return {
            item: {directory, root: root.key, entry: {...base, title: parsed.title ?? folder, ...(parsed.description === undefined ? {} : {description: parsed.description}), status: "ok", stickers}},
            findings: {ignored: parsed.ignored, stickers: problems},
        };
    }

    #syncWatchers(): void {
        if (this.#closed) return;
        const wanted = new Map<string, () => void>();
        for (const root of this.#roots) {
            if (!root.watch) continue;
            const rescan = () => this.#schedule(root.key, async () => {
                const current = this.#roots.find((candidate) => candidate.key === root.key);
                if (current === undefined) return false;
                this.#byRoot.set(root.key, await this.#scanRoot(current));
                return this.#derive();
            });
            wanted.set(root.root, rescan);
            for (const {item} of this.#byRoot.get(root.key) ?? []) if (item.entry.problem?.code !== "symlink") wanted.set(item.directory, rescan);
        }
        for (const [path, watcher] of this.#watchers) {
            if (wanted.has(path)) continue;
            watcher.close();
            this.#watchers.delete(path);
        }
        for (const [path, onChange] of wanted) {
            if (this.#watchers.has(path)) continue;
            try {
                // 子目录被删掉再建后是另一个目录，按路径留着的旧监视器收不到它的事件：上一级报出某个子项变了，就关掉这个子项的
                // 监视器，重扫之后按新的目录重建（同 Skill 目录）。
                const watcher = watch(path, {persistent: false}, (_event, filename) => {
                    if (filename !== null) this.#forgetWatchers(join(path, String(filename)));
                    onChange();
                });
                watcher.on("error", () => {
                    watcher.close();
                    if (this.#watchers.get(path) === watcher) this.#watchers.delete(path);
                });
                this.#watchers.set(path, watcher);
            } catch (error) {
                if (errorCode(error) !== "ENOENT") this.#options.report("watch-failed", `监视不了 ${path}`, {message: error instanceof Error ? error.message : String(error)});
            }
        }
    }

    #forgetWatchers(path: string): void {
        for (const [watched, watcher] of this.#watchers) {
            if (watched !== path && !watched.startsWith(`${path}${sep}`)) continue;
            watcher.close();
            this.#watchers.delete(watched);
        }
    }

    #schedule(key: string, work: () => Promise<boolean>): void {
        if (this.#closed) return;
        this.#pending.get(key)?.();
        this.#pending.set(key, this.#options.clock.schedule(() => {
            this.#pending.delete(key);
            void this.#queue(work);
        }, RESCAN_DELAY_MS));
    }
}

export type ImageCheck = {readonly ok: true; readonly type: string; readonly width: number; readonly height: number} | {readonly ok: false; readonly reason: string};

/** 核对一张表情图的字节（输出 4）：不超过 2 MiB、是与扩展名相符的图片、宽高不超过 1024。取图路由读到字节后也用它。 */
export async function checkImage(bytes: Uint8Array, file: string): Promise<ImageCheck> {
    if (bytes.length > IMAGE_MAX_BYTES) return {ok: false, reason: "超过 2 MiB"};
    const type = sniffImageType(bytes);
    const expected = IMAGE_TYPES[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
    if (type === null || type !== expected) return {ok: false, reason: "字节不是与扩展名相符的图片"};
    let size: {width: number; height: number};
    try {
        size = await new Bun.Image(bytes).metadata();
    } catch {
        return {ok: false, reason: "读不出图片的宽高"};
    }
    if (size.width > IMAGE_MAX_SIDE || size.height > IMAGE_MAX_SIDE) return {ok: false, reason: `宽或高超过 ${String(IMAGE_MAX_SIDE)} 像素`};
    return {ok: true, type, width: size.width, height: size.height};
}

/** 扫描时核对一张表情图：普通文件、不是链接，再核对字节；交回版本（修改时间与大小）。 */
async function readImage(path: string, file: string): Promise<{readonly ok: true; readonly width: number; readonly height: number; readonly version: string} | {readonly ok: false; readonly reason: string}> {
    const info = await lstat(path).catch(() => null);
    if (info === null) return {ok: false, reason: "文件不在"};
    if (info.isSymbolicLink()) return {ok: false, reason: "文件是链接"};
    if (!info.isFile()) return {ok: false, reason: "不是普通文件"};
    if (info.size > IMAGE_MAX_BYTES) return {ok: false, reason: "超过 2 MiB"};
    const checked = await checkImage(new Uint8Array(await readFile(path)), file);
    if (!checked.ok) return checked;
    return {ok: true, width: checked.width, height: checked.height, version: `${String(Math.round(info.mtimeMs))}-${String(info.size)}`};
}
