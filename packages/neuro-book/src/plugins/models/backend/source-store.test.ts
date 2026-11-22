/**
 * 模型来源的文件存放（docs/specs/models/service.md“模型来源”）：真实文件。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {fileSourceStore} from "./source-store";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-models", "sources");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("来源文件存放", () => {
    test("写了读得回；v1 的 `legacy:<id>` 也能作文件名；列出只含自己的文件；不留暂存文件；删除不存在的算成功", async () => {
        const root = join(tmp, "round-trip");
        const store = fileSourceStore(root);
        expect(await store.read("0123abcd")).toBeNull();
        expect(await store.list()).toEqual([]);
        await store.write("0123abcd", {version: 1, rows: [{id: "m"}]});
        await store.write("legacy:local", {version: 1, rows: []});
        await writeFile(join(root, "agent", "model-sources", "notes.txt"), "不相干");
        expect(await store.read("0123abcd")).toEqual({version: 1, rows: [{id: "m"}]});
        expect(await store.read("legacy:local")).toEqual({version: 1, rows: []});
        expect([...(await store.list())].sort()).toEqual(["0123abcd", "legacy:local"]);
        expect((await readdir(join(root, "agent", "model-sources"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
        await store.remove("0123abcd");
        await store.remove("0123abcd");
        expect(await store.list()).toEqual(["legacy:local"]);

        expect(await store.readCatalog()).toBeNull();
        await store.writeCatalog({version: 1, etag: null});
        expect(await store.readCatalog()).toEqual({version: 1, etag: null});
    });

    test("坏文件读时抛错（由服务核心写诊断、按没有缓存处理）", async () => {
        const root = join(tmp, "broken");
        const store = fileSourceStore(root);
        await store.write("aa", {ok: true});
        await writeFile(join(root, "agent", "model-sources", `${Buffer.from("aa").toString("hex")}.json`), "{not json");
        await expect(store.read("aa")).rejects.toThrow();
    });

    test.skipIf(process.platform === "win32")("目录被换成链接时不读、不列、不写", async () => {
        const root = join(tmp, "linked");
        const elsewhere = join(tmp, "elsewhere");
        await mkdir(join(root, "agent"), {recursive: true});
        await mkdir(elsewhere, {recursive: true});
        await writeFile(join(elsewhere, `${Buffer.from("aa").toString("hex")}.json`), JSON.stringify({stolen: true}));
        await symlink(elsewhere, join(root, "agent", "model-sources"));
        const store = fileSourceStore(root);
        expect(await store.read("aa")).toBeNull();
        expect(await store.list()).toEqual([]);
        await expect(store.write("bb", {})).rejects.toThrow();
        expect(await readdir(elsewhere)).toHaveLength(1);
    });
});
