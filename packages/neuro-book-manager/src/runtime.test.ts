import {chmod, mkdtemp, mkdir, readFile, realpath, writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it, vi} from "vitest";

import {removePath} from "#manager/files";
import {sha256File} from "#manager/files";
import {installManagerExecutable, resolveManagerRuntime, writeManagerWrapper} from "#manager/runtime";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => removePath(root)));
});

describe("portable manager wrapper", () => {
    it("不写入 staging 绝对路径", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-wrapper-"));
        roots.push(root);
        const source = join(root, "manager-source.mjs");
        const bun = join(root, ".runtime", "bun", "1.0.0", process.platform === "win32" ? "bun.exe" : "bun");
        await mkdir(join(root, ".runtime", "bun", "1.0.0"), {recursive: true});
        await writeFile(source, "console.log('manager')\n", "utf8");
        await writeFile(bun, "bun", "utf8");

        const manager = await installManagerExecutable(root, "0.1.0", source);
        await writeManagerWrapper(root, manager, {
            provider: "managed",
            version: "1.0.0",
            path: bun.slice(root.length + 1).replaceAll("\\", "/"),
            archiveSha256: "a".repeat(64),
            executableSha256: "b".repeat(64),
            sourceUrl: "https://example.com/bun.zip",
            license: "MIT",
            redistribution: "test",
        });

        const wrapper = await readFile(join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book"), "utf8");
        expect(wrapper).not.toContain(root);
        expect(wrapper).toContain("manager/0.1.0/neuro-book.mjs".replaceAll("/", process.platform === "win32" ? "\\" : "/"));
    });

    it.runIf(process.platform === "win32")("machine wrapper 从校验后的用户 Cache 投影执行 Manager", async () => {
        const sandbox = await mkdtemp(join(tmpdir(), "nbook-machine-manager-wrapper-"));
        roots.push(sandbox);
        const programFiles = join(sandbox, "Program Files");
        const root = join(programFiles, "NeuroBook");
        const source = join(root, "manager", "neuro-book.mjs");
        vi.stubEnv("ProgramFiles", programFiles);
        await mkdir(join(source, ".."), {recursive: true});
        await writeFile(source, "console.log(JSON.stringify({path: import.meta.path, args: Bun.argv.slice(2)}));\n", "utf8");
        const bundleSha256 = await sha256File(source);
        await writeManagerWrapper(root, {
            provider: "managed",
            version: "0.1.0",
            path: "manager/neuro-book.mjs",
            bundleSha256,
        }, {
            provider: "system",
            version: process.versions.bun ?? "1.3.0",
            executable: process.execPath,
        });
        const wrapper = join(root, ".runtime", "bin", "neuro-book.cmd");
        const localAppData = join(sandbox, "LocalAppData");

        const result = await execFileAsync(process.env.ComSpec ?? "cmd.exe", [
            "/d",
            "/c",
            "call",
            wrapper,
            "status",
            "--json",
        ], {
            env: {
                ...process.env,
                ProgramFiles: programFiles,
                LOCALAPPDATA: localAppData,
            },
            windowsHide: true,
        });
        const output = JSON.parse(result.stdout.trim()) as {path: string; args: string[]};

        const expected = join(localAppData, "NeuroBook", "cache", "manager-runtime", bundleSha256, "neuro-book.mjs");
        expect((await realpath(output.path)).toLocaleLowerCase("en-US"))
            .toBe((await realpath(expected)).toLocaleLowerCase("en-US"));
        expect(output.args).toEqual(["status", "--json"]);
        expect(await sha256File(output.path)).toBe(bundleSha256);

        await writeFile(source, "console.log('tampered');\n", "utf8");
        await expect(execFileAsync(process.env.ComSpec ?? "cmd.exe", [
            "/d",
            "/c",
            "call",
            wrapper,
            "doctor",
            "--json",
        ], {
            env: {
                ...process.env,
                ProgramFiles: programFiles,
                LOCALAPPDATA: localAppData,
            },
            windowsHide: true,
        })).rejects.toMatchObject({code: 1});
    });

    it("校验并接管 Stage 0 Bun", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-manager-stage0-"));
        roots.push(root);
        // Windows直接使用当前Bun作为Stage 0来源，避免在并行suite中为同一大文件做两次复制。
        const source = process.platform === "win32" ? process.execPath : join(root, "cache-bun");
        const version = process.versions.bun;
        if (!version) throw new Error("Stage 0测试必须由Bun执行。" );
        if (process.platform !== "win32") {
            await writeFile(source, `#!/bin/sh\nprintf '${version}\\n'\n`, "utf8");
            await chmod(source, 0o755);
        }
        const executableSha256 = await sha256File(source);
        const previous = {...process.env};
        process.env.NEURO_BOOK_STAGE0_BUN_PATH = source;
        process.env.NEURO_BOOK_STAGE0_BUN_VERSION = version;
        process.env.NEURO_BOOK_STAGE0_BUN_SOURCE_URL = "https://example.com/bun.zip";
        process.env.NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256 = "a".repeat(64);
        process.env.NEURO_BOOK_STAGE0_BUN_SHA256 = executableSha256;
        try {
            const runtime = await resolveManagerRuntime(root);
            expect(runtime.provider).toBe("managed");
            if (runtime.provider === "managed") expect(await sha256File(join(root, runtime.path))).toBe(executableSha256);
        } finally {
            process.env = previous;
        }
    // Windows会复制并多次校验真实Bun大文件；并行完整suite下30秒会把高I/O负载误判为挂死。
    }, 60_000);
});
