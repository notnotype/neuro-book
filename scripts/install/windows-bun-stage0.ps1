[CmdletBinding()]
param()

# This file is dot-sourced by the Windows install entry points.  It deliberately
# has no top-level installation side effects so the Desktop entry can prepare
# Bun without running the ordinary Manager installation flow first.

$script:NeuroBookBunVersion = "1.3.14"
$script:NeuroBookBunAssetUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$($script:NeuroBookBunVersion)/bun-windows-x64.zip"
$script:NeuroBookBunArchiveSha256 = "0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922"
$script:NeuroBookBunSha256 = "0187f68d843f825a72ada4a7eca60db896ed753759a7f8252edcd31ac1bf1b9c"

function Get-NeuroBookLocalAppData {
    if ($env:LOCALAPPDATA) { return $env:LOCALAPPDATA }
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE "AppData\Local") }
    throw "找不到 Windows Local AppData 根目录。"
}

function Test-NeuroBookBunExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [switch]$RequirePinnedDigest
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $version = (& $Path --version 2>$null).Trim()
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+(?:\.\d+)?$') { return $false }
        $parsedVersion = [version]$version
        if ($parsedVersion -lt [version]"1.3.0") { return $false }
        if ($RequirePinnedDigest) {
            $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $script:NeuroBookBunSha256) { return $false }
            if ($version -ne $script:NeuroBookBunVersion) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

function Set-NeuroBookStage0Environment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$ArchiveSha256,
        [Parameter(Mandatory = $true)]
        [string]$ExecutableSha256
    )

    $env:NEURO_BOOK_STAGE0_BUN_PATH = $Path
    $env:NEURO_BOOK_STAGE0_BUN_VERSION = $Version
    $env:NEURO_BOOK_STAGE0_BUN_SOURCE_URL = $Source
    $env:NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256 = $ArchiveSha256
    $env:NEURO_BOOK_STAGE0_BUN_SHA256 = $ExecutableSha256
}

function Clear-NeuroBookStage0Environment {
    foreach ($name in @(
        "NEURO_BOOK_STAGE0_BUN_PATH",
        "NEURO_BOOK_STAGE0_BUN_VERSION",
        "NEURO_BOOK_STAGE0_BUN_SOURCE_URL",
        "NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256",
        "NEURO_BOOK_STAGE0_BUN_SHA256"
    )) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
}

function Ensure-NeuroBookBun {
    [CmdletBinding()]
    param(
        [string]$ExplicitPath,
        [switch]$AllowDownload,
        [switch]$RequirePinnedRuntime,
        [switch]$UseAsStage0
    )

    $candidate = $ExplicitPath
    $candidateSource = "explicit"
    if (-not $candidate -and $env:NEURO_BOOK_STAGE0_BUN_PATH) {
        $candidate = $env:NEURO_BOOK_STAGE0_BUN_PATH
        $candidateSource = "stage0"
    }
    if (-not $candidate) {
        $command = Get-Command bun.exe -ErrorAction SilentlyContinue
        if ($command) {
            $candidate = $command.Source
            $candidateSource = "path"
        }
    }

    if ($candidate) {
        try {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            if (Test-NeuroBookBunExecutable -Path $resolved -RequirePinnedDigest:$RequirePinnedRuntime) {
                $version = (& $resolved --version 2>$null).Trim()
                $hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
                $source = if ($candidateSource -eq "stage0" -and $env:NEURO_BOOK_STAGE0_BUN_SOURCE_URL) {
                    $env:NEURO_BOOK_STAGE0_BUN_SOURCE_URL
                } else { "local:$candidateSource" }
                $archiveHash = if ($candidateSource -eq "stage0" -and $env:NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256) {
                    $env:NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256
                } else { $hash }
                if ($UseAsStage0) {
                    Set-NeuroBookStage0Environment -Path $resolved -Version $version -Source $source -ArchiveSha256 $archiveHash -ExecutableSha256 $hash
                }
                return $resolved
            }
        } catch {
            # An invalid explicit/PATH candidate is treated like a missing runtime
            # so the caller can either download the pinned Stage 0 or fail closed.
        }
    }

    if (-not $AllowDownload) {
        throw "找不到有效 Bun Runtime。请先运行 scripts/install/install.ps1 准备 Bun，或通过 -BunPath 传入 bun.exe。"
    }

    $cacheRoot = Join-Path (Get-NeuroBookLocalAppData) "NeuroBook\manager\runtime\bun\$($script:NeuroBookBunVersion)"
    $bunExe = Join-Path $cacheRoot "bun-windows-x64\bun.exe"
    if (-not (Test-NeuroBookBunExecutable -Path $bunExe -RequirePinnedDigest)) {
        Remove-Item -LiteralPath $cacheRoot -Recurse -Force -ErrorAction SilentlyContinue
        $stage = Join-Path ([System.IO.Path]::GetTempPath()) "neuro-book-stage0-$([guid]::NewGuid())"
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        try {
            $archive = Join-Path $stage "bun-windows-x64.zip"
            Invoke-WebRequest -Uri $script:NeuroBookBunAssetUrl -OutFile $archive
            $actualArchive = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualArchive -ne $script:NeuroBookBunArchiveSha256) {
                throw "Bun archive SHA256 校验失败。"
            }
            New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
            Expand-Archive -LiteralPath $archive -DestinationPath $cacheRoot -Force
        } finally {
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not (Test-NeuroBookBunExecutable -Path $bunExe -RequirePinnedDigest)) {
        Remove-Item -LiteralPath $cacheRoot -Recurse -Force -ErrorAction SilentlyContinue
        throw "NeuroBook Stage 0 Bun executable 校验失败：$bunExe"
    }
    if ($UseAsStage0) {
        Set-NeuroBookStage0Environment -Path $bunExe -Version $script:NeuroBookBunVersion -Source $script:NeuroBookBunAssetUrl -ArchiveSha256 $script:NeuroBookBunArchiveSha256 -ExecutableSha256 $script:NeuroBookBunSha256
    }
    return $bunExe
}
