import path from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    assertStorageRecordAddress,
    storageIdentityFilePath,
    storageIdentityLockPath,
    storagePartitionDigest,
    storagePartitionPaths,
    storagePartitionRelativePath,
    storageRecordFileName,
    userStorageRootFromWorkspaceRoot,
    projectStorageRootFromProjectRoot,
} from "nbook/server/storage/storage-address";

const ROOT = absoluteFsPath(testHostPath("nbook-storage-address"));

describe("storagePartitionPaths", () => {
    it("同一身份上下文的地址稳定，主体与客户端只落摘要", () => {
        const first = storagePartitionPaths({
            storageRoot: ROOT,
            identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
            subject: "user-a@example.com",
            locality: "local",
            clientId: "tab-session-1",
            owner: "test.workspace",
        });
        const second = storagePartitionPaths({
            storageRoot: ROOT,
            identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
            subject: "user-a@example.com",
            locality: "local",
            clientId: "tab-session-1",
            owner: "test.workspace",
        });

        expect(second.relative).toBe(first.relative);
        expect(first.relative).toBe([
            "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
            storagePartitionDigest("subject", "user-a@example.com"),
            "local",
            storagePartitionDigest("client", "tab-session-1"),
            "test.workspace",
        ].join("/"));
        expect(first.relative).not.toContain("user-a@example.com");
        expect(first.recordsDirectory.startsWith(first.directory)).toBe(true);
        expect(first.lockPath.startsWith(path.join(ROOT, ".locks"))).toBe(true);
        expect(first.lockPath).not.toContain("user-a@example.com");
        expect(first.lockPath.endsWith("test.workspace.lock")).toBe(true);
        expect(storageIdentityFilePath(ROOT)).toBe(path.join(ROOT, "identity.json"));
        expect(storageIdentityLockPath(ROOT)).toBe(path.join(ROOT, ".locks", "identity-domain.lock"));
    });

    it("主体、客户端、locality、身份域与 owner 各自改变分区", () => {
        const base = {
            storageRoot: ROOT,
            identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
            subject: "user-a",
            locality: "local" as const,
            clientId: "client-1",
            owner: "test.workspace",
        };
        const partitions = new Set([
            storagePartitionRelativePath(base),
            storagePartitionRelativePath({...base, subject: "user-b"}),
            storagePartitionRelativePath({...base, clientId: "client-2"}),
            storagePartitionRelativePath({...base, locality: "shared"}),
            storagePartitionRelativePath({...base, identityDomain: "9b1e2f3a-4567-4890-abcd-ef0123456789"}),
            storagePartitionRelativePath({...base, owner: "test.other"}),
        ]);
        expect(partitions.size).toBe(6);
        expect(storagePartitionRelativePath({...base, locality: "shared"}))
            .toBe(storagePartitionRelativePath({...base, locality: "shared", clientId: "client-9"}));
    });

    it("非法身份输入与缺失客户端上下文被拒绝", () => {
        const base = {
            storageRoot: ROOT,
            identityDomain: "3f0c9a1e-6d2b-4b0e-9f4a-2c1d8e7b5a90",
            subject: "user-a",
            locality: "local" as const,
            clientId: "client-1",
            owner: "test.workspace",
        };
        const cases = [
            {...base, clientId: undefined},
            {...base, identityDomain: "../escape"},
            {...base, identityDomain: "con"},
            {...base, owner: "../escape"},
            {...base, subject: ""},
        ];
        for (const candidate of cases) {
            const error = (() => {
                try {
                    storagePartitionRelativePath(candidate);
                    return null;
                } catch (caught: unknown) {
                    return caught;
                }
            })();
            expect(error).toMatchObject({code: "STORAGE_CONTEXT_INVALID"});
        }
    });

    it("user 与 project 存储根遵循 data 目录约定", () => {
        const workspaceRoot = absoluteFsPath(testHostPath("nbook-storage-workspace"));
        expect(userStorageRootFromWorkspaceRoot(workspaceRoot)).toBe(path.join(workspaceRoot, ".nbook", "storage"));
        const projectRoot = absoluteFsPath(testHostPath("nbook-storage-project"));
        expect(projectStorageRootFromProjectRoot(projectRoot)).toBe(path.join(projectRoot, ".nbook", "storage"));
    });
});

describe("assertStorageRecordAddress", () => {
    it("单例状态不接受资源标识，资源状态必须给出安全资源标识", () => {
        expect(assertStorageRecordAddress({records: "single", key: "layout"}, undefined)).toBeUndefined();
        expect(() => assertStorageRecordAddress({records: "single", key: "layout"}, {resource: "grid"}))
            .toThrowError(expect.objectContaining({code: "STORAGE_ADDRESS_INVALID", reason: "resource"}));
        expect(assertStorageRecordAddress({records: "identified", key: "note"}, {resource: "note-1"})).toBe("note-1");
        for (const resource of [undefined, "", "../escape", "a/b", "con", "trailing."]) {
            expect(() => assertStorageRecordAddress({records: "identified", key: "note"}, {resource}))
                .toThrowError(expect.objectContaining({code: "STORAGE_ADDRESS_INVALID"}));
        }
    });

    it("记录文件名由 key 与可选资源标识组成", () => {
        expect(storageRecordFileName("layout")).toBe("layout.json");
        expect(storageRecordFileName("layout", "grid-main")).toBe("layout~grid-main.json");
    });
});
