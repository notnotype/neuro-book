[CmdletBinding()]
param(
    [string]$DepotDirectory = "",
    [string]$TargetRoot = "C:\Users\Public\Documents\NeuroBookAcceptance"
)

$ErrorActionPreference = "Stop"

$expectedSha256 = "968cba7440921c7c2ab54e278b1619285900346047f18f0b96f836eef709ac1a"

if (-not $DepotDirectory) {
    $DepotDirectory = Join-Path $PSScriptRoot "..\..\..\..\..\.agent\tmp\t145-final-339853fb-package-a\output"
}
$depotRoot = (Resolve-Path -LiteralPath $DepotDirectory).Path
$depotZip = Join-Path $depotRoot "neuro-book-desktop-depot-win-x64.zip"
if (-not (Test-Path -LiteralPath $depotZip -PathType Leaf)) {
    throw "找不到 Depot ZIP：$depotZip"
}

$inputRoot = Join-Path $TargetRoot "t145-sandbox-input"
$evidenceRoot = Join-Path $TargetRoot "t145-sandbox-evidence"
New-Item -ItemType Directory -Path $inputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null

$actual = (Get-FileHash -LiteralPath $depotZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expectedSha256) {
    throw "Depot ZIP SHA-256 不匹配：实际 $actual，期望 $expectedSha256"
}

foreach ($name in @(
        "neuro-book-desktop-depot-win-x64.zip",
        "neuro-book-desktop-depot-win-x64.distribution.json",
        "neuro-book-desktop-depot-win-x64.manifest.json",
        "neuro-book-electron-portable-win-x64.manifest.json"
    )) {
    Copy-Item -LiteralPath (Join-Path $depotRoot $name) -Destination $inputRoot -Force
}

# Sandbox 内执行入口必须随输入一起映射（input 目录只读）。
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "run-sandbox-acceptance.ps1") -Destination $inputRoot -Force

$work = Join-Path $inputRoot "depot-extracted"
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
Expand-Archive -LiteralPath $depotZip -DestinationPath $work

$stage0 = Join-Path $work "windows-bun-stage0.ps1"
$installer = Join-Path $work "install-desktop.ps1"
if (-not (Test-Path -LiteralPath $stage0 -PathType Leaf)) { throw "Depot 缺少 windows-bun-stage0.ps1" }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Depot 缺少 install-desktop.ps1" }

Write-Output "Sandbox 输入已准备：$inputRoot"
Write-Output "Sandbox 证据输出：$evidenceRoot"
Write-Output "install-desktop.ps1：$installer"
