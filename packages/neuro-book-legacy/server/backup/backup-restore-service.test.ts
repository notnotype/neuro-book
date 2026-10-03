import {createHash, randomBytes} from "node:crypto";
import {createServer, type Server} from "node:http";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {strToU8, zipSync} from "fflate";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {BackupRestoreService} from "nbook/server/backup/backup-restore-service";
import {backupKeyId, type BackupEncryptionKey} from "nbook/server/backup/backup-keyring-service";
import {createBackupEnvelopeCipher} from "nbook/server/backup/backup-envelope";
import {OFFICIAL_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";

// 恢复服务：本地起最小 HTTP 服务当"官方站"，覆盖 sha256 校验拒收、
// zip-slip 条目拒绝、正常解包到 State Root 同级 restore-<ts>/ 目录。

let httpServer: Server | null = null;
let baseUrl = "";
let parentDir = "";
let stateRoot = "";

/** 当前服务的归档字节（每个用例替换） */
let servedBackup = new Uint8Array();
let requestedUrls: string[] = [];
const keyBytes = randomBytes(32);
const encryptionKey: BackupEncryptionKey = {keyId: backupKeyId(keyBytes), key: keyBytes};

function makeZip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync({
        "nb-backup.json": strToU8(JSON.stringify({formatVersion: 2, appVersion: "0.0.0-test", createdAt: "2026-07-22T00:00:00.000Z", encryption: "AES-256-GCM"})),
        ...entries,
    });
}

/**
 * 把测试 zip 包装为正式 NBOOKBK1 envelope。
 */
function makeBackup(entries: Record<string, Uint8Array>, key: BackupEncryptionKey = encryptionKey): Uint8Array {
    const zip = makeZip(entries);
    const envelope = createBackupEnvelopeCipher(key);
    return Buffer.concat([
        envelope.prefix,
        envelope.cipher.update(zip),
        envelope.cipher.final(),
        envelope.cipher.getAuthTag(),
    ]);
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
    parentDir = await mkdtemp(testHostPath("nbook-restore-"));
    stateRoot = join(parentDir, "data");

    httpServer = createServer((request, response) => {
        response.writeHead(200, {"content-type": "application/vnd.neurobook.backup", "x-nb-sha256": sha256Hex(servedBackup)});
        response.end(Buffer.from(servedBackup));
    });
    await new Promise<void>((resolveListen) => httpServer!.listen(0, "127.0.0.1", resolveListen));
    const address = httpServer.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
    await new Promise<void>((resolveClose) => httpServer?.close(() => resolveClose()));
    await rm(parentDir, {recursive: true, force: true}).catch(() => undefined);
});

beforeEach(() => {
    requestedUrls = [];
});

function service(): BackupRestoreService {
    return new BackupRestoreService(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        requestedUrls.push(url);
        return await fetch(url.replace(OFFICIAL_PASSPORT_SITE_URL, baseUrl), init);
    });
}

function paths() {
    return createRuntimePaths({
        applicationRoot: absoluteFsPath(stateRoot),
        stateRoot: absoluteFsPath(stateRoot),
    });
}

describe("BackupRestoreService", () => {
    it("正常恢复：解包到 State Root 同级 restore-<ts>/，manifest 校验通过", async () => {
        servedBackup = makeBackup({
            "workspace/manuscript/a.md": strToU8("# hello"),
            "config.yaml": strToU8("auth:\n  enabled: true\n"),
        });
        const result = await service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 1,
            expectedSha256: sha256Hex(servedBackup),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey,
            fileSizeHint: servedBackup.byteLength,
        });

        expect(result.appVersion).toBe("0.0.0-test");
        expect(requestedUrls).toEqual([`${OFFICIAL_PASSPORT_SITE_URL}/api/v1/backups/1/download`]);
        expect(result.fileCount).toBe(3); // nb-backup.json + a.md + config.yaml
        // 落点在 State Root 同级
        const siblings = await readdir(parentDir);
        expect(siblings.some((name) => name.startsWith("restore-"))).toBe(true);
        const restored = await readFile(join(result.restoreDir, "workspace", "manuscript", "a.md"), "utf8");
        expect(restored).toBe("# hello");
        const restoredKeyring = JSON.parse(await readFile(join(result.restoreDir, "secrets", "backup-keyring.json"), "utf8")) as {
            keys: Array<{keyId: string; state: string}>;
        };
        expect(restoredKeyring.keys).toEqual([expect.objectContaining({keyId: encryptionKey.keyId, state: "active"})]);
        // part 中转文件已清理
        expect(siblings.some((name) => name.endsWith(".nbbackup.part"))).toBe(false);
    });

    it("sha256 不一致拒收且不留半成品", async () => {
        servedBackup = makeBackup({"workspace/b.md": strToU8("b")});
        await expect(service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 2,
            expectedSha256: "0".repeat(64),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey,
            fileSizeHint: servedBackup.byteLength,
        })).rejects.toThrow(/sha256/);
    });

    it("GCM 认证失败时不释放任何恢复内容", async () => {
        servedBackup = makeBackup({"workspace/tampered.md": strToU8("secret")});
        servedBackup[servedBackup.byteLength - 1] ^= 1;
        await expect(service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 3,
            expectedSha256: sha256Hex(servedBackup),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey,
            fileSizeHint: servedBackup.byteLength,
        })).rejects.toThrow(/认证失败/);
        const siblings = await readdir(parentDir);
        expect(siblings.some((name) => name.endsWith(".nbbackup.part"))).toBe(false);
    });

    it("keyId 相同但密钥错误时拒绝恢复", async () => {
        servedBackup = makeBackup({"workspace/wrong-key.md": strToU8("secret")});
        await expect(service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 4,
            expectedSha256: sha256Hex(servedBackup),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey: {keyId: encryptionKey.keyId, key: randomBytes(32)},
            fileSizeHint: servedBackup.byteLength,
        })).rejects.toThrow(/认证失败/);
    });

    it("zip-slip 条目直接失败", async () => {
        servedBackup = makeBackup({
            "../escape.txt": strToU8("bad"),
        });
        await expect(service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 5,
            expectedSha256: sha256Hex(servedBackup),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey,
            fileSizeHint: servedBackup.byteLength,
        })).rejects.toThrow(/非法路径/);
        // 逃逸文件不存在
        await expect(readFile(join(parentDir, "escape.txt"))).rejects.toThrow();
    });

    it("旧明文 zip 直接拒绝", async () => {
        servedBackup = makeZip({"workspace/legacy.md": strToU8("legacy")});
        await expect(service().restore({
            paths: paths(),
            token: "nbp_at_test",
            backupId: 6,
            expectedSha256: sha256Hex(servedBackup),
            expectedKeyId: encryptionKey.keyId,
            encryptionKey,
            fileSizeHint: servedBackup.byteLength,
        })).rejects.toThrow(/加密格式/);
    });
});
