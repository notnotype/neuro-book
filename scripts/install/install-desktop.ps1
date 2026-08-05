[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $false)]
    [string]$Archive,
    [string]$ShellArchive,
    [ValidateSet("electron", "tauri")]
    [string]$Envelope = "electron",
    [ValidateSet("stable", "canary")]
    [string]$Channel = "canary",
    [string]$Remote,
    [switch]$AllowInsecureHttp,
    [string]$InstallRoot,
    [string]$ManagerPath,
    [string]$BunPath,
    [ValidateSet("managed")]
    [string]$RuntimeProvider = "managed",
    [ValidateSet("managed")]
    [string]$ToolProvider = "managed",
    [switch]$AddCliToPath,
    [switch]$PasswordStdin,
    [switch]$Yes,
    [string]$ManagerTag = "canary"
)

$ErrorActionPreference = "Stop"

function Resolve-Bun {
    param([string]$ExplicitPath)
    $candidate = $ExplicitPath
    if (-not $candidate -and $env:NEURO_BOOK_STAGE0_BUN_PATH) { $candidate = $env:NEURO_BOOK_STAGE0_BUN_PATH }
    if (-not $candidate) {
        $command = Get-Command bun.exe -ErrorAction SilentlyContinue
        if ($command) { $candidate = $command.Source }
    }
    if (-not $candidate) {
        throw "找不到 Bun Runtime。先运行 scripts/install/install.ps1 准备 Bun，或通过 -BunPath 传入 bun.exe。"
    }
    $resolved = (Resolve-Path -LiteralPath $candidate).Path
    $version = (& $resolved --version 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^1\.[3-9]\.') {
        throw "Bun Runtime 版本必须为 1.3 或更新版本，当前为：$version"
    }
    return $resolved
}

if ($Remote -and (-not $ShellArchive -or $Archive)) {
    throw "远端 Desktop 安装必须只传 -ShellArchive；它不携带 Product、Bun 或 Tool Pack。"
}
if (-not $Remote -and (-not $Archive -or $ShellArchive)) {
    throw "本地 Desktop 安装必须只传 -Archive；它需要完整 Product Portable。"
}
$bun = Resolve-Bun -ExplicitPath $BunPath
$managerOptions = @(
    "desktop", "install",
    "--envelope", $Envelope,
    "--channel", $Channel,
    "--runtime-provider", $RuntimeProvider,
    "--tool-provider", $ToolProvider
)
if ($Archive) { $managerOptions += @("--archive", (Resolve-Path -LiteralPath $Archive).Path) }
if ($ShellArchive) { $managerOptions += @("--shell-archive", (Resolve-Path -LiteralPath $ShellArchive).Path) }
if ($Remote) { $managerOptions += @("--remote", $Remote) }
if ($AllowInsecureHttp) { $managerOptions += "--allow-insecure-http" }
if ($InstallRoot) { $managerOptions += @("--dir", $InstallRoot) }
if ($AddCliToPath) { $managerOptions += "--add-cli-to-path" }
if ($PasswordStdin) { $managerOptions += "--password-stdin" }
if ($Yes) { $managerOptions += "--yes" }

$env:BUN_INSTALL_CACHE_DIR = Join-Path ($env:LOCALAPPDATA ?? (Join-Path $HOME "AppData\Local")) "NeuroBook\manager\bun\install"
if ($ManagerPath) {
    $manager = (Resolve-Path -LiteralPath $ManagerPath).Path
    & $bun --no-install $manager @managerOptions
} else {
    & $bun x --bun "@notnotype/neuro-book-manager@$ManagerTag" @managerOptions
}
exit $LASTEXITCODE
