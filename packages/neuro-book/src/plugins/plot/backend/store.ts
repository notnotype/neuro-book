/**
 * 按章的三张表落盘（docs/specs/plot/checks.md 输入）：写作指示快照、写手的自陈、检查记录，存成插件的项目记录，每章各一条。
 *
 * 诊断的计算是同步的，所以三张表都整份放在内存里，存储只是落盘：入口激活时读回，写入成功以后才改内存。
 *
 * 几个不寻常的做法：
 * - 存储没有列举接口，另存一条“有记录的章”的清单。写入顺序是先清单后记录：中途崩溃时清单里多一章，读出来 `missing`，无害；反过来就
 *   会有读不到的记录。
 * - 形状版本放在值里（`shape`），记录定义的 `version` 恒为 1。升记录定义的版本以后旧记录是 `unsupported-version`，只能 `reset`，而
 *   `reset` 把原件存进每分区最多 64 份的原件区：一本 1000 章的书升一次就占满。形状不认识的按“没有”，下一次 `save` 正常覆盖。
 *   只有 `corrupt` 才 `reset`。
 * - 写入都排进一条队列：比较 `base`、写盘、改内存是一步，两个带同一 `base` 的并发写入恰好一个成功。
 * - 数据版本取内容的摘要：内容没变就不变（重复推送不会让 canon 的全部游标作废），重启后同内容得到同一个版本。
 */

import {createHash} from "node:crypto";

import {canonicalJson} from "@notnotype/nb-canon/schema";
import {Type} from "typebox";
import type {TSchema} from "typebox";
import {Value} from "typebox/value";

import {CANON_BUDGET_BYTES} from "nbook/plugins/canon/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import type {RecordDefinition, RecordHandle, Revision, StorageFailure, StorageService} from "nbook/shared/storage";

/** 插件自己的数据版本前缀；后面接表内容的摘要，空表是 `1`。 */
export const PLOT_DATA_VERSION = "1";

const Envelope = Type.Object({shape: Type.Integer(), chapter: Type.String(), value: Type.Unknown()});
type Envelope = {shape: number; chapter: string; value: unknown};

const chapterRecord = (key: string): RecordDefinition<Envelope> => defineRecord({key, scope: "project", locality: "shared", version: 1, keyed: true, maxBytes: CANON_BUDGET_BYTES, schema: Envelope}) as RecordDefinition<Envelope>;

const CHAPTERS_RECORD = defineRecord({key: "plot-chapters", scope: "project", locality: "shared", version: 1, schema: Type.Object({chapters: Type.Array(Type.String())}), maxBytes: 1024 * 1024});

/** 资源 id 的规则比章 id 窄（只能小写字母、数字与几个符号）；值里自带 `chapter`。 */
const resourceOf = (chapter: string) => createHash("sha256").update(chapter).digest("hex").slice(0, 40);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export type StoreFailure = {readonly ok: false; readonly code: StorageFailure; readonly detail: string};

interface Row<T> {
    readonly value: T;
    readonly digest: string;
}

/** 这条记录在存储里的状态：`broken` 是当前值坏了，下一次写要 `reset`。 */
interface Slot {
    readonly handle: RecordHandle<Envelope>;
    revision: Revision | null;
    broken: boolean;
}

export interface TableOptions<T> {
    readonly key: string;
    readonly shape: number;
    /** 值的 schema：读回来不合的按“没有”。 */
    readonly schema: TSchema;
    /** 算内容摘要时取哪些内容（缺省整个值）：不算内容的字段（检查记录的依赖摘要）改了不改数据版本。 */
    readonly contentOf?: (value: T) => unknown;
}

/** 一张按章的表。写入经 `PlotStore` 的队列。 */
export class ChapterTable<T> {
    readonly #rows = new Map<string, Row<T>>();
    readonly #slots = new Map<string, Slot>();
    readonly #record: RecordDefinition<Envelope>;
    #version = PLOT_DATA_VERSION;

    constructor(
        readonly options: TableOptions<T>,
        private readonly storage: StorageService,
        private readonly warn: (event: string, detail: string) => void,
    ) {
        this.#record = chapterRecord(options.key);
    }

    /** 这张表的数据版本。 */
    get version(): string {
        return this.#version;
    }

    get empty(): boolean {
        return this.#rows.size === 0;
    }

    get(chapter: string): T | undefined {
        return this.#rows.get(chapter)?.value;
    }

    /** 全部值，按章 id 排好（与写入先后无关）。 */
    all(): readonly T[] {
        return [...this.#rows.keys()].sort().map((chapter) => this.#rows.get(chapter)!.value);
    }

    #digestOf(value: T): string {
        return sha(canonicalJson(this.options.contentOf === undefined ? (value as object) : (this.options.contentOf(value) as object)));
    }

    #refreshVersion(): void {
        const digests = [...this.#rows.keys()].sort().map((chapter) => [chapter, this.#rows.get(chapter)!.digest]);
        this.#version = digests.length === 0 ? PLOT_DATA_VERSION : `${PLOT_DATA_VERSION}+${sha(canonicalJson(digests))}`;
    }

    async #slot(chapter: string): Promise<Slot | StoreFailure> {
        const existing = this.#slots.get(chapter);
        if (existing !== undefined) return existing;
        const opened = await this.storage.open(this.#record, resourceOf(chapter));
        if (!opened.ok) return opened;
        const slot: Slot = {handle: opened.handle, revision: null, broken: false};
        this.#slots.set(chapter, slot);
        return slot;
    }

