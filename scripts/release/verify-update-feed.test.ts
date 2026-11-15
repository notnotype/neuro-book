import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer, type Server} from "node:http";
import {join} from "node:path";
import {zstdCompressSync} from "node:zlib";

import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {feedRequests, localFeedProblems, readManifest, readTarEntry, remoteFeedRecords} from "#scripts/release/verify-update-feed";

const VERSION = "0.12.2";
const HASH = "2ezvmjxej6yni";
const BASE_URL = "https://github.com/notnotype/neuro-book/releases/latest/download";
const IDENTITY = {identifier: "io.github.notnotype.neurobook", channel: "stable", platform: "win", arch: "x64"};

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/**
 * 一批与 Hutch 产物同形的更新文件：真实的 GNU tar 打出 `NeuroBook/Resources/version.json` 与一个程序文件，zstd 压缩；
 * 两份清单按 Hutch 0.29.0 `releaseUpdateJson` 的字段写。`change` 在写清单前改字段，模拟出错的构建。
 */
async function feed(options: {format?: "pax" | "gnu"; info?: Record<string, unknown>; change?: (v2: Record<string, unknown>, v1: Record<string, unknown>) => void} = {}): Promise<{directory: string; digests: Map<string, string>}> {
    const root = await createTestTmpRoot("release-feed", "verify-update-feed-test");
    roots.push(root);
    const app = join(root, "app");
    // 超过 100 字节的路径让 tar 写 pax 扩展头或 GNU 长名，覆盖读法里的两种改名条目。
    const deep = join(app, "NeuroBook", "Resources", "app", "neurobook", "node_modules", "@oh-my-pi", "a-rather-long-package-name-to-pass-the-limit");
    await mkdir(deep, {recursive: true});
    await writeFile(join(deep, "index.js"), "export {};\n");
    await writeFile(join(app, "NeuroBook", "Resources", "version.json"), JSON.stringify({version: VERSION, hash: HASH, baseUrl: BASE_URL, channel: "stable", name: "NeuroBook", identifier: IDENTITY.identifier, ...options.info}));
    const tarPath = join(root, "app.tar");
    const tarred = spawnSync("tar", [`--format=${options.format ?? "pax"}`, "-C", app, "-cf", tarPath, "NeuroBook"], {encoding: "utf8"});
    if (tarred.status !== 0) throw new Error(tarred.stderr);
    const tar = readFileSync(tarPath);

    const directory = join(root, "release-assets");
    await mkdir(directory);
    const files = new Map<string, Uint8Array | string>();
    files.set("stable-win-x64-NeuroBook.tar.zst", zstdCompressSync(tar));
    const v2: Record<string, unknown> = {schemaVersion: 1, ...IDENTITY, version: VERSION, hash: HASH, artifact: {file: "stable-win-x64-NeuroBook.tar.zst", tarSha256: sha256(tar), tarSize: tar.length}};
    const v1: Record<string, unknown> = {schemaVersion: 1, ...IDENTITY, version: VERSION, hash: HASH, artifact: {file: "stable-win-x64-NeuroBook.tar.zst"}};
    options.change?.(v2, v1);
    files.set("stable-win-x64-update-v2.json", JSON.stringify(v2));
    files.set("stable-win-x64-update.json", JSON.stringify(v1));
    files.set("stable-win-x64-1pgfu5evhc1gh.patch", "patch bytes");
    const digests = new Map<string, string>();
    for (const [name, content] of files) {
        await writeFile(join(directory, name), content);
        digests.set(name, sha256(content));
    }
    return {directory, digests};
}

/**
 * 与 GitHub 同样跳两次的本机源：`/latest/download/<文件>` 302 到 `/download/v<版本>/<文件>`，再 302 到带签名的对象地址，
 * 那里给 200。记下每个请求的查询串。`override` 换掉某个文件的应答。
 */
async function githubLike(directory: string, override: Record<string, {status: number; body?: string}> = {}): Promise<{base: string; queries: Map<string, string>}> {
    const queries = new Map<string, string>();
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        if (url.pathname.startsWith("/latest/download/")) {
            queries.set(name, url.search);
            response.writeHead(302, {location: `/download/v${VERSION}/${encodeURIComponent(name)}`}).end();
        } else if (url.pathname.startsWith("/download/")) {
            response.writeHead(302, {location: `/objects/${encodeURIComponent(name)}?sig=abc`}).end();
        } else if (override[name] !== undefined) {
            response.writeHead(override[name].status).end(override[name].body ?? "");
        } else {
            response.writeHead(200, {"content-type": "application/octet-stream"}).end(readFileSync(join(directory, name)));
        }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as {port: number};
    return {base: `http://127.0.0.1:${address.port}/latest/download`, queries};
}

describe("清单按更新器的规则读", () => {
    it("v2 清单齐全时读出版本、哈希、文件与解压后的摘要", () => {
        const {manifest, problems} = readManifest(JSON.stringify({schemaVersion: 1, ...IDENTITY, version: VERSION, hash: HASH, artifact: {file: "stable-win-x64-NeuroBook.tar.zst", tarSha256: "a".repeat(64), tarSize: 10}}), true);
        expect(problems).toEqual([]);
        expect(manifest).toMatchObject({version: VERSION, hash: HASH, tarSize: 10});
    });

    it("v2 缺 tarSha256、身份不是正式包（测试标识）、schemaVersion 不对、文件名不是本平台：逐条报出", () => {
        expect(readManifest(JSON.stringify({schemaVersion: 1, ...IDENTITY, version: VERSION, hash: HASH, artifact: {file: "stable-win-x64-NeuroBook.tar.zst"}}), true).problems[0]).toContain("tarSha256");
        const wrong = readManifest(JSON.stringify({schemaVersion: 2, ...IDENTITY, identifier: "io.github.notnotype.neurobook.t10test", version: VERSION, hash: HASH, artifact: {file: "stable-linux-x64-NeuroBook.tar.zst"}}), false);
        expect(wrong.problems).toHaveLength(3);
    });
});

