import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {lstat, readdir, readFile, stat} from "node:fs/promises";
import {basename, resolve} from "node:path";

export const DESKTOP_AGGREGATE_DEPOT_SCHEMA = "nbook.desktop-depot/v1" as const;
export const DESKTOP_DISTRIBUTION_SCHEMA = "nbook.desktop-distribution/v1" as const;
export const DESKTOP_AGGREGATE_DEPOT_PLATFORM = "windows-x64" as const;
export const DESKTOP_AGGREGATE_DEPOT_ARCHIVE = "neuro-book-desktop-depot-win-x64.zip";
export const DESKTOP_AGGREGATE_DEPOT_MANIFEST = "neuro-book-desktop-depot-win-x64.manifest.json";
export const DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST = "neuro-book-desktop-depot-win-x64.distribution.json";

/** 聚合 depot 的固定顶层载荷；Product、Bun、Tool Pack 不在此层重复展开。 */
export const DESKTOP_AGGREGATE_DEPOT_ENTRIES = [
    "install-desktop.ps1",
    "windows-bun-stage0.ps1",
    DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
    "neuro-book-electron-portable-win-x64.zip",
    "neuro-book-electron-portable-win-x64.manifest.json",
    "neuro-book-tauri-portable-win-x64.zip",
    "neuro-book-tauri-portable-win-x64.manifest.json",
] as const;

type AggregateDepotEntryName = typeof DESKTOP_AGGREGATE_DEPOT_ENTRIES[number];

export type DesktopAggregateZipEntry = {
    kind: "file";
    source: string;
    archivePath: AggregateDepotEntryName;
};

export type DesktopAggregateDirectoryEntry = {
    name: string;
    source: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    bytes: number;
};

export type DesktopAggregatePayload = {
    files: number;
    bytes: number;
    entries: DesktopAggregateZipEntry[];
};

export type DesktopAggregateDepotManifest = {
    schema: typeof DESKTOP_AGGREGATE_DEPOT_SCHEMA;
    platform: typeof DESKTOP_AGGREGATE_DEPOT_PLATFORM;
    distributionManifest: typeof DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST;
    entries: AggregateDepotEntryName[];
    payload: {
        files: number;
        bytes: number;
    };
    archive: {
        path: typeof DESKTOP_AGGREGATE_DEPOT_ARCHIVE;
        bytes: number;
        sha256: `sha256:${string}`;
    };
    distributionSchema: typeof DESKTOP_DISTRIBUTION_SCHEMA;
};

function expectedEntrySet(): Set<string> {
    return new Set(DESKTOP_AGGREGATE_DEPOT_ENTRIES);
}

/**
 * 校验聚合 depot 的顶层形状。这个纯函数也让 symlink/extra entry 的失败路径
 * 可以在不依赖 Windows symlink 权限的环境中稳定回归。
 */
export function validateDesktopAggregateDepotEntries(entries: DesktopAggregateDirectoryEntry[]): void {
    const expected = expectedEntrySet();
    const actual = new Set(entries.map((entry) => entry.name));
    const missing = DESKTOP_AGGREGATE_DEPOT_ENTRIES.filter((name) => !actual.has(name));
    const extra = entries.filter((entry) => !expected.has(entry.name)).map((entry) => entry.name);
    if (missing.length > 0) throw new Error(`Desktop aggregate depot 缺少文件：${missing.join(", ")}`);
    if (extra.length > 0) throw new Error(`Desktop aggregate depot 包含未登记文件：${extra.join(", ")}`);
    if (entries.length !== DESKTOP_AGGREGATE_DEPOT_ENTRIES.length) {
        throw new Error("Desktop aggregate depot 顶层文件数量不符合固定合同。" );
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink) throw new Error(`Desktop aggregate depot 不接受 symlink：${entry.name}`);
        if (!entry.isFile || entry.isDirectory) throw new Error(`Desktop aggregate depot 条目必须是普通文件：${entry.name}`);
        if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
            throw new Error(`Desktop aggregate depot 文件大小无效：${entry.name}`);
        }
    }
}

async function readDirectoryEntries(root: string): Promise<DesktopAggregateDirectoryEntry[]> {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        throw new Error(`Desktop aggregate depot staging 必须是真实目录：${root}`);
    }
    const names = await readdir(root);
    const entries = await Promise.all(names.map(async (name) => {
        const source = resolve(root, name);
        const info = await lstat(source);
        return {
            name,
            source,
            isFile: info.isFile(),
            isDirectory: info.isDirectory(),
            isSymbolicLink: info.isSymbolicLink(),
            bytes: info.isFile() ? info.size : 0,
        };
    }));
    return entries;
}

/** 收集固定顺序的普通文件并计算 payload 文件数/逻辑大小。 */
export async function inspectDesktopAggregateDepot(rootInput: string): Promise<DesktopAggregatePayload> {
    const root = resolve(rootInput);
    const entries = await readDirectoryEntries(root);
    validateDesktopAggregateDepotEntries(entries);
    const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
    const zipEntries = DESKTOP_AGGREGATE_DEPOT_ENTRIES.map((archivePath) => {
        const entry = byName.get(archivePath);
        if (!entry) throw new Error(`Desktop aggregate depot 缺少文件：${archivePath}`);
        return {kind: "file", source: entry.source, archivePath} as const;
    });
    return {
        files: zipEntries.length,
        bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
        entries: zipEntries,
    };
}

async function sha256File(path: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}

