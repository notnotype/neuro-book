/**
 * t42 独立复核探针（临时文件，运行后移出仓库归入 Task evidences）。
 * 只观察被审实现的可观察行为，不修改被审源码。
 */
import {describe, expect, it, vi} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {StorageReadResult} from "nbook/shared/storage/contract";
import {defineStorageState} from "nbook/shared/storage/definition";
import {openStorageOwnerHandle, type StorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import type {
    StorageProjectContextSession,
    StorageProjectContextTarget,
    StorageUserContextSession,
} from "nbook/app/utils/storage/host-context-client";
import {createWorkbenchStorageContext, type WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {createStoragePluginSample} from "nbook/app/utils/workbench/storage-plugin-sample";

const CREDENTIAL = "0123456789abcdef".repeat(4);
const readyA = {projectRoot: "/probe/a", publicId: "probe-a:1", revision: 1};
const readyB = {projectRoot: "/probe/b", publicId: "probe-b:1", revision: 2};

function userSession(): StorageUserContextSession {
    return {scope: "user", contextId: "u".repeat(64), clientCredential: CREDENTIAL};
}

function projectSession(target: StorageProjectContextTarget): StorageProjectContextSession {
    return {
        scope: "project",
        contextId: "p".repeat(64),
        clientCredential: CREDENTIAL,
        projectRoot: target.projectRoot,
        publicId: target.publicId,
    };
}

function stubHandle(owner: string, release: () => Promise<void>): StorageOwnerHandle {
    const unsupported = async (): Promise<never> => { throw new Error("probe：未实现的句柄动作"); };
    return {
        owner,
        binding: {local: 1, shared: 1},
        read: unsupported,
        save: unsupported,
        remove: unsupported,
        migrate: unsupported,
        repair: unsupported,
        reclaim: unsupported,
        subscribe: unsupported,
        release,
    };
}

describe("t42 复核探针", () => {
    it("探针1：Project 释放失败会跳过 user 句柄与 session 清理，且没有补救路径", async () => {
        const events: string[] = [];
        const userRelease = vi.fn(async () => { events.push("user-handle-released"); });
        const closeContext = vi.fn(async (session: {readonly scope: string}) => { events.push(`close:${session.scope}`); });
        const adapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async ({owner, session}) => stubHandle(owner, session.scope === "project"
                ? async () => { throw new Error("probe：Project 句柄释放失败"); }
                : userRelease),
            closeContext,
        };
        const context = createWorkbenchStorageContext({adapters});
        await context.userOwner("nbook.sample");
        const project = await context.enterProject(readyA);
        await project.owner("nbook.sample");

        await expect(context.release()).rejects.toThrow("释放工作台 Storage 资源失败");

        expect(events).toContain("close:project");
        expect(userRelease).not.toHaveBeenCalled();
        expect(events).not.toContain("close:user");

        // 重复 release 共同等待同一失败 Promise，没有第二次清理机会
        const repeated = context.release();
        await expect(repeated).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(closeContext).toHaveBeenCalledTimes(1);
    });

    it("探针2：AbortSignal 失效路径的释放失败不产生未处理拒绝", async () => {
        const seen: unknown[] = [];
        const onUnhandled = (reason: unknown): void => { seen.push(reason); };
        process.on("unhandledRejection", onUnhandled);
        try {
            const adapters: WorkbenchStorageAdapters = {
                openUserContext: async () => ({status: "ready", session: userSession()}),
                openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
                openOwnerHandle: async ({owner}) => stubHandle(owner, async () => {
                    throw new Error("probe：释放失败");
                }),
                closeContext: async () => undefined,
            };
            const context = createWorkbenchStorageContext({adapters});
            const invalidation = new AbortController();
            const project = await context.enterProject(readyA, {invalidation: invalidation.signal});
            await project.owner("nbook.sample");

            invalidation.abort();
            // 推进到下一个宏任务边界，让 unhandledRejection 的投递时机到达；不做固定时长等待。
            // 全程不给 project.released 附加任何 handler：实现声明它会自行登记内部 handler。
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            expect(seen).toEqual([]);

            await context.release().catch(() => undefined);
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            expect(seen).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("探针3：切换目标后已借用的 owner facade 仍接纳新写入（窗口持续到迟到打开收口）", async () => {
        const firstOwner = "t42.first";
        const secondOwner = "t42.second";
        const firstDefinition = defineStorageState({
            owner: firstOwner,
            key: "probe",
            scope: "project",
            records: "single",
            schemaVersion: 1,
            defaultValue: {flag: false},
            validate: (value): value is {flag: boolean} => typeof value === "object" && value !== null
                && "flag" in value && typeof value.flag === "boolean",
        });
        const written: string[] = [];
        const transport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "save") {
                    written.push(`${action.owner}/${action.key}`);
                    return {kind: "save", credential: {revision: "probe-rev-1", partitionGeneration: 1}};
                }
                throw new Error(`probe：未实现动作 ${action.kind}`);
            },
        };
        const gate = Promise.withResolvers<StorageOwnerHandle>();
        const lateRelease = vi.fn(async () => undefined);
        const adapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async (options) => options.owner === secondOwner
                ? await gate.promise
                : openStorageOwnerHandle({...options, transport}),
            closeContext: async () => undefined,
        };
        const context = createWorkbenchStorageContext({adapters});
        const project = await context.enterProject(readyA);
        const first = await project.owner(firstOwner);
        expect(first.status).toBe("ready");
        if (first.status !== "ready") throw new Error(first.diagnosis);
        const pendingSecond = project.owner(secondOwner);

        const enteringUserAssets = context.enterUserSurface("user-assets");
        expect(context.target).toEqual({kind: "user-assets"});
        expect(project.available).toBe(false);

        const credential = await first.handle.save(firstDefinition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {flag: true},
        });
        expect(credential.revision).toBe("probe-rev-1");
        expect(written).toEqual([`${firstOwner}/probe`]);

        gate.resolve(stubHandle(secondOwner, lateRelease));
        await enteringUserAssets;
        await pendingSecond;
        expect(lateRelease).toHaveBeenCalledOnce();
        await expect(first.handle.save(firstDefinition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {flag: true},
        })).rejects.toThrow(/句柄已释放/u);
        await context.release();
    });

    it("探针6：旧 Project 释放失败会拒绝发起切换的调用，随后切换仍能继续", async () => {
        const failingAdapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async ({owner, session}) => stubHandle(owner, session.scope === "project"
                ? async () => { throw new Error("probe：Project 句柄释放失败"); }
                : async () => undefined),
            closeContext: async () => undefined,
        };
        const first = createWorkbenchStorageContext({adapters: failingAdapters});
        const a1 = await first.enterProject(readyA);
        await a1.owner("nbook.sample");
        await expect(first.enterUserSurface("user-assets")).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(first.target).toEqual({kind: "user-assets"});
        // 旧 Project 已经不在位，下一次切换不再携带旧错误
        expect((await first.enterProject(readyB)).available).toBe(true);
        await first.release();

        const second = createWorkbenchStorageContext({adapters: failingAdapters});
        const a2 = await second.enterProject(readyA);
        await a2.owner("nbook.sample");
        await expect(second.enterProject(readyB)).rejects.toThrow("释放工作台 Storage 资源失败");
        // 切换目标已同步指向 B，但 B 没有上下文，旧错误只交给本次调用方
        expect(second.target).toEqual({kind: "project", ready: readyB});
        expect(await second.projectOwner("nbook.sample")).toMatchObject({status: "unavailable", reason: "project-unavailable"});
        await second.release();
    });

    it("探针7：等待旧 Project 释放期间 release()，迟到的 enterProject 不得复活", async () => {
        const gate = Promise.withResolvers<void>();
        const adapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async ({owner}) => stubHandle(owner, () => gate.promise),
            closeContext: async () => undefined,
        };
        const context = createWorkbenchStorageContext({adapters});
        const a = await context.enterProject(readyA);
        await a.owner("nbook.sample");

        const pendingB = context.enterProject(readyB);
        const releasing = context.release();
        gate.resolve();
        const b = await pendingB;

        expect(b.available).toBe(false);
        expect(await b.owner("nbook.sample")).toMatchObject({status: "unavailable", reason: "workbench-released"});
        await releasing;
        expect(context.target).toEqual({kind: "idle"});
    });

    it("探针4：内存订阅监听器抛异常会中断同一 selection 的其它消费者", async () => {
        const adapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async ({owner}) => stubHandle(owner, async () => undefined),
            closeContext: async () => undefined,
        };
        const context = createWorkbenchStorageContext({adapters});
        const project = await context.enterProject(readyA);
        const selection = project.memory.selection("nbook.sample");
        const received: Array<string | null> = [];
        selection.subscribe(() => { throw new Error("probe：消费者 A 抛错"); });
        selection.subscribe((value) => received.push(value));

        expect(() => selection.set("scene-1")).toThrow("probe：消费者 A 抛错");
        expect(received).toEqual([]);
        expect(selection.get()).toEqual({status: "ready", value: "scene-1"});
        await context.release();
    });

    it("探针5：样例保留未知字段，且损坏/未知版本不会被当作缺失覆盖", async () => {
        const records = new Map<string, unknown>();
        const forced = new Map<string, StorageReadResult<unknown>>();
        let revision = 0;
        const transport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                const key = `${action.owner}/${action.key}/${"resource" in action ? action.resource ?? "" : ""}`;
                if (action.kind === "read") {
                    const override = forced.get(key);
                    if (override !== undefined) return {kind: "read", result: override};
                    const record = records.get(key);
                    return record === undefined
                        ? {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}}
                        : {kind: "read", result: {kind: "value", value: record, schemaVersion: 1, credential: {
                            revision: "probe-rev",
                            partitionGeneration: 1,
                        }}};
                }
                if (action.kind === "save") {
                    revision += 1;
                    records.set(key, action.value);
                    return {kind: "save", credential: {revision: `probe-rev-${String(revision)}`, partitionGeneration: 1}};
                }
                throw new Error(`probe：未实现动作 ${action.kind}`);
            },
        };
        const adapters: WorkbenchStorageAdapters = {
            openUserContext: async () => ({status: "ready", session: userSession()}),
            openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
            openOwnerHandle: async (options) => openStorageOwnerHandle({...options, transport}),
            closeContext: async () => undefined,
        };
        const objectKey = "nbook.storage-sample/object-memory/chapter-1";
        const preferenceKey = "nbook.storage-sample/preference/";
        records.set(objectKey, {pinned: false, "x-unknown": "keep"});
        const context = createWorkbenchStorageContext({adapters});
        const project = await context.enterProject(readyA);
        const sample = createStoragePluginSample(context, project);
        const objectExists = (resource: string): boolean => resource === "chapter-1";

        const loaded = await sample.loadObjectMemory("chapter-1", objectExists);
        expect(loaded).not.toBeNull();
        expect(loaded?.value).toEqual({pinned: false, "x-unknown": "keep"});
        await sample.saveObjectMemory("chapter-1", loaded!, {...loaded!.value, pinned: true}, objectExists);
        expect(records.get(objectKey)).toEqual({pinned: true, "x-unknown": "keep"});

        forced.set(preferenceKey, {
            kind: "corrupt",
            diagnosis: "probe：记录损坏",
            repair: {partitionGeneration: 1, contentFingerprint: "probe-fp"},
        });
        await expect(sample.loadPreference()).rejects.toThrow("probe：记录损坏");
        forced.set(preferenceKey, {
            kind: "unsupported-version",
            wrapperVersion: 9,
            schemaVersion: 9,
            diagnosis: "probe：未知版本",
            repair: {partitionGeneration: 1, contentFingerprint: "probe-fp"},
        });
        await expect(sample.loadPreference()).rejects.toThrow("probe：未知版本");
        expect(records.has(preferenceKey)).toBe(false);
        await context.release();
    });
});
