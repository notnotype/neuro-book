/**
 * 主题包的导出与导入（docs/specs/theme/editor.md 输出 15、16 与验收 9、10）：一个主题导出成不写代码的主题插件（`package.json` 加 `assets/`，
 * 格式同 `plugin-sdk/examples/external/theme-dusk`），也能把这种包里的主题读回来。纯函数：读场景图字节、写素材都由调用方做，所以这里
 * 不碰网络与文件。导入的 zip 当不可信输入：先量完大小、数量与路径，全部合格才解压，再逐个主题校验；任何一项不合格都不交出任何东西。
 */

import {Unzip, UnzipInflate, UnzipPassThrough, zipSync} from "fflate";
import {Value} from "typebox/value";

import {manifestFormat} from "nbook/plugin-platform-profile";
import {sniffImageType} from "nbook/shared/image-type";

import {declarationProblem, ThemeDeclarationSchema, WORKBENCH_THEMES_POINT} from "../../../shared/themes";
import type {ThemeDeclaration} from "../../../shared/themes";
import {forUserLayer} from "../../../shared/user-themes";
import type {UserTheme} from "../../../shared/user-themes";

/** 一个包的上限：压缩包大小、文件数、单个文件解压后的大小与全部文件解压后的总大小（字节）。 */
export const PACKAGE_LIMITS = {archiveBytes: 20 * 1024 * 1024, files: 64, fileBytes: 20 * 1024 * 1024, totalBytes: 48 * 1024 * 1024} as const;

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

/** 相对路径：不空、没有空段与 `.`、`..` 段，不含反斜杠、NUL 与冒号（盘符）。真实的插件清单对相对路径同样不收空段与 `.` 段。 */
function safePath(name: string): boolean {
    if (name === "" || /[\\\0:]/u.test(name)) return false;
    const segments = name.endsWith("/") ? name.slice(0, -1).split("/") : name.split("/");
    return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

type Unpacked = {readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array>} | {readonly ok: false; readonly reason: string};

/**
 * 解开 zip，按实际解出的字节数记账：单个文件、全部文件的总量一超就停。不信 zip 目录里写的解压后大小（可以伪造成 1 字节，让预检
 * 全过、真正解压时占住主线程几秒），所以用流式解压边解边数，超限立即终止；路径与文件数在每个文件开始前就查。
 */
function unpack(archive: Uint8Array): Unpacked {
    const files = new Map<string, Uint8Array>();
    let failure: string | null = null;
    let count = 0;
    let total = 0;
    const unzipper = new Unzip();
    unzipper.register(UnzipInflate);
    unzipper.register(UnzipPassThrough);
    unzipper.onfile = (file) => {
        if (failure !== null) return;
        if (!safePath(file.name)) {
            failure = `路径不合规则：${file.name}`;
            return;
        }
        if (file.name.endsWith("/")) return;
        count += 1;
        if (count > PACKAGE_LIMITS.files) {
            failure = `文件太多：至多 ${String(PACKAGE_LIMITS.files)} 个`;
            return;
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        file.ondata = (error, chunk, final) => {
            if (failure !== null) return;
            if (error !== null) {
                failure = `解压失败：${error.message}`;
                return;
            }
            size += chunk.length;
            total += chunk.length;
            if (size > PACKAGE_LIMITS.fileBytes) failure = `${file.name} 太大`;
            else if (total > PACKAGE_LIMITS.totalBytes) failure = "解压后总量太大";
            if (failure !== null) {
                file.terminate();
                return;
            }
            chunks.push(chunk);
            if (final) {
                const whole = new Uint8Array(size);
                let offset = 0;
                for (const part of chunks) {
                    whole.set(part, offset);
                    offset += part.length;
                }
                files.set(file.name, whole);
            }
        };
        file.start();
    };
    try {
        unzipper.push(archive, true);
    } catch (error) {
        return {ok: false, reason: `读不了这个 zip：${error instanceof Error ? error.message : String(error)}`};
    }
    if (failure === null && count === 0) return {ok: false, reason: "读不了这个 zip：里面没有文件"};
    return failure === null ? {ok: true, files} : {ok: false, reason: failure};
}

/** 读一个 zip 里的主题；任何一项不合格都返回原因，不交出任何东西。 */
export function readPackage(archive: Uint8Array): ImportResult {
    if (archive.byteLength > PACKAGE_LIMITS.archiveBytes) return {ok: false, reason: "包太大"};
    const unpacked = unpack(archive);
    if (!unpacked.ok) return unpacked;
    const manifestBytes = unpacked.files.get("package.json");
    if (manifestBytes === undefined) return {ok: false, reason: "包里没有 package.json"};
    let json: unknown;
    try {
        json = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
        return {ok: false, reason: "package.json 不是合法的 JSON"};
    }
    // 清单走真实的清单读取器：发布者、名字、版本、`engines` 与各种字段的规则同一份，坏清单（含 null、缺身份）一律在这里变成原因。
    const read = manifestFormat.read(json);
    if (read.status !== "valid") return {ok: false, reason: `package.json 不合格：${read.problems.map((problem) => `${problem.path} ${problem.message}`).join("；")}`};
    const {manifest} = read;
    if (manifest.entries.length > 0) return {ok: false, reason: "包里有运行入口：只收不写代码的主题插件"};
    const themes: ImportedTheme[] = [];
    const seen = new Set<string>();
    for (const item of manifest.contributes) {
        if (item.capability !== WORKBENCH_THEMES_POINT) continue;
        const id = item.id;
        if (!id.startsWith(`${manifest.id}.`)) return {ok: false, reason: `主题 ${id} 的 id 要以插件 id 开头：${manifest.id}.`};
        if (seen.has(id)) return {ok: false, reason: `主题 id 重复：${id}`};
        seen.add(id);
        if (!Value.Check(ThemeDeclarationSchema, item.declaration)) return {ok: false, reason: `主题 ${id} 的声明不合格`};
        const written = item.declaration as ThemeDeclaration;
        const problem = declarationProblem(id, written);
        if (problem !== null) return {ok: false, reason: problem};
        // 导入的主题进用户层：图标集与工作态场景的素材放不下，读的时候就去掉（docs/specs/theme/editor.md 边界与兼容）。
        const declaration = forUserLayer(written);
        const assets = new Map<string, Uint8Array>();
        for (const appearance of ["light", "dark"] as const) {
            const scene = declaration[appearance].scene;
            if (scene === undefined) continue;
            const bytes = unpacked.files.get(scene);
            if (bytes === undefined) return {ok: false, reason: `主题 ${id} 的场景图 ${scene} 不在包里`};
            if (sniffImageType(bytes) === null) return {ok: false, reason: `${scene} 不是 PNG、JPEG 或 WebP`};
            assets.set(scene, bytes);
        }
        themes.push({declaration, assets});
    }
    if (themes.length === 0) return {ok: false, reason: "包里没有主题"};
    return {ok: true, themes};
}
