/**
 * 模型来源的文件存放（docs/specs/models/service.md“模型来源”）：真实文件。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {sourceKeyOf} from "@notnotype/nb-models/core";

import {fileSourceStore} from "./source-store";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-models", "sources");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const A = sourceKeyOf("0123abcd");
const LEGACY = sourceKeyOf("legacy:local");

describe("来源文件存放", () => {
    test("写了读得回；列出只含自己的文件；不留暂存文件；删除不存在的算成功；不是定长键的拒绝", async () => {
        const root = join(tmp, "round-trip");
        const store = fileSourceStore(root);
        expect(await store.read(A)).toBeNull();
        expect(await store.list()).toEqual([]);
        await store.write(A, {version: 1, rows: [{id: "m"}]});
        await store.write(LEGACY, {version: 1, rows: []});
        await writeFile(join(root, "agent", "model-sources", "notes.txt"), "不相干");
        expect(await store.read(A)).toEqual({version: 1, rows: [{id: "m"}]});
        expect([...(await store.list())].sort()).toEqual([A, LEGACY].sort());
        expect((await readdir(join(root, "agent", "model-sources"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
        await store.remove(A);
        await store.remove(A);
        expect(await store.list()).toEqual([LEGACY]);
        await expect(store.write("legacy:local", {})).rejects.toThrow();

        expect(await store.readCatalog()).toBeNull();
        await store.writeCatalog({version: 1, etag: null});
        expect(await store.readCatalog()).toEqual({version: 1, etag: null});
    });

    test("坏文件读时抛错（由服务核心写诊断、按没有缓存处理）", async () => {
        const root = join(tmp, "broken");
        const store = fileSourceStore(root);
        await store.write(A, {ok: true});
        await writeFile(join(root, "agent", "model-sources", `${A}.json`), "{not json");
        await expect(store.read(A)).rejects.toThrow();
    });

    test.skipIf(process.platform === "win32")("目录被换成链接时不读、不列、不写，也不在链接指向的地方建目录", async () => {
        const root = join(tmp, "linked");
        const elsewhere = join(tmp, "elsewhere");
        await mkdir(join(root, "agent"), {recursive: true});
        await mkdir(elsewhere, {recursive: true});
        await writeFile(join(elsewhere, `${A}.json`), JSON.stringify({stolen: true}));
        await symlink(elsewhere, join(root, "agent", "model-sources"));
        const store = fileSourceStore(root);
        expect(await store.read(A)).toBeNull();
        expect(await store.list()).toEqual([]);
        await expect(store.write(LEGACY, {})).rejects.toThrow();
        expect(await readdir(elsewhere)).toEqual([`${A}.json`]);

        const agentLinked = join(tmp, "agent-linked");
        const target = join(tmp, "agent-target");
        await mkdir(agentLinked, {recursive: true});
        await mkdir(target, {recursive: true});
        await symlink(target, join(agentLinked, "agent"));
        await expect(fileSourceStore(agentLinked).write(A, {})).rejects.toThrow();
        expect(await readdir(target)).toEqual([]);
    });
});
