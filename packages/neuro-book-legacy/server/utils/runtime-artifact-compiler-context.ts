import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {ProductRuntimeImageVerifier} from "nbook/server/interfaces/product-runtime-image-verifier";
import type {ProductRuntimeImageManifest} from "@notnotype/neuro-book-contracts/product-runtime";

export type RuntimeArtifactPathMapping = Readonly<{
    physicalRoot: string;
    logicalRoot: string;
}>;

export type RuntimeArtifactCompilerPaths = Readonly<{
    root: string;
    outputRoot: string;
    nbookRoot: string;
    /** 编译 Profile/Variable 时唯一允许的 package 解析根。 */
    compilerPackageRoot: string;
    /** 仅供 esbuild 解析批准 authoring 依赖的 node_modules。 */
    compilerNodeModulesRoot: string;
    /** 已生成 artifact 在 Product 运行时建立 require 的根。 */
    artifactRuntimeRequireRoot: string;
    tsconfigPath: string;
    /** 将编译输入物理根映射为 manifest 稳定逻辑路径。 */
    sourcePathMappings: readonly RuntimeArtifactPathMapping[];
}>;


/** Source Dev 的 authoring 身份；只能消费当前 checkout 的显式开发依赖。 */
export type SourceRuntimeArtifactAuthoringContext = RuntimeArtifactCompilerPaths & Readonly<{
    kind: "source";
    productRuntime: false;
}>;

/** 已完整验证的 Product authoring 身份。 */
export type ProductRuntimeArtifactAuthoringContext = RuntimeArtifactCompilerPaths & Readonly<{
    kind: "product";
    productRuntime: true;
    imageRoot: string;
    imageIdentity: Readonly<Pick<ProductRuntimeImageManifest,
        "imageId" | "version" | "revision" | "platform" | "sourceDigest" | "lockfileSha256">>;
}>;

/** 运行时作者能力只能来自 Source checkout 或 verified Product Image。 */
export type RuntimeArtifactAuthoringContext =
    | SourceRuntimeArtifactAuthoringContext
    | ProductRuntimeArtifactAuthoringContext;

/** Builder candidate 尚无 ready marker，只允许构建期生成内置 artifact。 */
export type ProductRuntimeArtifactCandidateContext = RuntimeArtifactCompilerPaths & Readonly<{
    kind: "product-candidate";
    productRuntime: true;
    imageRoot: string;
}>;

/** Source、verified Product 与 Product candidate 的统一编译上下文。 */
export type RuntimeArtifactCompilerContext = RuntimeArtifactAuthoringContext | ProductRuntimeArtifactCandidateContext;

/** Runtime artifact 的物理↔逻辑路径映射上下文。 */
export type RuntimeArtifactPathContext = Readonly<{
    compilerContext: RuntimeArtifactCompilerContext;
    mappings: readonly RuntimeArtifactPathMapping[];
}>;

const verifiedContexts = new Map<string, Promise<ProductRuntimeArtifactAuthoringContext>>();

