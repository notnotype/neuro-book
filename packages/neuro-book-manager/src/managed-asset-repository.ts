import {randomUUID} from "node:crypto";
import {rename} from "node:fs/promises";
import {isAbsolute, join, relative, resolve} from "node:path";

import {downloadVerified} from "#manager/download";
import {ensureDirectory, pathExists, removePath, sha256File} from "#manager/files";

/** 受管归档的公开Release身份。 */
export type ManagedAssetRelease = {
    name: string;
    url: string;
    sha256: string;
};

/** Manifest证明的既有不可变版本目录身份。 */
export type TrustedManagedAssetIdentity<TKey extends string> = {
    /** 从Manifest executable path派生的资产代次根，相对Installation Root。 */
    assetRoot: string;
    archiveSha256: string;
    sourceUrl: string;
    executables: {[key in TKey]: {path: string; sha256: string}};
};

/** 受管归档内一个必须验证的可执行文件。 */
export type ManagedExecutableSpec<TKey extends string> = {
    key: TKey;
    locate: (assetRoot: string) => Promise<string>;
    verify: (executable: string) => Promise<void>;
};

/** 已提交受管资产的文件身份。 */
export type ManagedAssetResult<TKey extends string> = {
    archiveSha256: string;
    sourceUrl: string;
    executables: {[key in TKey]: {path: string; sha256: string}};
    /** 本次提交的新资产代次；复用时为空。 */
    createdPath?: string;
    /** Manifest提交成功后才能删除的旧代次。 */
    retiredPaths: string[];
    reused: boolean;
};

export type MaterializeManagedAssetOptions<TKey extends string> = {
    installationRoot: string;
    targetRoot: string;
    release: ManagedAssetRelease;
    /** 仅允许来自当前有效Installation Manifest；缺少时既有目录一律不可信。 */
    trustedIdentity?: TrustedManagedAssetIdentity<TKey>;
    executables: readonly ManagedExecutableSpec<TKey>[];
    /** Stage 0等已验证本地来源可替换远程下载Adapter。 */
    fetch?: (target: string) => Promise<void>;
    extract: (archivePath: string, extractedRoot: string) => Promise<void>;
    createdPaths?: string[];
    retiredPaths?: string[];
    /** 每个本次创建路径出现后立即写入Operation Journal。 */
    recordCreated?: (relativePath: string) => Promise<void>;
    /** 物理创建完成后把同一PathCreateEffect推进到applied。 */
    recordCreatedApplied?: (relativePath: string) => Promise<void>;
    /** 每个待退役目录确定后立即写入Operation Journal。 */
    recordRetired?: (relativePath: string) => Promise<void>;
};

/** 从Manifest executable path派生受管仓库中的资产代次根。 */
export function managedAssetRoot(executablePath: string, repositoryPath: string): string {
    const executableParts = executablePath.replaceAll("\\", "/").split("/").filter(Boolean);
    const repositoryParts = repositoryPath.replaceAll("\\", "/").split("/").filter(Boolean);
    if (executableParts.length <= repositoryParts.length + 1
        || repositoryParts.some((part, index) => executableParts[index] !== part)) {
        throw new Error(`受管可执行文件不属于${repositoryPath}仓库：${executablePath}`);
    }
    return executableParts.slice(0, repositoryParts.length + 1).join("/");
}

/**
 * 物化一个受管归档并提交不可变版本目录。
 *
 * 既有目录只有在当前Manifest证明归档身份、全部文件checksum和真实版本时才能复用；
 * 其他情况创建新资产代次，稳定wrapper由调用方在全部资产完成后统一刷新。
 */
export async function materializeManagedAsset<TKey extends string>(
    options: MaterializeManagedAssetOptions<TKey>,
): Promise<ManagedAssetResult<TKey>> {
    const installationRoot = resolve(options.installationRoot);
    const targetRoot = resolve(options.targetRoot);
    const trusted = await inspectTrustedAsset(options, installationRoot);
    if (trusted) return {...trusted, retiredPaths: [], reused: true};

    const stageRoot = join(installationRoot, ".deploy", "staging", `managed-${randomUUID()}`);
    const stagePath = ownedRelativePath(installationRoot, stageRoot, "受管资产staging");
    const archivePath = join(stageRoot, options.release.name);
    const extractedRoot = join(stageRoot, "extracted");
    let committedRoot: string | null = null;
    try {
        await recordCreated(options, stagePath);
        await ensureDirectory(stageRoot);
        await options.recordCreatedApplied?.(stagePath);
        if (options.fetch) await options.fetch(archivePath);
        else await downloadVerified(options.release.url, archivePath, options.release.sha256);
        await options.extract(archivePath, extractedRoot);
        const staged = await inspectExecutables(options.executables, extractedRoot);
        const commitRoot = await generationRoot(targetRoot);
        const createdPath = ownedRelativePath(installationRoot, commitRoot, "受管资产目标");
        const retiredPaths = await retiredAssetPaths(options, installationRoot, targetRoot);
        // 先持久化ownership，再进行不可变代次rename；进程硬中断后恢复可安全删除目标。
        await recordCreated(options, createdPath);
        for (const retiredPath of retiredPaths) await recordRetired(options, retiredPath);
        await ensureDirectory(resolve(commitRoot, ".."));
        await renameWithRetry(extractedRoot, commitRoot);
        await options.recordCreatedApplied?.(createdPath);
        committedRoot = commitRoot;
        return {
            archiveSha256: options.release.sha256,
            sourceUrl: options.release.url,
            executables: relocateExecutables(staged, extractedRoot, commitRoot, installationRoot),
            createdPath,
            retiredPaths,
            reused: false,
        };
    } catch (error) {
        if (committedRoot) await removePath(committedRoot).catch(() => undefined);
        throw error;
    } finally {
        await removePath(stageRoot).catch(() => undefined);
    }
}

