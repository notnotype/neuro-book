[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $false)]
    [string]$Archive,
    [string]$Depot,
    [string]$ShellArchive,
    [string]$DistributionManifest,
    [string]$DistributionManifestUrl,
    [ValidateSet("electron")]
    [string]$Envelope = "electron",
    [ValidateSet("user", "machine")]
    [string]$Scope = "user",
    [ValidateSet("stable", "canary")]
    [string]$Channel = "canary",
    [string]$Remote,
    [switch]$AllowInsecureHttp,
    [string]$InstallRoot,
    [string]$ManagerPath,
    [string]$BunPath,
    [ValidateSet("managed", "system")]
    [string]$RuntimeProvider = "managed",
    [ValidateSet("managed", "system")]
    [string]$GitProvider = "managed",
    [ValidateSet("managed", "system")]
    [string]$RgProvider = "managed",
    [switch]$AddCliToPath,
    [switch]$PasswordStdin,
    [switch]$EnableAuth,
    [switch]$Yes,
    [string]$ManagerTag = "canary"
)

$ErrorActionPreference = "Stop"

function Test-NeuroBookAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Scope -eq "machine" -and -not (Test-NeuroBookAdministrator)) {
    if ($PasswordStdin) {
        throw "machine scope + PasswordStdin 需要由已提升的 PowerShell 直接运行，以保留密码 stdin；请先以管理员身份重试。"
    }
    $forwarded = @{}
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        $forwarded[$entry.Key] = $entry.Value
    }
    $forwarded["Scope"] = "machine"
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath)
    foreach ($entry in $forwarded.GetEnumerator()) {
        if ($entry.Value -is [System.Management.Automation.SwitchParameter]) {
            if ($entry.Value.IsPresent) { $arguments += "-$($entry.Key)" }
        } else {
            $arguments += "-$($entry.Key)"
            $arguments += [string]$entry.Value
        }
    }
    Start-Process -FilePath "pwsh.exe" -Verb RunAs -ArgumentList $arguments | Out-Null
    exit 0
}

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

