/**
 * 密钥文件（docs/specs/web/tools.md 输出 13、15）：真实的文件与锁。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createKeyStore} from "./backend/keys";

let root = "";
let counter = 0;
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-web", "密钥文件");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function store() {
    counter += 1;
    const events: string[] = [];
    const path = join(root, `state-${String(counter)}`, "web", "keys.json");
    return {path, events, keys: createKeyStore(path, (_level, event) => events.push(event))};
}

describe("密钥文件（输出 15）", () => {
    it("文件不存在时没有密钥，读不建文件", async () => {
        const {path, keys} = store();
        expect(await keys.read("deepseek")).toEqual({ok: true, key: null});
        expect(await keys.status()).toEqual({ok: true, status: {providers: {deepseek: {hasKey: false}}}});
        expect(await stat(path).catch(() => null)).toBeNull();
    });

    it("写入后文件只有本用户可读写，换一个读者照样读到；清除后文件里没有这把密钥", async () => {
        const {path, keys} = store();
        expect(await keys.set("deepseek", "sk-first-not-real")).toEqual({ok: true, status: {providers: {deepseek: {hasKey: true}}}});
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await createKeyStore(path, () => undefined).read("deepseek")).toEqual({ok: true, key: "sk-first-not-real"});

        expect((await keys.set("deepseek", "sk-second-not-real")).ok).toBe(true);
        expect(await keys.read("deepseek")).toEqual({ok: true, key: "sk-second-not-real"});

        expect(await keys.clear("deepseek")).toEqual({ok: true, status: {providers: {deepseek: {hasKey: false}}}});
        const text = await readFile(path, "utf8");
        expect(text).not.toContain("sk-first-not-real");
        expect(text).not.toContain("sk-second-not-real");
        expect(JSON.parse(text)).toEqual({version: 1, keys: {}});
    });

    it("文件坏了：读得失败并记诊断；写入照常覆盖它、记 keys-file-replaced，之后读得到", async () => {
        const {path, keys, events} = store();
        expect((await keys.set("deepseek", "sk-old-not-real")).ok).toBe(true);
        await writeFile(path, "{not json");
        expect(await keys.read("deepseek")).toMatchObject({ok: false});
        expect(await keys.status()).toMatchObject({ok: false});
        expect(events).toContain("web.keys-file-unreadable");

        expect(await keys.set("deepseek", "sk-new-not-real")).toEqual({ok: true, status: {providers: {deepseek: {hasKey: true}}}});
        expect(events).toContain("web.keys-file-replaced");
        expect(await keys.read("deepseek")).toEqual({ok: true, key: "sk-new-not-real"});
    });

    it("不认识的版本按解析不了处理，不改写", async () => {
        const {path, keys} = store();
        expect((await keys.set("deepseek", "sk-a-not-real")).ok).toBe(true);
        await writeFile(path, JSON.stringify({version: 2, keys: {deepseek: "sk-a-not-real"}}));
        expect(await keys.read("deepseek")).toMatchObject({ok: false});
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({version: 2, keys: {deepseek: "sk-a-not-real"}});
    });

    it("两个读者同时写不同的值：都成功，文件是其中一个、仍是合法的", async () => {
        const {path, keys} = store();
        const other = createKeyStore(path, () => undefined);
        const results = await Promise.all([keys.set("deepseek", "sk-one-not-real"), other.set("deepseek", "sk-two-not-real")]);
        expect(results.every((result) => result.ok)).toBe(true);
        const read = await keys.read("deepseek");
        if (!read.ok) throw new Error("unreadable");
        expect(read.key === "sk-one-not-real" || read.key === "sk-two-not-real").toBe(true);
    });
});
