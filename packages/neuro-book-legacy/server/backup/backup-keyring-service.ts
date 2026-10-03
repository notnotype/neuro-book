import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {chmod, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const BackupKeyStateSchema = z.enum(["pending", "active", "historical"]);

const StoredBackupKeySchema = z.object({
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    state: BackupKeyStateSchema,
    createdAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
}).strict();

const BackupKeyringFileSchema = z.object({
    formatVersion: z.literal(1),
    keys: z.array(StoredBackupKeySchema),
}).strict();

type StoredBackupKey = z.infer<typeof StoredBackupKeySchema>;
type BackupKeyringFile = z.infer<typeof BackupKeyringFileSchema>;
export type BackupKeyState = z.infer<typeof BackupKeyStateSchema>;

export type BackupEncryptionKey = {
    keyId: string;
    key: Buffer;
};

export type BackupKeyMetadata = {
    keyId: string;
    state: BackupKeyState;
    createdAt: string;
    confirmedAt: string | null;
};

export type BackupKeyringStatus = {
    activeKeyId: string | null;
    pendingKeyId: string | null;
    keys: BackupKeyMetadata[];
};

export type PreparedBackupKey = {
    recoveryCode: string;
    key: BackupKeyMetadata;
};

const emptyKeyring = (): BackupKeyringFile => ({formatVersion: 1, keys: []});

/**
 * 根据 32 字节主密钥生成稳定 keyId。
 */
export function backupKeyId(key: Uint8Array): string {
    assertKeyLength(key);
    return createHash("sha256").update(key).digest().subarray(0, 8).toString("hex");
}

/**
 * 把 32 字节主密钥编码成可人工保存的恢复码。
 */
export function encodeBackupRecoveryCode(key: Uint8Array): string {
    assertKeyLength(key);
    const checksum = createHash("sha256").update(key).digest().subarray(0, 4).toString("hex");
    return `NBK1-${Buffer.from(key).toString("base64url")}-${checksum}`;
}

/**
 * 解析恢复码并校验长度与 checksum；格式错误时不回显输入。
 */
export function decodeBackupRecoveryCode(recoveryCode: string): BackupEncryptionKey {
    const match = /^NBK1-([A-Za-z0-9_-]{43})-([0-9a-f]{8})$/.exec(recoveryCode.trim());
    if (!match) {
        throw new Error("恢复码格式无效");
    }
    const key = Buffer.from(match[1]!, "base64url");
    assertKeyLength(key);
    const expected = createHash("sha256").update(key).digest().subarray(0, 4);
    const actual = Buffer.from(match[2]!, "hex");
    if (!timingSafeEqual(expected, actual)) {
        throw new Error("恢复码校验失败，请检查是否复制完整");
    }
    return {keyId: backupKeyId(key), key};
}

/**
 * 管理 State Root 内的备份主密钥。所有写入经同一队列串行化并原子替换。
 */
export class BackupKeyringService {
    private mutationTail: Promise<void> = Promise.resolve();

    /**
     * 返回不含密钥材料的 keyring 状态。
     */
    async status(paths: RuntimePaths): Promise<BackupKeyringStatus> {
        return toStatus(await this.read(paths));
    }

    /**
     * 返回当前 active key；首次备份尚未确认恢复码时返回 null。
     */
    async activeKey(paths: RuntimePaths): Promise<BackupEncryptionKey | null> {
        const keyring = await this.read(paths);
        const stored = keyring.keys.find((item) => item.state === "active");
        return stored ? toEncryptionKey(stored) : null;
    }

    /**
     * 按 keyId 返回本地解密密钥；本地缺少时返回 null。
     */
    async key(paths: RuntimePaths, keyId: string): Promise<BackupEncryptionKey | null> {
        const keyring = await this.read(paths);
        const stored = keyring.keys.find((item) => item.keyId === keyId);
        return stored ? toEncryptionKey(stored) : null;
    }

    /**
     * 准备首次密钥或轮换密钥。已有 pending key 时重复返回同一恢复码。
     */
    async prepare(paths: RuntimePaths): Promise<PreparedBackupKey> {
        return this.mutate(async () => {
            const keyring = await this.read(paths);
            const existing = keyring.keys.find((item) => item.state === "pending");
            if (existing) {
                return {recoveryCode: encodeBackupRecoveryCode(decodeStoredKey(existing)), key: toMetadata(existing)};
            }

            const key = randomBytes(32);
            const now = new Date().toISOString();
            const pending: StoredBackupKey = {
                keyId: backupKeyId(key),
                key: key.toString("base64url"),
                state: "pending",
                createdAt: now,
                confirmedAt: null,
            };
            keyring.keys.push(pending);
            await this.write(paths, keyring);
            return {recoveryCode: encodeBackupRecoveryCode(key), key: toMetadata(pending)};
        });
    }

    /**
     * 确认 pending key 已被用户保存，并把原 active key 转为 historical。
     */
    async confirm(paths: RuntimePaths, keyId: string): Promise<BackupKeyringStatus> {
        return this.mutate(async () => {
            const keyring = await this.read(paths);
            const pending = keyring.keys.find((item) => item.keyId === keyId && item.state === "pending");
            if (!pending) {
                throw new Error("待确认的备份密钥不存在或已经确认");
            }
            const now = new Date().toISOString();
            for (const item of keyring.keys) {
                if (item.state === "active") {
                    item.state = "historical";
                }
            }
            pending.state = "active";
            pending.confirmedAt = now;
            await this.write(paths, keyring);
            return toStatus(keyring);
        });
    }

    /**
     * 导入恢复码。没有 active key 时成为 active，否则作为 historical 保留。
     */
    async import(paths: RuntimePaths, recoveryCode: string): Promise<BackupKeyringStatus> {
        const decoded = decodeBackupRecoveryCode(recoveryCode);
        return this.mutate(async () => {
            const keyring = await this.read(paths);
            if (keyring.keys.some((item) => item.keyId === decoded.keyId)) {
                return toStatus(keyring);
            }
            const now = new Date().toISOString();
            keyring.keys.push({
                keyId: decoded.keyId,
                key: decoded.key.toString("base64url"),
                state: keyring.keys.some((item) => item.state === "active") ? "historical" : "active",
                createdAt: now,
                confirmedAt: now,
            });
            await this.write(paths, keyring);
            return toStatus(keyring);
        });
    }

    /**
     * 导出指定本地密钥的恢复码。调用方负责先完成密码复验。
     */
    async export(paths: RuntimePaths, keyId: string): Promise<string> {
        const keyring = await this.read(paths);
        const stored = keyring.keys.find((item) => item.keyId === keyId);
        if (!stored) {
            throw new Error("指定的备份密钥不存在");
        }
        return encodeBackupRecoveryCode(decodeStoredKey(stored));
    }

    /**
     * 在恢复 staging State Root 写入仅含本次密钥的新 keyring。
     */
    async writeRestoreKeyring(stateRoot: string, encryptionKey: BackupEncryptionKey): Promise<void> {
        const now = new Date().toISOString();
        const secretsRoot = join(stateRoot, "secrets");
        await writeKeyringFile(secretsRoot, join(secretsRoot, "backup-keyring.json"), {
            formatVersion: 1,
            keys: [{
                keyId: encryptionKey.keyId,
                key: encryptionKey.key.toString("base64url"),
                state: "active",
                createdAt: now,
                confirmedAt: now,
            }],
        });
    }

    /**
     * 串行化 keyring 变更，避免并发 prepare/import 产生多个 active 或 pending key。
     */
    private async mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
        const previous = this.mutationTail;
        let release = (): void => undefined;
        this.mutationTail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    /**
     * 读取并验证 keyring；文件不存在表示尚未创建密钥。
     */
    private async read(paths: RuntimePaths): Promise<BackupKeyringFile> {
        let raw: string;
        try {
            raw = await readFile(paths.backupKeyringPath, "utf8");
        } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                return emptyKeyring();
            }
            throw error;
        }

        let keyring: BackupKeyringFile;
        try {
            keyring = BackupKeyringFileSchema.parse(JSON.parse(raw));
        } catch {
            throw new Error("备份密钥环损坏，已停止备份和恢复操作");
        }
        validateKeyring(keyring);
        return keyring;
    }

    /**
     * 以 0600 临时文件和原子 rename 保存 keyring。
     */
    private async write(paths: RuntimePaths, keyring: BackupKeyringFile): Promise<void> {
        validateKeyring(keyring);
        await writeKeyringFile(paths.secretsRoot, paths.backupKeyringPath, keyring);
    }
}