function isSha256(value: string): value is `sha256:${string}` {
    return /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** 从 JSON 边界解析 sidecar，拒绝 schema、路径、列表和摘要的任意放宽。 */
export function parseDesktopAggregateDepotManifest(input: unknown): DesktopAggregateDepotManifest {
    if (!input || typeof input !== "object") throw new Error("Desktop aggregate depot manifest 必须是对象。" );
    const value = input as {schema?: unknown; platform?: unknown; distributionManifest?: unknown; entries?: unknown; payload?: unknown; archive?: unknown; distributionSchema?: unknown};
    if (value.schema !== DESKTOP_AGGREGATE_DEPOT_SCHEMA
        || value.platform !== DESKTOP_AGGREGATE_DEPOT_PLATFORM
        || value.distributionManifest !== DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST
        || value.distributionSchema !== DESKTOP_DISTRIBUTION_SCHEMA) {
        throw new Error("Desktop aggregate depot manifest schema 或 platform 不受支持。" );
    }
    if (!Array.isArray(value.entries)
        || value.entries.length !== DESKTOP_AGGREGATE_DEPOT_ENTRIES.length
        || value.entries.some((entry) => typeof entry !== "string")
        || value.entries.some((entry, index) => entry !== DESKTOP_AGGREGATE_DEPOT_ENTRIES[index])) {
        throw new Error("Desktop aggregate depot manifest entries 不符合固定合同。" );
    }
    if (!value.payload || typeof value.payload !== "object") throw new Error("Desktop aggregate depot manifest 缺少 payload。" );
    const payload = value.payload as {files?: unknown; bytes?: unknown};
    if (payload.files !== DESKTOP_AGGREGATE_DEPOT_ENTRIES.length
        || typeof payload.bytes !== "number"
        || !Number.isSafeInteger(payload.bytes)
        || payload.bytes < 0) {
        throw new Error("Desktop aggregate depot manifest payload 不符合固定合同。" );
    }
    if (!value.archive || typeof value.archive !== "object") throw new Error("Desktop aggregate depot manifest 缺少 archive。" );
    const archive = value.archive as {path?: unknown; bytes?: unknown; sha256?: unknown};
    if (archive.path !== DESKTOP_AGGREGATE_DEPOT_ARCHIVE
        || typeof archive.bytes !== "number"
        || !Number.isSafeInteger(archive.bytes)
        || archive.bytes < 0
        || typeof archive.sha256 !== "string"
        || !isSha256(archive.sha256)) {
        throw new Error("Desktop aggregate depot manifest archive 不符合固定合同。" );
    }
    return {
        schema: DESKTOP_AGGREGATE_DEPOT_SCHEMA,
        platform: DESKTOP_AGGREGATE_DEPOT_PLATFORM,
        distributionManifest: DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
        entries: [...DESKTOP_AGGREGATE_DEPOT_ENTRIES],
        payload: {files: payload.files, bytes: payload.bytes},
        archive: {
            path: DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
            bytes: archive.bytes,
            sha256: archive.sha256,
        },
        distributionSchema: DESKTOP_DISTRIBUTION_SCHEMA,
    };
}

/** 在 ZIP 已写出后构造 sidecar，并再次以实际文件内容计算 archive identity。 */
export async function createDesktopAggregateDepotManifest(input: {
    stagingRoot: string;
    archivePath: string;
}): Promise<DesktopAggregateDepotManifest> {
    const payload = await inspectDesktopAggregateDepot(input.stagingRoot);
    const archivePath = resolve(input.archivePath);
    const archiveInfo = await lstat(archivePath);
    if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink()) {
        throw new Error(`Desktop aggregate depot archive 必须是普通文件：${archivePath}`);
    }
    if (basename(archivePath) !== DESKTOP_AGGREGATE_DEPOT_ARCHIVE) {
        throw new Error(`Desktop aggregate depot archive 文件名不符合合同：${basename(archivePath)}`);
    }
    return {
        schema: DESKTOP_AGGREGATE_DEPOT_SCHEMA,
        platform: DESKTOP_AGGREGATE_DEPOT_PLATFORM,
        distributionManifest: DESKTOP_AGGREGATE_DEPOT_DISTRIBUTION_MANIFEST,
        entries: [...DESKTOP_AGGREGATE_DEPOT_ENTRIES],
        payload: {files: payload.files, bytes: payload.bytes},
        archive: {
            path: DESKTOP_AGGREGATE_DEPOT_ARCHIVE,
            bytes: archiveInfo.size,
            sha256: `sha256:${await sha256File(archivePath)}`,
        },
        distributionSchema: DESKTOP_DISTRIBUTION_SCHEMA,
    };
}

/** 复核 staging、sidecar、ZIP 大小和 ZIP SHA-256；任何一项不一致都失败。 */
export async function verifyDesktopAggregateDepot(input: {
    stagingRoot: string;
    archivePath: string;
    manifestPath: string;
}): Promise<DesktopAggregateDepotManifest> {
    if (basename(resolve(input.manifestPath)) !== DESKTOP_AGGREGATE_DEPOT_MANIFEST) {
        throw new Error(`Desktop aggregate depot manifest 文件名不符合合同：${basename(resolve(input.manifestPath))}`);
    }
    const manifest = parseDesktopAggregateDepotManifest(JSON.parse(await readFile(input.manifestPath, "utf8")) as unknown);
    const expected = await createDesktopAggregateDepotManifest(input);
    if (JSON.stringify(manifest.payload) !== JSON.stringify(expected.payload)) {
        throw new Error("Desktop aggregate depot payload 与 sidecar 不一致。" );
    }
    const archivePath = resolve(input.archivePath);
    const actualArchive = {
        bytes: (await stat(archivePath)).size,
        sha256: `sha256:${await sha256File(archivePath)}`,
    };
    if (actualArchive.bytes !== manifest.archive.bytes || actualArchive.sha256 !== manifest.archive.sha256) {
        throw new Error("Desktop aggregate depot archive 与 sidecar 不一致。" );
    }
    return manifest;
}