describe("本地这批更新文件自洽", () => {
    it("两份清单指向同一目标，完整包解压后与 v2 的摘要相同，包里 version.json 是正式身份与更新源：没有问题", async () => {
        const {directory} = await feed();
        expect((await localFeedProblems(VERSION, directory, BASE_URL)).problems).toEqual([]);
    });

    it("GNU 格式（长名条目）的 tar 也读得到 version.json", async () => {
        const {directory} = await feed({format: "gnu"});
        expect((await localFeedProblems(VERSION, directory, BASE_URL)).problems).toEqual([]);
    });

    it("文件字节不变，v2 的 tarSha256 被改错：报出（更新器会以 ArchiveHashMismatch 失败）", async () => {
        const {directory} = await feed({change: (v2) => ((v2.artifact as Record<string, unknown>).tarSha256 = "0".repeat(64))});
        const {problems} = await localFeedProblems(VERSION, directory, BASE_URL);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("ArchiveHashMismatch");
    });

    it("v2 缺 tarSha256 与 tarSize：报出", async () => {
        const {directory} = await feed({change: (v2) => (v2.artifact = {file: "stable-win-x64-NeuroBook.tar.zst"})});
        expect((await localFeedProblems(VERSION, directory, BASE_URL)).problems.join("\n")).toContain("tarSha256");
    });

    it("v1 与 v2 指向不同的哈希、版本不是本次：报出", async () => {
        const {directory} = await feed({change: (v2, v1) => {
            v1.hash = "other";
            v2.version = "0.12.1";
        }});
        const {problems} = await localFeedProblems(VERSION, directory, BASE_URL);
        expect(problems.some((problem) => problem.includes("update.json 的 hash"))).toBe(true);
        expect(problems.some((problem) => problem.includes("版本是 0.12.1"))).toBe(true);
    });

    it("包里的 version.json 指着本机更新源（测试包混进了正式资产）：报出", async () => {
        const {directory} = await feed({info: {baseUrl: "http://127.0.0.1:47819"}});
        expect((await localFeedProblems(VERSION, directory, BASE_URL)).problems[0]).toContain("baseUrl");
    });
});

describe("远端照更新器的取法取", () => {
    it("经两次重定向取到四个文件（含补丁），字节都与冻结的资产相同；查询串是更新器与 Hutch 的形状；每一跳都记下", async () => {
        const {directory, digests} = await feed();
        const {base, queries} = await githubLike(directory);
        const records = await remoteFeedRecords(base, digests);
        expect(records.map((record) => [record.asset, record.ok])).toEqual([
            ["stable-win-x64-update-v2.json", true],
            ["stable-win-x64-update.json", true],
            ["stable-win-x64-NeuroBook.tar.zst", true],
            ["stable-win-x64-1pgfu5evhc1gh.patch", true],
        ]);
        expect(records[0]?.hops.map((hop) => hop.status)).toEqual([302, 302, 200]);
        expect(queries.get("stable-win-x64-update-v2.json")).toMatch(/^\?[a-f0-9]{16}$/);
        for (const name of ["stable-win-x64-update.json", "stable-win-x64-NeuroBook.tar.zst", "stable-win-x64-1pgfu5evhc1gh.patch"]) expect(queries.get(name)).toMatch(/^\?cache=[a-f0-9]{32}$/);
    });

    it("远端的完整包与冻结的不同、补丁 404：报出，其余照常记录", async () => {
        const {directory, digests} = await feed();
        const {base} = await githubLike(directory, {"stable-win-x64-NeuroBook.tar.zst": {status: 200, body: "other"}, "stable-win-x64-1pgfu5evhc1gh.patch": {status: 404}});
        const records = await remoteFeedRecords(base, digests);
        expect(records.filter((record) => !record.ok).map((record) => [record.asset, record.problem])).toEqual([
            ["stable-win-x64-NeuroBook.tar.zst", "与冻结的资产 SHA-256 不同"],
            ["stable-win-x64-1pgfu5evhc1gh.patch", "HTTP 404"],
        ]);
    });

    it("补丁按冻结的资产列出（清单里没有补丁列表）；没有补丁时只取三个", () => {
        expect(feedRequests(["stable-win-x64-update-v2.json", "SHA256SUMS"]).map((request) => request.asset)).toHaveLength(3);
        expect(feedRequests(["stable-win-x64-abc.patch", "stable-win-x64-def.patch"]).map((request) => request.asset).slice(3)).toEqual(["stable-win-x64-abc.patch", "stable-win-x64-def.patch"]);
    });
});

describe("tar 读法", () => {
    it("找不到要的条目时返回 null", async () => {
        const {directory} = await feed();
        const {zstdDecompressSync} = await import("node:zlib");
        const tar = zstdDecompressSync(await readFile(join(directory, "stable-win-x64-NeuroBook.tar.zst")));
        expect(readTarEntry(tar, (path) => path === "missing")).toBeNull();
        expect(readTarEntry(tar, (path) => path.endsWith("a-rather-long-package-name-to-pass-the-limit/index.js"))?.path).toContain("@oh-my-pi");
    });
});
