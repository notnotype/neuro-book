import {existsSync, readFileSync, realpathSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";

/** Product 中必须保留真实 package 形状的一组运行依赖。 */
export type ProductRuntimeIslandDefinition = {
    packages: string[];
    reason: string;
    smoke: string;
};

/** 最终 bundle 中无法由 ESM lexer 还原字面量的动态 import 登记。 */
export type ProductOpaqueImportDefinition = {
    pathPattern: string;
    count: number;
    reason: string;
    smoke: string;
};

/** esbuild 多入口命令图中稳定的 shared chunk 名称前缀。 */
export const PRODUCT_COMMAND_CHUNK_BASENAME = "command-shared";

type PackageManifest = {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
};

type ResolvedPackage = {
    name: string;
    version: string;
    packageJsonPath: string;
};

type ProductRuntimeIslandGraph = {
    definitions: ProductRuntimeIslandDefinition[];
    packages: Map<string, ResolvedPackage>;
};

const cachedRuntimeGraphs = new Map<string, ProductRuntimeIslandGraph>();

/**
 * 返回当前平台完整的 package island 登记。
 *
 * jsdom/undici 会读取 package 相对文件，TypeScript 会读取 `lib/*.d.ts`；它们
 * 不能安全冻结进单文件 bundle。其余纯 JS Provider SDK 仍由 Bun 收入 bundle。
 */
export function productRuntimeIslandDefinitions(sourceRoot = resolve(".")): ProductRuntimeIslandDefinition[] {
    return runtimeIslandGraph(sourceRoot).definitions.map((definition) => ({
        ...definition,
        packages: [...definition.packages],
    }));
}

/** 根据已解析的 jsdom 闭包建立当前平台的 package island 合同。 */
function createRuntimeIslandDefinitions(dynamicPackages: string[]): ProductRuntimeIslandDefinition[] {
    const definitions: ProductRuntimeIslandDefinition[] = [
        {
            packages: dynamicPackages,
            reason: "jsdom/undici 与 TypeScript 在运行时读取 package 相对文件，必须保留真实 package 形状。",
            smoke: "Profile compiler compile/import and Product HTTP startup",
        },
        {
            packages: ["esbuild"],
            reason: "Profile compiler 在运行时调用 esbuild，并由 package 解析平台 binary。",
            smoke: "import esbuild and transform TypeScript",
        },
        {
            packages: ["libsql", "@neon-rs/load", "detect-libc"],
            reason: "libsql 动态加载当前平台的 native binding。",
            smoke: "import libsql and open SQLite",
        },
        {
            packages: ["sqlite-vec"],
            reason: "sqlite-vec 按平台解析 extension 动态库的真实路径。",
            smoke: "resolve sqlite-vec extension path and load it",
        },
        {
            packages: ["sharp", "@img/colour", "semver"],
            reason: "Sharp 通过 package 形状定位当前平台 addon 与 libvips。",
            smoke: "run the compiled Image Variant command through generation and a fresh-instance cache hit",
        },
    ];
    if (process.platform === "win32" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/win32-x64");
        definitions[2]!.packages.push("@libsql/win32-x64-msvc");
        definitions[3]!.packages.push("sqlite-vec-windows-x64");
        definitions[4]!.packages.push("@img/sharp-win32-x64");
        return definitions;
    }
    if (process.platform === "linux" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/linux-x64");
        definitions[2]!.packages.push("@libsql/linux-x64-gnu");
        definitions[3]!.packages.push("sqlite-vec-linux-x64");
        definitions[4]!.packages.push("@img/sharp-linux-x64", "@img/sharp-libvips-linux-x64");
        return definitions;
    }
    if (process.platform === "linux" && process.arch === "arm64") {
        definitions[1]!.packages.push("@esbuild/linux-arm64");
        definitions[2]!.packages.push("@libsql/linux-arm64-gnu");
        definitions[3]!.packages.push("sqlite-vec-linux-arm64");
        definitions[4]!.packages.push("@img/sharp-linux-arm64", "@img/sharp-libvips-linux-arm64");
        return definitions;
    }
    if (process.platform === "darwin" && process.arch === "x64") {
        definitions[1]!.packages.push("@esbuild/darwin-x64");
        definitions[2]!.packages.push("@libsql/darwin-x64");
        definitions[3]!.packages.push("sqlite-vec-darwin-x64");
        definitions[4]!.packages.push("@img/sharp-darwin-x64", "@img/sharp-libvips-darwin-x64");
        return definitions;
    }
    if (process.platform === "darwin" && process.arch === "arm64") {
        definitions[1]!.packages.push("@esbuild/darwin-arm64");
        definitions[2]!.packages.push("@libsql/darwin-arm64");
        definitions[3]!.packages.push("sqlite-vec-darwin-arm64");
        definitions[4]!.packages.push("@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64");
        return definitions;
    }
    throw new Error(`Product Runtime 尚未登记 package islands：${process.platform}-${process.arch}`);
}

/** 返回供 Bun external 与最终复制共同消费的稳定 package 集合。 */
export function productRuntimeIslandPackageNames(sourceRoot = resolve(".")): string[] {
    return [...runtimeIslandGraph(sourceRoot).packages.keys()].sort();
}

/**
 * 判断 Rollup module id 是否属于 Product package island。
 * 支持 bare specifier，以及 npm、Bun、pnpm 物理路径中的最后一个 `node_modules` 边界。
 */
export function isProductRuntimeIslandModule(id: string): boolean {
    if (!id || id.startsWith("\0")) return false;
    const normalized = id.replaceAll("\\", "/");
    const packagePathWithSuffix = normalized.split("/node_modules/").at(-1) ?? normalized;
    const suffixIndex = [packagePathWithSuffix.indexOf("?"), packagePathWithSuffix.indexOf("#")]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0];
    const packagePath = suffixIndex === undefined
        ? packagePathWithSuffix
        : packagePathWithSuffix.slice(0, suffixIndex);
    return productRuntimeIslandPackageNames().some((packageName) => (
        packagePath === packageName || packagePath.startsWith(`${packageName}/`)
    ));
}

