import {describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    deriveStorageClientId,
    deriveStorageSessionGeneration,
    localStorageSubject,
    STORAGE_LOCAL_SESSION_GENERATION,
    StorageAccessContextRegistry,
    userStorageSubject,
    type StorageAccessContextClaims,
} from "nbook/server/storage/access-context";
import {isStorageDomainError} from "nbook/shared/storage/storage-errors";

const CLIENT_A = deriveStorageClientId("a".repeat(64));
const CLIENT_B = deriveStorageClientId("b".repeat(64));
const SESSION_A = deriveStorageSessionGeneration("session-a");
const SESSION_B = deriveStorageSessionGeneration("session-b");
const ROOT = absoluteFsPath(process.platform === "win32" ? "C:\\nbook\\state\\workspace" : "/nbook/state/workspace");
const OTHER_ROOT = absoluteFsPath(process.platform === "win32" ? "D:\\nbook\\state\\workspace" : "/nbook/other/workspace");

function claims(overrides: Partial<StorageAccessContextClaims> = {}): StorageAccessContextClaims {
    return {
        scope: "user",
        storageRoot: ROOT,
        identityDomain: "11111111-1111-4111-8111-111111111111",
        rootIdentity: "1:2:3",
        subject: "user:7",
        sessionGeneration: SESSION_A,
        clientId: CLIENT_A,
        ...overrides,
    };
}

describe("deriveStorageClientId", () => {
    it("同一凭证导出稳定摘要，不同凭证互不相同", () => {
        const credential = "0123456789abcdef".repeat(4);
        expect(deriveStorageClientId(credential)).toMatch(/^[0-9a-f]{64}$/u);
        expect(deriveStorageClientId(credential)).toBe(deriveStorageClientId(credential));
        expect(deriveStorageClientId(credential)).not.toBe(deriveStorageClientId("f".repeat(64)));
    });

    it("拒绝非法凭证且不把原始值带进错误", () => {
        const credential = "UPPERCASE".repeat(8);
        try {
            deriveStorageClientId(credential);
            throw new Error("非法凭证不应导出 clientId");
        } catch (error) {
            expect(isStorageDomainError(error, "STORAGE_CLIENT_CREDENTIAL_INVALID")).toBe(true);
            expect((error as Error).message).not.toContain(credential);
        }
    });
});

describe("deriveStorageSessionGeneration", () => {
    it("同一 session 导出稳定摘要，不同 session 互不相同，原始标识不出现在结果里", () => {
        expect(SESSION_A).toMatch(/^[0-9a-f]{64}$/u);
        expect(SESSION_A).toBe(deriveStorageSessionGeneration("session-a"));
        expect(SESSION_A).not.toBe(SESSION_B);
        expect(SESSION_A).not.toContain("session-a");
    });
});

describe("本地主体与用户主体", () => {
    it("数值用户编号不会与身份域本地主体重合", () => {
        expect(localStorageSubject("7")).not.toBe(userStorageSubject(7));
        expect(userStorageSubject(7)).toBe("user:7");
    });

    it("无鉴权模式的代次是固定值，不随 session 变化", () => {
        expect(STORAGE_LOCAL_SESSION_GENERATION).toBe("local");
    });
});

