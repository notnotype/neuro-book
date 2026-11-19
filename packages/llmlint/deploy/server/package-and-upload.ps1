param(
    [string]$Worktree = (Get-Location).Path,
    # 把 server 换成你的 SSH 别名。
    [string]$SshAlias = "server"
)
$ErrorActionPreference = "Stop"
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$tmp = Join-Path $env:TEMP "llmlint-$stamp.tgz"
try {
    & bash (Join-Path $Worktree "deploy/server/package-source.sh") $Worktree $tmp
    if ($LASTEXITCODE -ne 0) { throw "source package failed" }
    $hash = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLowerInvariant()
    Write-Output "archive=$tmp"
    Write-Output "sha256=$hash"
    & scp $tmp "$SshAlias`:/tmp/llmlint-$stamp.tgz"
    if ($LASTEXITCODE -ne 0) { throw "scp failed" }
    Write-Output "remote=/tmp/llmlint-$stamp.tgz"
} finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
}
