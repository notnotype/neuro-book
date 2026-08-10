import {existsSync} from "node:fs";
import {chmod, copyFile, readdir} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";

import {extractArchive, githubReleaseAsset} from "#manager/download";
import {ensureDirectory, pathExists, removePath, sha256File, writeTextAtomic} from "#manager/files";
import {
    MANAGER_RUNTIME_PROJECTION_DIRECTORY,
    MANAGER_RUNTIME_PROJECTION_FILENAME,
} from "#manager/manager-runtime-projection";
import {managedAssetRoot, materializeManagedAsset} from "#manager/managed-asset-repository";
import {currentProductPlatform, executableName} from "#manager/platform";
import {runCapture} from "#manager/process";
import type {ManagedRuntimeComponent, ManagerComponent, ManagerRuntimeComponent, ProductPlatform} from "#manager/types";
import {compare} from "semver";

const STAGE0_PATH = "NEURO_BOOK_STAGE0_BUN_PATH";
const STAGE0_VERSION = "NEURO_BOOK_STAGE0_BUN_VERSION";
const STAGE0_SOURCE_URL = "NEURO_BOOK_STAGE0_BUN_SOURCE_URL";
const STAGE0_SHA256 = "NEURO_BOOK_STAGE0_BUN_SHA256";

/** 当前Manager支持的平台到Bun官方Release资产名。 */
export const BUN_ASSET_NAMES = {
    "windows-x64": "bun-windows-x64.zip",
    "linux-x64-glibc": "bun-linux-x64.zip",
    "linux-aarch64-glibc": "bun-linux-aarch64.zip",
    "darwin-x64": "bun-darwin-x64.zip",
    "darwin-aarch64": "bun-darwin-aarch64.zip",
} as const satisfies Record<ProductPlatform, string>;

/** Manager自接管只允许严格升级；同版本bundle身份必须完全一致。 */
export async function assertManagerUpgrade(currentVersion: string, installedVersion: string, installedChecksum: string, source: string): Promise<boolean> {
    const direction = compare(currentVersion, installedVersion);
    if (direction < 0) {
        throw new Error(`当前Manager ${currentVersion}低于安装记录的${installedVersion}；拒绝覆盖或降级不可变Manager版本目录。请使用不低于${installedVersion}的Manager重试。`);
    }
    if (direction === 0 && await sha256File(source) !== installedChecksum) {
        throw new Error(`Manager ${currentVersion}版本相同但bundle checksum与Installation Manifest不一致；不可变版本目录不会被覆盖。`);
    }
    return direction > 0;
}

/** 解析 Manager Host Runtime；Stage 0 优先复制为 managed，否则使用当前 Bun。 */
export async function resolveManagerRuntime(
    root: string,
    forceManaged = false,
    createdPaths: string[] = [],
    recordCreated?: (path: string) => Promise<void>,
    recordCreatedApplied?: (path: string) => Promise<void>,
    retiredPaths: string[] = [],
    recordRetired?: (path: string) => Promise<void>,
): Promise<ManagerRuntimeComponent> {
    const stage0 = stage0Runtime();
    if (stage0) return installStage0Bun(root, stage0, createdPaths, recordCreated, recordCreatedApplied, retiredPaths, recordRetired);
    if (forceManaged) return installManagedBun(root, {createdPaths, recordCreated, recordCreatedApplied, retiredPaths, recordRetired});
    return {
        provider: "system",
        version: process.versions.bun ?? "unknown",
        executable: process.execPath,
    };
}

export type InstallManagedBunOptions = {
    requestedVersion?: string;
    /** 仅允许传入当前有效Installation Manifest中的managed Runtime。 */
    trustedIdentity?: ManagedRuntimeComponent;
    createdPaths?: string[];
    recordCreated?: (path: string) => Promise<void>;
    recordCreatedApplied?: (path: string) => Promise<void>;
    retiredPaths?: string[];
    recordRetired?: (path: string) => Promise<void>;
};

