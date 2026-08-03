import {existsSync} from "node:fs";
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {builtinModules, createRequire} from "node:module";
import path from "node:path";
import {build, type Plugin} from "esbuild";
import {consola} from "consola";
import {init as initModuleLexer, parse as parseModuleImports} from "es-module-lexer";
import type * as TypeScript from "typescript";
import {DEFAULT_RUNTIME_ARTIFACT_RETENTION, importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";
import {
    resolveRuntimeArtifactCompilerContext,
    resolveRuntimeArtifactNbookPath,
    resolveRuntimeArtifactPackagePath,
    type RuntimeArtifactCompilerContext,
} from "nbook/server/utils/runtime-artifact-compiler-context";

const runtimeRequire = createRequire(import.meta.url);
const ts = runtimeRequire("typescript") as typeof TypeScript;

const importCache = new Map<string, Promise<unknown>>();
const STALE_TEMP_FILE_AGE_MS = 10 * 60 * 1000;
const BARE_PACKAGE_SPECIFIER_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[^\\/:*?"<>|\s]+)*$/;
const NODE_BUILTIN_MODULES = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, "")));

type WorldEngineConfigLabel = "calendar" | "schema";

type SingleFileTypeScriptConfigImport = {
    filePath: string;
    label: WorldEngineConfigLabel;
    /** Project Workspace `.nbook` 内由调用方显式决定的可写 runtime cache 根。 */
    runtimeCacheRoot: string;
    /** Source 或 verified Product 的唯一模块解析合同。 */
    compilerContext?: RuntimeArtifactCompilerContext;
};

/**
 * 以内容 hash 加载 Project Workspace 里的单文件 TypeScript 配置。
 *
 * World Engine 明确只支持 `calendar.ts` 与 `schema/index.ts` 两个单文件入口。
 * 本地文件、绝对路径和 URL import 会造成依赖图缓存语义不清，因此在导入前直接拒绝；
 * 入口文件会先转译为 hash `.mjs` 再导入，避免依赖宿主环境直接 import TypeScript。
 */
export async function importSingleFileTypeScriptConfig<TModule extends object>(
    input: SingleFileTypeScriptConfigImport,
): Promise<TModule> {
    const compilerContext = input.compilerContext ?? await resolveRuntimeArtifactCompilerContext();
    const content = await fs.readFile(input.filePath);
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const cachePath = path.join(input.runtimeCacheRoot, ".staging", `.world-engine-${input.label}-${hash}.mjs`);
    const cached = importCache.get(cachePath);
    if (cached) {
        const imported = await cached as TModule;
        await removeOldRuntimeCache(input.filePath);
        return imported;
    }

    const pending = importValidatedHashedTypeScript<TModule>(input, compilerContext, cachePath, content, hash);
    importCache.set(cachePath, pending);
    try {
        return await pending;
    } catch (error) {
        importCache.delete(cachePath);
        throw error;
    }
}

/** 用 TypeScript AST 与 esbuild 双重确认配置入口没有本地文件、绝对路径或 URL 依赖。 */
async function assertSingleFileConfig(
    filePath: string,
    source: string,
    label: string,
    compilerContext: RuntimeArtifactCompilerContext,
): Promise<void> {
    const rejectedSpecifiers = new Set<string>();
    for (const specifier of collectRejectedSpecifiers(source, compilerContext)) {
        rejectedSpecifiers.add(specifier);
    }
    if (rejectedSpecifiers.size === 0) {
        for (const specifier of await collectBundledRejectedSpecifiers(filePath, compilerContext)) {
            rejectedSpecifiers.add(specifier);
        }
    }
    if (rejectedSpecifiers.size > 0) {
        throw new Error(singleFileConfigError(label, [...rejectedSpecifiers].sort()));
    }
}

