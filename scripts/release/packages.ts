#!/usr/bin/env bun
/**
 * 发布到 npm 的工作区包清单，与发布前对它们的检查（ADR 0029）。`bun run release:check` 运行检查；
 * `pack-smoke.ts` 与 `publish.ts` 用这里的清单与依赖顺序。
 *
 * 检查只读文件，不打包、不联网。源码导入的检查只看会发布的文件（按 `files` 白名单），因为装到用户机器上时
 * 只有它们会被执行或被宿主编译；仓库根 `node_modules` 的提升会掩盖漏写的依赖，所以不能靠“在仓库里能跑”。
 */

import {builtinModules} from "node:module";
import {readFileSync} from "node:fs";
import {join, relative} from "node:path";

/**
 * 以源码发布的包（`packages/` 下的目录名，ADR 0029）。加包时同步根 README 两份的包表，并在 `docs/` 与 `.agents/works/`
 * 里搜现有的包数（例如“9 个”“11 个包”）一并改。
 */
export const RELEASE_PACKAGES = [
    "nb-profile",
    "nb-session",
    "nb-flock",
    "nb-runtime",
    "nb-ui",
    "nb-harness",
    "nb-form",
    "nb-markdown",
    "nb-agent-ui",
    "nb-story",
] as const;

/** 先生成、再从生成的目录发布的包。 */
export type BuiltPackage = {
    readonly name: string;
    /** 生成它的源码包（`packages/` 下的目录名）。 */
    readonly source: string;
    readonly script: string;
    readonly outDir: string;
    readonly repositoryDirectory: string;
    /**
     * `"product"`：版本就是产品版本（应用与 SDK，ADR 0033）。`"own"`：版本独立、手工提，写在源码包的 `package.json`，
     * 提了版本号就是这次发（与源码包一样）；源码包还是 `private` 时只冒烟、不发（首发由开发者决定）。
     */
    readonly version: "product" | "own";
    /** 发布清单检查要求的许可。不是 `RELEASE_LICENSE` 的包，`LICENSE` 不与仓库根比，只要求是那种许可的全文。 */
    readonly license: typeof RELEASE_LICENSE | "MIT";
    /** 要不要写 `engines.bun`：给浏览器的库（nb-layout）不要求。 */
    readonly bun: boolean;
};

/**
 * 先生成、再从生成的目录发布的包：应用包与插件 SDK 由新应用的脚本生成，版本是产品版本（ADR 0033）；nb-layout 发编译产物，
 * 版本独立、许可 MIT（ADR 0054 第 5、6 条）。`release:smoke` 运行生成命令并打 tarball，`release:publish` 发布那些 tarball。
 * 加包时同步根 README 两份的包表。
 */
export const BUILT_PACKAGES: readonly BuiltPackage[] = [
    // SDK 在应用之前：应用包的 README 让用户用 SDK 写插件，先发它，应用发出去时 SDK 已经装得到。
    {name: "@notnotype/nb-plugin-sdk", source: "neuro-book", script: "build:sdk", outDir: "dist/plugin-sdk", repositoryDirectory: "packages/neuro-book/plugin-sdk", version: "product", license: "AGPL-3.0-only", bun: true},
    {name: "@notnotype/neuro-book", source: "neuro-book", script: "build:app-package", outDir: "dist/app-package", repositoryDirectory: "packages/neuro-book", version: "product", license: "AGPL-3.0-only", bun: true},
    {name: "@notnotype/nb-layout", source: "nb-layout", script: "build:package", outDir: "dist/package", repositoryDirectory: "packages/nb-layout", version: "own", license: "MIT", bun: false},
];

/** 版本就是产品版本的生成包（应用与 SDK）：发布计划里它们不会是历史包。 */
export const PRODUCT_PACKAGES: readonly string[] = BUILT_PACKAGES.filter((entry) => entry.version === "product").map((entry) => entry.name);

