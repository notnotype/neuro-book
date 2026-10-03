import {randomUUID} from "node:crypto";
import type {Dirent} from "node:fs";
import {mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {check, lock} from "proper-lockfile";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

export const AUTHORING_CACHE_OWNER_FILE = ".nbook-authoring-cache.json";
export const AUTHORING_CACHE_OWNER_SCHEMA = "nbook.authoring-cache/v1";
export const AUTHORING_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const AUTHORING_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const AUTHORING_CACHE_MAX_LEASES = 128;

export const AUTHORING_CACHE_KINDS = [
    "profile-preview",
    "profile-variable-types",
    "profile-authoring-check",
    "variable-authoring-check",
] as const;

export type AuthoringCacheKind = typeof AUTHORING_CACHE_KINDS[number];

export type AuthoringCacheOwner = {
    schema: typeof AUTHORING_CACHE_OWNER_SCHEMA;
    kind: AuthoringCacheKind;
    leaseId: string;
    pid: number;
    startedAt: string;
};

export type AuthoringCacheLease = {
    root: string;
    /**
     * 调用方停止写入后、任何消费者读取 lease 内容前复核 owner 总预算。
     *
     * 这不是操作系统级实时配额；复核失败会先关闭并删除当前 lease，再抛错。
     */
    verifyForConsumption(): Promise<void>;
    /** 释放活跃锁并删除当前 lease；重复调用是幂等的。 */
    close(): Promise<void>;
};

/**
 * 建立并准备 authoring lease，在准备结果暴露给消费者前复核 owner 总预算。
 *
 * prepare 回调必须在返回前停止写入；成功后的生命周期仍由调用方返回值携带，
 * 避免初始化异常或消费前预算失败绕过 finally。
 */
export async function prepareAuthoringCacheLease<TResult>(
    cacheRoot: AbsoluteFsPath,
    kind: AuthoringCacheKind,
    prepare: (lease: AuthoringCacheLease) => Promise<TResult>,
): Promise<TResult> {
    const lease = await createAuthoringCacheLease(cacheRoot, kind);
    try {
        const result = await prepare(lease);
        await lease.verifyForConsumption();
        return result;
    } catch (error) {
        await lease.close();
        throw error;
    }
}

/**
 * 为一次短期 authoring 操作建立带 owner marker 与活跃锁的 Cache Root lease。
 *
 * 调用方只能写入返回目录，并必须在 finally 中 close；未知 owner 永不回收。
 */
export async function createAuthoringCacheLease(
    cacheRoot: AbsoluteFsPath,
    kind: AuthoringCacheKind,
): Promise<AuthoringCacheLease> {
    const ownerRoot = resolve(cacheRoot, "authoring");
    await mkdir(ownerRoot, {recursive: true});
    await sweepAuthoringCache(ownerRoot);
    await assertAuthoringCacheBudget(ownerRoot);

    const leaseId = randomUUID();
    const kindRoot = join(ownerRoot, kind);
    const root = join(kindRoot, leaseId);
    const markerPath = join(root, AUTHORING_CACHE_OWNER_FILE);
    const marker: AuthoringCacheOwner = {
        schema: AUTHORING_CACHE_OWNER_SCHEMA,
        kind,
        leaseId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };
    await mkdir(kindRoot, {recursive: true});
    await mkdir(root, {recursive: false});
    let release: () => Promise<void>;
    try {
        await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
        release = await lock(markerPath, {
            realpath: false,
            stale: AUTHORING_CACHE_MAX_AGE_MS,
            update: 10_000,
            retries: 0,
        });
    } catch (error) {
        await rm(root, {recursive: true, force: true});
        throw error;
    }
    let closed = false;
    /** 释放锁与 lease 目录；供正常完成、异常和预算拒绝共用。 */
    const close = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        await release().catch(() => undefined);
        await rm(root, {recursive: true, force: true});
    };
    return {
        root,
        verifyForConsumption: async () => {
            if (closed) {
                throw new Error("Authoring Cache lease 已关闭，不能进入消费阶段。");
            }
            try {
                await assertAuthoringCacheBudget(ownerRoot, "consumption");
            } catch (error) {
                await close();
                throw error;
            }
        },
        close,
    };
}

