import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {isAbsolute, join, relative, resolve, sep} from "node:path";

import {ensureDirectory, pathExists, sha256File, writeJsonAtomic} from "#manager/files";
import {runCapture} from "#manager/process";
import {INSTALLED_WINDOWS_ROOT_LOCATORS, localAppDataRoot, resolveInstallationRoots} from "#manager/root-locators";

const INTENT_PATH = join(".deploy", "uninstall-intent.json");
const HOST_COMMAND_ENVIRONMENT = "NEURO_BOOK_WINDOWS_UNINSTALL_HOST_COMMAND";
const HOST_INPUT_ENVIRONMENT = "NEURO_BOOK_WINDOWS_UNINSTALL_HOST_INPUT";

const WINDOWS_UNINSTALL_HOST_BOOTSTRAP = String.raw`$hostInput = $env:NEURO_BOOK_WINDOWS_UNINSTALL_HOST_INPUT | ConvertFrom-Json
$scriptPath = [string]$hostInput.scriptPath
$parameters = @{
    ParentPid = [int]$hostInput.parentPid
    IntentPath = [string]$hostInput.intentPath
    ExpectedToken = [string]$hostInput.expectedToken
    ExpectedRoot = [string]$hostInput.expectedRoot
    ExpectedIntentSha256 = [string]$hostInput.expectedIntentSha256
    ResultPath = [string]$hostInput.resultPath
}
& $scriptPath @parameters
`;

const WINDOWS_UNINSTALL_LAUNCHER_SCRIPT = String.raw`$arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    $env:NEURO_BOOK_WINDOWS_UNINSTALL_HOST_COMMAND
)
$hostProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru
if ($null -eq $hostProcess -or $hostProcess.Id -le 0) { throw "Windows Uninstall Host launch failed." }
Write-Output $hostProcess.Id
`;

/** Host 只支持当前两种 Windows 可发行安装布局。 */
export type WindowsUninstallLayout = "installation-scoped" | "installed-windows";

/** Windows 外置 Uninstall Host 唯一接受的 durable intent。 */
export type WindowsUninstallIntent = Readonly<{
    schemaVersion: 1;
    token: string;
    layout: WindowsUninstallLayout;
    installationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    deleteData: boolean;
    createdAt: string;
}>;

/** 当前 Bun 位于 Installation Root 内时，Windows 不能由本进程同步删除它。 */
export function requiresWindowsUninstallHost(root: string, executable = process.execPath): boolean {
    return process.platform === "win32" && isSameOrWithin(resolve(root), resolve(executable));
}

/** 返回仍在等待外置 Host 完成的卸载 intent。 */
export async function pendingWindowsUninstall(root: string): Promise<WindowsUninstallIntent | null> {
    const path = resolve(root, INTENT_PATH);
    if (!await pathExists(path)) return null;
    return parseWindowsUninstallIntent(JSON.parse(await readFile(path, "utf8")), resolve(root));
}

/**
 * 写入 intent 并启动 Installation Root 外的 PowerShell Host。
 *
 * Host 等待当前 Manager PID 退出，重新核对 intent token 后才删除；调用方必须仍
 * 持有 Installation lease，确保 intent 发布与 Host 启动之间没有其他 mutation。
 */
