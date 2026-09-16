/**
 * t42 复核临时探针：逐字复跑 t40 Leader 初稿复核记录的 P1 探针（临时文件，运行后移出仓库）。
 */
import {expect, it} from "vitest";
import {createWorkbenchStorageContext, type WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import type {StorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";

it("离开到用户资产后，旧enterProject等待释放完成不能重新安装Project", async () => {
    let finishRelease!: () => void;
    const gate = new Promise<void>((resolve) => { finishRelease = resolve; });
    const unused = async (): Promise<never> => { throw new Error("unused"); };
    const handle: StorageOwnerHandle = {
        owner: "test.owner", binding: {local: 1, shared: 1},
        read: unused, save: unused, remove: unused, migrate: unused, repair: unused,
        reclaim: unused, subscribe: unused, release: () => gate,
    };
    const adapters: WorkbenchStorageAdapters = {
        openUserContext: unused,
        openProjectContext: async (ready) => ({status: "ready", session: {
            scope: "project", contextId: "a".repeat(64), clientCredential: "b".repeat(64), ...ready,
        }}),
        openOwnerHandle: async () => handle,
        closeContext: async () => undefined,
    };
    const context = createWorkbenchStorageContext({adapters});
    const a = await context.enterProject({projectRoot: "/a", publicId: "a"});
    await a.owner("test.owner");
    const pendingB = context.enterProject({projectRoot: "/b", publicId: "b"});
    // 原文是 `await context.enterUserSurface("user-assets")`：新实现会等待在途旧 Project 释放，
    // 因此先发起切换（同步生效）再放行 gate，避免探针自身死锁。
    const enteringUserAssets = context.enterUserSurface("user-assets");
    finishRelease();
    await enteringUserAssets;
    const b = await pendingB;
    try {
        expect(context.target).toEqual({kind: "user-assets"});
        expect(b.available).toBe(false);
        expect((await context.projectOwner("test.owner")).status).toBe("unavailable");
    } finally { await context.release(); }
});
