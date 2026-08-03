import {builtinModules} from "node:module";
import {cp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {init as initModuleLexer, parse as parseModuleImports} from "es-module-lexer";
import type {Metafile} from "esbuild";
import {
    productPiAiImportPlugin,
    productRuntimeCompatibilityPlugin,
} from "nbook/scripts/build/product-bundle-plugins";
import {bundleProductJavaScript} from "nbook/scripts/build/product-reproducible-bundle";
import {
    PRODUCT_COMMAND_CHUNK_BASENAME,
    productRuntimeIslandPackageNames,
} from "nbook/scripts/build/product-runtime-islands";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    type ProductRuntimeContract,
    type ProductRuntimeEntryMap,
} from "nbook/shared/product-runtime-contract";

export const PRODUCT_COMMAND_SOURCES = {
    "product-start": "server/runtime/product-start-command.mjs",
    "check-migrations": "server/runtime/check-migrations-command.ts",
    "sqlite-migrate": "server/database/sqlite-migrate-command.mjs",
    "migrate-application-state": "server/runtime/application-state-command.ts",
    "create-admin": "server/auth/create-admin-command.ts",
    "prepare-system-assets": "server/runtime/prepare-system-assets-command.ts",
    "product-profile-authoring-smoke": "scripts/deploy/product-profile-authoring-smoke.ts",
    "product-variable-authoring-smoke": "scripts/deploy/product-variable-authoring-smoke.ts",
    "product-image-variant-smoke": "scripts/deploy/product-image-variant-smoke.ts",
    "sqlite-vec-smoke": "scripts/smoke/sqlite-vec-smoke.ts",
    "product-web-fetch-smoke": "server/runtime/web-fetch-check.ts",
    "product-world-engine-config-smoke": "scripts/deploy/product-world-engine-config-smoke.ts",
    "profile": "server/agent/profiles/profile-command.ts",
    "variable": "server/agent/variables/variable-command.ts",
    "workspace": "server/workspace-files/workspace-command.ts",
    "product-command": "server/runtime/product-command.ts",
} as const;

export type ProductCommandBundleResult = {
    commands: string[];
    entries: ProductRuntimeEntryMap;
    contract: ProductRuntimeContract;
    files: number;
    bytes: number;
};

/** 一次多入口构建 Product 命令，共享公共 chunks，运行时不再加载 Source TypeScript。 */
export async function buildProductCommands(outputRoot: string): Promise<ProductCommandBundleResult> {
    const serverRoot = resolve(outputRoot, "server");
    const commandRoot = resolve(serverRoot, "commands");
    await rm(commandRoot, {recursive: true, force: true});
    await mkdir(commandRoot, {recursive: true});

    const result = await bundleProductJavaScript({
        absWorkingDir: commandRoot,
        entryPoints: Object.fromEntries(Object.entries(PRODUCT_COMMAND_SOURCES).map(([name, source]) => (
            [name, resolve(source)]
        ))),
        splitting: true,
        metafile: true,
        outdir: commandRoot,
        entryNames: "[name]",
        chunkNames: `chunks/${PRODUCT_COMMAND_CHUNK_BASENAME}-[hash]`,
        assetNames: "assets/[name]-[hash]",
        outExtension: {".js": ".mjs"},
        plugins: [productPiAiImportPlugin(), productRuntimeCompatibilityPlugin()],
        external: [
            ...builtinModules,
            ...builtinModules.map((moduleName) => `node:${moduleName}`),
            "bun",
            "bun:*",
            ...productRuntimeIslandPackageNames().flatMap((packageName) => [packageName, `${packageName}/*`]),
        ],
    });
    await pruneEmptyProductCommandChunks(result.metafile, commandRoot);
    await assertProductCommandOutputs(result.metafile, commandRoot);

    await copyPhysicalRuntimeFiles(serverRoot);
    const commandEntries = resolveProductCommandEntries(result.metafile, commandRoot);
    if (commandEntries["product-command"] !== PRODUCT_RUNTIME_COMMAND_BOOTSTRAP) {
        throw new Error(`Product command bootstrap 路径不稳定：${commandEntries["product-command"]}`);
    }
    const entry = (name: keyof typeof PRODUCT_COMMAND_SOURCES): string => commandEntries[name];
    const entries: ProductRuntimeEntryMap = {
        productStart: entry("product-start"),
        sqliteMigrate: entry("sqlite-migrate"),
        applicationStateMigration: entry("migrate-application-state"),
        createAdmin: entry("create-admin"),
        profile: entry("profile"),
        variable: entry("variable"),
        workspace: entry("workspace"),
        prepareSystemAssets: entry("prepare-system-assets"),
        checkMigrations: entry("check-migrations"),
        profileAuthoringSmoke: entry("product-profile-authoring-smoke"),
        variableAuthoringSmoke: entry("product-variable-authoring-smoke"),
        imageVariantSmoke: entry("product-image-variant-smoke"),
        sqliteVecSmoke: entry("sqlite-vec-smoke"),
        webFetchSmoke: entry("product-web-fetch-smoke"),
        worldEngineConfigSmoke: entry("product-world-engine-config-smoke"),
    };
    const inventory = await directoryInventory(commandRoot);
    return {
        commands: Object.keys(PRODUCT_COMMAND_SOURCES).sort(),
        entries,
        contract: createProductRuntimeContract(entries),
        ...inventory,
    };
}

