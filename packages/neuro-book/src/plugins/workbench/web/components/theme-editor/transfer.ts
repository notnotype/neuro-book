/**
 * 主题包的导出与导入的浏览器一侧（docs/specs/theme/editor.md 输出 15、16）：读场景图、下载 zip、上传导入的素材。包的格式与校验在
 * `package-io.ts`（纯函数）。导入分两步：先把所有素材传完，再写主题；中途任何一步失败都不留下半个主题。
 */

import {userThemeSceneUrl} from "../../themes";
import type {ThemeEntry} from "../../themes";
import type {ThemeDeclaration} from "../../../shared/themes";
import {exportPackage, readPackage} from "./package-io";
import {uploadScene} from "./scene-upload";
import type {UploadResult} from "./scene-upload";
import type {ThemeEditorModel} from "./theme-editor-model";

/** 编辑器主体要的两个动作：由持有者（`ThemeEditorHolder`）用真实的请求实现，Lab 里换成空的。 */
export interface ThemeTransfer {
    /** 导出当前选中的主题；没有选中的主题时返回 null。 */
    exportTheme(): Promise<TransferResult | null>;
    importArchive(archive: Uint8Array): Promise<TransferResult>;
    /** 上传一张已经缩好、转好码的场景图，成功返回素材文件名。 */
    uploadScene(blob: Blob): Promise<UploadResult>;
    /** 复制插件主题的场景图：读出来、传成我的素材，全部成功才返回文件名；任何一张读不到或传不上就整个失败，不留半个副本。 */
    copyScenes(entry: ThemeEntry): Promise<{readonly ok: true; readonly scenes: {readonly light?: string; readonly dark?: string}} | {readonly ok: false; readonly reason: string}>;
}

export type TransferResult = {readonly ok: true; readonly message: {readonly key: "exported" | "exportedWarn" | "imported"; readonly params: Readonly<Record<string, string | number>>}} | {readonly ok: false; readonly message: {readonly key: "exportFailed" | "importFailed" | "copyFailed"; readonly params: Readonly<Record<string, string>>}};

const readAsset = async (name: string): Promise<Uint8Array | null> => {
    const url = userThemeSceneUrl(name);
    if (url === null) return null;
    const response = await fetch(url).catch(() => null);
    return response?.ok === true ? new Uint8Array(await response.arrayBuffer()) : null;
};

const download = (fileName: string, bytes: Uint8Array): void => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type: "application/zip"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // 下载已经交给浏览器：稍后再释放，立即释放有的浏览器会取消下载。
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** 导出当前选中的主题；对比度有不合格项时照样导出，只在结果里提示（输出 14）。 */
export async function exportCurrent(model: ThemeEditorModel): Promise<TransferResult | null> {
    const theme = model.current.value;
    if (theme === null) return null;
    const result = await exportPackage(theme, readAsset);
    if (!result.ok) return {ok: false, message: {key: "exportFailed", params: {reason: result.reason}}};
    download(result.package.fileName, result.package.bytes);
    const count = model.failures.value.length;
    const name = result.package.fileName;
    return {ok: true, message: count > 0 ? {key: "exportedWarn", params: {name, count}} : {key: "exported", params: {name}}};
}

/** 导入一个 zip：校验、传素材、写进库里；返回导入了几套。 */
export async function importArchive(model: ThemeEditorModel, archive: Uint8Array): Promise<TransferResult> {
    const read = readPackage(archive);
    if (!read.ok) return {ok: false, message: {key: "importFailed", params: {reason: read.reason}}};
    const prepared: ThemeDeclaration[] = [];
    for (const theme of read.themes) {
        const declaration = structuredClone(theme.declaration) as ThemeDeclaration;
        for (const appearance of ["light", "dark"] as const) {
            const path = declaration[appearance].scene;
            if (path === undefined) continue;
            const bytes = theme.assets.get(path);
            const uploaded = bytes === undefined ? null : await uploadScene(new Blob([bytes as BlobPart]));
            if (uploaded === null || !uploaded.ok) return {ok: false, message: {key: "importFailed", params: {reason: uploaded?.ok === false ? uploaded.reason : path}}};
            declaration[appearance].scene = uploaded.name;
        }
        prepared.push(declaration);
    }
    // 一个提交点：几套一起进，超限或写失败时一套也不进，不留半个包。
    if (!(await model.addMany(prepared))) return {ok: false, message: {key: "importFailed", params: {reason: model.rejected.value ?? ""}}};
    return {ok: true, message: {key: "imported", params: {count: prepared.length}}};
}

/** 复制插件主题的场景图：地址由持有者按插件解析好；读不到、传不上都整个失败。 */
export async function copyPluginScenes(entry: ThemeEntry, sceneUrl: (appearance: "light" | "dark") => string | null): Promise<Awaited<ReturnType<ThemeTransfer["copyScenes"]>>> {
    const scenes: {light?: string; dark?: string} = {};
    for (const appearance of ["light", "dark"] as const) {
        if (entry.declaration[appearance].scene === undefined) continue;
        const url = sceneUrl(appearance);
        const response = url === null ? null : await fetch(url).catch(() => null);
        if (response === null || !response.ok) return {ok: false, reason: entry.declaration[appearance].scene ?? ""};
        const uploaded = await uploadScene(await response.blob());
        if (!uploaded.ok) return {ok: false, reason: uploaded.reason};
        scenes[appearance] = uploaded.name;
    }
    return {ok: true, scenes};
}
