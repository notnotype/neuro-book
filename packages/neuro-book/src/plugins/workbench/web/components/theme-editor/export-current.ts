/**
 * 导出当前选中的主题并交给浏览器下载（docs/specs/theme/editor.md 输出 15）。单独成文件：下载要用文档与对象 URL，
 * 其余的传输逻辑（`transfer.ts`）不碰它们，测试能直接用。
 */

import {userThemeAssetUrl} from "../../themes";
import {exportPackage} from "./package-io";
import type {ThemeEditorModel} from "./theme-editor-model";
import type {TransferResult} from "./transfer";

const readAsset = async (name: string): Promise<Uint8Array | null> => {
    const url = userThemeAssetUrl(name);
    if (url === null) return null;
    const response = await fetch(url).catch(() => null);
    return response?.ok === true ? new Uint8Array(await response.arrayBuffer()) : null;
};

const download = (fileName: string, bytes: Uint8Array): void => {
    const url = URL.createObjectURL(new Blob([bytes.slice()], {type: "application/zip"}));
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

