import {createHash, randomBytes} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {strFromU8, unzipSync} from "fflate";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {BackupArchiveService} from "nbook/server/backup/backup-archive-service";
import {backupKeyId, type BackupEncryptionKey} from "nbook/server/backup/backup-keyring-service";
import {
    createBackupCiphertextStream,
    createBackupEnvelopeDecipher,
    inspectBackupEnvelope,
    verifyBackupEnvelope,
} from "nbook/server/backup/backup-envelope";

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {...actual, readdir: vi.fn(actual.readdir)};
});

// 归档服务端到端：假 State Root（含真实 SQLite）打包 → 解包断言条目集、
// 排除规则生效、SQLite 走冷快照、nb-backup.json 合法、sha256 与产物一致。

let fixtureRoot = "";
let tmpDir = "";

beforeAll(async () => {
    fixtureRoot = await mkdtemp(testHostPath("nbook-archive-fixture-"));
    tmpDir = await mkdtemp(testHostPath("nbook-archive-out-"));

    // 假 State Root：workspace 正文 + 应用库（真 SQLite）+ 顶层 config/.env + 应排除物
    await mkdir(join(fixtureRoot, "workspace", "novel-a", "manuscript"), {recursive: true});
    await mkdir(join(fixtureRoot, "workspace", ".nbook"), {recursive: true});
    await mkdir(join(fixtureRoot, "logs"), {recursive: true});
    await mkdir(join(fixtureRoot, "secrets"), {recursive: true});
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "manuscript", "chapter-1.md"), "# 第一章\n正文内容");
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "draft.tmp"), "temp");
    await writeFile(join(fixtureRoot, "workspace", "novel-a", "editor.lock"), "lock");
    await writeFile(join(fixtureRoot, "logs", "app.log"), "log line");
    await writeFile(join(fixtureRoot, "secrets", "backup-keyring.json"), "must not leak");
    await writeFile(join(fixtureRoot, "config.yaml"), "auth:\n  enabled: true\n");
    await writeFile(join(fixtureRoot, ".env"), "SECRET=1\n");

    const dbPath = join(fixtureRoot, "workspace", ".nbook", "neuro-book.sqlite").replaceAll("\\", "/");
    const client = createClient({url: `file:${dbPath}`});
    await client.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)");
    await client.execute("INSERT INTO demo (name) VALUES ('hello')");
    client.close();
});

afterAll(async () => {
    await rm(fixtureRoot, {recursive: true, force: true}).catch(() => undefined);
    await rm(tmpDir, {recursive: true, force: true}).catch(() => undefined);
});