/** 版本手工提的包所在的目录：源码包与版本独立的生成包。发版准备与 Release 说明按它们看这次提了版本没有。 */
export const VERSIONED_DIRECTORIES: readonly string[] = [...RELEASE_PACKAGES, ...BUILT_PACKAGES.filter((entry) => entry.version === "own").map((entry) => entry.source)];

type VersionedManifest = {readonly version: string; readonly private?: boolean};

/**
 * 一个版本手工提的包在这次发版里怎么看（`prepare.ts`、`release-notes.ts` 共用）：现在还是 `private` 的（nb-layout 首发之前）
 * 这次不发，返回 null，不定稿它的记录、不列进说明；上一个标签下是 `private` 的，那时没有发，`previousVersion` 按新包给 null，
 * 首发要有它的版本段。
 */
export function versionedPackage(current: VersionedManifest, previous: VersionedManifest | null): {version: string; previousVersion: string | null} | null {
    if (current.private === true) return null;
    return {version: current.version, previousVersion: previous === null || previous.private === true ? null : previous.version};
}

export const APP_PACKAGE = "@notnotype/neuro-book";
export const SDK_PACKAGE = "@notnotype/nb-plugin-sdk";

/** 会进发布包的目录（相对仓库根）：根 LICENSE、源码包目录、生成包的源码目录。冒烟与发布都要求它们没有未提交的改动。 */
export function releaseDirectories(dirs: readonly string[] = RELEASE_PACKAGES): string[] {
    return ["LICENSE", ...new Set([...dirs, ...BUILT_PACKAGES.map((entry) => entry.source)].map((dir) => join("packages", dir)))];
}

export const RELEASE_LICENSE = "AGPL-3.0-only" as const;
const REPOSITORY_URL = "git+https://github.com/notnotype/neuro-book.git";
const SCOPE = "@notnotype/";

type DependencyMap = Readonly<Record<string, string>>;

export type PackageManifest = {
    name: string;
    version: string;
    private?: boolean;
    license?: string;
    files?: string[];
    engines?: Record<string, string>;
    publishConfig?: {access?: string};
    repository?: {type?: string; url?: string; directory?: string};
    dependencies?: DependencyMap;
    devDependencies?: DependencyMap;
    peerDependencies?: DependencyMap;
    optionalDependencies?: DependencyMap;
};

export type ReleasePackage = {
    /** `packages/` 下的目录名；生成的包是生成它的源码包。 */
    dir: string;
    /** 包目录的绝对路径；生成的包是生成的目录。 */
    path: string;
    /** `repository.directory` 应写的值。 */
    repositoryDirectory: string;
    manifest: PackageManifest;
    /** 要求的许可：源码包都是 `RELEASE_LICENSE`，生成包按 `BuiltPackage.license`。 */
    license: BuiltPackage["license"];
    /** 要不要写 `engines.bun`。 */
    bun: boolean;
    /** 版本独立、源码包还是 `private` 的生成包（首发之前）：照样检查、打包、冒烟，但不算发布的包、不进发布清单。 */
    held: boolean;
};

export type Finding = {
    package: string;
    code:
        | "private"
        | "license"
        | "license_file"
        | "readme"
        | "files"
        | "engines"
        | "publish_config"
        | "repository"
        | "internal_dependency"
        | "lockfile_version"
        | "undeclared_import"
        | "dependency_cycle";
    message: string;
};

export function loadReleasePackages(root: string, dirs: readonly string[] = RELEASE_PACKAGES): ReleasePackage[] {
    return dirs.map((dir) => {
        const path = join(root, "packages", dir);
        return {dir, path, repositoryDirectory: `packages/${dir}`, manifest: JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as PackageManifest, license: RELEASE_LICENSE, bun: true, held: false};
    });
}