/**
 * 返回最终 Product 允许保留的 opaque dynamic import 精确集合。
 *
 * shared chunk 的 content hash 会随 Source 改变，因此命令图使用 Builder 固定的
 * 受限文件名前缀；数量仍必须完全一致，任何新增、消失或移动都要求重新审查本合同。
 */
export function productOpaqueImportDefinitions(): ProductOpaqueImportDefinition[] {
    return [
        {
            pathPattern: "index.mjs",
            count: 3,
            reason: "Nitro server bundle 保留运行时选择的 Profile、SQLite 与 Provider module loader。",
            smoke: "Product HTTP startup and authenticated shutdown; TypeScript and jsdom use Profile/Variable and web-fetch checks",
        },
        {
            pathPattern: "authoring/profile-compile-worker.mjs",
            count: 2,
            reason: "Profile Authoring Worker 按批准依赖和已编译 artifact 地址执行动态加载。",
            smoke: "Profile compiler compile/import with typebox",
        },
        {
            pathPattern: `commands/chunks/${PRODUCT_COMMAND_CHUNK_BASENAME}-*.mjs`,
            count: 3,
            reason: "Product command 的共享依赖按当前 Runtime 与平台选择 module implementation。",
            smoke: "Product command start and database/application-state migrations",
        },
    ];
}

/**
 * 返回依赖图中已登记 package island 的真实目录，并核对 manifest 身份。
 * 该目录可以位于 Bun/pnpm 的嵌套 store，不要求 package 被 hoist 到根 node_modules。
 */
export function productRuntimeIslandSourceRoot(packageName: string, sourceRoot = resolve(".")): string {
    const resolvedPackage = runtimeIslandGraph(sourceRoot).packages.get(packageName);
    if (!resolvedPackage) {
        throw new Error(`Product package island 未登记 Source：${packageName}`);
    }
    return dirname(resolvedPackage.packageJsonPath);
}

