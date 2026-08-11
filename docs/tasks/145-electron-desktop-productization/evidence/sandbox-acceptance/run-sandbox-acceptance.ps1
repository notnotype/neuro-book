[CmdletBinding()]
param(
    [string]$InputRoot = "C:\NeuroBook\input",
    [string]$EvidenceRoot = "C:\NeuroBook\evidence",
    [string]$WorkRoot = "C:\NeuroBook\work"
)

$ErrorActionPreference = "Stop"

$expectedSha256 = "968cba7440921c7c2ab54e278b1619285900346047f18f0b96f836eef709ac1a"
$evidencePath = Join-Path $EvidenceRoot "t145-sandbox-acceptance.json"
$events = [System.Collections.Generic.List[object]]::new()

function Add-Event {
    param([string]$Kind, [object]$Payload = $null)
    $events.Add(@{kind = $Kind; at = (Get-Date -Format o); payload = $Payload})
}

function Wait-NeuroBookInstalled {
    param([int]$TimeoutSeconds = 900)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $manifest = "C:\Program Files\NeuroBook\desktop\desktop-installation.json"
        $wrapper = "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd"
        if ((Test-Path -LiteralPath $manifest -PathType Leaf) -and (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
            return
        }
        Start-Sleep -Seconds 5
    }
    throw "等待 machine 安装完成超时（$TimeoutSeconds 秒）。"
}

function Wait-NeuroBookUninstalled {
    param([int]$TimeoutSeconds = 900)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-Path -LiteralPath "C:\Program Files\NeuroBook")) {
            return
        }
        Start-Sleep -Seconds 5
    }
    throw "等待 Programs and Features 卸载完成超时（$TimeoutSeconds 秒）。"
}

function Get-InstalledBunPath {
    $manifestPath = "C:\Program Files\NeuroBook\.deploy\installation.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $version = $manifest.components.managerRuntime.version
    $bun = "C:\Program Files\NeuroBook\.runtime\bun\$version\bun.exe"
    if (-not (Test-Path -LiteralPath $bun -PathType Leaf)) {
        throw "找不到安装的 Bun Runtime：$bun"
    }
    return $bun
}

