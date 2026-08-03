import {existsSync} from "node:fs";
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {dirname, extname, relative, resolve} from "node:path";
import {init, parse} from "es-module-lexer";
import ts from "typescript";
import {
    productPiAiImportPlugin,
    productRuntimeCompatibilityPlugin,
} from "nbook/scripts/build/product-bundle-plugins";
import {
    bundleProductJavaScript,
    productBundleOutputText,
} from "nbook/scripts/build/product-reproducible-bundle";
import {productRuntimeIslandPackageNames} from "nbook/scripts/build/product-runtime-islands";
import {containsSourceRootDescendant} from "nbook/scripts/build/product-source-path-contract";
import {
    projectAuthoringDependencies,
    type AuthoringDependencyRegistration,
    type ProjectedAuthoringDependency,
} from "nbook/scripts/build/product-authoring-type-projection";

export type ProductAuthoringKitResult = {
    compilerBytes: number;
    sdkBytes: number;
    typeBytes: number;
    typeFiles: number;
    dependencies: ProductAuthoringDependency[];
};

export type ProductAuthoringDependency = ProjectedAuthoringDependency;

const AUTHORING_DEPENDENCY_SCHEMA = "nbook.product-authoring-dependencies/v2";
const AUTHORING_DEPENDENCIES = [
    {
        name: "typebox",
        kind: "runtime",
        purpose: "Profile 源码公开使用 Type 构造 schema，运行时 esbuild 需要读取实现与声明。",
        smoke: "compile and import a Profile that uses Type.Object",
    },
    {
        name: "@types/node",
        kind: "types",
        purpose: "Profile SDK 声明引用 Node 类型。",
        smoke: "typecheck Profile SDK declarations",
    },
    {
        name: "undici-types",
        kind: "types",
        purpose: "@types/node 的 fetch 声明引用 undici-types。",
        smoke: "resolve Node fetch declarations",
    },
] as const satisfies readonly AuthoringDependencyRegistration[];

/**
 * 建立与 Product revision 绑定的 Profile Authoring Kit。
 *
 * worker 实现被 bundle 成一个确定性入口；SDK 保留源码与专用 tsconfig，供运行时
 * esbuild 编译用户 Profile。这里不复制完整 server/app/docs 或通用 node_modules。
 */