function Test-NeuroBookPortableEntryPath {
    param([string]$Value)
    if (-not $Value -or [System.IO.Path]::IsPathRooted($Value) -or $Value.Contains("`0")) {
        return $false
    }
    $segments = $Value.Replace("\", "/").Split("/")
    return -not ($segments | Where-Object { -not $_ -or $_ -eq "." -or $_ -eq ".." })
}

function Copy-NeuroBookZipEntry {
    param(
        [System.IO.Compression.ZipArchiveEntry]$Entry,
        [string]$Destination
    )
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $inputStream = $Entry.Open()
    try {
        $outputStream = [System.IO.File]::Open(
            $Destination,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $inputStream.CopyTo($outputStream)
        } finally {
            $outputStream.Dispose()
        }
    } finally {
        $inputStream.Dispose()
    }
}

function Initialize-NeuroBookOfflineBootstrap {
    param([string]$PortableArchive)
    $archivePath = (Resolve-Path -LiteralPath $PortableArchive).Path
    $archiveInfo = Get-Item -LiteralPath $archivePath
    if (-not $archiveInfo.PSIsContainer -and $archiveInfo.Length -gt 0) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            $manifestEntry = $zip.GetEntry(".deploy/installation.json")
            if (-not $manifestEntry -or $manifestEntry.Length -le 0 -or $manifestEntry.Length -gt 2MB) {
                throw "离线 Portable 缺少有界的 .deploy/installation.json。"
            }
            $reader = New-Object System.IO.StreamReader($manifestEntry.Open(), [System.Text.Encoding]::UTF8, $true)
            try {
                $manifest = $reader.ReadToEnd() | ConvertFrom-Json
            } finally {
                $reader.Dispose()
            }
            if ($manifest.schemaVersion -ne 5 -or $manifest.profile -ne "windows-portable") {
                throw "离线 Bootstrap 只接受 Installation Manifest v5 的 Windows Portable。"
            }
            $manager = $manifest.components.manager
            $runtime = $manifest.components.managerRuntime
            if ($manager.provider -ne "managed" -or $runtime.provider -ne "managed") {
                throw "离线 Bootstrap 需要 Portable 自带的 managed Manager 与 Bun。"
            }
            $managerPath = [string]$manager.path
            $runtimePath = [string]$runtime.path
            $managerHash = ([string]$manager.bundleSha256).ToLowerInvariant()
            $runtimeHash = ([string]$runtime.executableSha256).ToLowerInvariant()
            if (-not (Test-NeuroBookPortableEntryPath $managerPath) `
                -or -not (Test-NeuroBookPortableEntryPath $runtimePath) `
                -or $managerHash -notmatch "^[0-9a-f]{64}$" `
                -or $runtimeHash -notmatch "^[0-9a-f]{64}$") {
                throw "离线 Portable 的 Manager/Bun 路径或摘要无效。"
            }
            $managerEntry = $zip.GetEntry($managerPath.Replace("\", "/"))
            $runtimeEntry = $zip.GetEntry($runtimePath.Replace("\", "/"))
            if (-not $managerEntry -or $managerEntry.Length -le 0 -or $managerEntry.Length -gt 64MB) {
                throw "离线 Portable 的 Manager bundle 缺失或超过 64 MiB。"
            }
            if (-not $runtimeEntry -or $runtimeEntry.Length -le 0 -or $runtimeEntry.Length -gt 256MB) {
                throw "离线 Portable 的 Bun Runtime 缺失或超过 256 MiB。"
            }

            $managerLocalAppData = $env:LOCALAPPDATA
            if (-not $managerLocalAppData) {
                $managerLocalAppData = Join-Path $HOME "AppData\Local"
            }
            $bootstrapParent = Join-Path $managerLocalAppData "NeuroBook\manager\bootstrap"
            $bootstrapRoot = Join-Path $bootstrapParent ($runtimeHash + "-" + $managerHash)
            $bunTarget = Join-Path $bootstrapRoot "bun.exe"
            $managerTarget = Join-Path $bootstrapRoot "neuro-book.mjs"
            $existingValid = (Test-Path -LiteralPath $bunTarget -PathType Leaf) `
                -and (Test-Path -LiteralPath $managerTarget -PathType Leaf) `
                -and ((Get-FileHash -LiteralPath $bunTarget -Algorithm SHA256).Hash.ToLowerInvariant() -eq $runtimeHash) `
                -and ((Get-FileHash -LiteralPath $managerTarget -Algorithm SHA256).Hash.ToLowerInvariant() -eq $managerHash)
            if (-not $existingValid) {
                New-Item -ItemType Directory -Path $bootstrapParent -Force | Out-Null
                if (Test-Path -LiteralPath $bootstrapRoot) {
                    Remove-Item -LiteralPath $bootstrapRoot -Recurse -Force
                }
                $staging = Join-Path $bootstrapParent (".stage-" + [Guid]::NewGuid().ToString("N"))
                New-Item -ItemType Directory -Path $staging | Out-Null
                try {
                    Copy-NeuroBookZipEntry -Entry $runtimeEntry -Destination (Join-Path $staging "bun.exe")
                    Copy-NeuroBookZipEntry -Entry $managerEntry -Destination (Join-Path $staging "neuro-book.mjs")
                    if ((Get-FileHash -LiteralPath (Join-Path $staging "bun.exe") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeHash `
                        -or (Get-FileHash -LiteralPath (Join-Path $staging "neuro-book.mjs") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $managerHash) {
                        throw "离线 Portable 的 Manager/Bun checksum 不匹配。"
                    }
                    try {
                        Move-Item -LiteralPath $staging -Destination $bootstrapRoot
                        $staging = $null
                    } catch {
                        $racedValid = (Test-Path -LiteralPath $bunTarget -PathType Leaf) `
                            -and (Test-Path -LiteralPath $managerTarget -PathType Leaf) `
                            -and ((Get-FileHash -LiteralPath $bunTarget -Algorithm SHA256).Hash.ToLowerInvariant() -eq $runtimeHash) `
                            -and ((Get-FileHash -LiteralPath $managerTarget -Algorithm SHA256).Hash.ToLowerInvariant() -eq $managerHash)
                        if (-not $racedValid) { throw }
                    }
                } finally {
                    if ($staging -and (Test-Path -LiteralPath $staging)) {
                        Remove-Item -LiteralPath $staging -Recurse -Force
                    }
                }
            }
            $version = (& $bunTarget --version | Select-Object -First 1).Trim()
            if ($LASTEXITCODE -ne 0 -or $version -ne [string]$runtime.version) {
                throw "离线 Portable 的 Bun 版本无法验证。"
            }
            return [pscustomobject]@{BunPath=$bunTarget; ManagerPath=$managerTarget}
        } finally {
            $zip.Dispose()
        }
    }
    throw "离线 Bootstrap 需要非空的 Portable ZIP。"
}

$depotCount = 0
if ($Archive) { $depotCount++ }
if ($Depot) { $depotCount++ }
if ($ShellArchive) { $depotCount++ }
if ($DistributionManifest) { $depotCount++ }
if ($DistributionManifestUrl) { $depotCount++ }
if ($depotCount -ne 1) {
    throw "Desktop 安装必须且只能传 -Archive、-Depot、-ShellArchive、-DistributionManifest 或 -DistributionManifestUrl 之一。"
}
if ($Remote -and $Archive) {
    throw "远端 Desktop 安装不能传 -Archive；它不携带 Product、Bun 或 Tool Pack。"
}
if ($Remote -and $Depot) {
    throw "远端 Desktop 安装不能传 -Depot；它包含本地 Product。"
}
if (-not $Remote -and $ShellArchive) {
    throw "本地 Desktop 安装不能传 -ShellArchive；它需要完整 Product Portable 或 distribution manifest。"
}

$offlinePortable = $null
if (-not $Remote -and $Archive) {
    $offlinePortable = $Archive
} elseif (-not $Remote -and ($Depot -or $DistributionManifest)) {
    $sourceRoot = if ($Depot) { Split-Path -Parent (Resolve-Path -LiteralPath $Depot).Path } else { Split-Path -Parent (Resolve-Path -LiteralPath $DistributionManifest).Path }
    $candidate = Join-Path $sourceRoot "neuro-book-electron-portable-win-x64.zip"
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $candidate = Join-Path $PSScriptRoot "neuro-book-electron-portable-win-x64.zip"
    }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $offlinePortable = $candidate
    }
}
if ($offlinePortable -and (-not $BunPath -or -not $ManagerPath)) {
    $offlineBootstrap = Initialize-NeuroBookOfflineBootstrap -PortableArchive $offlinePortable
    if (-not $BunPath) { $BunPath = $offlineBootstrap.BunPath }
    if (-not $ManagerPath) { $ManagerPath = $offlineBootstrap.ManagerPath }
}