export async function scheduleWindowsUninstall(input: {
    root: string;
    layout: WindowsUninstallLayout;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    deleteData: boolean;
    parentPid?: number;
    intent?: WindowsUninstallIntent;
}): Promise<{intent: WindowsUninstallIntent; resultPath: string}> {
    if (process.platform !== "win32") throw new Error("Windows Uninstall Host 只能在 Windows 上启动。" );
    const root = resolve(input.root);
    const intent = input.intent ?? Object.freeze({
        schemaVersion: 1 as const,
        token: randomUUID(),
        layout: input.layout,
        installationRoot: root,
        stateRoot: resolve(input.stateRoot),
        cacheRoot: resolve(input.cacheRoot),
        desktopRoot: resolve(input.desktopRoot),
        deleteData: input.deleteData,
        createdAt: new Date().toISOString(),
    });
    assertWindowsUninstallIntent(intent, root);
    if (
        intent.layout !== input.layout
        || !samePath(intent.stateRoot, input.stateRoot)
        || !samePath(intent.cacheRoot, input.cacheRoot)
        || !samePath(intent.desktopRoot, input.desktopRoot)
        || intent.deleteData !== input.deleteData
    ) {
        throw new Error("待完成的 Windows uninstall intent 与当前卸载请求不一致。" );
    }
    const intentPath = resolve(root, INTENT_PATH);
    const hostRoot = resolve(localAppDataRoot(), "NeuroBook", "uninstall-hosts", intent.token);
    const resultRoot = resolve(localAppDataRoot(), "NeuroBook", "uninstall-results");
    if (isSameOrWithin(root, hostRoot) || isSameOrWithin(root, resultRoot)) {
        throw new Error("Windows Uninstall Host 与结果目录必须位于 Installation Root 外。" );
    }
    const resultPath = resolve(resultRoot, `${intent.token}.json`);
    const scriptPath = resolve(hostRoot, "uninstall.ps1");
    await ensureDirectory(hostRoot);
    await ensureDirectory(resultRoot);
    if (input.intent) {
        const current = await pendingWindowsUninstall(root);
        if (!current || !sameIntent(current, intent)) {
            throw new Error("待完成的 Windows uninstall intent 已被修改。" );
        }
    } else {
        await writeJsonAtomic(intentPath, intent);
    }
    const intentSha256 = await sha256File(intentPath);
    await writeFile(scriptPath, WINDOWS_UNINSTALL_HOST_SCRIPT, "utf8");
    try {
        const hostInput = JSON.stringify({
            scriptPath,
            parentPid: input.parentPid ?? process.pid,
            intentPath,
            expectedToken: intent.token,
            expectedRoot: root,
            expectedIntentSha256: intentSha256,
            resultPath,
        });
        const hostCommand = Buffer.from(WINDOWS_UNINSTALL_HOST_BOOTSTRAP, "utf16le").toString("base64");
        await runCapture("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WINDOWS_UNINSTALL_LAUNCHER_SCRIPT,
        ], {
            env: {
                ...process.env,
                [HOST_COMMAND_ENVIRONMENT]: hostCommand,
                [HOST_INPUT_ENVIRONMENT]: hostInput,
            },
        });
    } catch (error) {
        if (!input.intent) await rm(intentPath, {force: true});
        await rm(hostRoot, {recursive: true, force: true});
        throw error;
    }
    return {intent, resultPath};
}