export async function buildProductAuthoringKit(outputRoot: string): Promise<ProductAuthoringKitResult> {
    const serverRoot = resolve(outputRoot, "server");
    const kitRoot = resolve(serverRoot, "authoring");
    const compilerPath = resolve(kitRoot, "profile-compile-worker.mjs");
    const nbookRoot = resolve(kitRoot, "nbook");
    const sdkSourceRoot = resolve(kitRoot, "sdk-source");
    const typeRoot = resolve(kitRoot, "types");
    await rm(kitRoot, {recursive: true, force: true});
    await mkdir(nbookRoot, {recursive: true});
    await mkdir(sdkSourceRoot, {recursive: true});

    const result = await bundleProductJavaScript({
        entryPoints: [resolve("server", "agent", "profiles", "profile-compile-worker-entry.ts")],
        outfile: compilerPath,
        write: false,
        plugins: [productPiAiImportPlugin(), productRuntimeCompatibilityPlugin()],
        external: [
            "bun",
            "bun:*",
            ...productRuntimeIslandPackageNames().flatMap((packageName) => [packageName, `${packageName}/*`]),
        ],
    });
    await writeFile(
        compilerPath,
        productBundleOutputText(result, "Profile compiler bundle"),
        "utf8",
    );

    const sdkEntries = [
        {name: "profile-sdk", files: ["index.ts", "contracts.ts", "constructors.ts", "writing.ts", "jsx-runtime.ts", "jsx-dev-runtime.ts"]},
        {name: "variable-sdk", files: ["index.ts", "contracts.ts"]},
    ] as const;
    for (const sdk of sdkEntries) {
        const runtimeRoot = resolve(nbookRoot, sdk.name);
        const sourceRoot = resolve(sdkSourceRoot, sdk.name);
        await mkdir(runtimeRoot, {recursive: true});
        await mkdir(sourceRoot, {recursive: true});
        for (const fileName of sdk.files) {
            const source = resolve(sdk.name, fileName);
            if (!existsSync(source)) throw new Error(`${sdk.name} 缺少 ${fileName}`);
            await cp(source, resolve(sourceRoot, fileName));
            const runtimeFileName = fileName.replace(/\.ts$/u, ".mjs");
            const sdkBuild = await bundleProductJavaScript({
                entryPoints: [source],
                outfile: resolve(runtimeRoot, runtimeFileName),
                write: false,
                external: [
                    "bun",
                    "bun:*",
                    ...(sdk.name === "profile-sdk" && fileName.startsWith("jsx-")
                        ? ["nbook/profile-sdk", "nbook/profile-sdk/*"]
                        : []),
                ],
            });
            const runtimeSource = await rewriteProjectedSdkImports(
                productBundleOutputText(sdkBuild, `${sdk.name} ${fileName}`),
                `${sdk.name}/${runtimeFileName}`,
            );
            await writeFile(resolve(runtimeRoot, runtimeFileName), runtimeSource, "utf8");
        }
    }

    // World Engine schema helper 与 Zod 运行时是 Authoring Kit 的独立小岛。
    // helper 保留唯一的相对 Zod 入口，最终用户 schema artifact 会把两者一起内联。
    const worldEngineRoot = resolve(nbookRoot, "world-engine");
    const worldEngineSourceRoot = resolve(sdkSourceRoot, "world-engine", "schema");
    await mkdir(worldEngineRoot, {recursive: true});
    await mkdir(worldEngineSourceRoot, {recursive: true});
    await cp(resolve("world-engine", "schema", "index.ts"), resolve(worldEngineSourceRoot, "index.ts"));
    const zodBuild = await bundleProductJavaScript({
        stdin: {
            contents: [
                'import * as z from "zod";',
                'export {z};',
                'export * from "zod";',
                'export default z;',
            ].join("\n"),
            resolveDir: resolve("."),
            sourcefile: "nbook-world-engine-zod-entry.mjs",
            loader: "js",
        },
        outfile: resolve(worldEngineRoot, "zod.mjs"),
        write: false,
    });
    await writeFile(
        resolve(worldEngineRoot, "zod.mjs"),
        productBundleOutputText(zodBuild, "World Engine Zod runtime"),
        "utf8",
    );
    const worldSchemaBuild = await bundleProductJavaScript({
        entryPoints: [resolve("world-engine", "schema", "index.ts")],
        outfile: resolve(worldEngineRoot, "schema", "index.mjs"),
        write: false,
        external: ["zod"],
    });
    await mkdir(resolve(worldEngineRoot, "schema"), {recursive: true});
    await writeFile(
        resolve(worldEngineRoot, "schema", "index.mjs"),
        await rewriteWorldEngineSchemaImports(
            productBundleOutputText(worldSchemaBuild, "World Engine schema helper"),
        ),
        "utf8",
    );
    const declarationDependencies = await emitAuthoringTypes(typeRoot);
    assertDeclaredTypeDependencies(declarationDependencies);
    await cp(resolve("proper-lockfile.d.ts"), resolve(typeRoot, "proper-lockfile.d.ts"));
    const dependencyProjection = await projectAuthoringDependencies({
        // Authoring tsconfig 显式启用 Node globals；即使 SDK 声明没有直接 import，也必须投影其真实类型闭包。
        seedSpecifiers: new Set([
            ...[...declarationDependencies].filter((specifier) => specifier !== "proper-lockfile"),
            "@types/node",
        ]),
        targetNodeModulesRoot: resolve(kitRoot, "node_modules"),
        registrations: AUTHORING_DEPENDENCIES,
        importerPath: resolve("profile-sdk", "index.ts"),
    });
    await writeFile(resolve(kitRoot, "tsconfig.json"), `${JSON.stringify({
        compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            jsxImportSource: "nbook/profile-sdk",
            strict: true,
            // Product 只保证批准依赖的公开声明可达；不为第三方 optional peer 伪造类型。
            skipLibCheck: true,
            baseUrl: ".",
            paths: {
                "nbook/profile-sdk": ["./types/profile-sdk/index.d.ts"],
                "nbook/profile-sdk/*": ["./types/profile-sdk/*"],
                "nbook/variable-sdk": ["./types/variable-sdk/index.d.ts"],
                "nbook/variable-sdk/*": ["./types/variable-sdk/*"],
                "nbook/*": ["./types/*"],
                "#cache/*": ["./types/packages/file-snapshot-cache/src/*"],
                "proper-lockfile": ["./types/proper-lockfile.d.ts"],
            },
            typeRoots: ["./node_modules/@types"],
            types: ["node"],
        },
        include: ["./types/**/*.d.ts", "./types/**/*.d.mts", "./sdk-source/**/*.ts"],
        exclude: ["./sdk-source/world-engine/schema/**/*.ts"],
    }, null, 4)}\n`, "utf8");
    await writeFile(resolve(kitRoot, "package.json"), `${JSON.stringify({
        name: "@notnotype/neuro-book-profile-authoring-kit",
        private: true,
        type: "module",
    }, null, 4)}\n`, "utf8");
    await writeFile(resolve(kitRoot, "authoring-dependencies.json"), `${JSON.stringify({
        schema: AUTHORING_DEPENDENCY_SCHEMA,
        dependencies: dependencyProjection.dependencies,
        instances: dependencyProjection.instances,
    }, null, 4)}\n`, "utf8");

    const typeInventory = await directoryInventory(typeRoot);
    const packageTypeInventory = await directoryInventory(resolve(kitRoot, "node_modules"));
    return {
        compilerBytes: (await stat(compilerPath)).size,
        sdkBytes: (await directoryInventory(nbookRoot)).bytes + (await directoryInventory(sdkSourceRoot)).bytes,
        typeBytes: typeInventory.bytes + packageTypeInventory.bytes,
        typeFiles: typeInventory.files + packageTypeInventory.files,
        dependencies: dependencyProjection.dependencies,
    };
}