/** 解析源码级 import/export，包含 esbuild 会擦除的 `import type` 和 TS import type expression。 */
function collectRejectedSpecifiers(source: string, compilerContext: RuntimeArtifactCompilerContext): string[] {
    const sourceFile = ts.createSourceFile("world-engine-config.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rejectedSpecifiers: string[] = [];
    const collect = (specifier: string): void => {
        if (classifySingleFileConfigSpecifier(specifier) === "rejected") {
            rejectedSpecifiers.push(specifier);
        }
    };
    const rejectDynamic = (kind: "import" | "require"): void => {
        rejectedSpecifiers.push(`动态 ${kind}(<non-literal>)`);
    };
    const visit = (node: TypeScript.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
            collect(node.moduleSpecifier.text);
        }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression;
            if (expression && ts.isStringLiteralLike(expression)) {
                collect(expression.text);
            }
        }
        if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
                collect(argument.literal.text);
            } else {
                rejectedSpecifiers.push("type import(<non-literal>)");
            }
        }
        if (ts.isCallExpression(node)) {
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
            if (!isDynamicImport && !isRequire) {
                ts.forEachChild(node, visit);
                return;
            }
            const [firstArg] = node.arguments;
            if (node.arguments.length !== 1 || !firstArg || !ts.isStringLiteralLike(firstArg)) {
                rejectDynamic(isDynamicImport ? "import" : "require");
            } else {
                collect(firstArg.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return rejectedSpecifiers;
}

/** 让 esbuild 解析入口文件，捕获运行时 import/export 的真实模块 specifier。 */
async function collectBundledRejectedSpecifiers(
    filePath: string,
    compilerContext: RuntimeArtifactCompilerContext,
): Promise<string[]> {
    const rejectedSpecifiers = new Set<string>();
    const plugin: Plugin = {
        name: "world-engine-single-file-config",
        setup(buildApi) {
            buildApi.onResolve({filter: /.*/}, (args) => {
                if (args.kind === "entry-point") {
                    return undefined;
                }
                if (classifySingleFileConfigSpecifier(args.path) === "rejected") {
                    rejectedSpecifiers.add(args.path);
                }
                return {path: args.path, external: true};
            });
        },
    };

    await build({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        metafile: true,
        logLevel: "silent",
        plugins: [plugin],
    });

    return [...rejectedSpecifiers];
}

function classifySingleFileConfigSpecifier(
    specifier: string,
): "allowed" | "rejected" {
    if (isNodeBuiltinSpecifier(specifier) || isAllowedNbookSpecifier(specifier)
        || specifier === "zod") {
        return "allowed";
    }
    // 保留 parser 对路径/URL/动态表达式的统一 rejected 结果。
    if (isBarePackageSpecifier(specifier)) return "rejected";
    return "rejected";
}

function isAllowedNbookSpecifier(specifier: string): boolean {
    return specifier === "nbook/world-engine/schema" || specifier === "neuro_book/world-engine/schema";
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
    if (!specifier.startsWith("node:")) {
        return false;
    }
    return NODE_BUILTIN_MODULES.has(specifier.slice("node:".length));
}

function isBarePackageSpecifier(specifier: string): boolean {
    if (specifier.length === 0 || specifier !== specifier.trim()) {
        return false;
    }
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)) {
        return false;
    }
    if (!BARE_PACKAGE_SPECIFIER_RE.test(specifier)) {
        return false;
    }
    if (NODE_BUILTIN_MODULES.has(specifier)) {
        return false;
    }
    const segments = specifier.split("/");
    return segments.every((segment) => segment !== "." && segment !== "..");
}

function singleFileConfigError(label: string, specifiers: string[]): string {
    const displayPath = configDisplayPath(label);
    return [
        `World Engine ${label} 配置必须是单文件：${displayPath} 不支持本地文件、绝对路径或 URL import/export。`,
        `发现：${specifiers.join(", ")}`,
        `请把 helper 合并到 ${displayPath}，或只使用 zod、nbook/world-engine/schema 等包级 import 与 node: 内置模块。动态 import/require 必须使用静态字符串并符合这条规则。`,
    ].join(" ");
}

function configDisplayPath(label: string): string {
    if (label === "calendar") {
        return "world-engine/calendar.ts";
    }
    if (label === "schema") {
        return "world-engine/schema/index.ts";
    }
    return label;
}

/** 校验后写入稳定临时文件并导入，确保并发加载共享同一条 pending promise。 */
async function importValidatedHashedTypeScript<TModule extends object>(
    input: SingleFileTypeScriptConfigImport,
    compilerContext: RuntimeArtifactCompilerContext,
    cachePath: string,
    content: Buffer,
    hash: string,
): Promise<TModule> {
    await assertSingleFileConfig(input.filePath, content.toString("utf-8"), input.label, compilerContext);
    return await importHashedTypeScript<TModule>(input, compilerContext, cachePath, content, hash);
}

/** 转译成稳定临时 mjs 并导入，导入完成后清理磁盘文件。 */
async function importHashedTypeScript<TModule extends object>(
    input: SingleFileTypeScriptConfigImport,
    compilerContext: RuntimeArtifactCompilerContext,
    cachePath: string,
    content: Buffer,
    hash: string,
): Promise<TModule> {
    await fs.mkdir(path.dirname(cachePath), {recursive: true});
    await cleanupStaleTempFiles(path.dirname(cachePath), input.label);
    await cleanupStaleTempFiles(path.dirname(input.filePath), input.label);
    const compiled = await compileSingleFileTypeScript(input.filePath, content.toString("utf-8"), compilerContext);
    const compiledHash = createHash("sha256").update(compiled).digest("hex");
    try {
        await fs.writeFile(cachePath, compiled, "utf-8");
        try {
            const imported = await importRuntimeArtifact<TModule>(cachePath, {
                cache: {
                    root: input.runtimeCacheRoot,
                    namespace: `world-engine-${input.label}`,
                    key: compiledHash,
                    bytes: Buffer.byteLength(compiled, "utf-8"),
                    retention: DEFAULT_RUNTIME_ARTIFACT_RETENTION,
                },
            });
            await removeOldRuntimeCache(input.filePath);
            return imported;
        } catch (error) {
            throw worldEngineArtifactImportError(error, {
                label: input.label,
                filePath: input.filePath,
                cachePath,
                hash: compiledHash,
            });
        }
    } finally {
        await fs.rm(cachePath, {force: true}).catch(() => undefined);
    }
}

