[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$ManagerTag = "canary",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ManagerArgs
)

$ErrorActionPreference = "Stop"
$stage0Script = Join-Path $PSScriptRoot "windows-bun-stage0.ps1"
if (-not (Test-Path -LiteralPath $stage0Script -PathType Leaf)) {
    throw "找不到 NeuroBook Bun Stage 0：$stage0Script"
}
. $stage0Script
$nativeArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($nativeArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
    throw "NeuroBook Manager v1 Stage 0 只支持原生 Windows x64，检测到：$nativeArchitecture。"
}
$bunExe = Ensure-NeuroBookBun -AllowDownload -RequirePinnedRuntime -UseAsStage0
& $bunExe x --bun "@notnotype/neuro-book-manager@$ManagerTag" install @ManagerArgs
exit $LASTEXITCODE
