import {spawn} from "node:child_process";
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {afterEach, beforeAll, describe, expect, it} from "vitest";

const scriptPath = resolve(import.meta.dirname, "install.sh");
const windowsScriptPath = resolve(import.meta.dirname, "install.ps1");
const desktopWindowsScriptPath = resolve(import.meta.dirname, "install-desktop.ps1");
const windowsCmdPath = resolve(import.meta.dirname, "install.cmd");
const roots: string[] = [];
let script = "";
let windowsScript = "";
let desktopWindowsScript = "";
let windowsCmd = "";

const PLATFORM_CASES = [
    {os: "Linux", arch: "x86_64", asset: "bun-linux-x64", archiveSha256: "951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f", executableSha256: "9fd36f87e4b90b07632b987a2e4ec81ca15a62c81bf983190cea6d715be2ad74", checksum: "sha256sum"},
    {os: "Linux", arch: "aarch64", asset: "bun-linux-aarch64", archiveSha256: "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b", executableSha256: "37141662ebed915a2ab89313156e455e2a1374395f5f6760d06407f49406f086", checksum: "sha256sum"},
    {os: "Darwin", arch: "x86_64", asset: "bun-darwin-x64", archiveSha256: "4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633", executableSha256: "ea2f223e94bb2f4bf3050895113c3cf346438f6fa0501c8532284e063f72f7a0", checksum: "shasum"},
    {os: "Darwin", arch: "arm64", asset: "bun-darwin-aarch64", archiveSha256: "d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620", executableSha256: "e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233", checksum: "shasum"},
] as const;

beforeAll(async () => {
    [script, windowsScript, desktopWindowsScript, windowsCmd] = await Promise.all([
        readFile(scriptPath, "utf8"),
        readFile(windowsScriptPath, "utf8"),
        readFile(desktopWindowsScriptPath, "utf8"),
        readFile(windowsCmdPath, "utf8"),
    ]);
});

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("POSIX Stage 0固定资产", () => {
    it.each(PLATFORM_CASES)("固定$asset的archive与executable checksum", ({asset, archiveSha256, executableSha256}) => {
        expect(script).toContain(asset);
        expect(script).toContain(archiveSha256);
        expect(script).toContain(executableSha256);
    });

    it("保留Linux glibc门禁和Darwin shasum实现", () => {
        expect(script).toContain('[ "$HOST_OS" = "Linux" ] && ! getconf GNU_LIBC_VERSION');
        expect(script).toContain("shasum -a 256");
        expect(script).toContain("sha256sum");
    });

    it("无参数时只允许通过/dev/tty进入交互向导", () => {
        expect(script).toContain('( : </dev/tty ) 2>/dev/null');
        expect(script).toContain('install </dev/tty');
        expect(script).toContain("--profile ghcr --yes");
    });
});