describe("BackupArchiveService", () => {
    it("Workspace 枚举失败时拒绝备份，不把不可读的产品数据当成空目录", async () => {
        const paths = createRuntimePaths({applicationRoot: absoluteFsPath(fixtureRoot), stateRoot: absoluteFsPath(fixtureRoot)});
        const denied = Object.assign(new Error("simulated permission failure"), {code: "EACCES"});
        vi.mocked(readdir).mockRejectedValueOnce(denied);
        const key = randomBytes(32);
        await expect(new BackupArchiveService().createArchive(paths, tmpDir, {keyId: backupKeyId(key), key}))
            .rejects.toBe(denied);
    });

    it("完整 data 解密解包保留两个 Storage scope 与原件，排除锁和临时文件", async () => {
        const storageFixture = await mkdtemp(testHostPath("nbook-storage-backup-"));
        const output = await mkdtemp(testHostPath("nbook-storage-backup-out-"));
        try {
            const userRoot = "workspace/.nbook/storage";
            const projectRoot = "workspace/novel-a/.nbook/storage";
            const records = {
                [`${userRoot}/identity.json`]: '{"identityDomain":"fixture-domain"}',
                [`${userRoot}/records/value.json`]: '{"revision":"u1","state":"value","value":42}',
                [`${projectRoot}/records/value.json`]: '{"revision":"p1","state":"value","value":320}',
                [`${projectRoot}/records/deleted.json`]: '{"revision":"p2","state":"deleted"}',
                [`${projectRoot}/quarantine/broken.corrupt`]: "original\u0000bytes\n",
                [`${projectRoot}/quarantine/manual.tmp`]: "preserve unknown original",
            };
            const excluded = {
                [`${userRoot}/.locks/identity/owner.json`]: "locked",
                [`${projectRoot}/.locks/partition/owner.json`]: "locked",
                [`${projectRoot}/records/value.json.12345678-1234-1234-1234-123456789abc.tmp`]: "half-written",
            };
            for (const [relative, content] of Object.entries({...records, ...excluded})) {
                const file = join(storageFixture, relative);
                await mkdir(join(file, ".."), {recursive: true});
                await writeFile(file, content);
            }
            const paths = createRuntimePaths({applicationRoot: absoluteFsPath(storageFixture), stateRoot: absoluteFsPath(storageFixture)});
            const key = randomBytes(32);
            const encryptionKey: BackupEncryptionKey = {keyId: backupKeyId(key), key};
            const result = await new BackupArchiveService().createArchive(paths, output, encryptionKey);
            const envelope = await inspectBackupEnvelope(result.backupPath);
            await verifyBackupEnvelope(result.backupPath, envelope, encryptionKey);
            const chunks: Buffer[] = [];
            const decrypted = createBackupCiphertextStream(result.backupPath, envelope)
                .pipe(createBackupEnvelopeDecipher(envelope, encryptionKey));
            for await (const chunk of decrypted) chunks.push(Buffer.from(chunk));
            const files = unzipSync(Buffer.concat(chunks));
            expect(Object.keys(files).sort()).toEqual(["nb-backup.json", ...Object.keys(records)].sort());
            for (const [relative, content] of Object.entries(records)) {
                expect(Buffer.from(files[relative]!).toString()).toBe(content);
            }
        } finally {
            await rm(storageFixture, {recursive: true, force: true});
            await rm(output, {recursive: true, force: true});
        }
    });

    it("压缩直接进入密文 envelope：条目、摘要、排除和 SQLite 快照均正确", async () => {
        const paths = createRuntimePaths({
            applicationRoot: absoluteFsPath(fixtureRoot),
            stateRoot: absoluteFsPath(fixtureRoot),
        });
        const keyBytes = randomBytes(32);
        const encryptionKey: BackupEncryptionKey = {keyId: backupKeyId(keyBytes), key: keyBytes};
        const progress: Array<[number, number]> = [];
        const result = await new BackupArchiveService().createArchive(
            paths,
            tmpDir,
            encryptionKey,
            (done, total) => progress.push([done, total]),
        );

        expect(result.warnings).toEqual([]);
        expect(result.fileCount).toBe(4); // chapter-1.md + neuro-book.sqlite + config.yaml + .env
        expect(progress.at(-1)).toEqual([4, 4]);

        const envelopeBytes = await readFile(result.backupPath);
        expect(envelopeBytes.byteLength).toBe(result.fileSize);
        expect(result.keyId).toBe(encryptionKey.keyId);
        expect(createHash("sha256").update(envelopeBytes).digest("hex")).toBe(result.sha256);

        const envelope = await inspectBackupEnvelope(result.backupPath);
        expect(envelope.header.keyId).toBe(encryptionKey.keyId);
        await verifyBackupEnvelope(result.backupPath, envelope, encryptionKey);
        const decryptedChunks: Buffer[] = [];
        const decrypted = createBackupCiphertextStream(result.backupPath, envelope)
            .pipe(createBackupEnvelopeDecipher(envelope, encryptionKey));
        for await (const chunk of decrypted) {
            decryptedChunks.push(chunk as Buffer);
        }
        const zipBytes = Buffer.concat(decryptedChunks);

        const entries = unzipSync(new Uint8Array(zipBytes));
        expect(Object.keys(entries).sort()).toEqual([
            ".env",
            "config.yaml",
            "nb-backup.json",
            "workspace/.nbook/neuro-book.sqlite",
            "workspace/novel-a/manuscript/chapter-1.md",
        ]);

        const manifest = JSON.parse(strFromU8(entries["nb-backup.json"] as Uint8Array)) as {formatVersion: number; encryption: string};
        expect(manifest.formatVersion).toBe(2);
        expect(manifest.encryption).toBe("AES-256-GCM");
        expect(await readdir(tmpDir)).not.toContain("backup.zip");

        // SQLite 快照是能打开的一致性数据库
        const snapshotPath = join(tmpDir, "restored.sqlite");
        await writeFile(snapshotPath, entries["workspace/.nbook/neuro-book.sqlite"] as Uint8Array);
        const client = createClient({url: `file:${snapshotPath.replaceAll("\\", "/")}`});
        const rows = await client.execute("SELECT name FROM demo");
        client.close();
        expect(rows.rows[0]?.name).toBe("hello");
    });
});
