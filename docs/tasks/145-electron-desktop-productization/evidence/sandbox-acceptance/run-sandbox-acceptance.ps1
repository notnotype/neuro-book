[CmdletBinding()]
param(
    [string]$InputRoot = "C:\NeuroBook\input",
    [string]$EvidenceRoot = "C:\NeuroBook\evidence",
    [string]$WorkRoot = "C:\NeuroBook\work",
    [switch]$Automated
)

$ErrorActionPreference = "Stop"

$expectedSha256 = "cf7f2b2c156e744c395fa4418c339d906bc7f55817cbf792361ed4e0aa59eab3"
$evidencePath = Join-Path $EvidenceRoot "t145-sandbox-acceptance.json"
$events = [System.Collections.Generic.List[object]]::new()

function Add-Event {
    param([string]$Kind, [object]$Payload = $null)
    $events.Add(@{kind = $Kind; at = (Get-Date -Format o); payload = $Payload})
}

function Set-Progress {
    param([string]$Text)
    $progressPath = Join-Path $EvidenceRoot "progress.txt"
    [System.IO.File]::WriteAllText(
        $progressPath,
        "$Text at $(Get-Date -Format o)",
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Test-NeuroBookRegistryKey {
    param([string]$Path)
    return [bool](Test-Path -LiteralPath $Path)
}

function Wait-NeuroBookInstalled {
    param([int]$TimeoutSeconds = 900)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $installationManifest = "C:\Program Files\NeuroBook\.deploy\installation.json"
        $desktopManifest = Join-Path $env:LOCALAPPDATA "NeuroBook\desktop\desktop-installation.json"
        $wrapper = "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd"
        if ((Test-Path -LiteralPath $installationManifest -PathType Leaf) `
                -and (Test-Path -LiteralPath $desktopManifest -PathType Leaf) `
                -and (Test-Path -LiteralPath $wrapper -PathType Leaf)) {
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

function Wait-NeuroBookProcessesStopped {
    param([int]$TimeoutSeconds = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $running = @(
            Get-Process -Name "NeuroBook-Electron" -ErrorAction SilentlyContinue
            Get-Process -Name "bun" -ErrorAction SilentlyContinue
        )
        if (-not $running) {
            # headless Product graceful shutdown 后可能有短暂文件锁收尾；再等一轮。
            Start-Sleep -Seconds 10
            $again = @(
                Get-Process -Name "NeuroBook-Electron" -ErrorAction SilentlyContinue
                Get-Process -Name "bun" -ErrorAction SilentlyContinue
            )
            if (-not $again) { return }
        }
        Start-Sleep -Seconds 5
    }
    throw "等待 Product 进程树收口超时（$TimeoutSeconds 秒）。"
}

function Wait-UninstallReceipt {
    param(
        [string]$ResultPath,
        [int]$TimeoutSeconds = 900
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $ResultPath -PathType Leaf) {
            $receipt = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($receipt.ok -eq $true) { return $receipt }
            if ($receipt.ok -eq $false) {
                throw "Uninstall Host 失败：$($receipt.error)"
            }
        }
        Start-Sleep -Seconds 5
    }
    throw "等待 Uninstall Host 回执超时（$TimeoutSeconds 秒）：$ResultPath"
}

function Get-InstalledBunPath {
    $manifestPath = "C:\Program Files\NeuroBook\.deploy\installation.json"
    # Manager 以无 BOM UTF-8 写入 installation.json；PS 5.1 必须显式 UTF8 解码，
    # 否则中文 license 字段按 ANSI 误读会破坏 JSON 语法。
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    # Bun 位置以 manifest 的相对 path 为准（当前 v3 安装为 runtime/bun.exe），
    # 不按旧 .runtime\bun\<version> 布局猜测。
    $relativePath = [string]$manifest.components.managerRuntime.path
    if (-not $relativePath) {
        throw "installation.json 缺少 components.managerRuntime.path。"
    }
    $bun = Join-Path "C:\Program Files\NeuroBook" $relativePath
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
Set-Progress "input-verified"

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
Set-Progress "external-workspace-created"

# 3. machine 安装。
#    -Automated：由 `wsb exec --run-as System` 驱动（SYSTEM 上下文直接获得安装权限，
#    Store Windows Sandbox CLI 不弹出 UAC）；否则等待用户在 Sandbox 桌面批准 UAC。
if ($Automated) {
    $installArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "C:\NeuroBook\input\depot-extracted\install-desktop.ps1",
        "-Depot", "C:\NeuroBook\input\neuro-book-desktop-depot-win-x64.zip",
        "-Scope", "machine", "-Channel", "canary", "-Yes"
    )
    $installProc = Start-Process -FilePath "powershell.exe" -ArgumentList $installArgs -Wait -PassThru -WindowStyle Hidden
    if ($installProc.ExitCode -ne 0) {
        throw "machine 安装失败（exit $($installProc.ExitCode)）。"
    }
} else {
    Write-Host "请在 Sandbox 中打开【管理员 PowerShell】（右键以管理员身份运行，批准 UAC），然后执行：" -ForegroundColor Yellow
    Write-Host "  & 'C:\NeuroBook\input\depot-extracted\install-desktop.ps1' -Depot 'C:\NeuroBook\input\neuro-book-desktop-depot-win-x64.zip' -Scope machine -Channel canary -Yes" -ForegroundColor Cyan
    Write-Host "安装完成后本脚本继续（自动等待，最长 15 分钟）。" -ForegroundColor Yellow
    Wait-NeuroBookInstalled
}
Add-Event "machine-installed" @{
    programRoot = "C:\Program Files\NeuroBook"
    installationManifest = Test-Path -LiteralPath "C:\Program Files\NeuroBook\.deploy\installation.json"
    desktopManifest = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "NeuroBook\desktop\desktop-installation.json")
    wrapper = Test-Path -LiteralPath "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd"
}
Set-Progress "machine-installed"

# 4. Provider smoke：本地假 /models + configure/test，验证 API Key 保密与模型发现。
$providerJson = @{
    name = "sandbox-fake"
    baseURL = "http://127.0.0.1:18473"
    api = "openai-responses"
    apiKey = "sandbox-secret-key-0123456789"
    model = "sandbox-fake-a"
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
    $stateConfig = Join-Path $env:LOCALAPPDATA "NeuroBook\data\workspace\.nbook\config.json"
    if (-not (Test-Path -LiteralPath $stateConfig -PathType Leaf)) {
        throw "configure-provider 未写入 State Root config.json：$stateConfig"
    }
    $configText = Get-Content -LiteralPath $stateConfig -Raw -Encoding UTF8
    if ($configText -notmatch "sandbox-fake") { throw "State Root config.json 缺少 providerId=sandbox-fake。" }
    Add-Event "provider-configured" @{
        secretLeaked = ($configuredText -match "sandbox-secret-key")
        stateConfigWritten = $true
        providerIdPresent = ($configText -match "sandbox-fake")
    }
} finally {
    Stop-Process -Id $fakeServer.Id -Force -ErrorAction SilentlyContinue
}
Set-Progress "provider-smoke-done"

# 5. 启动验证（headless graceful）。
$envelope = "C:\Program Files\NeuroBook\desktop\NeuroBook-Electron.exe"
$env:NBOOK_DESKTOP_DEV_HOLD_MS = "4000"
$startResult = & $envelope --headless 2>&1
$startExit = $LASTEXITCODE
Remove-Item Env:NBOOK_DESKTOP_DEV_HOLD_MS -ErrorAction SilentlyContinue
Add-Event "start-product" @{exitCode = $startExit; outputTail = (($startResult | Select-Object -Last 5) -join "`n")}
if ($startExit -ne 0) { throw "headless 启动退出码非零：$startExit" }
Set-Progress "headless-start-done"

# 6. Manager CLI 卸载（--delete-data）。
#    Programs and Features 卸载入口固定保留 State Root（broker-client 硬编码
#    deleteData=false）；删除数据的破坏性路径由 `uninstall --yes --delete-data`
#    承担，machine 安装会通过外置 UAC Host 删除 Program Files 与托管用户数据。
#    -Automated 下由 System 上下文直接执行，不需要用户批准 UAC。
if ($Automated) {
    # Bun 位于 Installation Root 内，卸载必须委托外置 Host 等待本进程退出后删除；
    # headless 启动刚结束时的文件锁会令 Host 失败，必须先等进程树完全收口。
    Wait-NeuroBookProcessesStopped
    $uninstallOutput = (& "C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd" uninstall --yes --delete-data 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Manager CLI 卸载失败（exit $LASTEXITCODE）。"
    }
    $resultMatch = [regex]::Match($uninstallOutput, "结果记录：(.+\.json)")
    if (-not $resultMatch.Success) {
        throw "无法从卸载输出解析结果记录路径。"
    }
    $resultPath = $resultMatch.Groups[1].Value.Trim()
    Wait-UninstallReceipt -ResultPath $resultPath
    Wait-NeuroBookUninstalled
} else {
    Write-Host "请在 Sandbox 中打开 PowerShell 并执行以下命令（批准弹出的 UAC）：" -ForegroundColor Yellow
    Write-Host "  & 'C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd' uninstall --yes --delete-data" -ForegroundColor Cyan
    Write-Host "卸载完成后本脚本继续（自动等待，最长 15 分钟）。" -ForegroundColor Yellow
    Wait-NeuroBookUninstalled
}
Add-Event "uninstalled-delete-data" @{programRootRemoved = -not (Test-Path -LiteralPath "C:\Program Files\NeuroBook")}
Set-Progress "uninstalled"

# 7. 验证全部安装/卸载产物消失，外部 Workspace 保留。
$checks = [ordered]@{}
$checks.programRootRemoved = -not (Test-Path -LiteralPath "C:\Program Files\NeuroBook")
$localAppData = Join-Path $env:LOCALAPPDATA "NeuroBook"
# delete-data 删除 State/Cache/Desktop/WebView；Manager 自身的 bootstrap/depot 缓存
# 与 uninstall-results 不属于托管用户数据，允许保留在 NeuroBook 根下。
$checks.stateRootRemoved = -not (Test-Path -LiteralPath (Join-Path $localAppData "data"))
$checks.cacheRootRemoved = -not (Test-Path -LiteralPath (Join-Path $localAppData "cache"))
$checks.desktopRootRemoved = -not (Test-Path -LiteralPath (Join-Path $localAppData "desktop"))
$checks.hklmUninstallRemoved = -not (Test-NeuroBookRegistryKey "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NeuroBook")
$checks.protocolRemoved = -not (Test-NeuroBookRegistryKey "HKLM:\Software\Classes\neurobook")
$startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\NeuroBook"
$publicDesktop = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "NeuroBook.lnk"
# 卸载删除开始菜单 .lnk；空目录残留是已知可接受残留（宿主机验收口径一致）。
$checks.startMenuShortcutsRemoved = -not [bool](Get-ChildItem -LiteralPath $startMenu -Filter "*.lnk" -ErrorAction SilentlyContinue)
$checks.publicShortcutRemoved = -not (Test-Path -LiteralPath $publicDesktop)
# Host 删除安装时创建的 launcher 子目录；空的 manager\uninstall 父目录是
# Manager 自身状态（与开始菜单空目录同一口径），允许保留。
$launcherRoot = Join-Path $localAppData "manager\uninstall"
$checks.launcherRootRemoved = -not [bool](Get-ChildItem -LiteralPath $launcherRoot -Directory -ErrorAction SilentlyContinue)
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
Set-Progress "acceptance-written"