/** 验证Manifest证明的现有目录；任何身份缺口都会回到完整重建。 */
async function inspectTrustedAsset<TKey extends string>(
    options: MaterializeManagedAssetOptions<TKey>,
    installationRoot: string,
): Promise<Omit<ManagedAssetResult<TKey>, "createdPath" | "retiredPaths" | "reused"> | null> {
    const trusted = options.trustedIdentity;
    const trustedRoot = trusted ? resolve(installationRoot, trusted.assetRoot) : null;
    if (!trusted
        || trusted.archiveSha256.toLowerCase() !== options.release.sha256.toLowerCase()
        || trusted.sourceUrl !== options.release.url
        || !trustedRoot
        || !await pathExists(trustedRoot)) {
        return null;
    }
    try {
        const entries = await Promise.all(options.executables.map(async (spec) => {
            const identity = trusted.executables[spec.key];
            if (!identity) throw new Error(`Manifest缺少受管可执行文件身份：${spec.key}`);
            const executable = resolve(installationRoot, identity.path);
            ownedRelativePath(trustedRoot, executable, `受管可执行文件${spec.key}`);
            if (!await pathExists(executable)) throw new Error(`受管可执行文件不存在：${identity.path}`);
            const actualSha256 = await sha256File(executable);
            if (actualSha256.toLowerCase() !== identity.sha256.toLowerCase()) {
                throw new Error(`受管可执行文件checksum不一致：${identity.path}`);
            }
            await spec.verify(executable);
            return [spec.key, {path: identity.path.replaceAll("\\", "/"), sha256: actualSha256}] as const;
        }));
        return {
            archiveSha256: trusted.archiveSha256,
            sourceUrl: trusted.sourceUrl,
            executables: Object.fromEntries(entries) as ManagedAssetResult<TKey>["executables"],
        };
    } catch {
        return null;
    }
}

/** 默认版本目录被占用时创建新代次，永不原地覆盖已有目录。 */
async function generationRoot(targetRoot: string): Promise<string> {
    if (!await pathExists(targetRoot)) return targetRoot;
    return `${targetRoot}-${randomUUID().slice(0, 8)}`;
}

/** 仅退役当前Manifest证明的损坏代次，或占用默认位置的无Manifest目录。 */
async function retiredAssetPaths<TKey extends string>(
    options: MaterializeManagedAssetOptions<TKey>,
    installationRoot: string,
    targetRoot: string,
): Promise<string[]> {
    const candidates = new Set<string>();
    if (await pathExists(targetRoot)) candidates.add(ownedRelativePath(installationRoot, targetRoot, "受管资产旧代次"));
    if (options.trustedIdentity) {
        const trustedRoot = resolve(installationRoot, options.trustedIdentity.assetRoot);
        if (await pathExists(trustedRoot)) candidates.add(ownedRelativePath(installationRoot, trustedRoot, "受管资产旧代次"));
    }
    return [...candidates];
}

/** 定位、执行并计算新归档中的全部必需可执行文件。 */
async function inspectExecutables<TKey extends string>(
    specs: readonly ManagedExecutableSpec<TKey>[],
    extractedRoot: string,
): Promise<Array<readonly [TKey, {path: string; sha256: string}]>> {
    return Promise.all(specs.map(async (spec) => {
        const executable = resolve(await spec.locate(extractedRoot));
        ownedRelativePath(extractedRoot, executable, `归档可执行文件${spec.key}`);
        await spec.verify(executable);
        return [spec.key, {path: executable, sha256: await sha256File(executable)}] as const;
    }));
}

/** 将staging绝对路径转换为Installation Root相对的最终Manifest路径。 */
/**
 * 带指数退避的 rename。Windows 上刚解压的大量可执行文件常被 Defender/索引器短暂持有句柄，
 * 直接 rename 会偶发 EPERM/EBUSY/EACCES；这类锁通常数秒内释放，重试即可恢复。
 */
async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            await rename(from, to);
            return;
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? (error as {code?: string}).code : undefined;
            const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
            if (!retryable || attempt >= attempts) throw error;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** (attempt - 1)));
        }
    }
}

function relocateExecutables<TKey extends string>(
    staged: Array<readonly [TKey, {path: string; sha256: string}]>,
    extractedRoot: string,
    targetRoot: string,
    installationRoot: string,
): ManagedAssetResult<TKey>["executables"] {
    return Object.fromEntries(staged.map(([key, executable]) => {
        const target = join(targetRoot, relative(extractedRoot, executable.path));
        return [key, {
            path: relative(installationRoot, target).replaceAll("\\", "/"),
            sha256: executable.sha256,
        }];
    })) as ManagedAssetResult<TKey>["executables"];
}

/** 返回受Installation Root拥有的非根相对路径。 */
function ownedRelativePath(root: string, target: string, label: string): string {
    const path = relative(resolve(root), resolve(target));
    if (!path || path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path)) {
        throw new Error(`${label}越出Installation Root：${target}`);
    }
    return path.replaceAll("\\", "/");
}

/** 同步内存清单与Operation Journal。 */
async function recordCreated<TKey extends string>(options: MaterializeManagedAssetOptions<TKey>, path: string): Promise<void> {
    if (options.createdPaths && !options.createdPaths.includes(path)) options.createdPaths.push(path);
    await options.recordCreated?.(path);
}

/** 同步内存退役清单与Operation Journal。 */
async function recordRetired<TKey extends string>(options: MaterializeManagedAssetOptions<TKey>, path: string): Promise<void> {
    if (options.retiredPaths && !options.retiredPaths.includes(path)) options.retiredPaths.push(path);
    await options.recordRetired?.(path);
}