/** 删除 esbuild 由纯 re-export 入口生成的无代码 shared chunk，并清理其静态副作用导入。 */
export async function pruneEmptyProductCommandChunks(
    metafile: Metafile | undefined,
    commandRoot: string,
): Promise<void> {
    if (!metafile) throw new Error("Product command bundle 缺少 metafile。");
    const emptyOutputs = Object.entries(metafile.outputs).filter(([outputName, output]) => {
        const outputRelative = resolveCommandOutput(outputName, commandRoot).outputRelative.replaceAll("\\", "/");
        return outputRelative.startsWith(`chunks/${PRODUCT_COMMAND_CHUNK_BASENAME}-`)
            && outputRelative.endsWith(".mjs")
            && output.bytes === 0
            && output.imports.length === 0
            && output.exports.length === 0
            && Object.values(output.inputs).every((input) => input.bytesInOutput === 0);
    });
    if (emptyOutputs.length === 0) return;

    await initModuleLexer;
    const emptySpecsByImporter = new Map<string, Set<string>>();
    for (const [emptyOutputName] of emptyOutputs) {
        const emptyOutputPath = resolveCommandOutput(emptyOutputName, commandRoot).outputPath;
        for (const importerName of Object.keys(metafile.outputs)) {
            if (importerName === emptyOutputName) continue;
            const importerPath = resolveCommandOutput(importerName, commandRoot).outputPath;
            const specifier = relative(dirname(importerPath), emptyOutputPath).replaceAll("\\", "/");
            const normalizedSpecifier = specifier.startsWith(".") ? specifier : `./${specifier}`;
            const source = await readFile(importerPath, "utf8");
            const [imports] = parseModuleImports(source);
            const matches = imports.filter((item) => item.n === normalizedSpecifier);
            if (matches.some((item) => item.d >= 0)) {
                throw new Error(`Product command empty shared chunk 被动态 import：${normalizedSpecifier}`);
            }
            if (matches.length === 0) continue;
            if (matches.some((item) => !/^import\s*["']/u.test(source.slice(item.ss, item.se).trim()))) {
                throw new Error(`Product command empty shared chunk 含有绑定 import：${normalizedSpecifier}`);
            }
            const key = importerPath;
            const specifiers = emptySpecsByImporter.get(key) ?? new Set<string>();
            specifiers.add(normalizedSpecifier);
            emptySpecsByImporter.set(key, specifiers);
        }
    }

    for (const [importerPath, specifiers] of emptySpecsByImporter) {
        let source = await readFile(importerPath, "utf8");
        const [imports] = parseModuleImports(source);
        const ranges = imports
            .filter((item) => item.d < 0 && item.n !== undefined && specifiers.has(item.n))
            .map((item) => ({start: item.ss, end: item.se}))
            .sort((left, right) => right.start - left.start);
        for (const range of ranges) source = `${source.slice(0, range.start)}${source.slice(range.end)}`;
        await writeFile(importerPath, source, "utf8");
    }

    for (const [emptyOutputName] of emptyOutputs) {
        const {outputPath} = resolveCommandOutput(emptyOutputName, commandRoot);
        await rm(outputPath, {force: true});
        delete metafile.outputs[emptyOutputName];
    }
}

/** 从 esbuild metafile 的 source entryPoint 建立 Product 相对入口，不依赖输出文件名规则。 */
export function resolveProductCommandEntries(
    metafile: Metafile | undefined,
    commandRoot: string,
): Record<keyof typeof PRODUCT_COMMAND_SOURCES, string> {
    if (!metafile) throw new Error("Product command bundle 缺少 metafile。");
    const outputBySource = new Map<string, string>();
    for (const [outputName, output] of Object.entries(metafile.outputs)) {
        if (!output.entryPoint) continue;
        const sourcePath = isAbsolute(output.entryPoint)
            ? resolve(output.entryPoint)
            : resolve(commandRoot, output.entryPoint);
        // esbuild metafile 的 output key 在不同构建形态下可能是绝对路径，也可能相对 absWorkingDir。
        // 相对值必须以 commandRoot 解析，不能借用调用进程 cwd。
        const {outputRelative} = resolveCommandOutput(outputName, commandRoot);
        if (outputBySource.has(sourcePath)) {
            throw new Error(`Product command source 产生多个 entry output：${sourcePath}`);
        }
        outputBySource.set(sourcePath, `server/commands/${outputRelative.replaceAll("\\", "/")}`);
    }
    return Object.fromEntries(Object.entries(PRODUCT_COMMAND_SOURCES).map(([name, source]) => {
        const output = outputBySource.get(resolve(source));
        if (!output) throw new Error(`Product command metafile 缺少 entry：${name}`);
        return [name, output];
    })) as Record<keyof typeof PRODUCT_COMMAND_SOURCES, string>;
}

/** 要求清理后的 esbuild outdir 中每个 metafile output 已完整落盘，拒绝空文件与截断。 */
export async function assertProductCommandOutputs(
    metafile: Metafile | undefined,
    commandRoot: string,
): Promise<void> {
    if (!metafile) throw new Error("Product command bundle 缺少 metafile。");
    for (const [outputName, output] of Object.entries(metafile.outputs)) {
        const {outputPath, outputRelative} = resolveCommandOutput(outputName, commandRoot);
        const info = await stat(outputPath).catch((error) => {
            throw new Error(`Product command output 未落盘：${outputRelative}`, {cause: error});
        });
        if (!info.isFile() || info.size === 0) {
            throw new Error(`Product command output 不完整：${outputRelative} expected=${output.bytes} actual=${info.size}`);
        }
    }
}

/** 将 Bun 的绝对或 outdir 相对 output key 收窄到 commands root。 */
function resolveCommandOutput(outputName: string, commandRoot: string): {outputPath: string; outputRelative: string} {
    const outputPath = isAbsolute(outputName) ? resolve(outputName) : resolve(commandRoot, outputName);
    const outputRelative = relative(commandRoot, outputPath);
    if (!outputRelative || outputRelative === ".." || outputRelative.startsWith(`..${sep}`)
        || isAbsolute(outputRelative)) {
        throw new Error(`Product command metafile output 逃逸 commands root：${outputName}`);
    }
    return {outputPath, outputRelative};
}

/** SQLite migration SQL 是数据演进真相源，必须保留普通文件而不是冻结进 bundle。 */
async function copyPhysicalRuntimeFiles(serverRoot: string): Promise<void> {
    const migrationsTarget = resolve(serverRoot, "prisma", "migrations", "sqlite");
    await rm(resolve(serverRoot, "prisma"), {recursive: true, force: true});
    await mkdir(dirname(migrationsTarget), {recursive: true});
    await cp(resolve("prisma", "migrations", "sqlite"), migrationsTarget, {recursive: true, dereference: true});
    await cp(resolve("prisma", "schema.sqlite.prisma"), resolve(serverRoot, "prisma", "schema.sqlite.prisma"));
}

/** 统计包含 shared chunks 的完整命令 owner。 */
async function directoryInventory(root: string): Promise<{files: number; bytes: number}> {
    let files = 0;
    let bytes = 0;
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await Array.fromAsync(new Bun.Glob("**/*").scan({cwd: directory, onlyFiles: true}))) {
            files += 1;
            bytes += (await stat(resolve(directory, entry))).size;
        }
    };
    await walk(root);
    return {files, bytes};
}

if (import.meta.main) {
    const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
    console.log(await buildProductCommands(outputRoot));
}
