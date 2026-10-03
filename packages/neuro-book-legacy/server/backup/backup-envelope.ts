import {createCipheriv, createDecipheriv, randomBytes, type CipherGCM, type DecipherGCM} from "node:crypto";
import {createReadStream} from "node:fs";
import {open, stat} from "node:fs/promises";
import {Writable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {z} from "zod";
import type {BackupEncryptionKey} from "nbook/server/backup/backup-keyring-service";

const BACKUP_MAGIC = Buffer.from("NBOOKBK1", "ascii");
const BACKUP_TAG_BYTES = 16;
const MAX_HEADER_BYTES = 4096;

const BackupEnvelopeHeaderSchema = z.object({
    formatVersion: z.literal(1),
    algorithm: z.literal("AES-256-GCM"),
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
}).strict();

export type BackupEnvelopeHeader = z.infer<typeof BackupEnvelopeHeaderSchema>;

export type BackupEnvelopeCipher = {
    header: BackupEnvelopeHeader;
    prefix: Buffer;
    cipher: CipherGCM;
};

export type BackupEnvelopeInfo = {
    header: BackupEnvelopeHeader;
    aad: Buffer;
    tag: Buffer;
    ciphertextStart: number;
    ciphertextEnd: number;
    ciphertextBytes: number;
};

/**
 * 创建固定字段顺序的 envelope header、AAD 与 AES-256-GCM cipher。
 */
export function createBackupEnvelopeCipher(encryptionKey: BackupEncryptionKey): BackupEnvelopeCipher {
    const nonce = randomBytes(12);
    const header: BackupEnvelopeHeader = {
        formatVersion: 1,
        algorithm: "AES-256-GCM",
        keyId: encryptionKey.keyId,
        nonce: nonce.toString("base64url"),
    };
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(headerBytes.byteLength);
    const prefix = Buffer.concat([BACKUP_MAGIC, length, headerBytes]);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey.key, nonce);
    cipher.setAAD(prefix);
    return {header, prefix, cipher};
}

/**
 * 读取并严格验证 envelope 前缀、header 与末尾认证 tag。
 */
export async function inspectBackupEnvelope(path: string): Promise<BackupEnvelopeInfo> {
    const fileStat = await stat(path);
    if (fileStat.size < BACKUP_MAGIC.byteLength + 4 + BACKUP_TAG_BYTES + 1) {
        throw new Error("备份密文已截断");
    }
    const handle = await open(path, "r");
    try {
        const fixedPrefix = Buffer.alloc(BACKUP_MAGIC.byteLength + 4);
        await readExactly(handle, fixedPrefix, 0);
        if (!fixedPrefix.subarray(0, BACKUP_MAGIC.byteLength).equals(BACKUP_MAGIC)) {
            throw new Error("备份文件不是受支持的加密格式");
        }
        const headerLength = fixedPrefix.readUInt32BE(BACKUP_MAGIC.byteLength);
        if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
            throw new Error("备份加密 header 长度无效");
        }
        const ciphertextStart = fixedPrefix.byteLength + headerLength;
        const ciphertextEnd = fileStat.size - BACKUP_TAG_BYTES - 1;
        if (ciphertextEnd < ciphertextStart) {
            throw new Error("备份密文已截断");
        }

        const headerBytes = Buffer.alloc(headerLength);
        await readExactly(handle, headerBytes, fixedPrefix.byteLength);
        let header: BackupEnvelopeHeader;
        try {
            header = BackupEnvelopeHeaderSchema.parse(JSON.parse(headerBytes.toString("utf8")));
        } catch {
            throw new Error("备份加密 header 无效");
        }
        if (JSON.stringify(header) !== headerBytes.toString("utf8")) {
            throw new Error("备份加密 header 字段或顺序无效");
        }
        const nonce = Buffer.from(header.nonce, "base64url");
        if (nonce.byteLength !== 12) {
            throw new Error("备份加密 nonce 无效");
        }

        const tag = Buffer.alloc(BACKUP_TAG_BYTES);
        await readExactly(handle, tag, fileStat.size - BACKUP_TAG_BYTES);
        return {
            header,
            aad: Buffer.concat([fixedPrefix, headerBytes]),
            tag,
            ciphertextStart,
            ciphertextEnd,
            ciphertextBytes: ciphertextEnd - ciphertextStart + 1,
        };
    } finally {
        await handle.close();
    }
}

/**
 * 第一遍完整解密到空 sink，仅在 GCM tag 验证成功后返回。
 */
export async function verifyBackupEnvelope(
    path: string,
    info: BackupEnvelopeInfo,
    encryptionKey: BackupEncryptionKey,
    onProgress?: (done: number, total: number) => void,
): Promise<void> {
    assertMatchingKey(info, encryptionKey);
    let verified = 0;
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            verified += chunk.byteLength;
            onProgress?.(verified, info.ciphertextBytes);
            callback();
        },
    });
    try {
        await pipeline(createBackupCiphertextStream(path, info), createBackupEnvelopeDecipher(info, encryptionKey), sink);
    } catch {
        throw new Error("备份密文认证失败，文件可能损坏或恢复码不匹配");
    }
}

/**
 * 创建只覆盖 ciphertext 区间的文件流，不把末尾 tag 送进 decipher。
 */
export function createBackupCiphertextStream(path: string, info: BackupEnvelopeInfo) {
    return createReadStream(path, {start: info.ciphertextStart, end: info.ciphertextEnd, highWaterMark: 1 << 18});
}

/**
 * 按已解析 header 创建第二遍可复用的 decipher。
 */
export function createBackupEnvelopeDecipher(info: BackupEnvelopeInfo, encryptionKey: BackupEncryptionKey): DecipherGCM {
    assertMatchingKey(info, encryptionKey);
    const nonce = Buffer.from(info.header.nonce, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey.key, nonce);
    decipher.setAAD(info.aad);
    decipher.setAuthTag(info.tag);
    return decipher;
}

/**
 * 确认调用方提供的是 header 声明的本地密钥。
 */
function assertMatchingKey(info: BackupEnvelopeInfo, encryptionKey: BackupEncryptionKey): void {
    if (info.header.keyId !== encryptionKey.keyId) {
        throw new Error(`本地缺少备份所需密钥（keyId: ${info.header.keyId}）`);
    }
}

/**
 * 在固定 offset 读取完整字节段，短读视为截断。
 */
async function readExactly(handle: Awaited<ReturnType<typeof open>>, buffer: Buffer, position: number): Promise<void> {
    let offset = 0;
    while (offset < buffer.byteLength) {
        const {bytesRead} = await handle.read(buffer, offset, buffer.byteLength - offset, position + offset);
        if (bytesRead === 0) {
            throw new Error("备份密文已截断");
        }
        offset += bytesRead;
    }
}