/** 生成的包：读生成目录里的清单。还没生成时失败，提示先跑生成命令（`release:smoke` 会跑）。 */
export function loadBuiltPackages(root: string, built: readonly BuiltPackage[] = BUILT_PACKAGES): ReleasePackage[] {
    return built.map((entry) => {
        const path = join(root, "packages", entry.source, entry.outDir);
        let manifest: PackageManifest;
        try {
            manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as PackageManifest;
        } catch (error) {
            throw new Error(`${entry.name} 还没有生成（${relative(root, path)}）：先在 packages/${entry.source} 里 bun run ${entry.script}`, {cause: error});
        }
        if (manifest.name !== entry.name) throw new Error(`${relative(root, path)} 里的是 ${manifest.name ?? "没有名字的包"}，不是 ${entry.name}`);
        return {dir: entry.source, path, repositoryDirectory: entry.repositoryDirectory, manifest, license: entry.license, bun: entry.bun, held: entry.version === "own" && manifest.private === true};
    });
}

/**
 * 按依赖排序：被依赖的在前，同一层按清单顺序。只看 dependencies 与 peerDependencies：devDependencies 不进用户的
 * 安装，发布先后对它们无关紧要。有环时抛错（环里的包无论先发哪个，另一个都要引用还不存在的版本）。
 */
export function publishOrder(packages: readonly ReleasePackage[]): ReleasePackage[] {
    const byName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
    const ordered: ReleasePackage[] = [];
    const placed = new Set<string>();
    const visiting = new Set<string>();
    const visit = (entry: ReleasePackage, path: readonly string[]) => {
        const name = entry.manifest.name;
        if (placed.has(name)) return;
        if (visiting.has(name)) throw new Error(`发布清单里有依赖环：${[...path, name].join(" → ")}`);
        visiting.add(name);
        for (const dependency of runtimeDependencyNames(entry.manifest)) {
            const target = byName.get(dependency);
            if (target) visit(target, [...path, name]);
        }
        visiting.delete(name);
        placed.add(name);
        ordered.push(entry);
    };
    for (const entry of packages) visit(entry, []);
    return ordered;
}

function runtimeDependencyNames(manifest: PackageManifest): string[] {
    return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
}

/**
 * 版本独立的生成包里已经首发的（源码包的清单没有 `private`）的名字。只查源码包时（`release:check` 不生成任何东西）它们的生成
 * 目录可能还没有，名字与首发与否从源码包的清单取；源码目录不在（测试用的夹具根）就当没有。
 */
export function releasedBuiltNames(root: string, built: readonly BuiltPackage[] = BUILT_PACKAGES): Set<string> {
    const names = new Set<string>();
    for (const entry of built) {
        if (entry.version !== "own") continue;
        const source = readOptional(join(root, "packages", entry.source, "package.json"));
        if (source && (JSON.parse(source.toString("utf8")) as PackageManifest).private !== true) names.add(entry.name);
    }
    return names;
}

/**
 * `alsoReleased`：不在 `packages` 里、但同样发到 registry 的包名：源码包的发布依赖可以指向它们，同样要写 `workspace:^`。
 * 缺省取已首发的生成包（`releasedBuiltNames`）：`release:check` 与 `release:publish` 的闸门只载源码包，`release:smoke` 把生成包
 * 一起载进 `packages`，三处得到同一个结论，不靠调用方各自记得传。
 */
