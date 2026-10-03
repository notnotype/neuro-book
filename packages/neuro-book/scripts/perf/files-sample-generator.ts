import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

export type SampleCategory = "root" | "lorebook" | "manuscript" | "notes";

export type SamplePlanEntry = Readonly<{
    index: number;
    relativePath: string;
    category: SampleCategory;
    kind: "content-index" | "note" | "root-index";
    type: "note" | "character" | "location" | "rule" | "chapter" | "volume";
    sizeBytes: number;
    uniqueMarker: string;
}>;

export type SamplePlan = Readonly<{
    seed: number;
    fileCount: number;
    minBytes: number;
    maxBytes: number;
    wideDirectoryPath: string;
    wideDirectoryChildren: number;
    entries: readonly SamplePlanEntry[];
}>;

export type SamplePlanOptions = Readonly<{
    fileCount?: number;
    seed?: number;
    minBytes?: number;
    maxBytes?: number;
    wideDirectoryChildren?: number;
}>;

const DEFAULT_FILE_COUNT = 3_000;
const DEFAULT_SEED = 42_017;
const DEFAULT_MIN_BYTES = 5 * 1024;
const DEFAULT_MAX_BYTES = 30 * 1024;
const DEFAULT_WIDE_DIRECTORY_CHILDREN = 400;

/**
 * 生成稳定的文件布局与大小；只依赖参数，不读取磁盘或系统时间。
 */
export function buildSamplePlan(options: SamplePlanOptions = {}): SamplePlan {
    const fileCount = positiveInteger(options.fileCount ?? DEFAULT_FILE_COUNT, "fileCount");
    const seed = positiveInteger(options.seed ?? DEFAULT_SEED, "seed");
    const minBytes = positiveInteger(options.minBytes ?? DEFAULT_MIN_BYTES, "minBytes");
    const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes");
    const wideDirectoryChildren = positiveInteger(options.wideDirectoryChildren ?? DEFAULT_WIDE_DIRECTORY_CHILDREN, "wideDirectoryChildren");
    if (minBytes > maxBytes) {
        throw new Error(`minBytes 不能大于 maxBytes：${String(minBytes)} > ${String(maxBytes)}`);
    }
    if (wideDirectoryChildren > fileCount - 1) {
        throw new Error(`wideDirectoryChildren 必须小于普通文件总数：${String(wideDirectoryChildren)} >= ${String(fileCount)}`);
    }

    const random = seededRandom(seed);
    const entries: SamplePlanEntry[] = [];
    const add = (entry: Omit<SamplePlanEntry, "index" | "sizeBytes" | "uniqueMarker">): void => {
        const index = entries.length;
        entries.push({
            ...entry,
            index,
            sizeBytes: minBytes + Math.floor(random() * (maxBytes - minBytes + 1)),
            uniqueMarker: `NBOOK-T42-${String(seed)}-${String(index).padStart(5, "0")}`,
        });
    };

    add({relativePath: "index.md", category: "root", kind: "root-index", type: "note"});
    const remaining = fileCount - 1;
    const lorebookCount = Math.floor(remaining * 0.30);
    const manuscriptCount = Math.floor(remaining * 0.3333333333);
    const notesCount = remaining - lorebookCount - manuscriptCount;
    if (wideDirectoryChildren > notesCount) {
        throw new Error(`wideDirectoryChildren 必须不大于普通笔记数：${String(wideDirectoryChildren)} > ${String(notesCount)}`);
    }

    const lorebookTypes = ["character", "location", "rule"] as const;
    for (let index = 0; index < lorebookCount; index += 1) {
        const type = lorebookTypes[index % lorebookTypes.length]!;
        const group = type === "character" ? "characters" : type === "location" ? "places" : "rules";
        add({
            relativePath: `lorebook/${group}/${type}-${String(index + 1).padStart(4, "0")}/index.md`,
            category: "lorebook",
            kind: "content-index",
            type,
        });
    }

    const volumeCount = manuscriptCount > 0 ? Math.min(10, manuscriptCount) : 0;
    for (let index = 0; index < volumeCount; index += 1) {
        const volume = `volume-${String(index + 1).padStart(2, "0")}`;
        add({
            relativePath: `manuscript/${volume}/index.md`,
            category: "manuscript",
            kind: "content-index",
            type: "volume",
        });
    }
    const chapterCount = manuscriptCount - volumeCount;
    for (let index = 0; index < chapterCount; index += 1) {
        const volume = `volume-${String(index % Math.max(volumeCount, 1) + 1).padStart(2, "0")}`;
        const chapter = `chapter-${String(index + 1).padStart(4, "0")}`;
        add({
            relativePath: `manuscript/${volume}/${chapter}/index.md`,
            category: "manuscript",
            kind: "content-index",
            type: "chapter",
        });
    }

    for (let index = 0; index < notesCount; index += 1) {
        const relativePath = index < wideDirectoryChildren
            ? `notes/wide/note-${String(index + 1).padStart(4, "0")}.md`
            : index % 2 === 0
                ? `notes/archive/2026/q1/note-${String(index + 1).padStart(4, "0")}.md`
                : `notes/projects/project-${String(index % 12 + 1).padStart(2, "0")}/note-${String(index + 1).padStart(4, "0")}.md`;
        add({relativePath, category: "notes", kind: "note", type: "note"});
    }

    if (entries.length !== fileCount) {
        throw new Error(`样本布局未生成指定文件数：${String(entries.length)} !== ${String(fileCount)}`);
    }
    return Object.freeze({
        seed,
        fileCount,
        minBytes,
        maxBytes,
        wideDirectoryPath: "notes/wide/",
        wideDirectoryChildren,
        entries: Object.freeze(entries),
    });
}