describe("StorageAccessContextRegistry", () => {
    it("同一客户端的重复签发各自独立，释放其中一个不撤销另一个", () => {
        const registry = new StorageAccessContextRegistry();
        const firstTab = registry.issue(claims());
        const secondTab = registry.issue(claims());
        expect(firstTab.contextId).toMatch(/^[0-9a-f]{64}$/u);
        expect(secondTab.contextId).not.toBe(firstTab.contextId);

        // 客户端身份相同不代表访问生命周期共享：一个标签页释放不撤销另一个。
        expect(registry.release({contextId: firstTab.contextId, subject: "user:7", clientId: CLIENT_A})).toBe(true);
        expect(registry.resolve({...claims(), contextId: secondTab.contextId}).contextId).toBe(secondTab.contextId);

        expect(registry.issue(claims({clientId: CLIENT_B})).contextId).not.toBe(secondTab.contextId);
        expect(registry.issue(claims({subject: "user:8"})).contextId).not.toBe(secondTab.contextId);
        expect(registry.issue(claims({scope: "project"})).contextId).not.toBe(secondTab.contextId);
        expect(registry.issue(claims({storageRoot: OTHER_ROOT})).contextId).not.toBe(secondTab.contextId);
    });

    it("核验要求当前主体、session 代次、凭证、身份域、存储根与 scope 全部一致", () => {
        const registry = new StorageAccessContextRegistry();
        const issued = registry.issue(claims());
        const mutations: readonly Partial<StorageAccessContextClaims>[] = [
            {subject: "user:8"},
            {subject: "local:11111111-1111-4111-8111-111111111111"},
            {sessionGeneration: SESSION_B},
            {sessionGeneration: STORAGE_LOCAL_SESSION_GENERATION},
            {clientId: CLIENT_B},
            {clientId: undefined},
            {identityDomain: "22222222-2222-4222-8222-222222222222"},
            {rootIdentity: "1:2:4"},
            {storageRoot: OTHER_ROOT},
            {scope: "project"},
        ];
        for (const mutation of mutations) {
            expect(() => registry.resolve({...claims(), ...mutation, contextId: issued.contextId}))
                .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_INVALID", reason: "claims-mismatch"}));
        }
        expect(registry.resolve({...claims(), contextId: issued.contextId}).contextId).toBe(issued.contextId);
    });

    it("核验失败的错误不泄露主体、凭证、身份域或 session 代次", () => {
        const registry = new StorageAccessContextRegistry();
        const issued = registry.issue(claims());
        try {
            registry.resolve({...claims({subject: "user:99"}), contextId: issued.contextId});
            throw new Error("不匹配的声明不应解析成功");
        } catch (error) {
            const message = (error as Error).message;
            expect(message).not.toContain("user:99");
            expect(message).not.toContain(CLIENT_A);
            expect(message).not.toContain("11111111-1111-4111-8111-111111111111");
            expect(message).not.toContain(SESSION_A);
        }
    });

    it("未签发的标识与非法标识分别拒绝", () => {
        const registry = new StorageAccessContextRegistry();
        expect(() => registry.resolve({...claims(), contextId: "0".repeat(64)}))
            .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_INVALID", reason: "unknown-context"}));
        expect(() => registry.resolve({...claims(), contextId: "not-a-context"}))
            .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_INVALID", reason: "context-id"}));
    });

    it("释放只作用于自己的访问，重复释放幂等", () => {
        const registry = new StorageAccessContextRegistry();
        const issued = registry.issue(claims());
        expect(() => registry.release({contextId: issued.contextId, subject: "user:8", clientId: CLIENT_A}))
            .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_INVALID", reason: "owner-mismatch"}));
        expect(() => registry.release({contextId: issued.contextId, subject: "user:7"}))
            .toThrowError(expect.objectContaining({reason: "owner-mismatch"}));
        expect(registry.resolve({...claims(), contextId: issued.contextId}).contextId).toBe(issued.contextId);
        expect(registry.release({contextId: issued.contextId, subject: "user:7", clientId: CLIENT_A})).toBe(true);
        // 已不存在的访问重复释放是幂等成功，不需要先查询。
        expect(registry.release({contextId: issued.contextId, subject: "user:7", clientId: CLIENT_A})).toBe(false);
        expect(() => registry.resolve({...claims(), contextId: issued.contextId}))
            .toThrowError(expect.objectContaining({reason: "unknown-context"}));
        // 释放后重新初始化得到新标识，原标识不复活。
        expect(registry.issue(claims()).contextId).not.toBe(issued.contextId);
    });

    it("容量占满拒绝新签发，已有访问继续有效", () => {
        const registry = new StorageAccessContextRegistry({maxContexts: 2, idleMs: Number.MAX_SAFE_INTEGER});
        const first = registry.issue(claims({subject: "user:1"}));
        const second = registry.issue(claims({subject: "user:2"}));
        expect(registry.resolve({...claims({subject: "user:1"}), contextId: first.contextId}).contextId).toBe(first.contextId);
        expect(() => registry.issue(claims({subject: "user:3"})))
            .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_LIMIT"}));
        expect(registry.resolve({...claims({subject: "user:2"}), contextId: second.contextId}).contextId).toBe(second.contextId);
        expect(registry.resolve({...claims({subject: "user:1"}), contextId: first.contextId}).contextId).toBe(first.contextId);
        registry.release({contextId: first.contextId, subject: "user:1", clientId: CLIENT_A});
        expect(registry.issue(claims({subject: "user:3"})).contextId).toMatch(/^[a-f0-9]{64}$/u);
    });

    it("容量校准时空闲访问先于仍在使用的访问被回收", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
            const registry = new StorageAccessContextRegistry({maxContexts: 2, idleMs: 60_000});
            const idle = registry.issue(claims({subject: "user:1"}));
            vi.setSystemTime(new Date("2026-09-16T00:02:00.000Z"));
            const active = registry.issue(claims({subject: "user:2"}));

            const third = registry.issue(claims({subject: "user:3"}));
            expect(() => registry.resolve({...claims({subject: "user:1"}), contextId: idle.contextId}))
                .toThrowError(expect.objectContaining({reason: "unknown-context"}));
            expect(registry.resolve({...claims({subject: "user:2"}), contextId: active.contextId}).contextId).toBe(active.contextId);
            expect(registry.resolve({...claims({subject: "user:3"}), contextId: third.contextId}).contextId).toBe(third.contextId);
        } finally {
            vi.useRealTimers();
        }
    });

    it("单客户端占满仍给其他客户端留有容量", () => {
        const registry = new StorageAccessContextRegistry({maxContexts: 4, maxContextsPerClient: 2});
        registry.issue(claims());
        registry.issue(claims());
        expect(() => registry.issue(claims())).toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_LIMIT"}));
        expect(registry.resolve(registry.issue(claims({clientId: CLIENT_B}))).clientId).toBe(CLIENT_B);
    });

    it("关闭幂等，关闭后不再签发或核验", async () => {
        const registry = new StorageAccessContextRegistry();
        const issued = registry.issue(claims());
        await registry.close();
        await registry.close();

        expect(() => registry.issue(claims())).toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(() => registry.resolve({...claims(), contextId: issued.contextId}))
            .toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
        expect(registry.release({contextId: issued.contextId, subject: "user:7", clientId: CLIENT_A})).toBe(false);
    });

    it("副作用前的存活检查在释放、session 撤销与自然到期后失效，且不延长闲置期限", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
            const registry = new StorageAccessContextRegistry({idleMs: 60_000});
            const live = registry.issue(claims());
            registry.assertLive(live.contextId);
            registry.assertLive(live.contextId);

            const revoked = registry.issue(claims({sessionGeneration: SESSION_B}));
            registry.revokeSession(SESSION_B);
            expect(() => registry.assertLive(revoked.contextId))
                .toThrowError(expect.objectContaining({code: "STORAGE_CONTEXT_INVALID", reason: "unknown-context"}));

            registry.release({contextId: live.contextId, subject: "user:7", clientId: CLIENT_A});
            expect(() => registry.assertLive(live.contextId))
                .toThrowError(expect.objectContaining({reason: "unknown-context"}));

            // 存活检查不更新最近核验时刻：闲置期限仍按上次核验起算。
            const expiring = registry.issue(claims({subject: "user:9"}));
            vi.setSystemTime(new Date("2026-09-16T00:00:59.000Z"));
            registry.assertLive(expiring.contextId);
            vi.setSystemTime(new Date("2026-09-16T00:02:00.000Z"));
            expect(() => registry.assertLive(expiring.contextId))
                .toThrowError(expect.objectContaining({reason: "unknown-context"}));
            expect(() => registry.assertLive("not-a-context"))
                .toThrowError(expect.objectContaining({reason: "context-id"}));
        } finally {
            vi.useRealTimers();
        }
    });

    it("关闭后副作用前的存活检查按服务关闭拒绝", async () => {
        const registry = new StorageAccessContextRegistry();
        const issued = registry.issue(claims());
        await registry.close();
        expect(() => registry.assertLive(issued.contextId))
            .toThrowError(expect.objectContaining({code: "STORAGE_SERVICE_CLOSED"}));
    });
});