export function checkReleasePackages(root: string, packages: readonly ReleasePackage[], alsoReleased: ReadonlySet<string> = releasedBuiltNames(root)): Finding[] {
    const findings: Finding[] = [];
    const rootLicense = readFileSync(join(root, "LICENSE"));
    // 首发之前的生成包不算发布的包：别的包的发布依赖不能指向它（它还不在 registry 上）。
    const releaseNames = new Set([...packages.filter((entry) => !entry.held).map((entry) => entry.manifest.name), ...alsoReleased]);
    for (const entry of packages) {
        const report = (code: Finding["code"], message: string) => findings.push({package: entry.manifest.name, code, message});
        const {manifest} = entry;
        if (manifest.private !== undefined && !entry.held) report("private", "去掉 private：发布的包不能是私有的");
        if (manifest.license !== entry.license) report("license", `license 要写 ${entry.license}，现在是 ${manifest.license ?? "空"}`);
        const license = readOptional(join(entry.path, "LICENSE"));
        if (!license) report("license_file", "包目录里没有 LICENSE");
        else if (entry.license === RELEASE_LICENSE && !license.equals(rootLicense)) report("license_file", "LICENSE 与仓库根的不同");
        else if (entry.license === "MIT" && !license.toString("utf8").startsWith("MIT License")) report("license_file", "LICENSE is not the MIT license text");
        if (!readOptional(join(entry.path, "README.md"))) report("readme", "包目录里没有 README.md（npm 的包页面显示它）");
        if (!manifest.files?.length) report("files", "缺少 files 白名单");
        else if (!manifest.files.includes("LICENSE") || !manifest.files.includes("README.md")) report("files", "files 要包括 LICENSE 与 README.md");
        if (entry.bun && !manifest.engines?.bun) report("engines", "engines 要写 bun 的最低版本");
        if (manifest.publishConfig?.access !== "public") report("publish_config", "publishConfig.access 要写 public（scope 包缺省是私有）");
        const directory = entry.repositoryDirectory;
        if (manifest.repository?.url !== REPOSITORY_URL || manifest.repository.directory !== directory) {
            report("repository", `repository 要写 {type: "git", url: "${REPOSITORY_URL}", directory: "${directory}"}`);
        }
        for (const [field, map] of dependencyFields(manifest)) {
            for (const [name, spec] of Object.entries(map)) {
                if (!name.startsWith(SCOPE)) continue;
                const released = releaseNames.has(name);
                // devDependencies 可以引用不发布的工作区包（例如测试支持包），发布后它们不会被安装。
                if (!released && field !== "devDependencies") report("internal_dependency", `${field} 里的 ${name} 不在发布清单里`);
                if (released && spec !== "workspace:^") report("internal_dependency", `${field} 里的 ${name} 要写 workspace:^，现在是 ${spec}`);
            }
        }
        for (const finding of undeclaredImports(entry)) report("undeclared_import", finding);
    }
    findings.push(...staleLockfileVersions(root, packages));
    try {
        publishOrder(packages);
    } catch (error) {
        findings.push({package: "*", code: "dependency_cycle", message: (error as Error).message});
    }
    return findings;
}

/**
 * `bun publish` 把 `workspace:^` 改写成 `^<版本>` 时用的是 `bun.lock` 里记的工作区版本，不是 `package.json` 的：改了版本号
 * 没跑 `bun install` 刷新锁文件，发出去的依赖范围就是旧的（nb-story 0.2.0 发出去依赖 `nb-runtime ^0.1.0`，冒烟用 file: 的
 * tarball 覆盖了依赖，查不出来）。没有锁文件（测试的临时仓库）时不查。
 */
function staleLockfileVersions(root: string, packages: readonly ReleasePackage[]): Finding[] {
    const lock = readOptional(join(root, "bun.lock"))?.toString("utf8");
    if (lock === undefined) return [];
    const findings: Finding[] = [];
    for (const entry of packages) {
        const match = new RegExp(`"${entry.repositoryDirectory.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")}": \\{\\s*"name": "[^"]+",\\s*"version": "([^"]+)"`, "u").exec(lock);
        const recorded = match?.[1];
        if (recorded !== undefined && recorded !== entry.manifest.version) {
            findings.push({package: entry.manifest.name, code: "lockfile_version", message: `bun.lock 里记的版本是 ${recorded}，package.json 是 ${entry.manifest.version}：先跑 bun install 刷新锁文件，否则 workspace:^ 会被改写成旧版本`});
        }
    }
    return findings;
}