/**
 * 将 SDK 投影之间的公开裸入口改成镜像内相对引用。
 *
 * Source 仍使用 `nbook/profile-sdk` 供作者和仓库 tsconfig 消费；Product Runtime Image
 * 内部不能依赖祖先目录的 package resolution。只登记实际存在的投影边，新增边必须显式审查。
 */
async function rewriteProjectedSdkImports(source: string, importer: string): Promise<string> {
    await init;
    const internalSpecifiers = new Map([
        ["nbook/profile-sdk", "./index.mjs"],
        ["nbook/profile-sdk/jsx-runtime", "./jsx-runtime.mjs"],
    ]);
    const [imports] = parse(source);
    const replacements: Array<{start: number; end: number; value: string}> = [];
    for (const item of imports) {
        if (!item.n) continue;
        const replacement = internalSpecifiers.get(item.n);
        if (replacement) {
            replacements.push({
                start: item.s,
                end: item.e,
                value: item.d >= 0 ? JSON.stringify(replacement) : replacement,
            });
            continue;
        }
        if (item.n === "nbook" || item.n.startsWith("nbook/")) {
            throw new Error(`Authoring SDK runtime 含未登记内部引用：${importer} -> ${item.n}`);
        }
    }
    let rewritten = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
    }
    return rewritten;
}

/** 把 helper 的唯一 zod external 边改成 Kit 内固定相对路径。 */
async function rewriteWorldEngineSchemaImports(source: string): Promise<string> {
    await init;
    const [imports] = parse(source);
    const replacements: Array<{start: number; end: number; value: string}> = [];
    for (const item of imports) {
        if (item.n === "zod") {
            replacements.push({start: item.s, end: item.e, value: "../zod.mjs"});
            continue;
        }
        if (item.n && !item.n.startsWith("node:")) {
            throw new Error(`World Engine schema helper 含未登记 runtime import：${item.n}`);
        }
    }
    let rewritten = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
    }
    return rewritten;
}