/**
 * 按 Source Root 解析 Product package island 依赖图。
 *
 * 传递依赖从声明它的 package 实例解析，不假定它被 hoist 到根 node_modules。
 * 最终 Product 会把这些实例扁平复制，因此同名不同版本仍然直接失败。
 */
function runtimeIslandGraph(sourceRoot: string): ProductRuntimeIslandGraph {
    const canonicalSourceRoot = realpathSync.native(resolve(sourceRoot));
    const cacheKey = process.platform === "win32"
        ? canonicalSourceRoot.toLowerCase()
        : canonicalSourceRoot;
    const cached = cachedRuntimeGraphs.get(cacheKey);
    if (cached) return cached;

    const sourceNodeModulesRoot = realpathSync.native(resolve(canonicalSourceRoot, "node_modules"));
    const packages = new Map<string, ResolvedPackage>();
    const visited = new Set<string>();
    const queue = [resolveRootPackageManifest(canonicalSourceRoot, "jsdom")];
    while (queue.length > 0) {
        const packageJsonPath = realpathSync.native(queue.shift()!);
        assertPackageInsideSource(sourceNodeModulesRoot, packageJsonPath);
        const identityPath = process.platform === "win32" ? packageJsonPath.toLowerCase() : packageJsonPath;
        if (visited.has(identityPath)) continue;
        visited.add(identityPath);
        const resolvedPackage = registerResolvedPackage(packages, packageJsonPath);
        const manifest = readPackageManifest(packageJsonPath);
        for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
            queue.push(resolveDependencyManifest(resolvedPackage, dependency));
        }
    }

    const dynamicPackages = ["typescript", ...packages.keys()].sort();
    const definitions = createRuntimeIslandDefinitions(dynamicPackages);
    const registeredNames = new Set(definitions.flatMap((definition) => definition.packages));

    const typescriptManifest = realpathSync.native(resolveRootPackageManifest(canonicalSourceRoot, "typescript"));
    assertPackageInsideSource(sourceNodeModulesRoot, typescriptManifest);
    registerResolvedPackage(packages, typescriptManifest);

    for (const definition of definitions.slice(1)) {
        const ownerName = definition.packages[0]!;
        const ownerManifest = realpathSync.native(resolveRootPackageManifest(canonicalSourceRoot, ownerName));
        assertPackageInsideSource(sourceNodeModulesRoot, ownerManifest);
        const owner = registerResolvedPackage(packages, ownerManifest);
        for (const packageName of definition.packages.slice(1)) {
            const packageJsonPath = realpathSync.native(resolveDependencyManifest(owner, packageName));
            assertPackageInsideSource(sourceNodeModulesRoot, packageJsonPath);
            registerResolvedPackage(packages, packageJsonPath);
        }
    }

    const missingPackages = [...registeredNames].filter((packageName) => !packages.has(packageName)).sort();
    if (missingPackages.length > 0) {
        throw new Error(`Product package island 缺少 Source package：${missingPackages.join(", ")}`);
    }

    const graph = {definitions, packages};
    cachedRuntimeGraphs.set(cacheKey, graph);
    return graph;
}

/** 从 Source 根的直接依赖槽读取 package manifest。 */
function resolveRootPackageManifest(sourceRoot: string, packageName: string): string {
    const packageJsonPath = resolve(sourceRoot, "node_modules", ...packageName.split("/"), "package.json");
    const manifestPath = packageManifestAt(packageJsonPath, packageName);
    if (manifestPath) return manifestPath;
    throw new Error(`Product package island 无法解析根依赖：${packageName}`);
}

/**
 * 从声明依赖的 package 实例解析目标 manifest。
 *
 * 先按标准 nested node_modules 查找，再检查 Bun/pnpm store 的同级依赖槽；最后才
 * 交给 Node resolver 处理其他标准布局。调用方仍会拒绝 Source Root 外的结果。
 */
