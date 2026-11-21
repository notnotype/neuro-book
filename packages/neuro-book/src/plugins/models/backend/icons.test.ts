/**
 * 服务商图标的文件存放与读取路由（docs/specs/models/service.md 输出 12）：真实文件与真实的 Hono 路由，`app.request` 发请求。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createIconRoutes, fileIconStore} from "./icons";
import {loadInstallSecret} from "./secret";

/** 1×1 的 PNG。 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const NAME = `${createHash("sha256").update(PNG).digest("hex")}.png`;

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-models", "icons");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("图标文件存放", () => {
    test("保存原子落盘、不留暂存文件；列出只含合规文件名；删除不存在的算成功", async () => {
        const directory = join(tmp, "store");
        const store = fileIconStore(directory);
        expect(await store.list()).toEqual([]);
        await store.save(NAME, PNG);
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, "notes.txt"), "不相干的文件");
        expect(await store.list()).toEqual([NAME]);
        expect((await readdir(directory)).sort()).toEqual([NAME, "notes.txt"].sort());
        expect(new Uint8Array(await readFile(join(directory, NAME)))).toEqual(new Uint8Array(PNG));
        await store.remove(NAME);
        await store.remove(NAME);
        expect(await store.list()).toEqual([]);
    });
});

describe("图标路由", () => {
    test("只给合规名字的 PNG：带 nosniff 与 ETag，同一个 ETag 回 304；不合规的名字、不存在、链接、不是 PNG、跨站的都不给", async () => {
        const directory = join(tmp, "route");
        await mkdir(directory, {recursive: true});
        await writeFile(join(directory, NAME), PNG);
        const fake = `${"a".repeat(64)}.png`;
        await writeFile(join(directory, fake), "不是图片");
        await writeFile(join(tmp, "outside.png"), PNG);
        const linked = `${"b".repeat(64)}.png`;
        await symlink(join(tmp, "outside.png"), join(directory, linked));
        const app = createIconRoutes(directory);

        const found = await app.request(`/icons/${NAME}`);
        expect(found.status).toBe(200);
        expect(found.headers.get("content-type")).toBe("image/png");
        expect(found.headers.get("x-content-type-options")).toBe("nosniff");
        const etag = found.headers.get("etag")!;
        expect(new Uint8Array(await found.arrayBuffer())).toEqual(new Uint8Array(PNG));
        expect((await app.request(`/icons/${NAME}`, {headers: {"if-none-match": etag}})).status).toBe(304);

        for (const name of ["../x.png", "plain.png", fake, linked, `${"c".repeat(64)}.png`]) expect((await app.request(`/icons/${name}`)).status).toBe(404);
        expect((await app.request(`/icons/${NAME}`, {headers: {"sec-fetch-site": "cross-site"}})).status).toBe(403);
        expect((await app.request(`/icons/${NAME}`, {headers: {"sec-fetch-site": "same-origin"}})).status).toBe(200);
    });
});

describe("安装的随机密钥", () => {
    test("第一次生成并只给本人读写，之后一直沿用；文件被手改坏了就重新生成并写回", async () => {
        const path = join(tmp, "agent", "identity.key");
        const first = await loadInstallSecret(path);
        expect(first).toMatch(/^[a-f0-9]{64}$/u);
        expect(await loadInstallSecret(path)).toBe(first);
        await writeFile(path, "坏了");
        const regenerated = await loadInstallSecret(path);
        expect(regenerated).toMatch(/^[a-f0-9]{64}$/u);
        expect(regenerated).not.toBe(first);
        expect((await readFile(path, "utf8")).trim()).toBe(regenerated);
    });
});
