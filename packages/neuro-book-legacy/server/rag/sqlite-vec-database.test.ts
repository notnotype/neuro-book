import {mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {openSqliteVecDatabase} from "nbook/server/rag/sqlite-vec-database";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(removeTestRoot));
});

describe("SQLite Vec Database", () => {
    it("使用跨平台libsql驱动加载扩展并执行向量召回", async () => {
        const root = await mkdtemp(testHostPath("nbook-sqlite-vec-query-"));
        roots.push(root);
        const db = await openSqliteVecDatabase({path: join(root, "vec.sqlite"), loadExtension: true});
        try {
            db.run("CREATE VIRTUAL TABLE vec_smoke USING vec0(embedding float[2])");
            db.run("INSERT INTO vec_smoke(rowid, embedding) VALUES (?, ?)", 1, new Float32Array([1, 0]));

            const rows = db.query("SELECT rowid FROM vec_smoke WHERE embedding MATCH ? ORDER BY distance LIMIT 1")
                .all(new Float32Array([1, 0])) as Array<{rowid: number | bigint}>;

            expect(Number(rows[0]?.rowid)).toBe(1);
        } finally {
            db.close();
        }
        await expect(rm(root, {recursive: true})).resolves.toBeUndefined();
        roots.splice(roots.indexOf(root), 1);
    });

    it("初始化失败时释放数据库句柄", async () => {
        const root = await mkdtemp(testHostPath("nbook-sqlite-vec-"));
        roots.push(root);
        const path = join(root, "vec.sqlite");

        await expect(openSqliteVecDatabase({
            path,
            loadExtension: true,
            initialize(db) {
                db.run("CREATE TABLE initialized (id INTEGER PRIMARY KEY)");
                throw new Error("injected initialization failure");
            },
        })).rejects.toThrow("injected initialization failure");

        await expect(rm(root, {recursive: true})).resolves.toBeUndefined();
        roots.splice(roots.indexOf(root), 1);
    });

    it("只读连接拒绝写入且不会创建缺失数据库", async () => {
        const root = await mkdtemp(testHostPath("nbook-sqlite-vec-readonly-"));
        roots.push(root);
        const path = join(root, "vec.sqlite");
        const writable = await openSqliteVecDatabase({path, loadExtension: false});
        writable.run("CREATE TABLE readonly_smoke (id INTEGER PRIMARY KEY)");
        writable.close();

        const readonly = await openSqliteVecDatabase({path, readonly: true, loadExtension: false});
        try {
            expect(() => readonly.run("INSERT INTO readonly_smoke(id) VALUES (1)")).toThrow();
        } finally {
            readonly.close();
        }

        await expect(openSqliteVecDatabase({
            path: join(root, "missing.sqlite"),
            readonly: true,
            loadExtension: false,
        })).rejects.toMatchObject({code: "ENOENT"});
    });
});

/** Windows libsql native handle 释放可能晚于 close，测试清理做有限重试。 */
async function removeTestRoot(root: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            const busy = error instanceof Error && "code" in error && error.code === "EBUSY";
            if (!busy || attempt === 19) throw error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
}