/**
 * 为一个计划项生成固定字节数的 Markdown；源码 title 与正文首段保留唯一标记。
 */
export function renderSampleDocument(entry: SamplePlanEntry): string {
    const frontmatter = (entry.kind === "note" ? [
        "---",
        `title: ${entry.uniqueMarker} Synthetic ${entry.category} ${String(entry.index)}`,
        "type: note",
        "status: active",
        "tags: [synthetic, t42]",
        "---",
        "",
    ] : [
        "---",
        `title: ${entry.uniqueMarker} Synthetic ${entry.category} ${String(entry.index)}`,
        `type: ${entry.type}`,
        "subtype: null",
        "status: active",
        "icon: null",
        "aliases: []",
        "tags: [synthetic, t42]",
        `summary: Synthetic baseline ${String(entry.index)}`,
        "refs: []",
        "retrieval: {enabled: true, trigger: null}",
        "governance: {source: generated, review: approved}",
        "ext: {}",
        "---",
        "",
    ]).join("\n");
    const header = entry.kind === "root-index" ? "# Synthetic Files Baseline" : `# ${entry.type} ${String(entry.index)}`;
    const prefix = `${frontmatter}\n${entry.uniqueMarker}\n\n${header}\n\n`;
    if (Buffer.byteLength(prefix, "utf8") >= entry.sizeBytes) {
        throw new Error(`样本文件大小下限不足以容纳 frontmatter：${entry.relativePath}`);
    }
    const remaining = entry.sizeBytes - Buffer.byteLength(prefix, "utf8");
    const paragraph = "Synthetic baseline prose keeps the file path realistic without importing user data. ";
    const body = paragraph.repeat(Math.ceil(remaining / Buffer.byteLength(paragraph, "utf8"))).slice(0, remaining).replace(/\s+$/u, (padding) => "x".repeat(padding.length));
    return `${prefix}${body}`;
}

/**
 * 将计划写入指定项目目录。并发受限，避免一次打开过多文件描述符。
 */
export async function writeSampleFiles(root: string, plan: SamplePlan, concurrency = 32): Promise<void> {
    const workerCount = Math.max(1, Math.min(concurrency, plan.entries.length));
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            const entry = plan.entries[index];
            if (!entry) return;
            const filePath = join(root, entry.relativePath);
            await mkdir(dirname(filePath), {recursive: true});
            await writeFile(filePath, renderSampleDocument(entry), "utf8");
        }
    };
    await Promise.all(Array.from({length: workerCount}, () => worker()));
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} 必须是正整数：${String(value)}`);
    }
    return value;
}

function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 4_294_967_296;
    };
}