    /** 读回一章。读取失败（不是缺失）交回失败：那时不知道这一章有没有记录，不能当没有。 */
    async load(chapter: string): Promise<StoreFailure | null> {
        const slot = await this.#slot(chapter);
        if ("ok" in slot) return slot;
        const snapshot = await slot.handle.read();
        if (snapshot.status === "error") return {ok: false, code: snapshot.code, detail: snapshot.detail};
        if (snapshot.status === "missing") {
            slot.revision = snapshot.revision;
            return null;
        }
        slot.revision = snapshot.revision;
        if (snapshot.status !== "ok") {
            slot.broken = true;
            this.warn("plot.store.broken", `${this.options.key} ${chapter}: ${snapshot.detail}`);
            return null;
        }
        const {shape, value} = snapshot.value;
        // 形状不认识的按没有（checks.md 边界：旧版本的记录不读），下一次写正常覆盖。
        if (shape !== this.options.shape || !Value.Check(this.options.schema, value)) return null;
        this.#rows.set(chapter, {value: value as T, digest: this.#digestOf(value as T)});
        return null;
    }

    /** 读完一批以后算一次版本。 */
    loaded(): void {
        this.#refreshVersion();
    }

    /** 由 `PlotStore` 的队列调用：写盘，成功后改内存。 */
    async write(chapter: string, value: T | null): Promise<{readonly ok: true} | StoreFailure> {
        const slot = await this.#slot(chapter);
        if ("ok" in slot) return slot;
        if (value === null && slot.revision === null) {
            this.#rows.delete(chapter);
            this.#refreshVersion();
            return {ok: true};
        }
        const envelope: Envelope = {shape: this.options.shape, chapter, value};
        const expect = {expect: slot.revision};
        const written = value === null ? await slot.handle.remove(expect) : slot.broken ? await slot.handle.reset(envelope, expect) : await slot.handle.save(envelope, expect);
        if (!written.ok) {
            // 别处写过（`conflict`）：下一次写之前重读 revision，不让这一条永远写不进去。
            if (written.code === "conflict") this.#slots.delete(chapter);
            return written;
        }
        slot.revision = written.revision;
        slot.broken = false;
        if (value === null) this.#rows.delete(chapter);
        else this.#rows.set(chapter, {value, digest: this.#digestOf(value)});
        this.#refreshVersion();
        return {ok: true};
    }
}

export class PlotStore {
    readonly #tables: ChapterTable<never>[] = [];
    #listHandle: RecordHandle<{chapters: string[]}> | null = null;
    #listRevision: Revision | null = null;
    #listBroken = false;
    readonly #listed = new Set<string>();
    #tail: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly storage: StorageService,
        private readonly warn: (event: string, detail: string) => void,
    ) {}

    table<T>(options: TableOptions<T>): ChapterTable<T> {
        const table = new ChapterTable<T>(options, this.storage, this.warn);
        this.#tables.push(table as unknown as ChapterTable<never>);
        return table;
    }

    /** 全部表合起来的数据版本：报给 canon。三张表都空是 `1`。 */
    get dataVersion(): string {
        const versions = this.#tables.map((table) => table.version);
        return versions.every((version) => version === PLOT_DATA_VERSION) ? PLOT_DATA_VERSION : `${PLOT_DATA_VERSION}+${sha(canonicalJson(versions))}`;
    }

    /** 读回清单里每一章的每张表。读取失败时交回失败，表里已读的留着，调用方不用这份 store。 */
    async load(): Promise<StoreFailure | null> {
        const opened = await this.storage.open(CHAPTERS_RECORD);
        if (!opened.ok) return opened;
        this.#listHandle = opened.handle;
        const list = await opened.handle.read();
        if (list.status === "error") return {ok: false, code: list.code, detail: list.detail};
        this.#listRevision = list.revision;
        if (list.status === "corrupt" || list.status === "unsupported-version") {
            this.#listBroken = true;
            this.warn("plot.store.broken", `plot-chapters: ${list.detail}`);
        }
        if (list.status === "ok") for (const chapter of list.value.chapters) this.#listed.add(chapter);
        for (const table of this.#tables) {
            for (const chapter of this.#listed) {
                const failed = await table.load(chapter);
                if (failed !== null) return failed;
            }
            table.loaded();
        }
        return null;
    }

    /** 排进写入队列：里面可以比较版本再写，别的写入等它做完。前一个失败不挡后一个。 */
    queued<R>(work: () => Promise<R>): Promise<R> {
        const run = this.#tail.then(work, work);
        this.#tail = run.catch(() => undefined);
        return run;
    }

    /** 写一章（`null` 是删除）。必须在 `queued` 里调用：先记进清单，再写记录。 */
    async write<T>(table: ChapterTable<T>, chapter: string, value: T | null): Promise<{readonly ok: true} | StoreFailure> {
        if (value !== null) {
            const listed = await this.#list(chapter);
            if (!listed.ok) return listed;
        }
        return table.write(chapter, value);
    }

    async #list(chapter: string): Promise<{readonly ok: true} | StoreFailure> {
        if (this.#listed.has(chapter)) return {ok: true};
        if (this.#listHandle === null) return {ok: false, code: "unavailable", detail: "plot store is not loaded"};
        const next = {chapters: [...this.#listed, chapter].sort()};
        const expect = {expect: this.#listRevision};
        const written = this.#listBroken ? await this.#listHandle.reset(next, expect) : await this.#listHandle.save(next, expect);
        if (!written.ok) return written;
        this.#listRevision = written.revision;
        this.#listBroken = false;
        this.#listed.add(chapter);
        return {ok: true};
    }
}
