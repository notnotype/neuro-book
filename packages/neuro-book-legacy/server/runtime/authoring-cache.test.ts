import {randomUUID} from "node:crypto";
import {access, mkdir, mkdtemp, readFile, readdir, rm, truncate, utimes, writeFile} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    AUTHORING_CACHE_MAX_AGE_MS,
    AUTHORING_CACHE_MAX_BYTES,
    AUTHORING_CACHE_MAX_LEASES,
    AUTHORING_CACHE_OWNER_FILE,
    AUTHORING_CACHE_OWNER_SCHEMA,
    createAuthoringCacheLease,
    prepareAuthoringCacheLease,
    sweepAuthoringCache,
    type AuthoringCacheOwner,
} from "nbook/server/runtime/authoring-cache";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const properLockfileMock = vi.hoisted(() => ({failNextLock: false}));
vi.mock("proper-lockfile", async (importOriginal) => {
    const actual = await importOriginal<typeof import("proper-lockfile")>();
    return {
        ...actual,
        lock: async (...args: Parameters<typeof actual.lock>) => {
            if (properLockfileMock.failNextLock) {
                properLockfileMock.failNextLock = false;
                throw new Error("lock failed");
            }
            return actual.lock(...args);
        },
    };
});

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 创建隔离 Cache Root。 */
async function cacheRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-authoring-cache-"));
    roots.push(root);
    return root;
}

/** 写入一个没有活跃锁的同 owner lease。 */
async function seedOwnedLease(root: string, startedAt: string): Promise<string> {
    const kind = "profile-preview" as const;
    const leaseId = randomUUID();
    const leaseRoot = join(root, "authoring", kind, leaseId);
    const marker: AuthoringCacheOwner = {
        schema: AUTHORING_CACHE_OWNER_SCHEMA,
        kind,
        leaseId,
        pid: process.pid,
        startedAt,
    };
    await mkdir(leaseRoot, {recursive: true});
    await writeFile(join(leaseRoot, AUTHORING_CACHE_OWNER_FILE), `${JSON.stringify(marker)}\n`, "utf8");
    return leaseRoot;
}