$bun = Resolve-Bun -ExplicitPath $BunPath
$managerOptions = @(
    "desktop", "install",
    "--envelope", $Envelope,
    "--scope", $Scope,
    "--channel", $Channel,
    "--runtime-provider", $RuntimeProvider,
    "--git-provider", $GitProvider,
    "--rg-provider", $RgProvider
)
if ($Archive) { $managerOptions += @("--archive", (Resolve-Path -LiteralPath $Archive).Path) }
if ($Depot) { $managerOptions += @("--depot", (Resolve-Path -LiteralPath $Depot).Path) }
if ($ShellArchive) { $managerOptions += @("--shell-archive", (Resolve-Path -LiteralPath $ShellArchive).Path) }
if ($DistributionManifest) { $managerOptions += @("--distribution-manifest", (Resolve-Path -LiteralPath $DistributionManifest).Path) }
if ($DistributionManifestUrl) { $managerOptions += @("--distribution-manifest-url", $DistributionManifestUrl) }
if ($Remote) { $managerOptions += @("--remote", $Remote) }
if ($AllowInsecureHttp) { $managerOptions += "--allow-insecure-http" }
if ($InstallRoot) { $managerOptions += @("--dir", $InstallRoot) }
if ($AddCliToPath) { $managerOptions += "--add-cli-to-path" }
if ($PasswordStdin) { $managerOptions += "--password-stdin" }
if ($EnableAuth) { $managerOptions += "--enable-auth" }
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
