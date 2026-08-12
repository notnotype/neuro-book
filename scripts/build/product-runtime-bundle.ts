import {builtinModules} from "node:module";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {currentProductPlatform} from "nbook/packages/neuro-book-manager/src/platform";
import {
    analyzeRuntimeModuleSource,
    assertRuntimeModuleFiles,
    assertRuntimePackageIdentity,
} from "nbook/scripts/build/nitro-runtime-module-specifier.mjs";
import {
    productPiAiImportPlugin,
    productRuntimeCompatibilityPlugin,
} from "nbook/scripts/build/product-bundle-plugins";
import {rewriteProductPackageIslandImports} from "nbook/scripts/build/product-package-island-imports";
import {bundleProductJavaScript} from "nbook/scripts/build/product-reproducible-bundle";
import {
    productOpaqueImportDefinitions,
    productRuntimeIslandDefinitions,
    productRuntimeIslandPackageNames,
    productRuntimeIslandSourceRoot,
} from "nbook/scripts/build/product-runtime-islands";
import {containsSourceRootDescendant} from "nbook/scripts/build/product-source-path-contract";
import {
    projectTypeScriptRuntime,
    type TypeScriptRuntimeProjection,
} from "nbook/scripts/build/typescript-runtime-projection";

const NATIVE_ISLAND_SCHEMA = "nbook.product-native-islands/v2";
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NITRO_IMPORT_META_FALLBACK = "file:///_entry.js";
const NITRO_IMPORT_META_FALLBACK_SHAPE = '{url:"file:///_entry.js",env:process.env}';
const NITRO_RELATIVE_ENTRY_URL = /new URL\(\s*(["'])(?:\.\.\/)+index\.mjs\1\s*,\s*import\.meta\.url\s*\)\.href/u;

export type ProductRuntimeBundleResult = {
    entryBytes: number;
    bundledInputs: number;
    islands: string[];
    islandFiles: number;
    islandBytes: number;
    islandImportFiles: number;
    islandImportReferences: number;
    rawModuleFiles: number;
    discoveredSeeds: string[];
    specifierRewrites: number;
    typescriptProjection: TypeScriptRuntimeProjection;
    msvcRuntime?: ProductMsvcRuntimeResult;
};

/** win32-x64 Product 镜像内 app-local 部署的 MSVC Runtime（VC++ 2015-2022 Redistributable）。 */
export type ProductMsvcRuntimeResult = {
    dlls: Array<{name: string; sha256: string}>;
    targets: string[];
    files: number;
    bytes: number;
};

/**
 * 把 Nitro 可执行图收敛为单个确定性 bundle，并只保留需要真实 package 形状的 native islands。
 * pi-ai 的三个变量相对 import 通过 build plugin 改成静态入口，避免把整套 Provider SDK 留在磁盘。
 */
export async function bundleProductRuntime(outputRoot: string, scratchRoot: string): Promise<ProductRuntimeBundleResult> {
    const imageRoot = resolve(outputRoot);
    const serverRoot = resolve(imageRoot, "server");
    const sourceEntry = resolve(serverRoot, "index.mjs");
    if (!existsSync(sourceEntry)) {
        throw new Error(`Product bundle 缺少 Nitro 入口：${sourceEntry}`);
    }

    const operationScratchRoot = resolve(scratchRoot);
    const scratchRelativePath = relative(imageRoot, operationScratchRoot);
    if (scratchRelativePath === "" || scratchRelativePath === ".."
        || scratchRelativePath.startsWith(`..${sep}`) || isAbsolute(scratchRelativePath)) {
        throw new Error(`Product Runtime bundle scratch 必须位于候选镜像内：${operationScratchRoot}`);
    }
    const temporaryRoot = resolve(operationScratchRoot, "runtime-bundle");
    const temporaryEntry = resolve(temporaryRoot, "index.mjs");
    await rm(temporaryRoot, {recursive: true, force: true});
    await mkdir(temporaryRoot, {recursive: true});
    try {
        const moduleSpecifiers = await normalizeRawRuntimeImports(serverRoot);
        const build = await bundleProductJavaScript({
            entryPoints: [sourceEntry],
            outfile: temporaryEntry,
            metafile: true,
            plugins: [productPiAiImportPlugin(), productRuntimeCompatibilityPlugin()],
            external: [
                ...builtinModules,
                ...builtinModules.map((name) => `node:${name}`),
                "bun",
                "bun:*",
                ...productRuntimeIslandPackageNames().flatMap((packageName) => [packageName, `${packageName}/*`]),
            ],
        });
        if (!existsSync(temporaryEntry)) {
            throw new Error("Product Runtime bundle 没有 entry output。");
        }
        const portableSource = normalizeNitroImportMetaFallback(
            normalizePackageManagerMetadata(await readFile(temporaryEntry, "utf8")),
            temporaryEntry,
        );
        await writeFile(temporaryEntry, portableSource, "utf8");

        await rm(sourceEntry, {force: true});
        await cp(temporaryEntry, sourceEntry);
        await rm(resolve(serverRoot, "chunks"), {recursive: true, force: true});
        await rm(resolve(serverRoot, "node_modules"), {recursive: true, force: true});
        const islandInventory = await copyNativeIslands(serverRoot);
        const islandImports = await rewriteProductPackageIslandImports({
            serverRoot,
            sourceRoot: SOURCE_ROOT,
            packageNames: islandInventory.packages,
        });
        await assertBundledRuntimeClosure(serverRoot);

        return {
            entryBytes: (await stat(sourceEntry)).size,
            bundledInputs: Object.keys(build.metafile?.inputs ?? {}).length,
            islands: islandInventory.packages,
            islandFiles: islandInventory.files,
            islandBytes: islandInventory.bytes,
            islandImportFiles: islandImports.rewrittenFiles,
            islandImportReferences: islandImports.rewrittenReferences,
            rawModuleFiles: moduleSpecifiers.files,
            discoveredSeeds: moduleSpecifiers.seeds,
            specifierRewrites: moduleSpecifiers.rewrites,
            typescriptProjection: islandInventory.typescriptProjection,
            ...(islandInventory.msvcRuntime ? {msvcRuntime: islandInventory.msvcRuntime} : {}),
        };
    } finally {
        await rm(temporaryRoot, {recursive: true, force: true});
    }
}

/**
 * Vite/Nitro 的前端资源 manifest 会保留 Bun/pnpm store module id。
 * 这些值不是 import，但属于构建机身份；统一改成逻辑 package 路径并保持键和值一致。
 */
function normalizePackageManagerMetadata(source: string): string {
    return source.replace(
        /(?:\.\.\/)*node_modules\/(?:\.bun\/[^/"']+\/node_modules\/|\.pnpm\/[^/"']+\/node_modules\/)(@[^/"']+\/[^/"']+|[^/"']+)\//gu,
        (_match, packageName: string) => `node_modules/${packageName}/`,
    );
}

/**
 * 把 raw Nitro 中的构建机 package 路径改成可迁移 module specifier。
 * native island 使用 bare subpath 交给 bundler external，其余路径落到当前 raw vendor 供 bundle 读取。
 */
async function normalizeRawRuntimeImports(serverRoot: string): Promise<{files: number; seeds: string[]; rewrites: number}> {
    const nativePackages = new Set(productRuntimeIslandPackageNames());
    const files = [resolve(serverRoot, "index.mjs"), ...await listMjsFiles(resolve(serverRoot, "chunks"))];
    const seeds = new Set<string>();
    let rewrites = 0;
    for (const filePath of files) {
        const source = await readFile(filePath, "utf8");
        const importMetaNormalized = normalizeNitroImportMetaFallback(source, filePath);
        const analysis = await analyzeRuntimeModuleSource({
            source: importMetaNormalized,
            importerPath: filePath,
            serverRoot,
            projectRoot: SOURCE_ROOT,
        });
        for (const seed of analysis.seeds) seeds.add(seed);
        rewrites += analysis.rewriteCount;
        let normalized = analysis.source;
        const replacements = new Map<string, string>();
        for (const reference of analysis.references) {
            if (reference.kind !== "path") continue;
            await assertRuntimePackageIdentity(reference, SOURCE_ROOT);
            const buildSpecifier = nativePackages.has(reference.packageName)
                ? reference.packageSubpath
                    ? `${reference.packageName}/${reference.packageSubpath}${reference.suffix}`
                    : `${reference.packageName}${reference.suffix}`
                : sourcePackageSpecifier(filePath, reference);
            const existing = replacements.get(reference.normalizedSpecifier);
            if (existing !== undefined && existing !== buildSpecifier) {
                throw new Error(`Product Runtime 同一 specifier 产生了两个构建目标：${reference.normalizedSpecifier}`);
            }
            replacements.set(reference.normalizedSpecifier, buildSpecifier);
        }
        for (const [normalizedSpecifier, buildSpecifier] of replacements) {
            normalized = replaceQuotedSpecifier(normalized, normalizedSpecifier, buildSpecifier, filePath);
        }
        if (normalized !== source) await writeFile(filePath, normalized, "utf8");
    }
    return {files: files.length, seeds: [...seeds].sort(), rewrites};
}

/**
 * Nitro raw chunk 的 fallback 只在 bundle 前存在；合并后必须以最终 entry 的
 * `import.meta.url` 为 createRequire 基准，不能保留 raw chunk 的相对层级。
 */
function normalizeNitroImportMetaFallback(source: string, filePath: string): string {
    let normalized = source.replaceAll(
        NITRO_IMPORT_META_FALLBACK_SHAPE,
        "{url:import.meta.url,env:process.env}",
    );
    while (NITRO_RELATIVE_ENTRY_URL.test(normalized)) {
        normalized = normalized.replace(NITRO_RELATIVE_ENTRY_URL, "import.meta.url");
    }
    if (hasNitroImportMetaFallback(normalized)) {
        throw new Error(`Nitro import.meta fallback 形状变化：${filePath}`);
    }
    return normalized;
}

/** 单文件 bundle 不得保留 raw chunk 相对于旧目录层级计算的 entry URL。 */
function hasNitroImportMetaFallback(source: string): boolean {
    return source.includes(NITRO_IMPORT_META_FALLBACK) || NITRO_RELATIVE_ENTRY_URL.test(source);
}

/** 只替换完整 module specifier，避免新相对路径再次包含旧 specifier 而被重复扩展。 */
function replaceQuotedSpecifier(source: string, current: string, next: string, importerPath: string): string {
    let replaced = false;
    let output = source;
    for (const quote of ["'", "\""] as const) {
        const token = `${quote}${current}${quote}`;
        if (!output.includes(token)) continue;
        output = output.replaceAll(token, `${quote}${next}${quote}`);
        replaced = true;
    }
    if (!replaced) {
        throw new Error(`Product Runtime 无法定位已解析 specifier：${current}\nimporter=${importerPath}`);
    }
    return output;
}

/**
 * 非 native external 只在构建期指向已核对版本的 hoisted Source package。
 * esbuild 会把实现收入单文件 bundle，最终镜像不会保留这个相对路径。
 */
function sourcePackageSpecifier(
    importerPath: string,
    reference: {
        packageName: string;
        packageSubpath: string;
        suffix: string;
    },
): string {
    const target = resolve(
        SOURCE_ROOT,
        "node_modules",
        ...reference.packageName.split("/"),
        ...(reference.packageSubpath ? reference.packageSubpath.split("/") : []),
    );
    const relativePath = relative(dirname(importerPath), target).replaceAll("\\", "/");
    const portablePath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return `${portablePath}${reference.suffix}`;
}

/** 稳定枚举 raw Nitro chunks，ESM lexer 只处理真实 `.mjs` 输入。 */
async function listMjsFiles(root: string): Promise<string[]> {
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(filePath);
        }
    };
    await walk(root);
    return files.sort();
}

async function copyNativeIslands(serverRoot: string): Promise<{
    packages: string[];
    files: number;
    bytes: number;
    typescriptProjection: TypeScriptRuntimeProjection;
    msvcRuntime?: ProductMsvcRuntimeResult;
}> {
    const definitions = productRuntimeIslandDefinitions();
    const packages = productRuntimeIslandPackageNames();
    let typescriptProjection: TypeScriptRuntimeProjection | null = null;
    for (const packageName of packages) {
        const source = productRuntimeIslandSourceRoot(packageName, SOURCE_ROOT);
        const target = resolve(serverRoot, "node_modules", ...packageName.split("/"));
        await mkdir(dirname(target), {recursive: true});
        if (packageName === "typescript") {
            typescriptProjection = await projectTypeScriptRuntime({
                sourceRoot: source,
                targetRoot: target,
                authoringTsconfigPath: resolve(serverRoot, "authoring", "tsconfig.json"),
            });
        } else {
            await cp(source, target, {recursive: true, dereference: true});
        }
    }
    if (!typescriptProjection) throw new Error("Product package islands缺少TypeScript Runtime Projection。");
    const msvcRuntime = process.platform === "win32" && process.arch === "x64"
        ? await copyMsvcRuntime(serverRoot)
        : undefined;
    const manifest = {
        schema: NATIVE_ISLAND_SCHEMA,
        platform: currentProductPlatform(),
        islands: definitions,
        opaqueImports: productOpaqueImportDefinitions(),
        ...(msvcRuntime ? {msvcRuntime} : {}),
    };
    await writeFile(resolve(serverRoot, "native-islands.json"), `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
    return {packages, typescriptProjection, msvcRuntime, ...await directoryInventory(resolve(serverRoot, "node_modules"))};
}

/**
 * 全新 Windows（例如 Windows Sandbox）没有 VC++ Redistributable 时，libsql/sharp/
 * sqlite-vec/esbuild 的 MSVC prebuilt 会 LoadLibrary 失败；微软允许 app-local 部署
 * MSVC Runtime。构建必须显式提供固定版本的 DLL 目录，缺失即 fail closed。
 * DLL 复制到镜像内每个含 `.node` 的目录和 esbuild.exe 目录，使各 native 二进制
 * 都能按自身目录解析依赖。
 */
const MSVC_RUNTIME_DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"] as const;

async function copyMsvcRuntime(serverRoot: string): Promise<ProductMsvcRuntimeResult> {
    const runtimeDir = process.env.NEURO_BOOK_MSVC_RUNTIME_DIR?.trim();
    if (!runtimeDir) {
        throw new Error("win32-x64 Product 构建必须设置 NEURO_BOOK_MSVC_RUNTIME_DIR（固定版本 MSVC Runtime DLL 目录）。");
    }
    const dlls: ProductMsvcRuntimeResult["dlls"] = [];
    for (const name of MSVC_RUNTIME_DLLS) {
        const filePath = resolve(runtimeDir, name);
        if (!(await stat(filePath).catch(() => null))?.isFile()) {
            throw new Error(`MSVC Runtime DLL 缺失：${filePath}`);
        }
        dlls.push({name, sha256: await fileSha256(filePath)});
    }
    const targets = new Set<string>();
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(filePath);
            } else if (entry.isFile() && (entry.name.endsWith(".node") || entry.name === "esbuild.exe")) {
                targets.add(directory);
            }
        }
    };
    await walk(resolve(serverRoot, "node_modules"));
    if (targets.size === 0) {
        throw new Error("MSVC Runtime 复制未发现任何 native 二进制目标。");
    }
    let bytes = 0;
    for (const target of [...targets].sort()) {
        for (const name of MSVC_RUNTIME_DLLS) {
            const source = resolve(runtimeDir, name);
            bytes += (await stat(source)).size;
            await copyFile(source, resolve(target, name));
        }
    }
    return {
        dlls,
        targets: [...targets].sort().map((target) => relative(serverRoot, target)),
        files: targets.size * MSVC_RUNTIME_DLLS.length,
        bytes,
    };
}

async function fileSha256(filePath: string): Promise<string> {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

/** Product bundle 最终不得留下构建机路径或候选外可达 import。 */
async function assertBundledRuntimeClosure(serverRoot: string): Promise<void> {
    const entry = resolve(serverRoot, "index.mjs");
    const source = await readFile(entry, "utf8");
    const analysis = await analyzeRuntimeModuleSource({
        source,
        importerPath: entry,
        serverRoot,
        projectRoot: SOURCE_ROOT,
    });
    if (analysis.source !== source || analysis.rewriteCount > 0) {
        throw new Error("Product bundle 仍含包管理器物理路径或构建机 node_modules 路径。");
    }
    if (hasNitroImportMetaFallback(source)) {
        throw new Error("Product bundle 仍含 Nitro 非法 import.meta fallback。");
    }
    await assertRuntimeModuleFiles({filePaths: [entry], serverRoot, projectRoot: SOURCE_ROOT});
    assertBundledRuntimeSourcePaths(source, SOURCE_ROOT);
}

/** 验证最终 bundle 没有携带包管理器目录或 Source Root 下的构建文件路径。 */
export function assertBundledRuntimeSourcePaths(source: string, sourceRoot: string): void {
    if (source.includes("/.bun/") || source.includes("/.pnpm/")
        || containsSourceRootDescendant(source, sourceRoot)) {
        throw new Error("Product bundle 泄漏了包管理器目录或构建机绝对路径。");
    }
}

async function directoryInventory(root: string): Promise<{files: number; bytes: number}> {
    let files = 0;
    let bytes = 0;
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(filePath);
            } else if (entry.isFile()) {
                files += 1;
                bytes += (await stat(filePath)).size;
            } else {
                throw new Error(`Native island 含特殊文件：${relative(root, filePath)}`);
            }
        }
    };
    await walk(root);
    return {files, bytes};
}

if (import.meta.main) {
    const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
    const scratchRoot = process.env.NEURO_BOOK_PRODUCT_SCRATCH_ROOT?.trim();
    if (!scratchRoot) {
        throw new Error("Product Runtime bundle 必须由 Product Runtime Image Builder 注入 operation scratch root。");
    }
    console.log(await bundleProductRuntime(outputRoot, scratchRoot));
}