function dependencyFields(manifest: PackageManifest): [string, DependencyMap][] {
    return [
        ["dependencies", manifest.dependencies ?? {}],
        ["peerDependencies", manifest.peerDependencies ?? {}],
        ["optionalDependencies", manifest.optionalDependencies ?? {}],
        ["devDependencies", manifest.devDependencies ?? {}],
    ];
}

function readOptional(path: string): Buffer | null {
    try {
        return readFileSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

/**
 * 会发布的文件：按 `files` 展开（目录写法匹配其下全部文件，`!` 开头的排除在后面统一生效）。npm 总会带上的
 * `package.json` 不在这里，它不是源码。
 */
export function publishedFiles(entry: ReleasePackage): string[] {
    const includes: Bun.Glob[] = [];
    const excludes: Bun.Glob[] = [];
    for (const pattern of entry.manifest.files ?? []) {
        const negated = pattern.startsWith("!");
        const body = negated ? pattern.slice(1) : pattern;
        const globs = /[*?[{]/u.test(body) ? [body] : [body, `${body}/**`];
        for (const glob of globs) (negated ? excludes : includes).push(new Bun.Glob(glob));
    }
    const files: string[] = [];
    for (const file of new Bun.Glob("**").scanSync({cwd: entry.path, onlyFiles: true, dot: true})) {
        if (file.startsWith("node_modules/")) continue;
        if (!includes.some((glob) => glob.match(file))) continue;
        if (excludes.some((glob) => glob.match(file))) continue;
        files.push(file);
    }
    return files.sort();
}

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gu;
const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)<\/style>/gu;
const SRC_ATTRIBUTE = /\bsrc=["']([^"']+)["']/u;
const CSS_REFERENCE = /@(?:import|plugin)\s+["']([^"']+)["']/gu;
const JSX_PRAGMA = /@jsxImportSource\s+(\S+)/u;
const BUILTINS = new Set(builtinModules);

/**
 * 发布文件里的值导入指向的包，有没有写在本包的 dependencies、peerDependencies 或 optionalDependencies 里。
 * 只有类型的导入不算：Bun 执行时会去掉它们（`Bun.Transpiler.scanImports` 也不报）。
 */
function undeclaredImports(entry: ReleasePackage): string[] {
    const {manifest} = entry;
    const declared = new Set([
        manifest.name,
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    const missing = new Map<string, string>();
    for (const file of publishedFiles(entry)) {
        for (const specifier of importSpecifiers(join(entry.path, file))) {
            const name = packageName(specifier);
            if (name && !declared.has(name) && !missing.has(name)) missing.set(name, file);
        }
    }
    return [...missing].map(([name, file]) => `${name}（${file} 导入）没有写进 dependencies 或 peerDependencies`);
}

export function importSpecifiers(path: string): string[] {
    const source = readFileSync(path, "utf8");
    if (path.endsWith(".css")) return scanCss(source);
    if (path.endsWith(".vue")) {
        // 单文件组件的脚本与样式都由宿主编译，两种块里的导入都算；`src` 属性指向的外部文件也是导入。
        const scripts = [...source.matchAll(SCRIPT_BLOCK)].flatMap((match) => {
            const loader = /lang=["']tsx["']/u.test(match[1] as string) ? "tsx" : "ts";
            return scanScript(match[2] as string, loader);
        });
        const styles = [...source.matchAll(STYLE_BLOCK)].flatMap((match) => scanCss(match[2] as string));
        const sources = [...source.matchAll(SCRIPT_BLOCK), ...source.matchAll(STYLE_BLOCK)].flatMap((match) => SRC_ATTRIBUTE.exec(match[1] as string)?.[1] ?? []);
        return [...scripts, ...styles, ...sources];
    }
    if (/\.(?:[cm]?[jt]s|tsx|jsx)$/u.test(path)) return scanScript(source, path.endsWith("x") ? "tsx" : "ts");
    return [];
}

function scanCss(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, "");
    return [...withoutComments.matchAll(CSS_REFERENCE)].map((match) => match[1] as string);
}

function scanScript(source: string, loader: "ts" | "tsx"): string[] {
    // 文件自己用 @jsxImportSource 指定 JSX 运行时时照它扫，否则 Bun 按缺省的 react 插入导入。发布的包里不带
    // tsconfig，Bun 在用户机器上执行它们时用的正是这两种之一。
    const pragma = loader === "tsx" ? JSX_PRAGMA.exec(source)?.[1] : undefined;
    const transpiler = new Bun.Transpiler({
        loader,
        ...(pragma ? {tsconfig: {compilerOptions: {jsx: "react-jsx", jsxImportSource: pragma}}} : {}),
    });
    // scanImports 不认文件开头的 shebang（`bin` 入口都有），只清掉那一行的内容，行号不变。
    const entries = transpiler.scanImports(source.replace(/^#!.*/u, ""));
    // 文件里有 JSX 时，scanImports 在显式导入之后补两条 require：JSX 运行时，再一个 `react`（createElement 的后备）。
    // 指定了运行时的文件实测没装 react 也照常执行，所以只去掉末尾补出来的这个 `react`；文件自己写的 react 导入在前面，
    // 照样报。Bun 改了这个顺序时 packages.test.ts 的 JSX 用例会失败。
    const last = entries.at(-1);
    const runtime = entries.at(-2);
    const injected = pragma !== undefined && last?.kind === "require-call" && last.path === "react" && runtime?.kind === "require-call" && runtime.path.startsWith(`${pragma}/jsx`);
    return (injected ? entries.slice(0, -1) : entries).map((entry) => entry.path);
}

/** 裸说明符的包名；相对路径、内置模块与 Vite 的虚拟模块返回 null。 */
export function packageName(specifier: string): string | null {
    const path = specifier.split("?")[0] as string;
    if (path.startsWith(".") || path.startsWith("/") || path.startsWith("#") || path.startsWith("virtual:")) return null;
    if (path.startsWith("node:") || path.startsWith("bun:") || path === "bun") return null;
    const parts = path.split("/");
    const name = path.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
    return BUILTINS.has(name) ? null : name;
}

/** `--root` 换仓库根、`--package` 只查给出的包（可重复），都为检查别的目录树而设，缺省查本仓库的整份清单。 */
function parseArguments(argv: readonly string[]): {root: string; dirs: readonly string[]; json: boolean} {
    let root = join(import.meta.dir, "..", "..");
    const dirs: string[] = [];
    let json = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (argument === "--json") json = true;
        else if (argument === "--root" && value) root = argv[(index += 1)] as string;
        else if (argument === "--package" && value) dirs.push(argv[(index += 1)] as string);
        else throw new UsageError(`未知参数或缺少值：${argument}`);
    }
    return {root, dirs: dirs.length > 0 ? dirs : RELEASE_PACKAGES, json};
}

class UsageError extends Error {}

if (import.meta.main) {
    try {
        const {root, dirs, json} = parseArguments(Bun.argv.slice(2));
        const packages = loadReleasePackages(root, dirs);
        const findings = checkReleasePackages(root, packages);
        const order = findings.some((finding) => finding.code === "dependency_cycle") ? [] : publishOrder(packages);
        if (json) {
            console.log(JSON.stringify({ok: findings.length === 0, findings, order: order.map((entry) => entry.manifest.name)}));
        } else if (findings.length === 0) {
            console.log(`发布清单检查通过，发布顺序：${order.map((entry) => `${entry.manifest.name}@${entry.manifest.version}`).join("、")}`);
        } else {
            for (const finding of findings) console.error(`${finding.package} [${finding.code}] ${finding.message}`);
            console.error(`发布清单检查失败：${findings.length} 处（在 ${relative(process.cwd(), root) || "."}）`);
        }
        process.exit(findings.length === 0 ? 0 : 1);
    } catch (error) {
        console.error((error as Error).message);
        process.exit(error instanceof UsageError ? 2 : 1);
    }
}