/**
 * 验证 keyring 内部唯一性及密钥材料和 keyId 的一致性。
 */
function validateKeyring(keyring: BackupKeyringFile): void {
    const keyIds = new Set<string>();
    let activeCount = 0;
    let pendingCount = 0;
    for (const item of keyring.keys) {
        const key = decodeStoredKey(item);
        if (backupKeyId(key) !== item.keyId || keyIds.has(item.keyId)) {
            throw new Error("备份密钥环损坏，已停止备份和恢复操作");
        }
        keyIds.add(item.keyId);
        activeCount += item.state === "active" ? 1 : 0;
        pendingCount += item.state === "pending" ? 1 : 0;
    }
    if (activeCount > 1 || pendingCount > 1) {
        throw new Error("备份密钥环状态冲突，已停止备份和恢复操作");
    }
}

/**
 * 将已验证的存储记录转为内部密钥对象。
 */
function toEncryptionKey(stored: StoredBackupKey): BackupEncryptionKey {
    return {keyId: stored.keyId, key: decodeStoredKey(stored)};
}

/**
 * 将密钥记录映射为不含密钥材料的公开元数据。
 */
function toMetadata(stored: StoredBackupKey): BackupKeyMetadata {
    return {
        keyId: stored.keyId,
        state: stored.state,
        createdAt: stored.createdAt,
        confirmedAt: stored.confirmedAt,
    };
}

