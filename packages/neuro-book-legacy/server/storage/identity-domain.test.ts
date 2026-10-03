import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {storageIdentityFilePath} from "nbook/server/storage/storage-address";
import {ensureStorageIdentityDomain, STORAGE_IDENTITY_SCHEMA} from "nbook/server/storage/identity-domain";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => rm(root, {recursive: true, force: true})));
});

async function createRoot(prefix: string): Promise<AbsoluteFsPath> {
    const scratch = await mkdtemp(testHostPath(prefix));
    roots.push(scratch);
    return absoluteFsPath(path.join(scratch, "storage"));
}

describe("ensureStorageIdentityDomain", () => {
    it("首次初始化创建身份域元数据，重复调用保持同一身份域", async () => {
        const root = await createRoot("nbook-storage-identity-");
        const created = await ensureStorageIdentityDomain(root);
        expect(created.created).toBe(true);
        expect(created.identityDomain).toMatch(/^[0-9a-f-]{36}$/u);

        const persisted = JSON.parse(await readFile(storageIdentityFilePath(root), "utf8")) as {
            readonly schema: string;
            readonly identityDomain: string;
        };
        expect(persisted).toEqual({schema: STORAGE_IDENTITY_SCHEMA, identityDomain: created.identityDomain});

        await expect(ensureStorageIdentityDomain(root)).resolves.toEqual({
            identityDomain: created.identityDomain,
            created: false,
        });
    });

    it("并发初始化受锁保护并返回同一身份域", async () => {
        const root = await createRoot("nbook-storage-identity-race-");
        const results = await Promise.all(Array.from({length: 4}, async () => ensureStorageIdentityDomain(root)));

        expect(new Set(results.map((result) => result.identityDomain)).size).toBe(1);
        expect(results.filter((result) => result.created)).toHaveLength(1);
    });

    it("独立 data 得到不同身份域", async () => {
        const first = await ensureStorageIdentityDomain(await createRoot("nbook-storage-identity-a-"));
        const second = await ensureStorageIdentityDomain(await createRoot("nbook-storage-identity-b-"));
        expect(first.identityDomain).not.toBe(second.identityDomain);
    });

    it("身份域元数据损坏或封装不受支持时与缺失区分", async () => {
        const root = await createRoot("nbook-storage-identity-broken-");
        await ensureStorageIdentityDomain(root);
        const identityPath = storageIdentityFilePath(root);

        for (const content of [
            "{broken\n",
            `${JSON.stringify({schema: "nbook.storage-identity/v2", identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90"})}\n`,
            `${JSON.stringify({schema: STORAGE_IDENTITY_SCHEMA, identityDomain: "../escape"})}\n`,
        ]) {
            await writeFile(identityPath, content, "utf8");
            await expect(ensureStorageIdentityDomain(root)).rejects.toMatchObject({code: "STORAGE_IDENTITY_INVALID"});
        }
    });
});
