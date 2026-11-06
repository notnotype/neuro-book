/**
 * 主题包的导出与导入（docs/specs/theme/editor.md 输出 15、16 与验收 9、10）：一个主题导出成不写代码的主题插件（`package.json` 加 `assets/`，
 * 格式同 `plugin-sdk/examples/external/theme-dusk`），也能把这种包里的主题读回来。纯函数：读场景图字节、写素材都由调用方做，所以这里
 * 不碰网络与文件。导入的 zip 当不可信输入：先量完大小、数量与路径，全部合格才解压，再逐个主题校验；任何一项不合格都不交出任何东西。
 */

import {unzipSync, zipSync} from "fflate";
import type {Unzipped} from "fflate";
import {Value} from "typebox/value";

import {sniffImageType} from "nbook/shared/image-type";

import {declarationProblem, ThemeDeclarationSchema, WORKBENCH_THEMES_POINT} from "../../../shared/themes";
import type {ThemeDeclaration} from "../../../shared/themes";
import type {UserTheme} from "../../../shared/user-themes";

/** 一个包的上限（字节）、文件数与单个文件的上限（字节）。 */
export const PACKAGE_LIMITS = {archiveBytes: 20 * 1024 * 1024, files: 64, fileBytes: 20 * 1024 * 1024} as const;

export interface ExportedPackage {
    readonly fileName: string;
    readonly bytes: Uint8Array;
}

/** 标题里能写成包名的部分：小写字母、数字与连字符，以字母开头；写不出来时用主题 id 的前八位。 */
function packageName(theme: UserTheme): string {
    const title = theme.declaration.title;
    const english = typeof title === "object" && "en-US" in title ? String((title as Record<string, string>)["en-US"]) : "";
    const slug = english.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
    return /^[a-z]/u.test(slug) ? slug.slice(0, 40).replace(/-+$/u, "") : `theme-${theme.id.slice("user:".length, "user:".length + 8)}`;
}

/** 场景图在包里的路径。 */
const assetPath = (name: string): string => `assets/${name}`;

/** 导出：`readAsset` 按素材文件名读字节，读不到时返回 null，整个导出失败并说出哪张图。 */
export async function exportPackage(theme: UserTheme, readAsset: (name: string) => Promise<Uint8Array | null>): Promise<{readonly ok: true; readonly package: ExportedPackage} | {readonly ok: false; readonly reason: string}> {
    const files: Record<string, Uint8Array> = {};
    const declaration = structuredClone(theme.declaration) as ThemeDeclaration;
    for (const appearance of ["light", "dark"] as const) {
        const name = declaration[appearance].scene;
        if (name === undefined) continue;
        const bytes = await readAsset(name);
        if (bytes === null) return {ok: false, reason: name};
        files[assetPath(name)] = bytes;
        declaration[appearance].scene = assetPath(name);
    }
    const name = packageName(theme);
    const manifest = {
        name,
        publisher: "local",
        version: "0.1.0",
        description: typeof theme.declaration.title === "object" ? String((theme.declaration.title as Record<string, string>)["zh-CN"] ?? name) : name,
        private: true,
        engines: {neurobook: ">=0.1.0"},
        contributes: [{capability: WORKBENCH_THEMES_POINT, id: `local.${name}.${name}`, declaration}],
    };
    files["package.json"] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 4)}\n`);
    return {ok: true, package: {fileName: `${name}.zip`, bytes: zipSync(files, {level: 6})}};
}

export interface ImportedTheme {
    /** 声明，`scene` 还是包里的路径（`assets/…`）；素材字节在 `assets` 里。 */
    readonly declaration: ThemeDeclaration;
    readonly assets: ReadonlyMap<string, Uint8Array>;
}

export type ImportResult = {readonly ok: true; readonly themes: ReadonlyArray<ImportedTheme>} | {readonly ok: false; readonly reason: string};

const SAFE_PATH = /^(?![/\\])(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/u;

/** 读一个 zip 里的主题；任何一项不合格都返回原因，不交出任何东西。 */
export function readPackage(archive: Uint8Array): ImportResult {
    if (archive.byteLength > PACKAGE_LIMITS.archiveBytes) return {ok: false, reason: "包太大"};
    // 先只量不解压：zip 的目录里有每个文件解压后的大小，炸弹式的包在这里就被拦下。
    const entries: Array<{readonly name: string; readonly size: number}> = [];
    try {
        unzipSync(archive, {filter: (file) => {
            entries.push({name: file.name, size: file.originalSize});
            return false;
        }});
    } catch (error) {
        return {ok: false, reason: `读不了这个 zip：${error instanceof Error ? error.message : String(error)}`};
    }
    const files = entries.filter((entry) => !entry.name.endsWith("/"));
    if (files.length > PACKAGE_LIMITS.files) return {ok: false, reason: `文件太多：${String(files.length)} 个，至多 ${String(PACKAGE_LIMITS.files)} 个`};
    for (const entry of entries) {
        if (!SAFE_PATH.test(entry.name)) return {ok: false, reason: `路径不合规则：${entry.name}`};
        if (entry.size > PACKAGE_LIMITS.fileBytes) return {ok: false, reason: `${entry.name} 太大`};
    }
    let unzipped: Unzipped;
    try {
        unzipped = unzipSync(archive, {filter: (file) => !file.name.endsWith("/")});
    } catch (error) {
        return {ok: false, reason: `解压失败：${error instanceof Error ? error.message : String(error)}`};
    }
    const manifestBytes = unzipped["package.json"];
    if (manifestBytes === undefined) return {ok: false, reason: "包里没有 package.json"};
    let manifest: unknown;
    try {
        manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
        return {ok: false, reason: "package.json 不是合法的 JSON"};
    }
    const contributes = (manifest as {contributes?: unknown}).contributes;
    if (!Array.isArray(contributes)) return {ok: false, reason: "package.json 没有 contributes"};
    const themes: ImportedTheme[] = [];
    for (const item of contributes as ReadonlyArray<{capability?: unknown; id?: unknown; declaration?: unknown}>) {
        if (item.capability !== WORKBENCH_THEMES_POINT) continue;
        const id = typeof item.id === "string" ? item.id : "?";
        if (!Value.Check(ThemeDeclarationSchema, item.declaration)) return {ok: false, reason: `主题 ${id} 的声明不合格`};
        const declaration = item.declaration as ThemeDeclaration;
        const problem = declarationProblem(id, declaration);
        if (problem !== null) return {ok: false, reason: problem};
        const assets = new Map<string, Uint8Array>();
        for (const appearance of ["light", "dark"] as const) {
            const scene = declaration[appearance].scene;
            if (scene === undefined) continue;
            const bytes = unzipped[scene];
            if (bytes === undefined) return {ok: false, reason: `主题 ${id} 的场景图 ${scene} 不在包里`};
            if (sniffImageType(bytes) === null) return {ok: false, reason: `${scene} 不是 PNG、JPEG 或 WebP`};
            assets.set(scene, bytes);
        }
        themes.push({declaration, assets});
    }
    if (themes.length === 0) return {ok: false, reason: "包里没有主题"};
    return {ok: true, themes};
}