/** 回收超过保留期且没有活跃锁的同 owner lease。 */
export async function sweepAuthoringCache(ownerRoot: string, now = Date.now()): Promise<void> {
    for (const kind of AUTHORING_CACHE_KINDS) {
        const kindRoot = join(ownerRoot, kind);
        const entries = await readdir(kindRoot, {withFileTypes: true}).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const root = join(kindRoot, entry.name);
            const markerPath = join(root, AUTHORING_CACHE_OWNER_FILE);
            const marker = await readOwner(markerPath);
            if (!marker || marker.kind !== kind || marker.leaseId !== entry.name) continue;
            if (now - Date.parse(marker.startedAt) < AUTHORING_CACHE_MAX_AGE_MS) continue;
            if (await check(markerPath, {
                realpath: false,
                stale: AUTHORING_CACHE_MAX_AGE_MS,
            }).catch(() => true)) continue;
            await rm(root, {recursive: true, force: true});
        }
    }
}

/**
 * 检查 Authoring Cache owner 的离散预算门禁。
 *
 * admission 在创建目录前要求仍有一个 lease 的余量；consumption 允许刚好达到
 * 上限，但禁止把超限 lease 暴露给消费者。该检查不等同于实时磁盘配额。
 */
async function assertAuthoringCacheBudget(
    ownerRoot: string,
    phase: "admission" | "consumption" = "admission",
): Promise<void> {
    let leases = 0;
    let bytes = 0;
    const queue = [ownerRoot];
    while (queue.length > 0) {
        const current = queue.pop()!;
        let entries: Dirent[];
        try {
            entries = await readdir(current, {withFileTypes: true});
        } catch (error) {
            if (isMissingPathError(error)) continue;
            throw error;
        }
        for (const entry of entries) {
            const target = join(current, entry.name);
            if (entry.isDirectory()) {
                if (await readOwner(join(target, AUTHORING_CACHE_OWNER_FILE))) leases += 1;
                queue.push(target);
            } else if (entry.isFile()) {
                try {
                    bytes += (await stat(target)).size;
                } catch (error) {
                    if (isMissingPathError(error)) continue;
                    throw error;
                }
            }
        }
    }
    const leaseLimitReached = phase === "admission"
        ? leases >= AUTHORING_CACHE_MAX_LEASES
        : leases > AUTHORING_CACHE_MAX_LEASES;
    const byteLimitReached = phase === "admission"
        ? bytes >= AUTHORING_CACHE_MAX_BYTES
        : bytes > AUTHORING_CACHE_MAX_BYTES;
    if (leaseLimitReached || byteLimitReached) {
        const gate = phase === "admission" ? "创建前准入" : "消费前复核";
        throw new Error(`Authoring Cache ${gate}失败：leases=${leases}/${AUTHORING_CACHE_MAX_LEASES}, bytes=${bytes}/${AUTHORING_CACHE_MAX_BYTES}`);
    }
}

/** 并发 lease 关闭时只忽略已经消失的路径，其他扫描错误一律 fail closed。 */
function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error
        && "code" in error
        && error.code === "ENOENT";
}

/** 严格解析磁盘 owner marker；任何不认识的格式都保守返回 null。 */
async function readOwner(markerPath: string): Promise<AuthoringCacheOwner | null> {
    let raw: string;
    try {
        raw = await readFile(markerPath, "utf8");
    } catch (error) {
        if (isMissingPathError(error)) return null;
        throw error;
    }
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const marker = value as Partial<AuthoringCacheOwner>;
        if (marker.schema !== AUTHORING_CACHE_OWNER_SCHEMA
            || !AUTHORING_CACHE_KINDS.includes(marker.kind as AuthoringCacheKind)
            || typeof marker.leaseId !== "string"
            || !/^[0-9a-f-]{36}$/iu.test(marker.leaseId)
            || typeof marker.pid !== "number"
            || typeof marker.startedAt !== "string"
            || !Number.isFinite(Date.parse(marker.startedAt))) {
            return null;
        }
        return marker as AuthoringCacheOwner;
    } catch {
        return null;
    }
}