/**
 * 汇总 keyring 的公开状态。
 */
function toStatus(keyring: BackupKeyringFile): BackupKeyringStatus {
    return {
        activeKeyId: keyring.keys.find((item) => item.state === "active")?.keyId ?? null,
        pendingKeyId: keyring.keys.find((item) => item.state === "pending")?.keyId ?? null,
        keys: keyring.keys.map(toMetadata),
    };
}

/**
 * 解码 keyring 内部的 base64url 密钥材料。
 */
function decodeStoredKey(stored: StoredBackupKey): Buffer {
    const key = Buffer.from(stored.key, "base64url");
    assertKeyLength(key);
    return key;
}

/**
 * 强制 Backup Master Key 固定为 32 字节。
 */
function assertKeyLength(key: Uint8Array): void {
    if (key.byteLength !== 32) {
        throw new Error("备份主密钥长度无效");
    }
}

/**
 * 原子写入 keyring，并收紧目录和文件权限。
 */
async function writeKeyringFile(secretsRoot: string, keyringPath: string, keyring: BackupKeyringFile): Promise<void> {
    await mkdir(secretsRoot, {recursive: true, mode: 0o700});
    await chmod(secretsRoot, 0o700);
    const temporaryPath = `${keyringPath}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(keyring, null, 4)}\n`, {encoding: "utf8", mode: 0o600, flag: "wx"});
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, keyringPath);
        await chmod(keyringPath, 0o600);
    } catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
        throw error;
    }
}

/**
 * 判断异常是否携带 Node.js 文件错误码。
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}

type GlobalBackupKeyring = {
    backupKeyringService?: BackupKeyringService;
};

const globalForBackupKeyring = globalThis as typeof globalThis & GlobalBackupKeyring;

/**
 * 返回进程级 keyring 服务，确保所有 HTTP 请求共享同一变更队列。
 */
export function useBackupKeyringService(): BackupKeyringService {
    if (!globalForBackupKeyring.backupKeyringService) {
        globalForBackupKeyring.backupKeyringService = new BackupKeyringService();
    }
    return globalForBackupKeyring.backupKeyringService;
}