export async function resolveRuntimeArtifactCompilerContext(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeArtifactCompilerContext> {
    const absoluteRoot = resolve(root);
    const explicitImageRoot = env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    const outputRoot = explicitImageRoot
        ? resolve(explicitImageRoot, "server")
        : resolve(absoluteRoot, ".output", "server");
    const outputEntry = resolve(outputRoot, "index.mjs");
    const outputPackage = resolve(outputRoot, "package.json");
    if (!explicitImageRoot) {
        return Object.freeze({
            kind: "source",
            root: absoluteRoot,
            productRuntime: false,
            outputRoot,
            nbookRoot: absoluteRoot,
            compilerPackageRoot: resolve(absoluteRoot, "package.json"),
            compilerNodeModulesRoot: resolve(absoluteRoot, "node_modules"),
            artifactRuntimeRequireRoot: resolve(absoluteRoot, "package.json"),
            tsconfigPath: resolve(absoluteRoot, "tsconfig.json"),
            sourcePathMappings: sourcePathMappingsFor(absoluteRoot),
        });
    }

    assertProductCompilerShape(explicitImageRoot, outputEntry, outputPackage);
    if (env.NEURO_BOOK_PRODUCT_BUILD === "1") {
        return Object.freeze({
            kind: "product-candidate",
            productRuntime: true,
            imageRoot: resolve(explicitImageRoot),
            ...productCompilerPaths(absoluteRoot, outputRoot, outputEntry),
        });
    }

    const imageRoot = resolve(explicitImageRoot);
    const contextKey = `${absoluteRoot}\0${imageRoot}`;
    let pending = verifiedContexts.get(contextKey);
    if (!pending) {
        pending = openVerifiedProductContext(absoluteRoot, imageRoot);
        verifiedContexts.set(contextKey, pending);
        void pending.catch(() => verifiedContexts.delete(contextKey));
    }
    return await pending;
}

/** 由 verified Product handle 构造唯一 Product authoring context。 */
async function openVerifiedProductContext(
    root: string,
    imageRoot: string,
): Promise<ProductRuntimeArtifactAuthoringContext> {
    const verified = await new ProductRuntimeImageVerifier().openSelfVerified(imageRoot).catch((error: unknown) => {
        throw new Error(`Product Runtime Authoring Context 必须来自 verified image identity：${imageRoot}`, {cause: error});
    });
    const outputRoot = resolve(verified.path, "server");
    const outputEntry = resolve(outputRoot, "index.mjs");
    const paths = productCompilerPaths(root, outputRoot, outputEntry);
    return Object.freeze({
        kind: "product",
        productRuntime: true,
        imageRoot: verified.path,
        imageIdentity: Object.freeze({
            imageId: verified.manifest.imageId,
            version: verified.manifest.version,
            revision: verified.manifest.revision,
            platform: verified.manifest.platform,
            sourceDigest: verified.manifest.sourceDigest,
            lockfileSha256: verified.manifest.lockfileSha256,
        }),
        ...paths,
    });
}

function productCompilerPaths(root: string, outputRoot: string, outputEntry: string): RuntimeArtifactCompilerPaths {
    const authoringRoot = resolve(outputRoot, "authoring");
    const tsconfigPath = resolve(authoringRoot, "tsconfig.json");
    const authoringPackagePath = resolve(authoringRoot, "package.json");
    const profileWorkerPath = resolve(authoringRoot, "profile-compile-worker.mjs");
    if (!existsSync(tsconfigPath) || !existsSync(authoringPackagePath) || !existsSync(profileWorkerPath)) {
        throw new Error(`Product runtime 缺少自包含 Authoring Kit：${authoringRoot}`);
    }
    return {
        root,
        outputRoot,
        nbookRoot: resolve(authoringRoot, "nbook"),
        compilerPackageRoot: authoringPackagePath,
        compilerNodeModulesRoot: resolve(authoringRoot, "node_modules"),
        artifactRuntimeRequireRoot: outputEntry,
        tsconfigPath,
        sourcePathMappings: Object.freeze([
            {physicalRoot: resolve(outputRoot), logicalRoot: ".output/server"},
        ]),
    };
}

/** candidate 与 verified Product 都先执行不涉及身份声明的最小形状检查。 */
function assertProductCompilerShape(imageRoot: string, outputEntry: string, outputPackage: string): void {
    if (!existsSync(outputEntry)) {
        throw new Error(`Product runtime 缺少 server/index.mjs：${imageRoot}`);
    }
    if (packageManifestName(outputPackage) !== "neuro-book-output") {
        throw new Error(`Product runtime 缺少有效 server/package.json：${imageRoot}`);
    }
}

/** Source checkout 保留空逻辑根，并显式覆盖应用包与 workspace hoisted node_modules。 */
function sourcePathMappingsFor(applicationRoot: string): readonly RuntimeArtifactPathMapping[] {
    const absoluteApplicationRoot = resolve(applicationRoot);
    const mappings: RuntimeArtifactPathMapping[] = [{physicalRoot: absoluteApplicationRoot, logicalRoot: ""}];
    const applicationNodeModules = join(absoluteApplicationRoot, "node_modules");
    if (existsSync(applicationNodeModules)) {
        mappings.push({physicalRoot: applicationNodeModules, logicalRoot: "node_modules"});
    }
    let current = dirname(absoluteApplicationRoot);
    while (true) {
        const nodeModulesRoot = join(current, "node_modules");
        if (existsSync(nodeModulesRoot)) {
            mappings.push({physicalRoot: nodeModulesRoot, logicalRoot: "node_modules"});
            mappings.push({physicalRoot: current, logicalRoot: ""});
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return Object.freeze(mappings);
}

/** 把显式编译上下文内的物理路径稳定写成 manifest 逻辑身份。 */
export function normalizeRuntimeArtifactPath(
    filePath: string,
    context: RuntimeArtifactCompilerContext | RuntimeArtifactPathContext,
): string {
    const absolutePath = resolve(filePath);
    const mappings = "compilerContext" in context
        ? context.mappings
        : context.sourcePathMappings;
    for (const mapping of [...mappings]
        .map((item) => ({...item, physicalRoot: resolve(item.physicalRoot)}))
        .sort((left, right) => right.physicalRoot.length - left.physicalRoot.length)) {
        const outputRelative = relative(mapping.physicalRoot, absolutePath);
        if (outputRelative === "" || (outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative))) {
            const logicalRoot = mapping.logicalRoot.replace(/[\\/]+/gu, "/").replace(/\/$/u, "");
            const suffix = outputRelative === "" ? "" : `/${outputRelative.split(/[\\/]+/u).join("/")}`;
            return `${logicalRoot}${suffix}`.replace(/^\//u, "") || ".";
        }
    }
    throw new Error(`Runtime artifact 路径未映射到稳定逻辑根：${absolutePath}`);
}
/** 将 manifest 逻辑依赖路径反解到当前编译上下文的物理根。 */
export function resolveRuntimeArtifactPath(
    filePath: string,
    context: RuntimeArtifactCompilerContext | RuntimeArtifactPathContext,
): string {
    if (isAbsolute(filePath) || /^[A-Za-z]:[\\/]/u.test(filePath)) {
        return resolve(filePath);
    }
    const logicalPath = filePath.replace(/[\\/]+/gu, "/").replace(/^\.\//u, "");
    const mappings = "compilerContext" in context
        ? context.mappings
        : context.sourcePathMappings;
    const candidates = [...mappings]
        .map((mapping) => ({
            ...mapping,
            physicalRoot: resolve(mapping.physicalRoot),
            logicalRoot: mapping.logicalRoot.replace(/[\\/]+/gu, "/").replace(/^\/+|\/+$/gu, ""),
        }))
        .filter((mapping) => mapping.logicalRoot === ""
            || logicalPath === mapping.logicalRoot
            || logicalPath.startsWith(`${mapping.logicalRoot}/`))
        .sort((left, right) => right.logicalRoot.length - left.logicalRoot.length);
    for (const mapping of candidates) {
        const suffix = mapping.logicalRoot === ""
            ? logicalPath
            : logicalPath.slice(mapping.logicalRoot.length).replace(/^\//u, "");
        const candidate = resolve(mapping.physicalRoot, ...suffix.split("/").filter(Boolean));
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error(`Runtime artifact 逻辑路径未映射：${filePath}`);
}

/** 从当前编译上下文解析 `nbook/*` 包级源码。 */
export function resolveRuntimeArtifactNbookPath(
    context: RuntimeArtifactCompilerContext,
    relativePath: string,
): string {
    const basePath = resolve(context.nbookRoot, relativePath);
    const candidates = [
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
        join(basePath, "index.mjs"),
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        basePath,
    ];
    const resolvedPath = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedPath) {
        const source = context.productRuntime ? "Product Profile Authoring Kit" : "Source checkout";
        throw new Error(`${source} 无法解析 nbook 包级 import：${relativePath}`);
    }
    return resolvedPath;
}

/** 从 Authoring Kit 或 Source checkout 解析 World Engine 允许的 runtime package。 */
export function resolveRuntimeArtifactPackagePath(
    context: RuntimeArtifactCompilerContext,
    specifier: string,
): string {
    if (specifier !== "zod") {
        throw new Error(`Runtime Artifact Authoring 未登记 package：${specifier}`);
    }
    if (context.kind !== "source") {
        return resolveRuntimeArtifactNbookPath(context, "world-engine/zod");
    }
    const requireFromCompiler = createRequire(pathToFileURL(context.compilerPackageRoot));
    try {
        return requireFromCompiler.resolve(specifier);
    } catch (error) {
        throw new Error(`Source Runtime Artifact Authoring 无法解析 package：${specifier}`, {cause: error});
    }
}

/** 读取 package name；损坏或缺失时返回 null。 */
function packageManifestName(path: string): string | null {
    try {
        const manifest = JSON.parse(readFileSync(path, "utf8")) as {name?: string};
        return typeof manifest.name === "string" ? manifest.name : null;
    } catch {
        return null;
    }
}