# PS 5.1 的原生管道会给 stdin 无条件写入 UTF-8 BOM，Manager CLI 的 JSON
# 解析会失败；必须用无 BOM 文件 + cmd 重定向传递 stdin（宿主机已验证）。
function Invoke-ProviderCli {
    param([string[]]$Arguments)
    $wrapper = "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd"
    $jsonFile = Join-Path $WorkRoot "provider-input.json"
    [System.IO.File]::WriteAllText($jsonFile, $providerJson, [System.Text.UTF8Encoding]::new($false))
    $quoted = ($Arguments | ForEach-Object { "`"$_`"" }) -join " "
    $commandLine = "`"$wrapper`" $quoted < `"$jsonFile`""
    return cmd /c $commandLine 2>&1
}

function Start-FakeModelsServer {
    $serve = @"
Bun.serve({port:18473,hostname:'127.0.0.1',fetch(req){const u=new URL(req.url);if(u.pathname==='/models')return Response.json({data:[{id:'sandbox-fake-a'},{id:'sandbox-fake-b'}]});return new Response('not found',{status:404});}});setInterval(()=>{},1000);
"@
    $serverScript = Join-Path $WorkRoot "fake-models-server.js"
    [System.IO.File]::WriteAllText($serverScript, $serve, [System.Text.UTF8Encoding]::new($false))
    $bun = Get-InstalledBunPath
    $proc = Start-Process -FilePath $bun -ArgumentList @($serverScript) -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
    if ($proc.HasExited) {
        throw "假 /models 服务启动失败（exit $($proc.ExitCode)）。"
    }
    return $proc
}

Add-Event "started" @{inputRoot = $InputRoot; evidenceRoot = $EvidenceRoot}

# 1. 校验并解压 Depot。
$depotZip = Join-Path $InputRoot "neuro-book-desktop-depot-win-x64.zip"
$actual = (Get-FileHash -LiteralPath $depotZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expectedSha256) {
    throw "Depot ZIP SHA-256 不匹配：实际 $actual"
}
Add-Event "input-verified" @{sha256 = $actual}

$depot = Join-Path $WorkRoot "depot"
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
if (Test-Path -LiteralPath $depot) { Remove-Item -LiteralPath $depot -Recurse -Force }
Expand-Archive -LiteralPath $depotZip -DestinationPath $depot
Add-Event "depot-extracted" @{root = $depot}

# 2. 预创建外部 Project Workspace（卸载必须保留，不归安装器所有）。
$externalWorkspace = Join-Path $EvidenceRoot "ExternalProject"
New-Item -ItemType Directory -Path $externalWorkspace -Force | Out-Null
Set-Content -LiteralPath (Join-Path $externalWorkspace "marker.txt") -Value "sandbox-external-workspace" -Encoding utf8
Add-Event "external-workspace-created" @{path = $externalWorkspace}

# 3. machine 安装（用户在 Sandbox 桌面批准 UAC；脚本等待安装产物出现）。
Write-Host "请在 Sandbox 中打开【管理员 PowerShell】（右键以管理员身份运行，批准 UAC），然后执行：" -ForegroundColor Yellow
Write-Host "  & 'C:\NeuroBook\input\depot-extracted\install-desktop.ps1' -Depot 'C:\NeuroBook\input\neuro-book-desktop-depot-win-x64.zip' -Scope machine -Channel canary -Yes" -ForegroundColor Cyan
Write-Host "安装完成后本脚本继续（自动等待，最长 15 分钟）。" -ForegroundColor Yellow
Wait-NeuroBookInstalled
Add-Event "machine-installed" @{
    programRoot = "C:\Program Files\NeuroBook"
    manifest = Test-Path -LiteralPath "C:\Program Files\NeuroBook\desktop\desktop-installation.json"
    wrapper = Test-Path -LiteralPath "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd"
}

# 4. Provider smoke：本地假 /models + configure/test，验证 API Key 保密与模型发现。
$providerJson = @{
    name = "sandbox-fake"
    baseURL = "http://127.0.0.1:18473"
    api = "openai-responses"
    apiKey = "sandbox-secret-key-0123456789"
    model = ""
    discoverModels = $true
} | ConvertTo-Json -Compress

$fakeServer = Start-FakeModelsServer
try {
    $testOutput = Invoke-ProviderCli @("desktop", "test-provider", "--stdin-json", "--json")
    $testText = ($testOutput | Out-String)
    if ($testText -match "sandbox-secret-key") { throw "test-provider 输出泄漏 API Key。" }
    $testResult = $testOutput | Where-Object { $_ -match "provider-test" } | Select-Object -Last 1
    Add-Event "provider-test" @{
        result = $testResult
        secretLeaked = ($testText -match "sandbox-secret-key")
    }
    if (-not ($testText -match "sandbox-fake-a")) {
        throw "模型发现未返回 sandbox-fake-a。"
    }

    $configured = Invoke-ProviderCli @("desktop", "configure-provider", "--stdin-json", "--json")
    $configuredText = ($configured | Out-String)
    if ($configuredText -match "sandbox-secret-key") { throw "configure-provider 输出泄漏 API Key。" }
    Add-Event "provider-configured" @{secretLeaked = ($configuredText -match "sandbox-secret-key")}
} finally {
    Stop-Process -Id $fakeServer.Id -Force -ErrorAction SilentlyContinue
}

# 5. 启动验证（headless graceful）。
$envelope = "C:\Program Files\NeuroBook\desktop\NeuroBook-Electron.exe"
$env:NBOOK_DESKTOP_DEV_HOLD_MS = "4000"
$startResult = & $envelope --headless 2>&1
$startExit = $LASTEXITCODE
Remove-Item Env:NBOOK_DESKTOP_DEV_HOLD_MS -ErrorAction SilentlyContinue
Add-Event "start-product" @{exitCode = $startExit; outputTail = (($startResult | Select-Object -Last 5) -join "`n")}
if ($startExit -ne 0) { throw "headless 启动退出码非零：$startExit" }

# 6. Programs and Features 卸载（--delete-data，用户在 Sandbox 桌面批准 UAC）。
Write-Host "请在 Sandbox 中打开【设置 → 应用 → 已安装的应用】，找到 NeuroBook 点击卸载，" -ForegroundColor Yellow
Write-Host "确认选择【同时删除数据】，批准 UAC。卸载完成后本脚本继续（自动等待，最长 15 分钟）。" -ForegroundColor Yellow
Wait-NeuroBookUninstalled
Add-Event "uninstalled-delete-data" @{programRootRemoved = -not (Test-Path -LiteralPath "C:\Program Files\NeuroBook")}

# 7. 验证全部安装/卸载产物消失，外部 Workspace 保留。
$checks = [ordered]@{}
$checks.programRootRemoved = -not (Test-Path -LiteralPath "C:\Program Files\NeuroBook")
$localAppData = Join-Path $env:LOCALAPPDATA "NeuroBook"
$checks.stateCacheDesktopRemoved = -not (Test-Path -LiteralPath $localAppData)
$checks.hklmUninstallRemoved = -not (Test-NeuroBookRegistryKey "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeuroBook")
$checks.protocolRemoved = -not (Test-NeuroBookRegistryKey "HKLM:\Software\Classes\neurobook")
$startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\NeuroBook"
$publicDesktop = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "NeuroBook.lnk"
$checks.startMenuRemoved = -not (Test-Path -LiteralPath $startMenu)
$checks.publicShortcutRemoved = -not (Test-Path -LiteralPath $publicDesktop)
$checks.launcherRootRemoved = -not (Test-Path -LiteralPath (Join-Path $localAppData "manager\uninstall"))
$checks.processTreeRemoved = -not [bool](Get-Process -Name "NeuroBook-Electron" -ErrorAction SilentlyContinue)
$checks.externalWorkspacePreserved = (Test-Path -LiteralPath (Join-Path $externalWorkspace "marker.txt"))

Add-Event "verified" $checks
$failed = $checks.GetEnumerator() | Where-Object { -not $_.Value }
if ($failed) {
    $summary = [ordered]@{schema = "nbook.task-145-sandbox-acceptance/v1"; ok = $false; checks = $checks; events = $events}
    $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    throw "验收失败项：$((($failed | ForEach-Object { $_.Key }) -join ", "))"
}

$summary = [ordered]@{schema = "nbook.task-145-sandbox-acceptance/v1"; ok = $true; checks = $checks; events = $events}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Sandbox 验收通过，证据已写入 $evidencePath" -ForegroundColor Green

function Test-NeuroBookRegistryKey {
    param([string]$Path)
    return [bool](Test-Path -LiteralPath $Path)
}
