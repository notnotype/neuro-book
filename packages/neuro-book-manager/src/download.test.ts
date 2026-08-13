import {createHash} from "node:crypto";
import {chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {strToU8, zipSync} from "fflate";
import {afterEach, describe, expect, it, vi} from "vitest";

import {downloadVerified, extractTarGz, extractZip} from "#manager/download";
import {run} from "#manager/process";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Archive Extraction Adapter", () => {
    it("保留标准ZIP目录条目并解压其文件", async () => {
        const root = await fixtureRoot();
        const archive = join(root, "bun.zip");
        const target = join(root, "target");
        await writeFile(archive, zipSync({
            "bun-windows-x64/": new Uint8Array(),
            "bun-windows-x64/bun.exe": strToU8("bun-runtime"),
        }));

        await extractZip(archive, target);

        expect((await stat(join(target, "bun-windows-x64"))).isDirectory()).toBe(true);
        expect(await readFile(join(target, "bun-windows-x64", "bun.exe"), "utf8")).toBe("bun-runtime");
    });

    it("继续拒绝ZIP路径穿越", async () => {
        const root = await fixtureRoot();
        const archive = join(root, "unsafe.zip");
        const target = join(root, "target");
        await writeFile(archive, zipSync({"../outside.txt": strToU8("unsafe")}));

        await expect(extractZip(archive, target)).rejects.toThrow("Installation Root");
        await expect(stat(join(root, "outside.txt"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("在Bun下解压超过fflate异步Worker阈值的高压缩条目", async () => {
        const root = await fixtureRoot();
        const archive = join(root, "large.zip");
        const target = join(root, "target");
        const expected = new Uint8Array(600 * 1024).fill(65);
        await writeFile(archive, zipSync({"product/server/index.mjs": expected}));

        await extractZip(archive, target);

        expect(new Uint8Array(await readFile(join(target, "product", "server", "index.mjs"))))
            .toEqual(expected);
    });

    it.runIf(process.platform !== "win32")("保留Product tar中的可执行权限", async () => {
        const root = await fixtureRoot();
        const source = join(root, "source");
        const archive = join(root, "product.tar.gz");
        const target = join(root, "target");
        const runtime = join(source, "runtime.mjs");
        await mkdir(source, {recursive: true});
        await writeFile(runtime, "runtime");
        await chmod(runtime, 0o764);
        await run("tar", ["-czf", archive, "-C", source, "runtime.mjs"], {stdio: "ignore"});

        await extractTarGz(archive, target);

        expect((await stat(join(target, "runtime.mjs"))).mode & 0o777).toBe(0o764);
    });
});

describe("Verified Release download", () => {
    it("跟随 GitHub Release 资产的临时重定向并校验最终内容", async () => {
        const root = await fixtureRoot();
        const target = join(root, "bun.zip");
        const content = strToU8("verified-release-asset");
        const digest = createHash("sha256").update(content).digest("hex");
        const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => init?.redirect === "follow"
            ? Promise.resolve(new Response(content, {status: 200}))
            : Promise.resolve(new Response(null, {
                status: 302,
                headers: {location: "https://objects.example/asset"},
            })));
        vi.stubGlobal("fetch", fetchMock);

        try {
            await downloadVerified("https://github.com/example/release/asset.zip", target, digest);
            expect(await readFile(target, "utf8")).toBe("verified-release-asset");
            expect(fetchMock).toHaveBeenNthCalledWith(
                1,
                "https://github.com/example/release/asset.zip",
                expect.objectContaining({redirect: "follow"}),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });
});


/** 创建每项测试独占的归档根。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-manager-download-"));
    roots.push(root);
    return root;
}
