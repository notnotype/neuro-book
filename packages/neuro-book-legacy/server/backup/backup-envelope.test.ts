import {randomBytes} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {backupKeyId, type BackupEncryptionKey} from "nbook/server/backup/backup-keyring-service";
import {createBackupEnvelopeCipher, inspectBackupEnvelope, verifyBackupEnvelope} from "nbook/server/backup/backup-envelope";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await rm(root, {recursive: true, force: true});
    }
});

/**
 * 创建测试主密钥。
 */
function encryptionKey(): BackupEncryptionKey {
    const key = randomBytes(32);
    return {keyId: backupKeyId(key), key};
}

/**
 * 用正式格式加密一段测试 payload。
 */
function encrypt(payload: Uint8Array, key: BackupEncryptionKey): Buffer {
    const envelope = createBackupEnvelopeCipher(key);
    return Buffer.concat([
        envelope.prefix,
        envelope.cipher.update(payload),
        envelope.cipher.final(),
        envelope.cipher.getAuthTag(),
    ]);
}

/**
 * 将测试密文写入隔离文件。
 */
async function writeEnvelope(bytes: Uint8Array): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-envelope-"));
    cleanupRoots.push(root);
    const path = join(root, "backup.nbbackup");
    await writeFile(path, bytes);
    return path;
}

describe("backup envelope", () => {
    it("固定 magic/header 合同可解析并完整认证", async () => {
        const key = encryptionKey();
        const path = await writeEnvelope(encrypt(Buffer.from("payload"), key));
        const info = await inspectBackupEnvelope(path);

        expect(info.header).toEqual({
            formatVersion: 1,
            algorithm: "AES-256-GCM",
            keyId: key.keyId,
            nonce: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
        });
        await expect(verifyBackupEnvelope(path, info, key)).resolves.toBeUndefined();
    });

    it("同一 key 连续创建 envelope 不复用 nonce", () => {
        const key = encryptionKey();
        const nonces = Array.from({length: 128}, () => createBackupEnvelopeCipher(key).header.nonce);
        expect(new Set(nonces).size).toBe(nonces.length);
    });

    it("拒绝 magic、header、ciphertext、tag 篡改和截断", async () => {
        const key = encryptionKey();
        const original = encrypt(Buffer.from("payload with enough bytes"), key);

        const magicTampered = Buffer.from(original);
        magicTampered[0] ^= 1;
        await expect(inspectBackupEnvelope(await writeEnvelope(magicTampered))).rejects.toThrow(/加密格式/);

        const headerTampered = Buffer.from(original);
        const algorithmOffset = headerTampered.indexOf(Buffer.from("AES-256-GCM"));
        headerTampered[algorithmOffset] = "B".charCodeAt(0);
        await expect(inspectBackupEnvelope(await writeEnvelope(headerTampered))).rejects.toThrow(/header/);

        const ciphertextTampered = Buffer.from(original);
        const ciphertextPath = await writeEnvelope(ciphertextTampered);
        const ciphertextInfo = await inspectBackupEnvelope(ciphertextPath);
        ciphertextTampered[ciphertextInfo.ciphertextStart] ^= 1;
        await writeFile(ciphertextPath, ciphertextTampered);
        await expect(verifyBackupEnvelope(ciphertextPath, ciphertextInfo, key)).rejects.toThrow(/认证失败/);

        const tagTampered = Buffer.from(original);
        tagTampered[tagTampered.byteLength - 1] ^= 1;
        const tagPath = await writeEnvelope(tagTampered);
        await expect(verifyBackupEnvelope(tagPath, await inspectBackupEnvelope(tagPath), key)).rejects.toThrow(/认证失败/);

        await expect(inspectBackupEnvelope(await writeEnvelope(original.subarray(0, 12)))).rejects.toThrow(/截断/);
    });
});
