/**
 * 表情目录（docs/specs/agent/stickers.md 输出 1–6）：按根扫描表情包，核对清单与图片，监视用户的表情包文件夹，变了重扫并通知。
 *
 * 根有用户与插件两种来源：用户的一个，启动时给定并建好；插件的每个 `stickers.packs` 贡献一个，随贡献的发布与撤回增删。
 * 监视用非递归的 `fs.watch`：用户的根与其中每个表情包文件夹。任何一处变了都重扫整个用户的根（用户的表情包通常不多）；
 * 没变的图片（修改时间、大小与 inode 相同）沿用上一次的核对结果，重扫只读清单（没写表情列表的再列一次文件夹）、`lstat` 每张图。插件的表情包装在版本目录里、
 * 一次运行里不变，不监视。
 *
 * 图片第一次见到时读一遍：按开头的字节判定类型、取宽高（`Bun.Image`）、算版本（修改时间、大小与 inode）。取图路由读的时候再判
 * 一次，扫描之后被换掉的文件不会按旧的结论给出去。
 *
 * 表情包页另要两类不是表情的图（`extras`）：名字当不了表情名的、有表情列表时文件夹里清单没列的；它们只在目录条目旁边记着，不进
 * 条目（浏览器目录与槽只看条目）。页面写完文件用 `refresh` 等到目录已是写完的样子。
 */