/** 安装托管 Bun Runtime，使用 staging 后原子提交不可变版本目录。 */
export async function installManagedBun(root: string, options: InstallManagedBunOptions = {}): Promise<ManagedRuntimeComponent> {
    const tag = options.requestedVersion
        ? options.requestedVersion.startsWith("bun-v") ? options.requestedVersion : `bun-v${options.requestedVersion.replace(/^v/u, "")}`
        : undefined;
    const archiveName = BUN_ASSET_NAMES[currentProductPlatform()];
    const release = await githubReleaseAsset("oven-sh/bun", tag, (name) => name === archiveName);
    const version = release.tag.replace(/^bun-v/u, "");
    const runtimeRoot = join(root, ".runtime", "bun", version);
    const materialized = await materializeManagedAsset({
        installationRoot: root,
        targetRoot: runtimeRoot,
        release: release.asset,
        ...(options.trustedIdentity ? {trustedIdentity: {
            assetRoot: managedAssetRoot(options.trustedIdentity.path, ".runtime/bun"),
            archiveSha256: options.trustedIdentity.archiveSha256,
            sourceUrl: options.trustedIdentity.sourceUrl,
            executables: {bun: {
                path: options.trustedIdentity.path,
                sha256: options.trustedIdentity.executableSha256,
            }},
        }} : {}),
        executables: [{
            key: "bun" as const,
            locate: (assetRoot) => findNamedFile(assetRoot, executableName("bun")),
            verify: (executable) => verifyManagedBun(executable, version),
        }],
        extract: extractArchive,
        createdPaths: options.createdPaths,
        recordCreated: options.recordCreated,
        recordCreatedApplied: options.recordCreatedApplied,
        retiredPaths: options.retiredPaths,
        recordRetired: options.recordRetired,
    });
    const executable = materialized.executables.bun;
    return {
        provider: "managed",
        version,
        path: executable.path,
        archiveSha256: materialized.archiveSha256,
        executableSha256: executable.sha256,
        sourceUrl: materialized.sourceUrl,
        license: "MIT",
        redistribution: "按 Bun 官方 Release 原样再分发，并保留上游许可证与版本信息。",
    };
}

/** 修复POSIX执行位并验证Managed Bun真实版本。 */
async function verifyManagedBun(executable: string, expectedVersion: string): Promise<void> {
    if (process.platform !== "win32") await chmod(executable, 0o755);
    const actualVersion = (await runCapture(executable, ["--version"])).trim();
    if (actualVersion !== expectedVersion) {
        throw new Error(`Managed Bun版本不匹配：期望${expectedVersion}，实际${actualVersion || "<missing>"}。`);
    }
}

/** 把当前 Manager bundle安装到版本目录，并返回严格组件状态。 */
export async function installManagerExecutable(
    root: string,
    version: string,
    source: string,
    createdPaths: string[] = [],
    recordCreated?: (path: string) => Promise<void>,
    recordCreatedApplied?: (path: string) => Promise<void>,
): Promise<ManagerComponent> {
    const managerRoot = join(root, ".runtime", "manager", version);
    const target = join(managerRoot, "neuro-book.mjs");
    if (await pathExists(target)) {
        if (resolve(source) !== resolve(target) && await sha256File(source) !== await sha256File(target)) {
            throw new Error(`Manager版本目录不可变且bundle checksum不一致：${target}`);
        }
    } else {
        if (await pathExists(managerRoot)) {
            throw new Error(`Manager版本目录不完整且不可变：${managerRoot}`);
        }
        const createdPath = relative(root, managerRoot).replaceAll("\\", "/");
        createdPaths.push(createdPath);
        await recordCreated?.(createdPath);
        await ensureDirectory(managerRoot);
        if (resolve(source) !== resolve(target)) await copyFile(source, target);
        await recordCreatedApplied?.(createdPath);
    }
    return {
        provider: "managed",
        version,
        path: relative(root, target).replaceAll("\\", "/"),
        bundleSha256: await sha256File(target),
    };
}

/** 根据当前 Manager 与 Manager Runtime 原子刷新稳定 wrapper。 */
export async function writeManagerWrapper(root: string, manager: ManagerComponent, runtime: ManagerRuntimeComponent): Promise<void> {
    const binRoot = join(root, ".runtime", "bin");
    await ensureDirectory(binRoot);
    if (process.platform === "win32") {
        await writeTextAtomic(
            join(binRoot, "neuro-book.cmd"),
            renderManagerWrapper(manager, runtime, "win32", isCanonicalMachineInstallationRoot(root)),
        );
        return;
    }
    const wrapper = join(binRoot, "neuro-book");
    await writeTextAtomic(wrapper, renderManagerWrapper(manager, runtime));
    await chmod(wrapper, 0o755);
}

