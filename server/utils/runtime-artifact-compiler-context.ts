import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {isAbsolute, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {
    ProductRuntimeImageVerifier,
    type ProductRuntimeImageManifest,
} from "nbook/shared/product-runtime-image-verifier";

type RuntimeArtifactCompilerPaths = Readonly<{
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

/** Runtime artifact 编译器共用上下文；candidate 分支不对运行期调用方公开为 Authoring Context。 */
export type RuntimeArtifactCompilerContext = RuntimeArtifactAuthoringContext | ProductRuntimeArtifactCandidateContext;

const verifiedContexts = new Map<string, Promise<ProductRuntimeArtifactAuthoringContext>>();

/**
 * 解析 Profile、Variable 等 Runtime artifact 的编译上下文。
 *
 * Source 开发直接使用 checkout；Product 必须完全绑定 `.output/server`，禁止
 * freshness manifest 记录最终安装包中不存在的根 `node_modules` 或生成源码。
 */
export async function resolveRuntimeArtifactCompilerContext(
    root = process.cwd(),
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

/** Product Authoring Kit 的物理路径只从指定 image root 派生。 */
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

/** 把 staging image 内的物理依赖路径稳定写成激活后的 `.output/server/**` 身份。 */
export function normalizeRuntimeArtifactPath(
    filePath: string,
    context?: RuntimeArtifactCompilerContext,
): string {
    const absolutePath = resolve(filePath);
    const explicitImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    const outputRoot = context?.outputRoot ?? (explicitImageRoot ? resolve(explicitImageRoot, "server") : null);
    if (outputRoot) {
        const outputRelative = relative(outputRoot, absolutePath);
        if (outputRelative === "" || outputRelative === ".") return ".output/server";
        if (!outputRelative.startsWith("..") && !isAbsolute(outputRelative)) {
            return `.output/server/${outputRelative.split(/[\\/]+/u).join("/")}`;
        }
    }
    const cwdRelative = relative(process.cwd(), absolutePath);
    if (cwdRelative && !cwdRelative.startsWith("..") && !isAbsolute(cwdRelative)) {
        return cwdRelative.split(/[\\/]+/u).join("/");
    }
    return absolutePath.split(/[\\/]+/u).join("/");
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