describe("Windows Stage 0合同", () => {
    it("使用原生OS架构并在首次解压后再次校验executable", () => {
        expect(windowsScript).toContain("RuntimeInformation]::OSArchitecture");
        expect(windowsScript).toContain("Architecture]::X64");
        expect(windowsScript.match(/Get-FileHash -LiteralPath \$bunExe/gu)?.length).toBe(2);
        expect(windowsScript.match(/& \$bunExe --version/gu)?.length).toBe(2);
        expect(windowsScript).toContain("Remove-Item -LiteralPath $cacheRoot -Recurse -Force");
        expect(windowsCmd).toContain("exit /b %ERRORLEVEL%");
    });

    it("透传本地 Desktop distribution manifest 并保持 depot 参数互斥", () => {
        expect(desktopWindowsScript).toContain("[string]$DistributionManifest");
        expect(desktopWindowsScript).toContain("--distribution-manifest");
        expect(desktopWindowsScript).toContain("-Archive、-ShellArchive 或 -DistributionManifest 之一");
    });

    it.runIf(process.platform === "win32")("PowerShell脚本语法有效", async () => {
        const command = `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${windowsScriptPath.replaceAll("'", "''")}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`;
        const result = await spawnCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], process.env);
        expect(result.code).toBe(0);
    });

    it.runIf(process.platform === "win32")("Desktop 安装向导 PowerShell 语法有效", async () => {
        const command = `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${desktopWindowsScriptPath.replaceAll("'", "''")}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`;
        const result = await spawnCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], process.env);
        expect(result.code).toBe(0);
    });
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("POSIX Stage 0行为", () => {
    it.each(PLATFORM_CASES)("$os $arch选择$asset并传递完整Manager元数据", async (platformCase) => {
        const run = await runStage0(platformCase, {args: ["--profile", "product-bun", "--yes"]});

        expect(run.code).toBe(0);
        expect(run.url).toContain("/" + platformCase.asset + ".zip");
        expect(run.capture).toContain("args=x --bun @notnotype/neuro-book-manager@canary install --profile product-bun --yes");
        expect(run.capture).toContain("asset=" + platformCase.asset);
        expect(run.capture).toContain("archive=" + platformCase.archiveSha256);
        expect(run.capture).toContain("executable=" + platformCase.executableSha256);
        expect(run.checksumLog).toContain(platformCase.checksum);
        expect(await readdir(run.stageParent)).toEqual([]);
    });

    it("Linux musl在下载前明确拒绝", async () => {
        const run = await runStage0(PLATFORM_CASES[1], {glibc: false});
        expect(run.code).toBe(1);
        expect(run.stderr).toContain("只支持 Linux glibc");
        expect(run.url).toBe("");
    });

    it("无TTY且没有显式参数时在下载前拒绝", async () => {
        const run = await runStage0(PLATFORM_CASES[0], {args: []});
        expect(run.code).toBe(1);
        expect(run.stderr).toContain("无法打开交互终端");
        expect(run.stderr).toContain("--profile ghcr --yes");
        expect(run.url).toBe("");
    });

    it("archive或executable checksum错误时删除无效Runtime", async () => {
        const archiveFailure = await runStage0(PLATFORM_CASES[0], {archiveChecksum: "0".repeat(64)});
        expect(archiveFailure.code).toBe(1);
        expect(archiveFailure.stderr).toContain("archive checksum不匹配");

        const executableFailure = await runStage0(PLATFORM_CASES[0], {executableChecksum: "0".repeat(64)});
        expect(executableFailure.code).toBe(1);
        expect(executableFailure.stderr).toContain("executable校验失败");
        await expect(readdir(join(executableFailure.cacheRoot, "neuro-book-manager", "runtime", "bun"))).resolves.toEqual([]);
    });

    it("有效缓存不下载，损坏缓存会重建并再次校验", async () => {
        const first = await runStage0(PLATFORM_CASES[0]);
        expect(first.code).toBe(0);
        await chmod(join(first.cacheRoot, "neuro-book-manager", "runtime", "bun", "1.3.14", PLATFORM_CASES[0].asset, "bun"), 0o644);
        await rm(first.urlCapture, {force: true});

        const cached = await runStage0(PLATFORM_CASES[0], {root: first.root, curlFail: true});
        expect(cached.code).toBe(0);
        expect(cached.url).toBe("");

        const repaired = await runStage0(PLATFORM_CASES[0], {root: first.root, firstExecutableChecksumWrong: true});
        expect(repaired.code).toBe(0);
        expect(repaired.url).toContain("bun-linux-x64.zip");
        expect(repaired.capture).toContain("version=1.3.14");
    });

    it("缺少curl时在创建缓存或临时目录前失败", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-stage0-missing-tool-"));
        roots.push(root);
        const bin = join(root, "bin");
        await mkdir(bin, {recursive: true});
        await writeExecutable(join(bin, "uname"), '#!/bin/sh\n[ "$1" = "-s" ] && echo Linux || echo x86_64\n');
        await writeExecutable(join(bin, "getconf"), "#!/bin/sh\necho 'glibc 2.39'\n");
        const result = await spawnScript(
            {PATH: bin, HOME: join(root, "home")},
            ["--profile", "product-bun", "--yes"],
        );

        expect(result.code).toBe(1);
        expect(result.stderr).toContain("Stage 0 缺少命令：curl");
    });
});

type PlatformCase = typeof PLATFORM_CASES[number];
type RunOptions = {
    root?: string;
    args?: string[];
    glibc?: boolean;
    archiveChecksum?: string;
    executableChecksum?: string;
    firstExecutableChecksumWrong?: boolean;
    curlFail?: boolean;
};