/** 测试与审计共用的固定 Host 脚本；业务路径只通过参数和 intent JSON 进入。 */
export const WINDOWS_UNINSTALL_HOST_SCRIPT = String.raw`param(
    [Parameter(Mandatory=$true)][int]$ParentPid,
    [Parameter(Mandatory=$true)][string]$IntentPath,
    [Parameter(Mandatory=$true)][string]$ExpectedToken,
    [Parameter(Mandatory=$true)][string]$ExpectedRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedIntentSha256,
    [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference = "Stop"
function Resolve-CanonicalPath([string]$Value) {
    return [IO.Path]::GetFullPath($Value).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}
function Test-SamePath([string]$Left, [string]$Right) {
    return [string]::Equals((Resolve-CanonicalPath $Left), (Resolve-CanonicalPath $Right), [StringComparison]::OrdinalIgnoreCase)
}
function Test-SameOrWithin([string]$Root, [string]$Target) {
    $canonicalRoot = Resolve-CanonicalPath $Root
    $canonicalTarget = Resolve-CanonicalPath $Target
    if ([string]::Equals($canonicalRoot, $canonicalTarget, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $canonicalTarget.StartsWith($canonicalRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Add-LongPathPrefix([string]$Path) {
    if ($Path.StartsWith('\\?\')) { return $Path }
    return '\\?\' + $Path
}

function Strip-LongPathPrefix([string]$Path) {
    if ($Path.StartsWith('\\?\')) { return $Path.Substring(4) }
    return $Path
}

function Remove-OwnedPath([string]$Path) {
    # Deep trees (e.g. product-runtime cache) can exceed MAX_PATH (260);
    # the \\?\ prefix enables long-path deletion. Script must stay ASCII:
    # Windows PowerShell 5.1 misparses non-ASCII comments in BOM-less UTF-8.
    $longPath = Add-LongPathPrefix $Path
    if (Test-Path -LiteralPath $longPath) { Remove-Item -LiteralPath $longPath -Recurse -Force -ErrorAction Stop }
}

function Remove-TreeExcept([string]$Current, [string]$Preserve) {
    if (Test-SamePath $Current $Preserve) { return }
    foreach ($entry in @(Get-ChildItem -LiteralPath (Add-LongPathPrefix $Current) -Force -ErrorAction Stop)) {
        $target = Resolve-CanonicalPath (Strip-LongPathPrefix $entry.FullName)
        $preserveCanonical = Resolve-CanonicalPath $Preserve
        if (Test-SamePath $target $preserveCanonical) { continue }
        if (Test-SameOrWithin $target $preserveCanonical) {
            Remove-TreeExcept $target $preserveCanonical
        } else {
            Remove-Item -LiteralPath (Add-LongPathPrefix $target) -Recurse -Force -ErrorAction Stop
        }
    }
}
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}
function Write-HostResult([hashtable]$Result) {
    $resultDirectory = [IO.Path]::GetDirectoryName($ResultPath)
    New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
    $temporaryResult = Join-Path $resultDirectory ("." + [IO.Path]::GetFileName($ResultPath) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
    try {
        $Result | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryResult -Encoding UTF8
        Move-Item -LiteralPath $temporaryResult -Destination $ResultPath -Force
    } finally {
        Remove-Item -LiteralPath $temporaryResult -Force -ErrorAction SilentlyContinue
    }
}
try {
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for the parent Manager process to exit." }
        Start-Sleep -Milliseconds 200
    }
    $actualIntentSha256 = Get-Sha256 $IntentPath
    if ($actualIntentSha256 -ne $ExpectedIntentSha256.ToLowerInvariant()) { throw "The uninstall intent digest does not match." }
    $intent = Get-Content -LiteralPath $IntentPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($intent.schemaVersion -ne 1 -or $intent.token -ne $ExpectedToken) { throw "The uninstall intent identity does not match." }
    $root = Resolve-CanonicalPath ([string]$intent.installationRoot)
    $state = Resolve-CanonicalPath ([string]$intent.stateRoot)
    $cache = Resolve-CanonicalPath ([string]$intent.cacheRoot)
    $desktop = Resolve-CanonicalPath ([string]$intent.desktopRoot)
    if (-not (Test-SamePath $root $ExpectedRoot)) { throw "The uninstall Installation Root does not match." }
    if (-not (Test-SamePath $IntentPath (Join-Path $root ".deploy\uninstall-intent.json"))) {
        throw "The uninstall intent path is not owned by the Installation Root."
    }
    if (Test-SameOrWithin $root $ResultPath) { throw "The uninstall result path must be outside the Installation Root." }
    if ($intent.layout -eq "installation-scoped") {
        foreach ($ownedPath in @($state, $cache, $desktop)) {
            if (-not (Test-SameOrWithin $root $ownedPath)) { throw "An installation-scoped uninstall path escapes the Installation Root." }
        }
    } elseif ($intent.layout -eq "installed-windows") {
        $localAppData = Resolve-CanonicalPath $env:LOCALAPPDATA
        $programFiles = if ($env:ProgramFiles) { Resolve-CanonicalPath $env:ProgramFiles } else { Resolve-CanonicalPath (Join-Path $env:SystemDrive "Program Files") }
        $programRoots = @(
            (Join-Path $localAppData "Programs\NeuroBook"),
            (Join-Path $programFiles "NeuroBook")
        )
        if (-not ($programRoots | Where-Object { Test-SamePath $root $_ })) { throw "The Installed Windows program root does not match." }
        if (-not (Test-SamePath $state (Join-Path $localAppData "NeuroBook\data"))) { throw "The Installed Windows State Root does not match." }
        if (-not (Test-SamePath $cache (Join-Path $localAppData "NeuroBook\cache"))) { throw "The Installed Windows Cache Root does not match." }
        if (-not (Test-SamePath $desktop (Join-Path $localAppData "NeuroBook\desktop"))) { throw "The Installed Windows Desktop Root does not match." }
    } else {
        throw "The uninstall layout is invalid."
    }
    # Remove the Programs and Features launcher root created at install time.
    # The Programs and Features launcher deletes itself after running, but the
    # CLI/external-Host uninstall path has no launcher self-cleanup.
    # installationId lives in the Desktop Installation Manifest (desktop root).
    $installationManifestPath = Join-Path $desktop "desktop-installation.json"
    if (Test-Path -LiteralPath (Add-LongPathPrefix $installationManifestPath)) {
        $installationManifest = Get-Content -LiteralPath (Add-LongPathPrefix $installationManifestPath) -Raw -Encoding UTF8 | ConvertFrom-Json
        $installationId = [string]$installationManifest.installationId
        if ($installationId -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') {
            $launcherRoot = Join-Path $env:LOCALAPPDATA ("NeuroBook\manager\uninstall\" + $installationId)
            Remove-OwnedPath $launcherRoot
        }
    }
    if ($intent.deleteData) {
        if ($intent.layout -eq "installed-windows") {
            Remove-OwnedPath $desktop
            Remove-OwnedPath $cache
            Remove-OwnedPath $state
        }
        Remove-OwnedPath $root
    } else {
        Remove-OwnedPath $cache
        Remove-OwnedPath $desktop
        Remove-OwnedPath (Join-Path $state "logs")
        if (Test-SameOrWithin $root $state) {
            Remove-TreeExcept $root $state
        } else {
            Remove-OwnedPath $root
        }
    }
    $result = @{ok=$true; token=$ExpectedToken; installationRoot=$root; completedAt=[DateTime]::UtcNow.ToString("o")}
    Write-HostResult $result
    Remove-Item -LiteralPath $PSScriptRoot -Recurse -Force -ErrorAction SilentlyContinue
} catch {
    $result = @{ok=$false; token=$ExpectedToken; error=$_.Exception.Message; completedAt=[DateTime]::UtcNow.ToString("o")}
    Write-HostResult $result
    exit 1
}
`;

