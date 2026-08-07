[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $false)]
    [string]$Archive,
    [string]$ShellArchive,
    [string]$DistributionManifest,
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
$stage0Script = Join-Path $PSScriptRoot "windows-bun-stage0.ps1"
if (-not (Test-Path -LiteralPath $stage0Script -PathType Leaf)) {
    throw "找不到 NeuroBook Bun Stage 0：$stage0Script"
}
. $stage0Script
Clear-NeuroBookStage0Environment

function Resolve-Bun {
    param([string]$ExplicitPath)
    return Ensure-NeuroBookBun -ExplicitPath $ExplicitPath -AllowDownload
}

$depotCount = 0
if ($Archive) { $depotCount++ }
if ($ShellArchive) { $depotCount++ }
if ($DistributionManifest) { $depotCount++ }
if ($depotCount -ne 1) {
    throw "Desktop 安装必须且只能传 -Archive、-ShellArchive 或 -DistributionManifest 之一。"
}
if ($Remote -and $Archive) {
    throw "远端 Desktop 安装不能传 -Archive；它不携带 Product、Bun 或 Tool Pack。"
}
if (-not $Remote -and $ShellArchive) {
    throw "本地 Desktop 安装不能传 -ShellArchive；它需要完整 Product Portable 或 distribution manifest。"
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
if ($DistributionManifest) { $managerOptions += @("--distribution-manifest", (Resolve-Path -LiteralPath $DistributionManifest).Path) }
if ($Remote) { $managerOptions += @("--remote", $Remote) }
if ($AllowInsecureHttp) { $managerOptions += "--allow-insecure-http" }
if ($InstallRoot) { $managerOptions += @("--dir", $InstallRoot) }
if ($AddCliToPath) { $managerOptions += "--add-cli-to-path" }
if ($PasswordStdin) { $managerOptions += "--password-stdin" }
if ($Yes) { $managerOptions += "--yes" }

$managerLocalAppData = $env:LOCALAPPDATA
if (-not $managerLocalAppData) {
    $managerLocalAppData = Join-Path $HOME "AppData\Local"
}
$env:BUN_INSTALL_CACHE_DIR = Join-Path $managerLocalAppData "NeuroBook\manager\bun\install"
if ($ManagerPath) {
    $manager = (Resolve-Path -LiteralPath $ManagerPath).Path
    & $bun --no-install $manager @managerOptions
} else {
    & $bun x --bun "@notnotype/neuro-book-manager@$ManagerTag" @managerOptions
}
exit $LASTEXITCODE