async function runStage0(platformCase: PlatformCase, options: RunOptions = {}) {
    const root = options.root ?? await mkdtemp(join(tmpdir(), "nbook-stage0-harness-"));
    if (!options.root) roots.push(root);
    const bin = join(root, "bin");
    const home = join(root, "home");
    const cacheRoot = join(root, "cache");
    const stageParent = join(root, "stage");
    const capturePath = join(root, "manager-capture.txt");
    const urlCapture = join(root, "url-capture.txt");
    const checksumLog = join(root, "checksum-log.txt");
    const checksumCounter = join(root, "checksum-counter.txt");
    await mkdir(bin, {recursive: true});
    await mkdir(home, {recursive: true});
    await mkdir(cacheRoot, {recursive: true});
    await mkdir(stageParent, {recursive: true});
    await rm(capturePath, {force: true});
    await rm(checksumLog, {force: true});
    await rm(checksumCounter, {force: true});
    if (!options.root) await rm(urlCapture, {force: true});

    await writeExecutable(join(bin, "uname"), [
        "#!/bin/sh",
        'if [ "$1" = "-s" ]; then printf \'%s\\n\' "$STUB_OS"; else printf \'%s\\n\' "$STUB_ARCH"; fi',
        "",
    ].join("\n"));
    await writeExecutable(join(bin, "getconf"), [
        "#!/bin/sh",
        '[ "$STUB_GLIBC" = "true" ] || exit 1',
        "printf 'glibc 2.39\\n'",
        "",
    ].join("\n"));
    await writeExecutable(join(bin, "curl"), [
        "#!/bin/sh",
        '[ "$STUB_CURL_FAIL" = "true" ] && exit 97',
        "output=",
        "url=",
        'while [ "$#" -gt 0 ]; do',
        '    case "$1" in',
        '        -o) shift; output="$1" ;;',
        '        http*) url="$1" ;;',
        "    esac",
        "    shift",
        "done",
        'printf \'archive\' > "$output"',
        'printf \'%s\' "$url" > "$STUB_URL_CAPTURE"',
        "",
    ].join("\n"));
    await writeExecutable(join(bin, "unzip"), [
        "#!/bin/sh",
        "destination=",
        'while [ "$#" -gt 0 ]; do',
        '    if [ "$1" = "-d" ]; then shift; destination="$1"; fi',
        "    shift",
        "done",
        'mkdir -p "$destination/$STUB_ASSET"',
        'cat > "$destination/$STUB_ASSET/bun" <<\'STUB_BUN\'',
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        '    printf \'%s\\n\' "$STUB_BUN_VERSION"',
        "    exit 0",
        "fi",
        "{",
        '    printf \'args=%s\\n\' "$*"',
        '    printf \'asset=%s\\n\' "$STUB_ASSET"',
        '    printf \'version=%s\\n\' "$NEURO_BOOK_STAGE0_BUN_VERSION"',
        '    printf \'archive=%s\\n\' "$NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256"',
        '    printf \'executable=%s\\n\' "$NEURO_BOOK_STAGE0_BUN_SHA256"',
        '    printf \'path=%s\\n\' "$NEURO_BOOK_STAGE0_BUN_PATH"',
        '} > "$STUB_CAPTURE"',
        "STUB_BUN",
        'chmod 644 "$destination/$STUB_ASSET/bun"',
        "",
    ].join("\n"));
    const checksumScript = [
        "#!/bin/sh",
        "path=",
        'for argument in "$@"; do path="$argument"; done',
        'case "$path" in',
        '    *.zip) value="$STUB_ARCHIVE_CHECKSUM" ;;',
        "    *)",
        '        if [ "$STUB_FIRST_EXEC_WRONG" = "true" ] && [ ! -e "$STUB_CHECKSUM_COUNTER" ]; then',
        '            value="' + "0".repeat(64) + '"',
        '            : > "$STUB_CHECKSUM_COUNTER"',
        "        else",
        '            value="$STUB_EXECUTABLE_CHECKSUM"',
        "        fi",
        "        ;;",
        "esac",
        'printf \'%s  %s\\n\' "$value" "$path"',
        'printf \'%s\\n\' "$0" >> "$STUB_CHECKSUM_LOG"',
        "",
    ].join("\n");
    await writeExecutable(join(bin, "sha256sum"), checksumScript);
    await writeExecutable(join(bin, "shasum"), checksumScript);

    const result = await spawnScript({
        ...process.env,
        PATH: bin + ":" + (process.env.PATH ?? ""),
        HOME: home,
        XDG_CACHE_HOME: cacheRoot,
        TMPDIR: stageParent,
        STUB_OS: platformCase.os,
        STUB_ARCH: platformCase.arch,
        STUB_ASSET: platformCase.asset,
        STUB_GLIBC: String(options.glibc ?? true),
        STUB_BUN_VERSION: "1.3.14",
        STUB_ARCHIVE_CHECKSUM: options.archiveChecksum ?? platformCase.archiveSha256,
        STUB_EXECUTABLE_CHECKSUM: options.executableChecksum ?? platformCase.executableSha256,
        STUB_FIRST_EXEC_WRONG: String(options.firstExecutableChecksumWrong ?? false),
        STUB_CURL_FAIL: String(options.curlFail ?? false),
        STUB_CAPTURE: capturePath,
        STUB_URL_CAPTURE: urlCapture,
        STUB_CHECKSUM_LOG: checksumLog,
        STUB_CHECKSUM_COUNTER: checksumCounter,
    }, options.args ?? ["--profile", "product-bun", "--yes"]);

    return {
        ...result,
        root,
        cacheRoot,
        stageParent,
        urlCapture,
        capture: await readFile(capturePath, "utf8").catch(() => ""),
        url: await readFile(urlCapture, "utf8").catch(() => ""),
        checksumLog: await readFile(checksumLog, "utf8").catch(() => ""),
    };
}

async function writeExecutable(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
    await chmod(path, 0o755);
}

async function spawnScript(env: NodeJS.ProcessEnv, args: string[] = []): Promise<{code: number; stdout: string; stderr: string}> {
    return spawnCommand("/bin/sh", [scriptPath, ...args], env);
}

async function spawnCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{code: number; stdout: string; stderr: string}> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {env, stdio: ["ignore", "pipe", "pipe"]});
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => stdout += chunk);
        child.stderr.on("data", (chunk: string) => stderr += chunk);
        child.once("error", rejectPromise);
        child.once("exit", (code) => resolvePromise({code: code ?? 1, stdout, stderr}));
    });
}
