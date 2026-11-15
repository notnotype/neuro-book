/**
 * 打便携包（docs/specs/runtime/desktop-shell.md 的“便携标记”）：从 Hutch 的完整包 `stable-win-x64-NeuroBook.tar.zst` 解压出真实的
 * 应用目录，在程序根目录放 `NeuroBook.portable`，打成 `NeuroBook-<版本>-win-x64-portable.zip`。
 *
 * 不从 `build/stable-win-x64/NeuroBook/` 打：Hutch 0.29.0 的 stable 构建打完内层 tar 之后会清空这个目录、重建成解压器外壳
 * （没有 bun.exe、Resources/version.json 与载荷，w00046 t11 设计审查第 2 轮第 8 条）。
 *
 * 用法：`bun desktop/scripts/portable.ts <tar.zst> <版本> <输出目录>`（Windows 上，用系统的 tar 打 zip）。退出码：0 成功；1 失败；2 用法错误。
 */

import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {zstdDecompressSync} from "node:zlib";

/** 解压后程序根目录里必须有的：启动器、随包的 Bun、版本信息与服务端入口。 */
export const PORTABLE_REQUIRED = [join("bin", "launcher.exe"), join("bin", "bun.exe"), join("Resources", "version.json"), join("Resources", "app", "neurobook", "server", "main.js")];

async function tar(args: readonly string[]): Promise<void> {
    const child = Bun.spawn(["tar", ...args], {stdin: "ignore", stdout: "ignore", stderr: "pipe"});
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`tar ${args.join(" ")} 失败（退出码 ${String(code)}）：${stderr.trim()}`);
}

export async function buildPortable(archive: string, version: string, outDir: string): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), "nbook-portable-"));
    try {
        const tarFile = join(work, "app.tar");
        await writeFile(tarFile, zstdDecompressSync(await readFile(archive)));
        const extracted = join(work, "x");
        await mkdir(extracted);
        await tar(["-xf", tarFile, "-C", extracted]);
        const [top, ...rest] = await readdir(extracted);
        if (top === undefined || rest.length > 0) throw new Error(`完整包的顶层应当只有应用目录一个，实际是：${[top, ...rest].join("、")}`);
        const programRoot = join(extracted, top);
        const missing = PORTABLE_REQUIRED.filter((path) => !existsSync(join(programRoot, path)));
        if (missing.length > 0) throw new Error(`完整包里的应用目录缺：${missing.join("、")}`);
        await writeFile(join(programRoot, "NeuroBook.portable"), "");
        await mkdir(outDir, {recursive: true});
        const zip = join(outDir, `NeuroBook-${version}-win-x64-portable.zip`);
        await rm(zip, {force: true});
        // Windows 的 tar（bsdtar）按扩展名打 zip（-a）。
        await tar(["-a", "-cf", zip, "-C", extracted, top]);
        return zip;
    } finally {
        await rm(work, {recursive: true, force: true});
    }
}

if (import.meta.main) {
    const [archive, version, outDir, ...extra] = Bun.argv.slice(2);
    if (archive === undefined || version === undefined || outDir === undefined || extra.length > 0) {
        console.error("用法：bun desktop/scripts/portable.ts <tar.zst> <版本> <输出目录>");
        process.exitCode = 2;
    } else {
        try {
            console.log(`✓ 便携包：${await buildPortable(archive, version, outDir)}`);
        } catch (error) {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        }
    }
}