/** 新 `.nbook` cache 已成功导入后，清理源码旁的旧物理 cache。 */
async function removeOldRuntimeCache(filePath: string): Promise<void> {
    const oldCachePath = path.join(path.dirname(filePath), ".runtime-artifact-import-cache");
    await fs.rm(oldCachePath, {
        recursive: true,
        force: true,
    }).catch((error) => {
        consola.warn({path: oldCachePath, error}, "World Engine 旧 runtime artifact cache 清理失败，将在后续加载重试");
    });
}

function worldEngineArtifactImportError(
    error: unknown,
    input: {label: string; filePath: string; cachePath: string; hash: string},
): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    return new Error([
        `World Engine ${input.label} 配置已转译为运行时 artifact，但导入失败。`,
        `source=${input.filePath}`,
        `artifact=${input.cachePath}`,
        `hash=${input.hash}`,
        `原始错误：${originalMessage}`,
    ].join(" "), {cause: error});
}

/** 只编译用户入口和 nbook 公共 helper；第三方包由当前 runtime vendor 解析。 */
async function compileSingleFileTypeScript(
    filePath: string,
    source: string,
    compilerContext: RuntimeArtifactCompilerContext,
): Promise<string> {
    const result = await build({
        stdin: {
            contents: source,
            sourcefile: filePath,
            resolveDir: path.dirname(filePath),
            loader: "ts",
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        absWorkingDir: compilerContext.root,
        nodePaths: compilerContext.productRuntime ? [compilerContext.compilerNodeModulesRoot] : [],
        target: "esnext",
        logLevel: "silent",
        plugins: [runtimeConfigCompilePlugin(compilerContext)],
    });
    const output = result.outputFiles[0];
    if (!output) {
        throw new Error("World Engine TypeScript 配置转译未产生输出文件。");
    }
    await assertWorldEngineArtifactClosure(output.text);
    return output.text;
}

/** 最终 artifact 只能留下 node: builtin；Zod/helper 必须已经进入同一内容寻址文件。 */
async function assertWorldEngineArtifactClosure(source: string): Promise<void> {
    await initModuleLexer;
    const [imports] = parseModuleImports(source);
    const unresolved = imports
        .filter((item) => item.n && !isNodeBuiltinSpecifier(item.n))
        .map((item) => item.n!);
    if (unresolved.length > 0) {
        throw new Error(`World Engine runtime artifact 含未内联 import：${[...new Set(unresolved)].sort().join(", ")}`);
    }
    if (imports.some((item) => item.d >= 0 && !item.n)) {
        throw new Error("World Engine runtime artifact 不允许未解析的动态 import。");
    }
}

function runtimeConfigCompilePlugin(compilerContext: RuntimeArtifactCompilerContext): Plugin {
    return {
        name: "world-engine-config-compile",
        setup(buildApi) {
            buildApi.onResolve({filter: /^(nbook|neuro_book)\//}, (args) => {
                const relativePath = args.path.replace(/^(nbook|neuro_book)\//, "");
                if (!isAllowedNbookSpecifier(args.path)) {
                    return {errors: [{text: `World Engine 配置未登记 nbook import：${args.path}`}]};
                }
                return {path: resolveRuntimeArtifactNbookPath(compilerContext, relativePath)};
            });
            buildApi.onResolve({filter: /^[^./].*/}, (args) => {
                if (isNodeBuiltinSpecifier(args.path)) {
                    return {path: args.path, external: true};
                }
                if (args.path !== "zod") {
                    return undefined;
                }
                return {path: resolveRuntimeArtifactPackagePath(compilerContext, args.path)};
            });
        },
    };
}

/** 清理异常中断留下的旧临时文件；保留近期文件，避免误删并发导入中的文件。 */
async function cleanupStaleTempFiles(directory: string, label: string): Promise<void> {
    const entries = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
    const now = Date.now();
    await Promise.all(entries
        .filter((entry) =>
            entry.isFile()
            && entry.name.startsWith(`.world-engine-${label}-`)
            && (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")),
        )
        .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats || now - stats.mtimeMs < STALE_TEMP_FILE_AGE_MS) {
                return;
            }
            await fs.rm(filePath, {force: true}).catch(() => undefined);
        }));
}