function parseWindowsUninstallIntent(value: unknown, root: string): WindowsUninstallIntent {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Windows uninstall intent 不是对象。" );
    const record = value as Partial<WindowsUninstallIntent>;
    if (
        record.schemaVersion !== 1
        || typeof record.token !== "string"
        || !/^[0-9a-f-]{36}$/iu.test(record.token)
        || (record.layout !== "installation-scoped" && record.layout !== "installed-windows")
        || typeof record.installationRoot !== "string"
        || typeof record.stateRoot !== "string"
        || typeof record.cacheRoot !== "string"
        || typeof record.desktopRoot !== "string"
        || typeof record.deleteData !== "boolean"
        || typeof record.createdAt !== "string"
    ) {
        throw new Error("Windows uninstall intent 字段无效。" );
    }
    const intent: WindowsUninstallIntent = Object.freeze({
        schemaVersion: 1,
        token: record.token,
        layout: record.layout,
        installationRoot: record.installationRoot,
        stateRoot: record.stateRoot,
        cacheRoot: record.cacheRoot,
        desktopRoot: record.desktopRoot,
        deleteData: record.deleteData,
        createdAt: record.createdAt,
    });
    assertWindowsUninstallIntent(intent, root);
    return intent;
}

function assertWindowsUninstallIntent(intent: WindowsUninstallIntent, root: string): void {
    if (!samePath(intent.installationRoot, root)) throw new Error("Windows uninstall intent 的 Installation Root 不一致。" );
    if (intent.layout === "installation-scoped") {
        for (const path of [intent.stateRoot, intent.cacheRoot, intent.desktopRoot]) {
            if (!isSameOrWithin(root, path)) throw new Error(`Windows uninstall 路径越出 Installation Root：${path}`);
        }
        return;
    }
    const allowedProgramRoots = [
        resolve(localAppDataRoot(), "Programs", "NeuroBook"),
        resolve(process.env.ProgramFiles ?? join(process.env.SystemDrive ?? "C:", "Program Files"), "NeuroBook"),
    ];
    const expectedRoots = resolveInstallationRoots(allowedProgramRoots[0]!, INSTALLED_WINDOWS_ROOT_LOCATORS);
    if (
        !allowedProgramRoots.some((candidate) => samePath(root, candidate))
        || !samePath(intent.stateRoot, expectedRoots.state)
        || !samePath(intent.cacheRoot, expectedRoots.cache)
        || !samePath(intent.desktopRoot, expectedRoots.desktop)
    ) {
        throw new Error("Windows Installed uninstall intent 不符合固定 owner 布局。" );
    }
}

function sameIntent(left: WindowsUninstallIntent, right: WindowsUninstallIntent): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.token === right.token
        && left.layout === right.layout
        && samePath(left.installationRoot, right.installationRoot)
        && samePath(left.stateRoot, right.stateRoot)
        && samePath(left.cacheRoot, right.cacheRoot)
        && samePath(left.desktopRoot, right.desktopRoot)
        && left.deleteData === right.deleteData
        && left.createdAt === right.createdAt;
}

function samePath(left: string, right: string): boolean {
    return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function isSameOrWithin(root: string, target: string): boolean {
    const path = relative(resolve(root), resolve(target));
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