/**
 * 使用 TypeScript semantic gate 与声明 emitter 建立候选图，再从 SDK 公开入口精确投影可达声明。
 * `program.emit()` 会写出 Program 中所有源码；不能直接把那棵树当成 SDK 闭包。
 */
async function emitAuthoringTypes(typeRoot: string): Promise<Set<string>> {
    const root = resolve(".");
    const emittedRoot = resolve(dirname(typeRoot), ".types-emitted");
    await rm(emittedRoot, {recursive: true, force: true});
    await rm(typeRoot, {recursive: true, force: true});
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "nbook/profile-sdk",
        baseUrl: root,
        paths: {"nbook/*": ["./*"]},
        rootDir: root,
        outDir: emittedRoot,
        lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
        types: ["bun", "node"],
        skipLibCheck: true,
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
    };
    const roots = [
        resolve("profile-sdk", "index.ts"),
        resolve("profile-sdk", "contracts.ts"),
        resolve("profile-sdk", "constructors.ts"),
        resolve("profile-sdk", "writing.ts"),
        resolve("profile-sdk", "jsx-runtime.ts"),
        resolve("profile-sdk", "jsx-dev-runtime.ts"),
        resolve("variable-sdk", "index.ts"),
        resolve("variable-sdk", "contracts.ts"),
        resolve("server", "agent", "tools", "web-extraction-modules.d.ts"),
    ];
    try {
        const program = ts.createProgram({rootNames: roots, options});
        const diagnostics = ts.getPreEmitDiagnostics(program);
        if (diagnostics.length > 0) {
            throw new Error(ts.formatDiagnostics(diagnostics, {
                getCanonicalFileName: (fileName) => fileName,
                getCurrentDirectory: () => process.cwd(),
                getNewLine: () => "\n",
            }));
        }
        const emitted = program.emit();
        if (emitted.emitSkipped) throw new Error("Profile SDK declaration projection 没有完成。");
        return await copyReachableDeclarations(emittedRoot, typeRoot);
    } finally {
        await rm(emittedRoot, {recursive: true, force: true});
    }
}

/** 从声明入口沿静态 module specifier 复制闭包，并返回第三方类型依赖。 */
async function copyReachableDeclarations(emittedRoot: string, typeRoot: string): Promise<Set<string>> {
    const entryFiles = [
        resolve(emittedRoot, "profile-sdk", "index.d.ts"),
        resolve(emittedRoot, "profile-sdk", "writing.d.ts"),
        resolve(emittedRoot, "profile-sdk", "jsx-runtime.d.ts"),
        resolve(emittedRoot, "profile-sdk", "jsx-dev-runtime.d.ts"),
        resolve(emittedRoot, "variable-sdk", "index.d.ts"),
        resolve(emittedRoot, "variable-sdk", "contracts.d.ts"),
    ];
    const queue = [...entryFiles];
    const visited = new Set<string>();
    const dependencies = new Set<string>();
    while (queue.length > 0) {
        const sourcePath = queue.shift()!;
        if (visited.has(sourcePath)) continue;
        visited.add(sourcePath);
        const emittedRelativePath = relative(emittedRoot, sourcePath);
        if (emittedRelativePath.startsWith("..") || extname(emittedRelativePath) === "") {
            throw new Error(`Authoring declaration 越出 emitter 根：${sourcePath}`);
        }
        const source = await readFile(sourcePath, "utf8");
        assertAuthoringDeclarationSourcePaths(source, resolve("."), emittedRelativePath);
        const targetPath = resolve(typeRoot, emittedRelativePath);
        await mkdir(dirname(targetPath), {recursive: true});
        await cp(sourcePath, targetPath);

        for (const specifier of declarationModuleSpecifiers(sourcePath, source)) {
            const internalPath = resolveInternalDeclaration(emittedRoot, sourcePath, specifier);
            if (internalPath) {
                queue.push(internalPath);
                continue;
            }
            if (specifier.startsWith("nbook/") || specifier.startsWith(".") || specifier.startsWith("#cache/")) {
                throw new Error(`${emittedRelativePath} 引用了未投影声明：${specifier}`);
            }
            dependencies.add(specifier);
        }
    }
    return dependencies;
}