function resolveDependencyManifest(owner: ResolvedPackage, packageName: string): string {
    const ownerRoot = dirname(owner.packageJsonPath);
    const packageParts = packageName.split("/");
    const candidates = [
        resolve(ownerRoot, "node_modules", ...packageParts, "package.json"),
        resolve(ownerNodeModulesRoot(owner), ...packageParts, "package.json"),
    ];
    for (const candidate of candidates) {
        const packageJsonPath = packageManifestAt(candidate, packageName);
        if (packageJsonPath) return packageJsonPath;
    }
    const requireFromOwner = createRequire(pathToFileURL(owner.packageJsonPath));
    return resolvePackageManifest(requireFromOwner, packageName);
}

/** 定位当前 package 实例所在的 node_modules 层。 */
function ownerNodeModulesRoot(owner: ResolvedPackage): string {
    let directory = dirname(owner.packageJsonPath);
    for (const _part of owner.name.split("/")) directory = dirname(directory);
    return directory;
}

/** 读取一个确定 package 槽；槽存在但身份不符时直接拒绝。 */
function packageManifestAt(packageJsonPath: string, packageName: string): string | undefined {
    if (!existsSync(packageJsonPath)) return undefined;
    const manifest = readPackageManifest(packageJsonPath);
    if (manifest.name !== packageName) {
        throw new Error(`Product package island Source 身份无效：${packageName} (${packageJsonPath})`);
    }
    return packageJsonPath;
}

/** 登记一个实际 package 实例，并拒绝扁平复制会冲突的同名多版本。 */
function registerResolvedPackage(
    packages: Map<string, ResolvedPackage>,
    packageJsonPath: string,
): ResolvedPackage {
    const manifest = readPackageManifest(packageJsonPath);
    const name = manifest.name;
    const version = manifest.version;
    if (!name || !version) {
        throw new Error(`Product package island package 缺少 name/version：${packageJsonPath}`);
    }
    const resolvedPackage = {name, version, packageJsonPath};
    const existing = packages.get(name);
    if (existing && existing.version !== version) {
        throw new Error(`Product package island 无法扁平化 ${name}：${existing.version} != ${version}`);
    }
    if (!existing) packages.set(name, resolvedPackage);
    return resolvedPackage;
}

/** 所有 package 实例都必须真实位于当前 Source Root 的 node_modules 内。 */
function assertPackageInsideSource(sourceNodeModulesRoot: string, packageJsonPath: string): void {
    const child = relative(sourceNodeModulesRoot, packageJsonPath);
    if (child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)) return;
    throw new Error(`Product package island 逃逸 Source Root：${packageJsonPath}`);
}

/** 从 package.json 读取构建期受信 manifest。 */
function readPackageManifest(packageJsonPath: string): PackageManifest {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageManifest;
}

/**
 * 解析 package manifest；当 package exports 隐藏 `package.json` 时，从真实入口向上定位。
 * 只有 name 精确匹配的 manifest 才能充当依赖身份，不能误取祖先 package。
 */
function resolvePackageManifest(requireFrom: NodeRequire, packageName: string): string {
    try {
        return requireFrom.resolve(`${packageName}/package.json`);
    } catch (packageJsonError) {
        let entryPath: string;
        try {
            entryPath = requireFrom.resolve(packageName);
        } catch (entryError) {
            throw new Error(`Product package island 无法解析依赖：${packageName}`, {cause: entryError});
        }
        let directory = dirname(entryPath);
        while (true) {
            const packageJsonPath = resolve(directory, "package.json");
            try {
                if (readPackageManifest(packageJsonPath).name === packageName) return packageJsonPath;
            } catch {
                // 继续向上寻找当前入口所属 package；缺失或损坏的祖先不能成为身份。
            }
            const parent = dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
        throw new Error(`Product package island 无法定位 manifest：${packageName}`, {cause: packageJsonError});
    }
}
