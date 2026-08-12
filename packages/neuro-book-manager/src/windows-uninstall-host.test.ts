import {spawn} from "node:child_process";
import {mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

import {pathExists, sha256File} from "#manager/files";
import {
    scheduleWindowsUninstall,
    WINDOWS_UNINSTALL_HOST_SCRIPT,
    type WindowsUninstallIntent,
    type WindowsUninstallLayout,
} from "#manager/windows-uninstall-host";

const cleanupRoots: string[] = [];
// 真实 PowerShell 与独立 Host 冷启动在共享 Windows runner 上曾超过 15 秒。
const WINDOWS_HOST_TEST_TIMEOUT_MS = 30_000;

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe.runIf(process.platform === "win32")("Windows Uninstall Host", () => {
    it("真实调度的Host不依赖Bun父进程句柄完成Portable删除", async () => {
        const sandbox = testSandbox("host-scheduled-portable");
        const root = join(sandbox, "portable");
        await Promise.all([
            write(root, "payload.txt", "payload"),
            write(root, "data/workspace/novel/book.md", "truth"),
        ]);

        const scheduled = await scheduleWindowsUninstall({
            root,
            layout: "installation-scoped",
            stateRoot: join(root, "data"),
            cacheRoot: join(root, ".cache"),
            desktopRoot: join(root, "data", ".desktop"),
            deleteData: false,
            parentPid: 2147483647,
        });
        let result: HostResult | undefined;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (await pathExists(scheduled.resultPath)) {
                const text = (await readFile(scheduled.resultPath, "utf8")).replace(/^\uFEFF/u, "");
                result = JSON.parse(text) as HostResult;
                break;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }

        expect(result).toMatchObject({ok: true});
        await expect(stat(join(root, "payload.txt"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(root, "data", "workspace", "novel", "book.md"), "utf8"))
            .resolves.toBe("truth");
    }, WINDOWS_HOST_TEST_TIMEOUT_MS);

    it("Portable 默认只保留 State Root 用户数据", async () => {
        const sandbox = testSandbox("host-preserve-portable");
        const root = join(sandbox, "portable");
        await Promise.all([
            write(root, ".output/server/index.mjs", "product"),
            write(root, ".cache/runtime/item", "cache"),
            write(root, "data/.desktop/webview/profile", "desktop"),
            write(root, "data/logs/server.jsonl", "log"),
            write(root, "data/workspace/novel/book.md", "truth"),
        ]);

        const result = await runHost({
            sandbox,
            root,
            layout: "installation-scoped",
            stateRoot: join(root, "data"),
            cacheRoot: join(root, ".cache"),
            desktopRoot: join(root, "data", ".desktop"),
            deleteData: false,
        });

        expect(result.ok).toBe(true);
        await expect(readFile(join(root, "data", "workspace", "novel", "book.md"), "utf8")).resolves.toBe("truth");
        await expect(stat(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, ".cache"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, "data", ".desktop"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(root, "data", "logs"))).rejects.toMatchObject({code: "ENOENT"});
    }, WINDOWS_HOST_TEST_TIMEOUT_MS);

    it("Installed Windows 的 deleteData 删除程序和全部托管数据根", async () => {
        const sandbox = testSandbox("host-delete-installed");
        const localData = join(sandbox, "Local");
        vi.stubEnv("LOCALAPPDATA", localData);
        const root = join(localData, "Programs", "NeuroBook");
        const stateRoot = join(localData, "NeuroBook", "data");
        const cacheRoot = join(localData, "NeuroBook", "cache");
        const desktopRoot = join(localData, "NeuroBook", "desktop");
        const installationId = "test-install-0001";
        const launcherRoot = join(localData, "NeuroBook", "manager", "uninstall", installationId);
        await Promise.all([
            write(root, ".runtime/bun/bun.exe", "runtime"),
            write(desktopRoot, "desktop-installation.json", JSON.stringify({schemaVersion: 3, installationId, installationScope: "machine"})),
            write(stateRoot, "workspace/novel/book.md", "truth"),
            write(cacheRoot, "runtime/item", "cache"),
            write(desktopRoot, "webview/profile", "desktop"),
            write(launcherRoot, "uninstall.ps1", "# launcher"),
        ]);

        const result = await runHost({sandbox, root, layout: "installed-windows", stateRoot, cacheRoot, desktopRoot, deleteData: true});

        expect(result.ok).toBe(true);
        for (const target of [root, stateRoot, cacheRoot, desktopRoot, launcherRoot]) {
            await expect(stat(target)).rejects.toMatchObject({code: "ENOENT"});
        }
    }, WINDOWS_HOST_TEST_TIMEOUT_MS);

    it("删除超过 MAX_PATH 的深层托管内容（\\?\\ 长路径前缀）", async () => {
        const sandbox = testSandbox("host-deep-path");
        const root = join(sandbox, "portable");
        const deepSegment = "segment-0123456789abcdef";
        const deepFile = join(
            root,
            ".cache",
            "product-runtime",
            ...Array.from({length: 10}, () => deepSegment),
            "artifact-0123456789abcdef0123456789abcdef.mjs",
        );
        await mkdir(dirname(deepFile), {recursive: true});
        await writeFile(deepFile, "deep");
        expect(deepFile.length).toBeGreaterThan(260);

        const result = await runHost({
            sandbox,
            root,
            layout: "installation-scoped",
            stateRoot: join(root, "data"),
            cacheRoot: join(root, ".cache"),
            desktopRoot: join(root, "data", ".desktop"),
            deleteData: true,
        });

        expect(result.ok).toBe(true);
        await expect(stat(deepFile)).rejects.toMatchObject({code: "ENOENT"});
    }, WINDOWS_HOST_TEST_TIMEOUT_MS);

    it("intent 摘要被篡改时零删除并写失败结果", async () => {
        const sandbox = testSandbox("host-tampered-intent");
        const root = join(sandbox, "portable");
        await write(root, ".output/server/index.mjs", "product");

        const result = await runHost({
            sandbox,
            root,
            layout: "installation-scoped",
            stateRoot: join(root, "data"),
            cacheRoot: join(root, ".cache"),
            desktopRoot: join(root, "data", ".desktop"),
            deleteData: false,
            tamperIntent: true,
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("digest does not match");
        await expect(readFile(join(root, ".output", "server", "index.mjs"), "utf8")).resolves.toBe("product");
    }, WINDOWS_HOST_TEST_TIMEOUT_MS);
});

type HostResult = {
    ok: boolean;
    /** 仅失败结果包含 PowerShell 捕获的错误信息。 */
    error?: string;
};

/** 通过真实 powershell.exe 同步执行 Product 使用的同一 Host 脚本。 */
async function runHost(input: {
    sandbox: string;
    root: string;
    layout: WindowsUninstallLayout;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    deleteData: boolean;
    /** 测试摘要锁定后的 durable intent 篡改。 */
    tamperIntent?: boolean;
}): Promise<HostResult> {
    const token = crypto.randomUUID();
    const intent: WindowsUninstallIntent = {
        schemaVersion: 1,
        token,
        layout: input.layout,
        installationRoot: resolve(input.root),
        stateRoot: resolve(input.stateRoot),
        cacheRoot: resolve(input.cacheRoot),
        desktopRoot: resolve(input.desktopRoot),
        deleteData: input.deleteData,
        createdAt: new Date().toISOString(),
    };
    const intentPath = join(input.root, ".deploy", "uninstall-intent.json");
    const hostRoot = join(input.sandbox, "external-host", token);
    const scriptPath = join(hostRoot, "uninstall.ps1");
    const resultPath = join(input.sandbox, "external-results", `${token}.json`);
    await Promise.all([
        write(intentPath, "", `${JSON.stringify(intent, null, 4)}\n`),
        write(scriptPath, "", WINDOWS_UNINSTALL_HOST_SCRIPT),
    ]);
    const expectedSha256 = await sha256File(intentPath);
    if (input.tamperIntent) {
        await writeFile(intentPath, `${JSON.stringify({...intent, installationRoot: join(input.sandbox, "other-root")}, null, 4)}\n`, "utf8");
    }
    await mkdir(dirname(resultPath), {recursive: true});
    const child = spawn("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-ParentPid",
        "2147483647",
        "-IntentPath",
        intentPath,
        "-ExpectedToken",
        token,
        "-ExpectedRoot",
        resolve(input.root),
        "-ExpectedIntentSha256",
        expectedSha256,
        "-ResultPath",
        resultPath,
    ], {stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    let standardError = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
        standardError += chunk;
    });
    const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("close", resolvePromise);
    });
    if (!await pathExists(resultPath)) {
        throw new Error(`Windows Uninstall Host 未写结果（exit=${String(exitCode)}）：${standardError.trim()}`);
    }
    const text = (await readFile(resultPath, "utf8")).replace(/^\uFEFF/u, "");
    return JSON.parse(text) as HostResult;
}

function testSandbox(name: string): string {
    const sandbox = join(process.cwd(), ".agent", `${name}-${crypto.randomUUID()}`);
    cleanupRoots.push(sandbox);
    vi.stubEnv("LOCALAPPDATA", join(sandbox, "Local"));
    return sandbox;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
    const file = relativePath ? join(root, ...relativePath.split("/")) : root;
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, content, "utf8");
}