/** 生成稳定Manager wrapper；安装与doctor必须消费同一模板。 */
export function renderManagerWrapper(
    manager: ManagerComponent,
    runtime: ManagerRuntimeComponent,
    platform: NodeJS.Platform = process.platform,
    machineProjection = false,
): string {
    if (platform === "win32") {
        const runtimeCommand = runtime.provider === "managed"
            ? `"%ROOT%\\${runtime.path.replaceAll("/", "\\")}"`
            : `"${runtime.executable}"`;
        if (!machineProjection) {
            return `@echo off\r\nset "ROOT=%~dp0..\\.."\r\n${runtimeCommand} "%ROOT%\\${manager.path.replaceAll("/", "\\")}" %*\r\n`;
        }
        const managerPath = manager.path.replaceAll("/", "\\");
        const projection = `%LOCALAPPDATA%\\NeuroBook\\cache\\${MANAGER_RUNTIME_PROJECTION_DIRECTORY}\\${manager.bundleSha256.toLowerCase()}\\${MANAGER_RUNTIME_PROJECTION_FILENAME}`;
        const materialize = [
            "$ErrorActionPreference='Stop'",
            "function Get-Sha256([string]$path){$stream=[System.IO.File]::OpenRead($path);$sha=[System.Security.Cryptography.SHA256]::Create();try{return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();$stream.Dispose()}}",
            "$source=$env:NBOOK_MANAGER_SOURCE",
            "$target=$env:NBOOK_MANAGER_TARGET",
            "$expected=$env:NBOOK_MANAGER_SHA256.ToLowerInvariant()",
            "$sourceHash=Get-Sha256 $source",
            "if($sourceHash -ne $expected){throw 'Manager source checksum mismatch'}",
            "$valid=$false",
            "if(Test-Path -LiteralPath $target -PathType Leaf){$valid=((Get-Sha256 $target) -eq $expected)}",
            "if(-not $valid){$parent=Split-Path -Parent $target;[void][System.IO.Directory]::CreateDirectory($parent);$temporary=Join-Path $parent ('.neuro-book-'+[guid]::NewGuid().ToString('N')+'.mjs');try{Copy-Item -LiteralPath $source -Destination $temporary -Force;if((Get-Sha256 $temporary) -ne $expected){throw 'Manager projection checksum mismatch'};Move-Item -LiteralPath $temporary -Destination $target -Force}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}}",
        ].join(";");
        return [
            "@echo off",
            "setlocal",
            "for %%I in (\"%~dp0..\\..\") do set \"ROOT=%%~fI\"",
            `set "MANAGER=%ROOT%\\${managerPath}"`,
            "if \"%LOCALAPPDATA%\"==\"\" echo NeuroBook Manager requires LOCALAPPDATA for machine installation. 1>&2",
            "if \"%LOCALAPPDATA%\"==\"\" exit /b 1",
            "set \"NBOOK_MANAGER_SOURCE=%MANAGER%\"",
            `set "NBOOK_MANAGER_TARGET=${projection}"`,
            `set "NBOOK_MANAGER_SHA256=${manager.bundleSha256.toLowerCase()}"`,
            `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${materialize}"`,
            "if errorlevel 1 exit /b %errorlevel%",
            "set \"MANAGER=%NBOOK_MANAGER_TARGET%\"",
            ":run-manager",
            `${runtimeCommand} "%MANAGER%" %*`,
            "set \"NBOOK_MANAGER_EXIT=%ERRORLEVEL%\"",
            "endlocal & exit /b %NBOOK_MANAGER_EXIT%",
            "",
        ].join("\r\n");
    }
    const runtimeCommand = runtime.provider === "managed"
        ? `"$ROOT/${runtime.path}"`
        : JSON.stringify(runtime.executable);
    return `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"\nexec ${runtimeCommand} "$ROOT/${manager.path}" "$@"\n`;
}

/** 只有 canonical Windows machine Installation Root 才需要 Cache execution projection。 */
export function isCanonicalMachineInstallationRoot(root: string): boolean {
    if (process.platform !== "win32") return false;
    const machineRoot = resolve(
        process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"),
        "NeuroBook",
    );
    return resolve(root).toLocaleLowerCase("en-US") === machineRoot.toLocaleLowerCase("en-US");
}

/** 返回 Runtime 真实可执行文件。 */
export function runtimeExecutable(root: string, runtime: ManagerRuntimeComponent): string {
    return runtime.provider === "managed" ? resolve(root, runtime.path) : runtime.executable;
}

/** 将托管 Runtime/Tool 的真实目录加入当前子进程 PATH。 */
export function prependExecutablePath(executable: string): void {
    const directory = dirname(executable);
    const separator = process.platform === "win32" ? ";" : ":";
    const current = process.env.PATH ?? "";
    if (!current.split(separator).includes(directory)) process.env.PATH = `${directory}${separator}${current}`;
}

