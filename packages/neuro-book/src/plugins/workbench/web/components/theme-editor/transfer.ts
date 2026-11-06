/**
 * 主题包的导入与插件主题的素材复制的浏览器一侧（docs/specs/theme/editor.md 输出 2、16）：读素材、上传成我的素材。下载导出的 zip 在
 * `export-current.ts`；包的格式与校验在 `package-io.ts`（纯函数）。导入分两步：先把所有素材传完，再写主题；中途任何一步失败都不写主题记录（主题记录是原子的）。素材写入
 * 不可回滚：已经传上的留在素材目录里成为孤儿，文件名是内容摘要，重试不会重复；孤儿由用户手动清理（`theme-editor-model.ts` 的 `unusedAssets`）。
 */

import type {ThemeAssetSweepResult, ThemeAssetSweepStats} from "nbook/plugins/files/shared/contracts";

import type {ThemeEntry} from "../../themes";
import type {ThemeDeclaration} from "../../../shared/themes";
import {readPackage} from "./package-io";
import {keepUserAssets, assetRefs, renameAssets} from "./assets";
import type {AssetKind, AssetRef} from "./assets";
import {uploadIcon, uploadScene} from "./asset-upload";
import type {SweepOutcome} from "./asset-upload";
import type {UploadResult} from "./asset-upload";
import type {ThemeEditorModel} from "./theme-editor-model";

/** 编辑器主体要的动作：由持有者（`ThemeEditorHolder`）用真实的请求实现，Lab 里换成空的。 */
export interface ThemeTransfer {
    /** 导出当前选中的主题；没有选中的主题时返回 null。 */
    exportTheme(): Promise<TransferResult | null>;
    importArchive(archive: Uint8Array): Promise<TransferResult>;
    /** 上传一张已经缩好、转好码的场景图，成功返回素材文件名。 */
    uploadScene(blob: Blob): Promise<UploadResult>;
    /** 上传一个图标 SVG，成功返回素材文件名。 */
    uploadIcon(blob: Blob): Promise<UploadResult>;
    /** 统计没人引用、过了保护期的素材（不删任何东西）。`keep` 是仍被引用的素材名。 */
    statUnusedAssets(keep: ReadonlyArray<string>): Promise<SweepOutcome<ThemeAssetSweepStats>>;
    /** 删掉用户确认过的那份统计里的素材（只删 `names` 里的，每个仍要满足清理条件）。 */
    removeUnusedAssets(keep: ReadonlyArray<string>, names: ReadonlyArray<string>): Promise<SweepOutcome<ThemeAssetSweepResult>>;
    /**
     * 复制插件主题的素材（场景图、工作态场景、图标）：读出来、传成我的素材，全部成功才返回换成素材文件名的声明；任何一个读不到或
     * 传不上就整个失败，不建副本。
     */
    copyAssets(entry: ThemeEntry): Promise<{readonly ok: true; readonly declaration: ThemeDeclaration} | {readonly ok: false; readonly reason: string}>;
}

export type TransferResult = {readonly ok: true; readonly message: {readonly key: "exported" | "exportedWarn" | "imported"; readonly params: Readonly<Record<string, string | number>>}} | {readonly ok: false; readonly message: {readonly key: "exportFailed" | "importFailed" | "copyFailed"; readonly params: Readonly<Record<string, string>>}};

/** 同时在途的上传不超过这个数：一套满额的主题有上百个图标，一次发出上百个请求会堵住浏览器的连接池。 */
const UPLOAD_CONCURRENCY = 6;

/** 一个要上传的素材：`load` 取字节，读不到返回 null。 */
interface AssetSource extends AssetRef {
    readonly load: () => Promise<Blob | null>;
}

type Uploaded = {readonly ok: true; readonly names: ReadonlyMap<string, string>} | {readonly ok: false; readonly reason: string};

const keyOf = (kind: AssetKind, path: string): string => `${kind}\n${path}`;

/**
 * 把素材传成我的素材，同一个种类与路径只传一次。限量并发；第一个失败后不再开始新的上传，等已经发出的都结束（settle）再返回，
 * 不留下还在飞的请求。返回路径到素材文件名的表。
 */
async function uploadAssets(sources: ReadonlyArray<AssetSource>): Promise<Uploaded> {
    const names = new Map<string, string>();
    let failure: string | null = null;
    let next = 0;
    const worker = async (): Promise<void> => {
        while (failure === null && next < sources.length) {
            const source = sources[next];
            next += 1;
            if (source === undefined) return;
            const blob = await source.load().catch(() => null);
            // 读取期间别的 worker 可能已经失败：失败之后不再发起上传（已经发出的请求不取消，等它们 settle）。
            if (failure !== null) return;
            if (blob === null) {
                failure ??= source.path;
                return;
            }
            const uploaded = await (source.kind === "icon" ? uploadIcon(blob) : uploadScene(blob));
            if (!uploaded.ok) {
                failure ??= `${source.path}：${uploaded.reason}`;
                return;
            }
            names.set(keyOf(source.kind, source.path), uploaded.name);
        }
    };
    await Promise.all(Array.from({length: Math.min(UPLOAD_CONCURRENCY, sources.length)}, worker));
    return failure === null ? {ok: true, names} : {ok: false, reason: failure};
}

const nameOf = (names: ReadonlyMap<string, string>) => (kind: AssetKind, path: string): string => names.get(keyOf(kind, path)) ?? path;

/** 导入一个 zip：校验、传素材、写进库里；返回导入了几套。 */
export async function importArchive(model: ThemeEditorModel, archive: Uint8Array): Promise<TransferResult> {
    const read = readPackage(archive);
    if (!read.ok) return {ok: false, message: {key: "importFailed", params: {reason: read.reason}}};
    // 几套主题共用同一个包内文件时只传一次。
    const wanted = new Map<string, AssetSource>();
    for (const theme of read.themes) {
        for (const ref of assetRefs(theme.declaration)) {
            const bytes = theme.assets.get(ref.path);
            wanted.set(keyOf(ref.kind, ref.path), {...ref, load: async () => (bytes === undefined ? null : new Blob([bytes.slice()]))});
        }
    }
    const uploaded = await uploadAssets([...wanted.values()]);
    if (!uploaded.ok) return {ok: false, message: {key: "importFailed", params: {reason: uploaded.reason}}};
    const prepared = read.themes.map((theme) => renameAssets(theme.declaration, nameOf(uploaded.names)));
    // 一个提交点：几套一起进，超限或写失败时一套也不进，不留半个包。
    if (!(await model.addMany(prepared))) return {ok: false, message: {key: "importFailed", params: {reason: model.rejected.value ?? ""}}};
    return {ok: true, message: {key: "imported", params: {count: prepared.length}}};
}

/** 复制插件主题的素材：地址由持有者按插件解析好；读不到、传不上都整个失败。 */
export async function copyPluginAssets(entry: ThemeEntry, assetUrl: (path: string) => string | null): Promise<Awaited<ReturnType<ThemeTransfer["copyAssets"]>>> {
    const sources = assetRefs(entry.declaration).map((ref): AssetSource => ({
        ...ref,
        load: async () => {
            const url = assetUrl(ref.path);
            const response = url === null ? null : await fetch(url).catch(() => null);
            return response?.ok === true ? response.blob() : null;
        },
    }));
    const uploaded = await uploadAssets(sources);
    if (!uploaded.ok) return {ok: false, reason: uploaded.reason};
    return {ok: true, declaration: keepUserAssets(renameAssets(entry.declaration, nameOf(uploaded.names)))};
}
