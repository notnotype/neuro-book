/**
 * 桌面载荷（`scripts/desktop-payload.ts`）里不联网的部分：发布清单与 tarball 的核对、锁文件的对照、文件清单。从 registry 装依赖的
 * 整段组装由 `bun run release:smoke`（仓库根）用刚打好的应用包跑一遍，并以托管方式运行组装出的 `app/server/main.js`。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {appTarball, listFiles, lockedPackages, lockMismatches} from "./desktop-payload";
import {APP_NAME} from "./pack-app";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop-payload", "desktop-payload");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("发布清单里的应用包", () => {
    it("摘要相同时交出 tarball；被换过、清单里没有应用包、文件不在时失败", async () => {
        const directory = join(tmp, "release");
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, "app.tgz"), "bytes");
        const digest = new Bun.CryptoHasher("sha256").update("bytes").digest("hex");
        const manifestPath = join(directory, "release-manifest.json");
        const entry = {name: APP_NAME, version: "1.2.3", tarball: "app.tgz", sha256: digest};

        expect(await appTarball(manifestPath, {commit: "c", packages: [entry]})).toEqual({path: join(directory, "app.tgz"), version: "1.2.3", sha256: digest});
        await expect(appTarball(manifestPath, {commit: "c", packages: [{...entry, sha256: "0".repeat(64)}]})).rejects.toThrow("被换过");
        await expect(appTarball(manifestPath, {commit: "c", packages: [{...entry, name: "@notnotype/other"}]})).rejects.toThrow(`没有 ${APP_NAME}`);
        await expect(appTarball(manifestPath, {commit: "c", packages: [{...entry, tarball: "missing.tgz"}]})).rejects.toThrow("不存在");
    });
});

describe("锁文件的对照", () => {
    const rootLock = `{
  "lockfileVersion": 1,
  "workspaces": {"": {"name": "root"}},
  "packages": {
    "nbook": ["nbook@workspace:packages/neuro-book"],
    "a": ["a@1.0.0", "", {}, "sha512-AAA="],
    "b": ["b@2.0.0", "", {}, "sha512-BBB="],
  },
}`;

    it("按 名@版本 读出完整性哈希，工作区包不算；对不上的逐个列出", () => {
        const root = lockedPackages(rootLock);
        expect([...root]).toEqual([["a@1.0.0", "sha512-AAA="], ["b@2.0.0", "sha512-BBB="]]);
        expect(lockMismatches(new Map([["a@1.0.0", "sha512-AAA="]]), root)).toEqual([]);
        expect(lockMismatches(new Map([["a@1.0.0", "sha512-XXX="], ["c@1.0.0", "sha512-CCC="], ["b@2.0.1", "sha512-BBB="]]), root)).toEqual([
            "a@1.0.0 的完整性哈希与仓库根的 bun.lock 不同",
            "c@1.0.0 不在仓库根的 bun.lock 里",
            "b@2.0.1 不在仓库根的 bun.lock 里",
        ]);
    });
});

describe("文件清单", () => {
    it("全部文件按路径排序、路径用斜杠、带大小与摘要；遇到符号链接失败", async () => {
        const root = join(tmp, "files");
        await mkdir(join(root, "server"), {recursive: true});
        await writeFile(join(root, "server", "main.js"), "x");
        await writeFile(join(root, "README.md"), "hello");
        const files = await listFiles(root);
        expect(files.map((file) => file.path)).toEqual(["README.md", "server/main.js"]);
        expect(files[0]).toEqual({path: "README.md", size: 5, sha256: new Bun.CryptoHasher("sha256").update("hello").digest("hex")});

        await symlink(join(root, "README.md"), join(root, "link"));
        await expect(listFiles(root)).rejects.toThrow("符号链接");
    });
});