async function installStage0Bun(
    root: string,
    stage0: Stage0Runtime,
    createdPaths: string[] = [],
    recordCreated?: (path: string) => Promise<void>,
    recordCreatedApplied?: (path: string) => Promise<void>,
    retiredPaths: string[] = [],
    recordRetired?: (path: string) => Promise<void>,
): Promise<ManagedRuntimeComponent> {
    const actualChecksum = await sha256File(stage0.path);
    if (actualChecksum.toLowerCase() !== stage0.executableSha256.toLowerCase()) {
        throw new Error(`Stage 0 Bun checksum 不匹配：${stage0.path}`);
    }
    const targetRoot = join(root, ".runtime", "bun", stage0.version);
    const targetName = executableName("bun");
    const materialized = await materializeManagedAsset({
        installationRoot: root,
        targetRoot,
        release: {
            name: basename(stage0.path),
            url: stage0.sourceUrl,
            sha256: stage0.archiveSha256,
        },
        executables: [{
            key: "bun" as const,
            locate: (assetRoot) => findNamedFile(assetRoot, targetName),
            verify: (executable) => verifyManagedBun(executable, stage0.version),
        }],
        fetch: (target) => copyFile(stage0.path, target),
        extract: async (source, extractedRoot) => {
            await ensureDirectory(extractedRoot);
            await copyFile(source, join(extractedRoot, targetName));
        },
        createdPaths,
        recordCreated,
        recordCreatedApplied,
        retiredPaths,
        recordRetired,
    });
    const executable = materialized.executables.bun;
    return {
        provider: "managed",
        version: stage0.version,
        path: executable.path,
        archiveSha256: stage0.archiveSha256,
        executableSha256: executable.sha256,
        sourceUrl: stage0.sourceUrl,
        license: "MIT",
        redistribution: "由 NeuroBook Stage 0 校验 Bun 官方 Release 后复制到 Installation Root。",
    };
}

/** 为已验证的 managed Bun 写入稳定 wrapper。 */
export async function writeRuntimeWrapper(root: string, runtime: ManagedRuntimeComponent): Promise<void> {
    const binRoot = join(root, ".runtime", "bin");
    await ensureDirectory(binRoot);
    if (process.platform === "win32") {
        await writeTextAtomic(join(binRoot, "bun.cmd"), renderRuntimeWrapper(runtime));
        return;
    }
    const wrapper = join(binRoot, "bun");
    await writeTextAtomic(wrapper, renderRuntimeWrapper(runtime));
    await chmod(wrapper, 0o755);
}

/** 生成稳定managed Bun wrapper；安装与doctor必须消费同一模板。 */
export function renderRuntimeWrapper(runtime: ManagedRuntimeComponent, platform: NodeJS.Platform = process.platform): string {
    if (platform === "win32") {
        return `@echo off\r\nset "ROOT=%~dp0..\\.."\r\n"%ROOT%\\${runtime.path.replaceAll("/", "\\")}" %*\r\n`;
    }
    return `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)"\nexec "$ROOT/${runtime.path}" "$@"\n`;
}

/** 在解压目录中递归寻找指定文件。 */
export async function findNamedFile(root: string, filename: string): Promise<string> {
    if (!await pathExists(root)) throw new Error(`目录不存在：${root}`);
    const entries = await readdir(root, {withFileTypes: true});
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return path;
        if (entry.isDirectory()) {
            const nested = await findNamedFile(path, filename).catch(() => null);
            if (nested) return nested;
        }
    }
    throw new Error(`解压目录缺少 ${filename}：${root}`);
}

type Stage0Runtime = {
    path: string;
    version: string;
    sourceUrl: string;
    archiveSha256: string;
    executableSha256: string;
};

function stage0Runtime(): Stage0Runtime | null {
    const path = process.env[STAGE0_PATH]?.trim();
    const version = process.env[STAGE0_VERSION]?.trim();
    const sourceUrl = process.env[STAGE0_SOURCE_URL]?.trim();
    const archiveSha256 = process.env.NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256?.trim();
    const executableSha256 = process.env[STAGE0_SHA256]?.trim();
    if (!path && !version && !sourceUrl && !archiveSha256 && !executableSha256) return null;
    if (!path || !version || !sourceUrl || !archiveSha256 || !executableSha256
        || !/^[a-fA-F0-9]{64}$/u.test(archiveSha256) || !/^[a-fA-F0-9]{64}$/u.test(executableSha256)) {
        throw new Error("Stage 0 Bun metadata 不完整，拒绝安装未验证 Runtime。" );
    }
    if (!pathExistsSync(path)) throw new Error(`Stage 0 Bun 不存在：${path}`);
    return {path: resolve(path), version, sourceUrl, archiveSha256, executableSha256};
}

function pathExistsSync(path: string): boolean {
    return existsSync(path);
}
