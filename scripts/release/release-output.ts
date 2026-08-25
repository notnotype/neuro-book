#!/usr/bin/env bun
import {createHash} from "node:crypto";
import {appendFile, lstat, mkdir, readFile, readdir, rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {relative, resolve} from "node:path";
import process from "node:process";

import {Command} from "commander";

import {PRODUCT_ASSET_NAMES} from "@notnotype/neuro-book-contracts/platform";
import {runCapture} from "#scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RELEASE_OUTPUT_ROOT = "dist";
const RELEASE_READY_ASSET = "release-manifest.json";

export const RELEASE_OUTPUT_ASSET_NAMES = [
    "neuro-book-source.zip",
    PRODUCT_ASSET_NAMES["windows-x64"],
    PRODUCT_ASSET_NAMES["linux-x64-glibc"],
    PRODUCT_ASSET_NAMES["linux-aarch64-glibc"],
    PRODUCT_ASSET_NAMES["darwin-x64"],
    PRODUCT_ASSET_NAMES["darwin-aarch64"],
    "neuro-book-windows-x64.zip",
    "install.ps1",
    "install.cmd",
    "install.sh",
    "SHA256SUMS",
    RELEASE_READY_ASSET,
] as const;

export type ReleaseOutputAssetName = typeof RELEASE_OUTPUT_ASSET_NAMES[number];

export type ReleaseGenerationIdentity = {
    version: string;
    revision: string;
    dirty: false;
    lockfileSha256: string;
    buildId: string;
};

export type ReleaseOutput = ReleaseGenerationIdentity & {
    directory: string;
    /** 返回当前代次目录内一个固定发行资产的绝对路径。 */
    assetPath(name: ReleaseOutputAssetName): string;
};

const program = new Command().name("release-output");

program.command("prepare")
    .description("创建当前 Source identity 对应的空发行目录。")
    .option("--github-env", "把统一发行身份和目录写入 GITHUB_ENV。", false)
    .action(async (options: {githubEnv: boolean}) => {
        const output = await prepareReleaseOutput(ROOT);
        if (options.githubEnv) await writeGithubEnvironment(output, ROOT);
        printReleaseOutput(output, ROOT);
    });

program.command("cleanup")
    .description("显式删除一个精确 version/buildId 的历史发行目录。")
    .requiredOption("--version <version>")
    .requiredOption("--build-id <build-id>")
    .action(async (options: {version: string; buildId: string}) => {
        const removed = await cleanupReleaseOutput(ROOT, options.version, options.buildId);
        console.log(`Removed release output: ${relative(ROOT, removed)}`);
    });

if (import.meta.main) await program.parseAsync(process.argv);

/** 版本、revision 与 lockfile 的 canonical identity 跨平台稳定。 */
export function releaseBuildId(identity: {version: string; revision: string; lockfileSha256: string}): string {
    const canonical = JSON.stringify({
        lockfileSha256: identity.lockfileSha256,
        revision: identity.revision,
        version: identity.version,
    });
    return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** 从干净 Git checkout 读取唯一的 Release generation identity。 */
export async function readReleaseGeneration(projectRoot: string): Promise<ReleaseGenerationIdentity> {
    const applicationPackagePath = resolve(projectRoot, "packages", "neuro-book", "package.json");
    const packagePath = existsSync(applicationPackagePath)
        ? applicationPackagePath
        : resolve(projectRoot, "package.json");
    const [packageText, revisionOutput, statusOutput, lockfile] = await Promise.all([
        readFile(packagePath, "utf8"),
        runCapture("git", ["rev-parse", "HEAD"], {cwd: projectRoot}),
        runCapture("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {cwd: projectRoot}),
        readFile(resolve(projectRoot, "bun.lock")),
    ]);
    if (statusOutput.length > 0) {
        // -z 输出按 NUL 分隔；发布失败时必须直接给出脏路径，否则 Windows/CI 只剩不可定位的 dirty=true。
        const entries = statusOutput.split("\0")
            .filter((entry) => entry.length > 0)
            .slice(0, 20)
            .map((entry) => `- ${entry.slice(0, 300)}`);
        throw new Error([
            "正式 Release Source 必须来自干净 Git checkout；当前 Source dirty=true。",
            ...entries,
        ].join("\n"));
    }
    const revision = revisionOutput.trim();
    if (!/^[0-9a-f]{40,64}$/iu.test(revision)) {
        throw new Error(`Release Source revision 无效：${revision || "empty"}`);
    }
    const version = parsePackageVersion(packageText, packagePath);
    const lockfileSha256 = `sha256:${createHash("sha256").update(lockfile).digest("hex")}`;
    return {
        version,
        revision,
        dirty: false,
        lockfileSha256,
        buildId: releaseBuildId({version, revision, lockfileSha256}),
    };
}

/** 计算当前 Source identity 的规范目录，但不创建文件。 */
export async function resolveReleaseOutput(projectRoot: string): Promise<ReleaseOutput> {
    return createReleaseOutput(projectRoot, await readReleaseGeneration(projectRoot));
}

/** 创建当前代次的空目标；已有任何内容都视为另一轮或中断的发行并拒绝复用。 */
export async function prepareReleaseOutput(projectRoot: string): Promise<ReleaseOutput> {
    const output = await resolveReleaseOutput(projectRoot);
    await prepareReleaseParents(projectRoot, output.version);
    try {
        await mkdir(output.directory);
    } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertReleaseDirectory(output, true);
    return output;
}

/** 打开当前代次的未封存目录；缺失、额外文件和 ready manifest 都 fail closed。 */
export async function openReleaseOutput(projectRoot: string): Promise<ReleaseOutput> {
    const output = await resolveReleaseOutput(projectRoot);
    await assertReleaseParents(projectRoot, output.version);
    await assertReleaseDirectory(output, false);
    return output;
}

/** 只删除调用方明确给出的单个历史代次；不会扫描或按年龄自动清理。 */
export async function cleanupReleaseOutput(projectRoot: string, version: string, buildIdInput: string): Promise<string> {
    assertVersion(version);
    const buildId = normalizeBuildId(buildIdInput);
    const directory = releaseDirectory(projectRoot, version, buildId);
    await assertReleaseParents(projectRoot, version);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
        info = await lstat(directory);
    } catch (error) {
        if (isNodeError(error, "ENOENT")) throw new Error(`Release output 不存在：${directory}`, {cause: error});
        throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Release output 不是可清理的普通目录：${directory}`);
    }
    await rm(directory, {recursive: true, force: false});
    return directory;
}

/** 用已经读取的 identity 建立带固定资产寻址函数的输出对象。 */
function createReleaseOutput(projectRoot: string, identity: ReleaseGenerationIdentity): ReleaseOutput {
    const directory = releaseDirectory(projectRoot, identity.version, identity.buildId);
    return {
        ...identity,
        directory,
        assetPath(name) {
            if (!(RELEASE_OUTPUT_ASSET_NAMES as readonly string[]).includes(name)) {
                throw new Error(`未知 Release 资产名：${name}`);
            }
            return resolve(directory, name);
        },
    };
}

/** 逐层创建并校验 dist/version，禁止现有 symlink 把发行写入重定向到仓库外。 */
async function prepareReleaseParents(projectRoot: string, version: string): Promise<void> {
    const distRoot = resolve(projectRoot, RELEASE_OUTPUT_ROOT);
    const versionRoot = resolve(distRoot, version);
    await createOrdinaryDirectory(distRoot, "Release dist root");
    await createOrdinaryDirectory(versionRoot, "Release version root");
}

/** 打开或清理前重新验证固定父级，不信任此前检查结果。 */
async function assertReleaseParents(projectRoot: string, version: string): Promise<void> {
    await assertOrdinaryDirectory(resolve(projectRoot, RELEASE_OUTPUT_ROOT), "Release dist root");
    await assertOrdinaryDirectory(resolve(projectRoot, RELEASE_OUTPUT_ROOT, version), "Release version root");
}

/** mkdir 只创建一个确定目录；EEXIST 时必须仍是非 symlink 目录。 */
async function createOrdinaryDirectory(path: string, label: string): Promise<void> {
    try {
        await mkdir(path);
    } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
    }
    await assertOrdinaryDirectory(path, label);
}

/** lstat 保证父级本身不是 symlink 或其他特殊文件。 */
async function assertOrdinaryDirectory(path: string, label: string): Promise<void> {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} 必须是普通目录：${path}`);
}

/** 校验目录只含固定普通文件，并在 manifest 已存在时禁止继续写入。 */
async function assertReleaseDirectory(output: ReleaseOutput, requireEmpty: boolean): Promise<void> {
    const info = await lstat(output.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Release output 必须是普通目录：${output.directory}`);
    }
    const entries = await readdir(output.directory, {withFileTypes: true});
    if (requireEmpty && entries.length > 0) {
        throw new Error(`Release output 目标目录必须为空：${output.directory}`);
    }
    for (const entry of entries) {
        if (!(RELEASE_OUTPUT_ASSET_NAMES as readonly string[]).includes(entry.name)) {
            throw new Error(`Release output 包含未知文件：${entry.name}`);
        }
        if (!entry.isFile() || entry.isSymbolicLink()) {
            throw new Error(`Release output 资产必须是普通文件：${entry.name}`);
        }
    }
    if (!requireEmpty && entries.some((entry) => entry.name === RELEASE_READY_ASSET)) {
        throw new Error(`Release output 已由 ${RELEASE_READY_ASSET} 封存，拒绝继续写入：${output.directory}`);
    }
}

/** 输出路径只使用 Windows 可接受的 build digest，不把 buildId 中的冒号写入目录名。 */
function releaseDirectory(projectRoot: string, version: string, buildId: string): string {
    assertVersion(version);
    const normalizedBuildId = normalizeBuildId(buildId);
    const digest = normalizedBuildId.slice("sha256:".length);
    return resolve(projectRoot, RELEASE_OUTPUT_ROOT, version, digest);
}

/** Release version 必须能安全作为单个跨平台目录名。 */
function assertVersion(version: string): void {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
        throw new Error(`Release version 不能作为安全目录名：${version}`);
    }
}

/** CLI cleanup 同时接受完整 buildId 和目录中使用的 64 位 digest。 */
function normalizeBuildId(value: string): string {
    const buildId = /^[0-9a-f]{64}$/u.test(value) ? `sha256:${value}` : value;
    if (!/^sha256:[0-9a-f]{64}$/u.test(buildId)) throw new Error(`Release buildId 无效：${value}`);
    return buildId;
}

/** 严格读取 package.json.version，避免 object 字段被隐式字符串化。 */
function parsePackageVersion(text: string, source: string): string {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(`${source} 不是有效 JSON：${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || !("version" in value)
        || typeof value.version !== "string" || !value.version) {
        throw new Error(`${source} 缺少 version。`);
    }
    assertVersion(value.version);
    return value.version;
}

/** 在 workflow job 内发布统一代次变量，禁止各 step 自己拼接目录。 */
async function writeGithubEnvironment(output: ReleaseOutput, projectRoot: string): Promise<void> {
    const githubEnvironment = process.env.GITHUB_ENV;
    if (!githubEnvironment) throw new Error("--github-env 需要 GitHub Actions 提供 GITHUB_ENV。");
    const directory = relative(projectRoot, output.directory).replaceAll("\\", "/");
    await appendFile(githubEnvironment, [
        `NEURO_BOOK_RELEASE_VERSION=${output.version}`,
        `NEURO_BOOK_RELEASE_BUILD_ID=${output.buildId}`,
        `NEURO_BOOK_RELEASE_DIR=${directory}`,
        "",
    ].join("\n"), "utf8");
}

/** CLI 输出既供人工查看，也方便非 GitHub workflow 消费。 */
function printReleaseOutput(output: ReleaseOutput, projectRoot: string): void {
    console.log(JSON.stringify({
        version: output.version,
        revision: output.revision,
        buildId: output.buildId,
        directory: relative(projectRoot, output.directory).replaceAll("\\", "/"),
    }));
}

/** 只收窄预期的 Node 文件系统错误。 */
function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}