/** 验证 Authoring 声明只包含可移植类型内容，不携带 Source Root 下的文件路径。 */
export function assertAuthoringDeclarationSourcePaths(
    source: string,
    sourceRoot: string,
    emittedRelativePath: string,
): void {
    if (containsSourceRootDescendant(source, sourceRoot)) {
        throw new Error(`Authoring declaration 泄漏构建机绝对路径：${emittedRelativePath}`);
    }
}

/** 使用 TypeScript AST 收集 import、re-export 与静态 import type 的 module specifier。 */
function declarationModuleSpecifiers(filePath: string, source: string): Set<string> {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specifiers = new Set<string>();
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.add(node.moduleSpecifier.text);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            && ts.isStringLiteral(node.argument.literal)) {
            specifiers.add(node.argument.literal.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return specifiers;
}

/** 解析 emitter 内的 nbook、相对路径和 file-snapshot-cache 私有 alias。 */
function resolveInternalDeclaration(emittedRoot: string, importer: string, specifier: string): string | null {
    let basePath: string;
    if (specifier.startsWith("nbook/")) {
        basePath = resolve(emittedRoot, specifier.slice("nbook/".length));
    } else if (specifier.startsWith("#cache/")) {
        basePath = resolve(emittedRoot, "packages", "file-snapshot-cache", "src", specifier.slice("#cache/".length));
    } else if (specifier.startsWith(".")) {
        basePath = resolve(dirname(importer), specifier);
    } else {
        return null;
    }
    const sourceExtension = /\.(?:tsx?|mts|cts|mjs|cjs|js)$/u.exec(basePath)?.[0];
    const extensionlessPath = sourceExtension ? basePath.slice(0, -sourceExtension.length) : basePath;
    const candidates = [
        `${extensionlessPath}.d.ts`,
        `${extensionlessPath}.d.mts`,
        `${extensionlessPath}.d.cts`,
        resolve(basePath, "index.d.ts"),
        resolve(basePath, "index.d.mts"),
        resolve(basePath, "index.d.cts"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** 第三方声明只能来自显式登记的 Authoring type/runtime island。 */
function assertDeclaredTypeDependencies(specifiers: Set<string>): void {
    const allowedPackages = new Set(AUTHORING_DEPENDENCIES.map((dependency) => dependency.name));
    const unsupported = [...specifiers].filter((specifier) => {
        if (specifier.startsWith("node:")) return false;
        if (specifier === "proper-lockfile") return false;
        const segments = specifier.split("/");
        const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]!;
        return !allowedPackages.has(packageName);
    });
    if (unsupported.length > 0) {
        throw new Error(`Authoring declaration 含未登记第三方依赖：\n${unsupported.sort().map((name) => `- ${name}`).join("\n")}`);
    }
}

/** 统计 Authoring Kit 的声明树，供 owner inventory 和构建日志使用。 */
async function directoryInventory(root: string): Promise<{files: number; bytes: number}> {
    let files = 0;
    let bytes = 0;
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const filePath = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(filePath);
            else if (entry.isFile()) {
                files += 1;
                bytes += (await stat(filePath)).size;
            } else throw new Error(`Authoring Kit 含特殊文件：${filePath}`);
        }
    };
    await walk(root);
    return {files, bytes};
}

if (import.meta.main) {
    const outputRoot = resolve(process.env.NEURO_BOOK_OUTPUT_DIR ?? ".output");
    console.log(await buildProductAuthoringKit(outputRoot));
}
