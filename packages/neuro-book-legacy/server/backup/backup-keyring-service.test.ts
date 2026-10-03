import {createHash, randomBytes} from "node:crypto";
import {mkdtemp, readFile, rm, stat} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    backupKeyId,
    BackupKeyringService,
    decodeBackupRecoveryCode,
    encodeBackupRecoveryCode,
} from "nbook/server/backup/backup-keyring-service";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

/**
 * 创建隔离 State Root 与对应 Runtime Paths。
 */
async function fixturePaths() {
    const root = await mkdtemp(testHostPath("nbook-keyring-"));
    cleanupRoots.push(root);
    return createRuntimePaths({applicationRoot: absoluteFsPath(root), stateRoot: absoluteFsPath(root)});
}

describe("backup recovery code", () => {
    it("固定编码 32 字节 key、43 字符 base64url 与 8 字符 checksum", () => {
        const key = randomBytes(32);
        const code = encodeBackupRecoveryCode(key);
        expect(code).toMatch(/^NBK1-[A-Za-z0-9_-]{43}-[0-9a-f]{8}$/);
        expect(code.split("-").at(-1)).toBe(createHash("sha256").update(key).digest("hex").slice(0, 8));
        expect(decodeBackupRecoveryCode(code)).toEqual({keyId: backupKeyId(key), key});
    });

    it("拒绝错误 checksum、大小写和截断恢复码", () => {
        const code = encodeBackupRecoveryCode(randomBytes(32));
        const replacement = code.endsWith("0") ? "1" : "0";
        expect(() => decodeBackupRecoveryCode(`${code.slice(0, -1)}${replacement}`)).toThrow(/校验失败/);
        expect(() => decodeBackupRecoveryCode(code.replace("NBK1", "nbk1"))).toThrow(/格式无效/);
        expect(() => decodeBackupRecoveryCode(code.slice(0, -2))).toThrow(/格式无效/);
    });
});

describe("BackupKeyringService", () => {
    it("取消后重复 prepare 复用同一 pending key，confirm 后才成为 active", async () => {
        const paths = await fixturePaths();
        const service = new BackupKeyringService();
        const first = await service.prepare(paths);
        const second = await service.prepare(paths);

        expect(second).toEqual(first);
        expect((await service.status(paths)).activeKeyId).toBeNull();
        expect(await service.activeKey(paths)).toBeNull();

        const confirmed = await service.confirm(paths, first.key.keyId);
        expect(confirmed.activeKeyId).toBe(first.key.keyId);
        expect((await service.activeKey(paths))?.keyId).toBe(first.key.keyId);
        expect(await service.export(paths, first.key.keyId)).toBe(first.recoveryCode);
    });

    it("轮换只改变状态，不删除 historical key", async () => {
        const paths = await fixturePaths();
        const service = new BackupKeyringService();
        const first = await service.prepare(paths);
        await service.confirm(paths, first.key.keyId);
        const rotation = await service.prepare(paths);
        await service.confirm(paths, rotation.key.keyId);

        const status = await service.status(paths);
        expect(status.keys).toEqual([
            expect.objectContaining({keyId: first.key.keyId, state: "historical"}),
            expect.objectContaining({keyId: rotation.key.keyId, state: "active"}),
        ]);
        expect(await service.export(paths, first.key.keyId)).toBe(first.recoveryCode);
    });

    it("导入密钥在无 active 时激活，有 active 时保存为 historical", async () => {
        const paths = await fixturePaths();
        const service = new BackupKeyringService();
        const importedCode = encodeBackupRecoveryCode(randomBytes(32));
        const firstStatus = await service.import(paths, importedCode);
        const importedKeyId = decodeBackupRecoveryCode(importedCode).keyId;
        expect(firstStatus.activeKeyId).toBe(importedKeyId);

        const secondCode = encodeBackupRecoveryCode(randomBytes(32));
        const secondKeyId = decodeBackupRecoveryCode(secondCode).keyId;
        const secondStatus = await service.import(paths, secondCode);
        expect(secondStatus.keys).toContainEqual(expect.objectContaining({keyId: secondKeyId, state: "historical"}));
    });

    it("原子文件使用受限权限，且不把恢复码明文写入 JSON", async () => {
        const paths = await fixturePaths();
        const prepared = await new BackupKeyringService().prepare(paths);
        const raw = await readFile(paths.backupKeyringPath, "utf8");

        expect(raw).not.toContain("NBK1-");
        expect(raw).not.toContain(prepared.recoveryCode);
        if (process.platform !== "win32") {
            expect((await stat(paths.secretsRoot)).mode & 0o777).toBe(0o700);
            expect((await stat(paths.backupKeyringPath)).mode & 0o777).toBe(0o600);
        }
    });

    it("并发 prepare 仍只生成一把 pending key", async () => {
        const paths = await fixturePaths();
        const service = new BackupKeyringService();
        const prepared = await Promise.all(Array.from({length: 8}, () => service.prepare(paths)));
        expect(new Set(prepared.map((item) => item.key.keyId)).size).toBe(1);
        expect((await service.status(paths)).keys).toHaveLength(1);
    });
});