import {watch, type FSWatcher, type Stats} from "node:fs";
import {lstat, mkdir, readdir, readFile, rm} from "node:fs/promises";
import {join, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {sniffImageType} from "nbook/shared/image-type";

import {EXTRAS_MAX, FOLDER_NAME, IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_TYPES, MANIFEST_FILE, MANIFEST_MAX_BYTES, packId, REPLACED_PREFIX, STAGING_PREFIX} from "../shared/contracts";
import type {ExtraCounts, StickerEntry, StickerExtra, StickerPackEntry, StickerPackProblem, StickerSource} from "../shared/contracts";
import {isImageFileName, parseManifest, stickersFromFiles} from "../shared/manifest";

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

/**
 * 目录里的一项：条目加真实目录与所属根的 `key`；`listed` 是清单写了表情列表；`extras` 每类至多 `EXTRAS_MAX` 张，`counts` 是总数。
 */
export interface StickerPackItem {
    readonly entry: StickerPackEntry;
    readonly directory: string;
    readonly root: string;
    readonly listed: boolean;
    readonly extras: readonly StickerExtra[];
    readonly counts: ExtraCounts;
    /**
     * 用户的包的文件夹身份令牌（表情包页改包名、删除、替换时带回）；插件的包与取不到时为 null。在读这个包的内容之前取：
     * 取到之后文件夹又被换掉时，令牌比内容旧，带回去的条件操作会被拒绝，不会把旧内容配上新文件夹的令牌。
     */
    readonly token: string | null;
}

export interface StickerCatalogOptions {
    readonly roots: readonly StickerRoot[];
    readonly clock: RuntimeClock;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    /** 按文件夹名取用户的包的身份令牌，与入参同序；某项取不到时是 null。缺省时都是 null（没有 Files 服务的场合）。 */
    readonly identify?: (folders: readonly string[]) => Promise<ReadonlyArray<string | null>>;
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
    /** 上一次写过诊断的问题，按表情包 id（JSON）。每次合成目录后去掉不再出现的（表情包删了、不再重复）。 */
    readonly #reported = new Map<string, string>();
    /**
     * 各根上一次扫描核对过的图片，按路径：文件的修改时间、大小与 inode 都没变时不再读字节、不再解码。重扫一个根时只留这次还在的，
     * 所以不随删掉的图增长。
     */
    readonly #images = new Map<string, Map<string, {readonly stamp: string; readonly result: ImageRead}>>();
    readonly #listeners = new Set<() => void>();
    readonly #watchers = new Map<string, FSWatcher>();
    readonly #pending = new Map<string, () => void>();
    /** 每个根被加进来的次数：插件撤回再登记同一个贡献时变，复制插件的包据此发现途中换了版本。 */
    readonly #rootVersions = new Map<string, number>();
    #rootCounter = 0;
    #scanning: Promise<void> = Promise.resolve();
    #closed = false;

    private constructor(options: StickerCatalogOptions) {
        this.#options = options;
        this.#roots = [...options.roots];
    }

    /** 建好要监视的根（用户的表情包文件夹）并扫一遍。 */
    static async open(options: StickerCatalogOptions): Promise<StickerCatalog> {
        const catalog = new StickerCatalog(options);
        for (const root of options.roots) {
            catalog.#rootCounter += 1;
            catalog.#rootVersions.set(root.key, catalog.#rootCounter);
            if (root.watch) await mkdir(root.root, {recursive: true});
            if (root.source === "user") await catalog.#sweep(root.root);
        }
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

    /** 全部表情包的项（含无效的），按 id 的码元顺序。 */
    items(): readonly StickerPackItem[] {
        return [...this.#items.values()].sort((left, right) => byCodeUnit(left.entry.id, right.entry.id));
    }

    /**
     * 立即重扫一个根并等它发布（表情包页写完文件后用）：跳过监视的合并等待，排进同一个扫描队列；此前已到、还在等合并的监视事件被这次
     * 吸收，扫描期间新来的照常再扫。扫描失败时 reject（写已经完成，调用方报“目录没刷新”）。
     */
    refresh(rootKey: string): Promise<void> {
        this.#pending.get(rootKey)?.();
        this.#pending.delete(rootKey);
        return this.#queue(async () => {
            const current = this.#roots.find((candidate) => candidate.key === rootKey);
            if (current === undefined) return false;
            this.#byRoot.set(rootKey, await this.#scanRoot(current));
            return this.#derive();
        }, true);
    }

    onChanged(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /** 根当前的版本；根不在时 undefined。 */
    rootVersion(key: string): number | undefined {
        return this.#rootVersions.get(key);
    }

    async addRoot(root: StickerRoot): Promise<void> {
        this.#rootCounter += 1;
        this.#rootVersions.set(root.key, this.#rootCounter);
        await this.#queue(async () => {
            this.#roots = [...this.#roots.filter((candidate) => candidate.key !== root.key), root];
            this.#byRoot.set(root.key, await this.#scanRoot(root));
            return this.#derive();
        });
    }

    async removeRoot(key: string): Promise<void> {
        this.#rootVersions.delete(key);
        await this.#queue(async () => {
            this.#roots = this.#roots.filter((candidate) => candidate.key !== key);
            this.#byRoot.delete(key);
            this.#images.delete(key);
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

    /**
     * 重扫一个接一个地做，免得后完成的旧结果盖掉新的；每次之后对一遍监视器，内容变了才通知。失败写诊断、不卡住后面的；`rejects` 时
     * 交给调用方的 promise 照样 reject（`refresh` 要知道）。
     */
    #queue(work: () => Promise<boolean>, rejects = false): Promise<void> {
        const run = this.#scanning.then(async () => {
            if (this.#closed) return;
            const changed = await work();
            this.#syncWatchers();
            if (changed) for (const listener of [...this.#listeners]) listener();
        });
        this.#scanning = run.catch((error: unknown) => this.#options.report("scan-failed", "表情目录重扫失败", {message: error instanceof Error ? error.message : String(error)}));
        return rejects ? run : this.#scanning;
    }

    /** 打开时清掉没提交的暂存；挪开的旧包不动，写诊断（输出 36）。 */
    async #sweep(root: string): Promise<void> {
        const children = await readdir(root, {withFileTypes: true}).catch(() => []);
        for (const child of children) {
            const path = join(root, child.name);
            if (child.name.startsWith(STAGING_PREFIX)) {
                await rm(path, {recursive: true, force: true}).catch((error: unknown) => this.#options.report("staging-left", `删不掉表情包页的暂存 ${path}`, {path, message: error instanceof Error ? error.message : String(error)}));
            } else if (child.name.startsWith(REPLACED_PREFIX)) {
                this.#options.report("replace-leftover", `替换表情包时挪开的旧包还在 ${path}，没有自动改回；需要的话手动改回原名`, {path});
            }
        }
    }

    /** 由各根的扫描结果合成目录，写变了的诊断；交回内容是否变了。 */
    #derive(): boolean {
        const next = new Map<string, StickerPackItem>();
        const touched = new Set<string>();
        const reportOnce = (key: string, value: unknown, write: () => unknown): void => {
            touched.add(key);
            this.#reportOnce(key, value, write);
        };
        for (const root of [...this.#roots].sort((left, right) => byCodeUnit(left.key, right.key))) {
            for (const {item, findings} of this.#byRoot.get(root.key) ?? []) {
                const kept = next.get(item.entry.id);
                if (kept !== undefined) {
                    reportOnce(`duplicate:${item.entry.id}:${item.root}`, {}, () => this.#options.report("pack-duplicate", `表情包 ${item.entry.id} 被带来两次，用 ${kept.directory}，不列 ${item.directory}`, {id: item.entry.id, kept: kept.root, skipped: item.root}));
                    continue;
                }
                next.set(item.entry.id, item);
                this.#reportFindings(item.entry.id, findings, reportOnce);
            }
        }
        for (const key of [...this.#reported.keys()]) if (!touched.has(key)) this.#reported.delete(key);
        const changed = next.size !== this.#items.size || [...next].some(([id, item]) => {
            const before = this.#items.get(id);
            return before === undefined || before.directory !== item.directory || before.listed !== item.listed || before.token !== item.token || JSON.stringify(before.entry) !== JSON.stringify(item.entry) || JSON.stringify(before.counts) !== JSON.stringify(item.counts) || JSON.stringify(before.extras) !== JSON.stringify(item.extras);
        });
        this.#items = next;
        return changed;
    }

    #reportFindings(id: string, findings: PackFindings, reportOnce: (key: string, value: unknown, write: () => unknown) => void): void {
        reportOnce(`pack:${id}`, findings.invalid ?? null, () => findings.invalid !== undefined && this.#options.report("pack-invalid", `表情包 ${id} 无效：${findings.invalid.code}`, {id, problem: findings.invalid}));
        reportOnce(`fields:${id}`, findings.ignored, () => findings.ignored.length > 0 && this.#options.report("field-ignored", `表情包 ${id} 忽略了不合规则的字段 ${findings.ignored.join("、")}`, {id, fields: findings.ignored}));
        reportOnce(`stickers:${id}`, findings.stickers, () => findings.stickers.length > 0 && this.#options.report("sticker-invalid", `表情包 ${id} 有 ${String(findings.stickers.length)} 项不列：${findings.stickers.join("；")}`, {id, stickers: findings.stickers}));
    }

    /** 问题与上一次写过的相同时不写（输出 5）。 */
    #reportOnce(key: string, value: unknown, write: () => unknown): void {
        const serialized = JSON.stringify(value);
        if (this.#reported.get(key) === serialized) return;
        this.#reported.set(key, serialized);
        write();
    }

    async #scanRoot(root: StickerRoot): Promise<Array<{readonly item: StickerPackItem; readonly findings: PackFindings}>> {
        // 根读不了（不是“不存在”）时让扫描失败：照空目录发布会让页面以为用户的包全没了；失败时保留上一次发布的目录。
        const children = await readdir(root.root, {withFileTypes: true}).catch((error: unknown) => (errorCode(error) === "ENOENT" ? [] : Promise.reject(error)));
        const packs = [];
        const previous = this.#images.get(root.key) ?? new Map();
        const images = new Map<string, {readonly stamp: string; readonly result: ImageRead}>();
        const read = async (path: string, file: string): Promise<ImageRead> => {
            const info = await lstat(path).catch(() => null);
            if (info === null) return {ok: false, reason: "文件不在"};
            const stamp = `${String(info.mtimeMs)}-${String(info.size)}-${String(info.ino)}`;
            const cached = previous.get(path);
            const result = cached?.stamp === stamp ? cached.result : await readImage(path, file, info);
            images.set(path, {stamp, result});
            return result;
        };
        // 按名字排序：readdir 的顺序随文件系统变，诊断的先后要稳定。文件与以点开头的条目不是表情包；链接照样列出，状态是无效。
        const folders = children.sort((left, right) => byCodeUnit(left.name, right.name)).filter((child) => !child.name.startsWith(".") && (child.isDirectory() || child.isSymbolicLink()));
        const tokens = root.source === "user" && this.#options.identify !== undefined ? await this.#options.identify(folders.map((child) => child.name)).catch(() => []) : [];
        for (const [index, child] of folders.entries()) {
            packs.push(await this.#readPack(root, join(root.root, child.name), child.name, child.isSymbolicLink(), read, tokens[index] ?? null));
        }
        this.#images.set(root.key, images);
        return packs;
    }

    async #readPack(root: StickerRoot, directory: string, folder: string, link: boolean, readImage: (path: string, file: string) => Promise<ImageRead>, token: string | null): Promise<{readonly item: StickerPackItem; readonly findings: PackFindings}> {
        const base = {id: packId(root.prefix, folder), folder, source: root.source, ...(root.plugin === undefined ? {} : {plugin: root.plugin})};
        const invalid = (problem: StickerPackProblem) => ({item: {directory, root: root.key, entry: {...base, title: folder, status: "invalid" as const, problem, stickers: []}, listed: false, extras: [], counts: {unrecognized: 0, unlisted: 0}, token}, findings: {invalid: problem, ignored: [], stickers: []}});
        if (link) return invalid({code: "symlink"});
        if (!FOLDER_NAME.test(folder)) return invalid({code: "folder-name"});
        const manifestPath = join(directory, MANIFEST_FILE);
        const info = await lstat(manifestPath).catch((error: unknown) => (errorCode(error) === "ENOENT" ? null : error instanceof Error ? error : new Error(String(error))));
        if (info instanceof Error) return invalid({code: "manifest-unreadable", detail: info.message});
        // 没有清单与清单 `{}` 一样：表情按文件夹里的图片。
        let json: unknown = {};
        if (info !== null) {
            if (!info.isFile()) return invalid({code: "manifest-unreadable", detail: `${MANIFEST_FILE} 不是普通文件`});
            if (info.size > MANIFEST_MAX_BYTES) return invalid({code: "manifest-too-large"});
            try {
                json = JSON.parse(await readFile(manifestPath, "utf8"));
            } catch (error) {
                return invalid({code: "manifest-unreadable", detail: error instanceof Error ? error.message : String(error)});
            }
        }
        const parsed = parseManifest(json);
        if (!parsed.ok) return invalid({code: "manifest-invalid", detail: parsed.detail});
        // 有表情列表时也列一次文件夹：找清单没列的图（extras）。
        const files = await fileNames(directory);
        if (!Array.isArray(files)) return invalid({code: "folder-unreadable", detail: files.message});
        const listed = parsed.stickers ?? stickersFromFiles(files);
        const problems: string[] = [];
        const stickers: StickerEntry[] = [];
        const named: StickerExtra[] = [];
        const counts = {unrecognized: 0, unlisted: 0};
        for (const item of listed.items) {
            if (!item.ok) {
                problems.push(`${item.label}：${item.reason}`);
                // 名字的问题、图本身没问题的，表情包页列为“认不出”，让用户改名。
                if (item.named === undefined) continue;
                const image = await readImage(join(directory, item.named.file), item.named.file);
                if (!image.ok) continue;
                counts.unrecognized += 1;
                if (named.length < EXTRAS_MAX) named.push({file: item.named.file, reason: "name", raw: item.named.raw, width: image.width, height: image.height, version: image.version, bytes: image.bytes});
                continue;
            }
            const image = await readImage(join(directory, item.sticker.file), item.sticker.file);
            if (!image.ok) problems.push(`${item.sticker.name}：${image.reason}`);
            else stickers.push({...item.sticker, width: image.width, height: image.height, version: image.version, bytes: image.bytes});
        }
        if (listed.truncated > 0) problems.push(`超过 500 项，后面 ${String(listed.truncated)} 项不认`);
        const unlisted: StickerExtra[] = [];
        if (parsed.stickers !== null) {
            for (const file of files.filter((candidate) => isImageFileName(candidate) && !listed.referenced.has(candidate)).sort(byCodeUnit)) {
                const image = await readImage(join(directory, file), file);
                if (!image.ok) continue;
                counts.unlisted += 1;
                if (unlisted.length < EXTRAS_MAX) unlisted.push({file, reason: "unlisted", raw: null, width: image.width, height: image.height, version: image.version, bytes: image.bytes});
            }
        }
        return {
            item: {
                directory,
                root: root.key,
                entry: {...base, title: parsed.title ?? folder, ...(parsed.description === undefined ? {} : {description: parsed.description}), status: "ok", stickers},
                listed: parsed.stickers !== null,
                extras: [...named, ...unlisted],
                counts,
                token,
            },
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

/**
 * 表情包文件夹里的文件与链接的名字，读不了时交回错误（表情包按无效列出，诊断随表情包去重）。文件夹在扫描途中被删掉时是空的，
 * 下一次重扫会对上。链接也交出去，由图片核对判成“文件是链接”，与清单里写了链接的一样报。
 */
async function fileNames(directory: string): Promise<string[] | Error> {
    try {
        return (await readdir(directory, {withFileTypes: true})).filter((child) => child.isFile() || child.isSymbolicLink()).map((child) => child.name);
    } catch (error) {
        if (errorCode(error) === "ENOENT") return [];
        return error instanceof Error ? error : new Error(String(error));
    }
}

type ImageRead = {readonly ok: true; readonly width: number; readonly height: number; readonly version: string; readonly bytes: number} | {readonly ok: false; readonly reason: string};

/**
 * 扫描时核对一张表情图：普通文件、不是链接，再核对字节；交回版本。版本带 inode：换成另一个文件（原子替换）时即使大小与修改时间
 * 相同也会变，取图路由才敢按版本长期缓存。
 */
async function readImage(path: string, file: string, info: Stats): Promise<ImageRead> {
    if (info.isSymbolicLink()) return {ok: false, reason: "文件是链接"};
    if (!info.isFile()) return {ok: false, reason: "不是普通文件"};
    if (info.size > IMAGE_MAX_BYTES) return {ok: false, reason: "超过 2 MiB"};
    const checked = await checkImage(new Uint8Array(await readFile(path)), file);
    if (!checked.ok) return checked;
    return {ok: true, width: checked.width, height: checked.height, version: `${String(Math.round(info.mtimeMs))}-${String(info.size)}-${String(info.ino)}`, bytes: info.size};
}