describe("Authoring Cache lifecycle", () => {
    it("lease 固定落到 Cache Root 并在 close 后删除", async () => {
        const root = await cacheRoot();
        const lease = await createAuthoringCacheLease(absoluteFsPath(root), "profile-variable-types");

        expect(lease.root.startsWith(join(root, "authoring", "profile-variable-types"))).toBe(true);
        await expect(readFile(join(lease.root, AUTHORING_CACHE_OWNER_FILE), "utf8"))
            .resolves.toContain(AUTHORING_CACHE_OWNER_SCHEMA);

        await lease.close();
        await expect(access(lease.root)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("prepare 在结果暴露前复核预算，成功后仍由调用方关闭 lease", async () => {
        const root = await cacheRoot();
        let leaseRoot = "";

        const prepared = await prepareAuthoringCacheLease(
            absoluteFsPath(root),
            "profile-variable-types",
            async (lease) => {
                leaseRoot = lease.root;
                await writeFile(join(lease.root, "types.d.ts"), "export type Ready = true;\n", "utf8");
                return {value: "ready", close: lease.close};
            },
        );

        expect(prepared.value).toBe("ready");
        await access(leaseRoot);
        await prepared.close();
        await expect(access(leaseRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("创建前准入在已有 lease 达到上限时拒绝新 lease", async () => {
        const root = await cacheRoot();
        const startedAt = new Date().toISOString();
        await Promise.all(Array.from(
            {length: AUTHORING_CACHE_MAX_LEASES},
            () => seedOwnedLease(root, startedAt),
        ));

        await expect(createAuthoringCacheLease(absoluteFsPath(root), "profile-preview"))
            .rejects.toThrow("Authoring Cache 创建前准入失败");
    });

    it("消费前字节复核超限时关闭当前 lease 并 fail closed", async () => {
        const root = await cacheRoot();
        const lease = await createAuthoringCacheLease(absoluteFsPath(root), "profile-preview");
        const leaseRoot = lease.root;
        const oversizedPath = join(leaseRoot, "oversized.bin");
        await writeFile(oversizedPath, "", "utf8");
        await truncate(oversizedPath, AUTHORING_CACHE_MAX_BYTES);

        await expect(lease.verifyForConsumption())
            .rejects.toThrow("Authoring Cache 消费前复核失败");
        await expect(access(leaseRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("prepare 自动复核 lease 数超限并在返回前关闭当前 lease", async () => {
        const root = await cacheRoot();
        const startedAt = new Date().toISOString();
        let currentLeaseRoot = "";

        await expect(prepareAuthoringCacheLease(
            absoluteFsPath(root),
            "profile-authoring-check",
            async (lease) => {
                currentLeaseRoot = lease.root;
                await Promise.all(Array.from(
                    {length: AUTHORING_CACHE_MAX_LEASES},
                    () => seedOwnedLease(root, startedAt),
                ));
                return "unreachable";
            },
        )).rejects.toThrow("Authoring Cache 消费前复核失败");

        await expect(access(currentLeaseRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("超过 24 小时且没有活跃锁的同 owner lease 会被回收", async () => {
        const root = await cacheRoot();
        const now = Date.now();
        const leaseRoot = await seedOwnedLease(root, new Date(now - AUTHORING_CACHE_MAX_AGE_MS - 1_000).toISOString());

        await sweepAuthoringCache(join(root, "authoring"), now);

        await expect(access(leaseRoot)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("即使 marker 时间过期也不会删除仍持有锁的 lease", async () => {
        const root = await cacheRoot();
        const lease = await createAuthoringCacheLease(absoluteFsPath(root), "profile-preview");
        const markerPath = join(lease.root, AUTHORING_CACHE_OWNER_FILE);
        const marker = JSON.parse(await readFile(markerPath, "utf8")) as AuthoringCacheOwner;
        const now = Date.now();
        await writeFile(markerPath, `${JSON.stringify({
            ...marker,
            startedAt: new Date(now - AUTHORING_CACHE_MAX_AGE_MS - 1_000).toISOString(),
        })}\n`, "utf8");

        await sweepAuthoringCache(join(root, "authoring"), now);

        await access(lease.root);
        await lease.close();
    });

    it("超过 proper-lockfile 默认 10 秒但未超过 24 小时的锁仍视为活跃", async () => {
        const root = await cacheRoot();
        const now = Date.now();
        const leaseRoot = await seedOwnedLease(root, new Date(now - AUTHORING_CACHE_MAX_AGE_MS - 1_000).toISOString());
        const markerPath = join(leaseRoot, AUTHORING_CACHE_OWNER_FILE);
        const lockPath = `${markerPath}.lock`;
        await mkdir(lockPath);
        const fifteenSecondsAgo = new Date(now - 15_000);
        await utimes(lockPath, fifteenSecondsAgo, fifteenSecondsAgo);

        await sweepAuthoringCache(join(root, "authoring"), now);

        await access(leaseRoot);
    });

    it("新 lease 取得锁失败时回滚刚创建的目录", async () => {
        const root = await cacheRoot();
        properLockfileMock.failNextLock = true;

        await expect(createAuthoringCacheLease(absoluteFsPath(root), "profile-preview"))
            .rejects.toThrow("lock failed");

        const kindRoot = join(root, "authoring", "profile-preview");
        await expect(readdir(kindRoot)).resolves.toEqual([]);
    });

    it("lease 初始化失败时立即关闭并删除已建立的 root", async () => {
        const root = await cacheRoot();
        let leaseRoot = "";

        await expect(prepareAuthoringCacheLease(
            absoluteFsPath(root),
            "profile-variable-types",
            async (lease) => {
                leaseRoot = lease.root;
                throw new Error("injected prepare failure");
            },
        )).rejects.toThrow("injected prepare failure");

        await expect(access(leaseRoot)).rejects.toMatchObject({code: "ENOENT"});
    });
});
