/**
 * t42 最终追加复核探针（临时文件，运行后移回 Task evidences，不进入产品）。
 * 只断言被审实现的公开行为，不改动 storage-context / storage-plugin-sample。
 * 等待点只用微任务轮转，不绑定真实时钟。
 */
import {describe, expect, it, vi} from "vitest";
import {setImmediate as tick} from "node:timers/promises";
import type {
    StorageProjectContextSession,
    StorageProjectContextTarget,
    StorageUserContextSession,
} from "nbook/app/utils/storage/host-context-client";
import {openStorageOwnerHandle, type StorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import {defineStorageState} from "nbook/shared/storage/definition";
import type {StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageOwnerResult,
} from "nbook/app/utils/workbench/storage-context";
import {createStoragePluginSample} from "nbook/app/utils/workbench/storage-plugin-sample";

const CREDENTIAL = "0123456789abcdef".repeat(4);
const MISSING = {revision: null, partitionGeneration: 1};

/** 只推进微任务队列：被审实现的释放链不含计时器，固定轮转即确定性等待。 */
async function drain(turns = 24): Promise<void> {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

function userSession(id: string): StorageUserContextSession {
    return {scope: "user", contextId: id.repeat(64).slice(0, 64), clientCredential: CREDENTIAL};
}

function projectSession(target: StorageProjectContextTarget, id: string): StorageProjectContextSession {
    return {
        scope: "project",
        contextId: id.repeat(64).slice(0, 64),
        clientCredential: CREDENTIAL,
        projectRoot: target.projectRoot,
        publicId: target.publicId,
    };
}

function fakeHandle(owner: string, release = vi.fn(() => Promise.resolve())): StorageOwnerHandle {
    const unsupported = async (): Promise<never> => { throw new Error("探针未实现的句柄动作"); };
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

function adapters(overrides: Partial<WorkbenchStorageAdapters> = {}) {
    let sequence = 0;
    const value: WorkbenchStorageAdapters = {
        openUserContext: vi.fn(async () => ({status: "ready" as const, session: userSession(String(++sequence))})),
        openProjectContext: vi.fn(async (target: StorageProjectContextTarget) => ({
            status: "ready" as const,
            session: projectSession(target, String(++sequence)),
        })),
        openOwnerHandle: vi.fn(async ({owner}) => fakeHandle(owner)),
        closeContext: vi.fn(async () => undefined),
        ...overrides,
    };
    return value;
}

const readyA = {projectRoot: "/workspace/a", publicId: "runtime-a:1", revision: 1};
const readyB = {projectRoot: "/workspace/b", publicId: "runtime-b:1", revision: 2};

async function expectReadyOwner(result: WorkbenchStorageOwnerResult) {
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error(result.diagnosis);
    return result.handle;
}

const switchDefinition = defineStorageState({
    owner: "nbook.p",
    key: "state",
    scope: "project",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {enabled: false},
    validate: (value): value is {enabled: boolean} => typeof value === "object" && value !== null
        && "enabled" in value && typeof value.enabled === "boolean",
});

const userDefinition = defineStorageState({
    owner: "nbook.u",
    key: "preference",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {compact: false},
    validate: (value): value is {compact: boolean} => typeof value === "object" && value !== null
        && "compact" in value && typeof value.compact === "boolean",
});

function missingRead(): Promise<StorageActionResponse> {
    return Promise.resolve({kind: "read", result: {kind: "missing", credential: MISSING}});
}

describe("t42 最终追加复核探针", () => {
    it("探针1 Project 句柄释放失败时 user 句柄与两个 session 仍被清理，重复 release 共同等待", async () => {
        const projectFailure = new Error("探针 Project 句柄释放失败");
        const releasedOwners: string[] = [];
        const closedScopes: string[] = [];
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner, session}) => fakeHandle(owner, vi.fn(async () => {
                releasedOwners.push(owner);
                if (session.scope === "project") throw projectFailure;
            }))),
            closeContext: vi.fn(async (session) => { closedScopes.push(session.scope); }),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        await expectReadyOwner(await context.userOwner("nbook.u"));
        const project = await context.enterProject(readyA);
        await expectReadyOwner(await project.owner("nbook.p"));

        const first = context.release();
        expect(context.release()).toBe(first);
        await expect(first).rejects.toThrow("释放工作台 Storage 资源失败");

        expect([...releasedOwners].sort()).toEqual(["nbook.p", "nbook.u"]);
        expect([...closedScopes].sort()).toEqual(["project", "user"]);
    });

    it("探针2 切换时已打开句柄立即停止，不等其它 owner 的在途打开", async () => {
        const gatedOwnerGate = Promise.withResolvers<StorageOwnerHandle>();
        const transport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") return await missingRead();
                throw new Error(`探针未实现动作：${action.kind}`);
            },
        };
        const harness = adapters({
            openOwnerHandle: vi.fn(async (options) => options.owner === "nbook.gated"
                ? gatedOwnerGate.promise
                : openStorageOwnerHandle({...options, transport, subscribe: {intervalMs: 60_000, maxBackoffMs: 60_000}})),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const project = await context.enterProject(readyA);
        const facade = await expectReadyOwner(await project.owner("nbook.p"));
        const subscription = await facade.subscribe(switchDefinition);
        const gatedOpening = project.owner("nbook.gated");

        let switchingSettled = false;
        const switching = context.enterUserSurface("user-assets").then(() => { switchingSettled = true; });
        await drain();

        expect(switchingSettled).toBe(false);
        await expect(subscription.refresh()).rejects.toThrow("Storage 订阅已关闭");
        expect(context.target).toEqual({kind: "user-assets"});

        const gatedHandle = fakeHandle("nbook.gated");
        gatedOwnerGate.resolve(gatedHandle);
        await switching;
        await expect(gatedOpening).resolves.toMatchObject({status: "unavailable", reason: "project-invalidated"});
        expect(gatedHandle.release).toHaveBeenCalledOnce();
        await context.release();
    });

    it("探针3 切换同步入口立即封锁 project facade，user facade 在切换期间仍然可用", async () => {
        const sent: string[] = [];
        const userTransport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                sent.push(`user:${action.kind}`);
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") return await missingRead();
                throw new Error(`探针未实现动作：${action.kind}`);
            },
        };
        const projectTransport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                sent.push(`project:${action.kind}`);
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") return await missingRead();
                if (action.kind === "save") return {kind: "save", credential: {revision: "r1", partitionGeneration: 1}};
                throw new Error(`探针未实现动作：${action.kind}`);
            },
        };
        const harness = adapters({
            openOwnerHandle: vi.fn(async (options) => openStorageOwnerHandle({
                ...options,
                transport: options.session.scope === "user" ? userTransport : projectTransport,
                subscribe: {intervalMs: 60_000, maxBackoffMs: 60_000},
            })),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const userFacade = await expectReadyOwner(await context.userOwner("nbook.u"));
        const project = await context.enterProject(readyA);
        const projectFacade = await expectReadyOwner(await project.owner("nbook.p"));

        const switching = context.enterUserSurface("user-assets");
        await expect(projectFacade.save(switchDefinition, {expected: MISSING, value: {enabled: true}}))
            .rejects.toThrow("Project Storage 上下文已失效");
        expect(sent.filter((entry) => entry === "project:save")).toEqual([]);
        await expect(userFacade.read(userDefinition)).resolves.toMatchObject({kind: "missing"});

        await switching;
        await context.release();
    });

    it("探针4 已失效 Project 仍在途的释放会被 release() 等待", async () => {
        const releaseGate = Promise.withResolvers<void>();
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner}) => fakeHandle(owner, vi.fn(() => releaseGate.promise))),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const project = await context.enterProject(readyA);
        await expectReadyOwner(await project.owner("nbook.p"));

        const invalidating = project.invalidate();
        let releaseSettled = false;
        const releasing = context.release().then(() => { releaseSettled = true; }, () => { releaseSettled = true; });
        await drain();

        expect(releaseSettled).toBe(false);
        releaseGate.resolve();
        await invalidating;
        await releasing;
        expect(releaseSettled).toBe(true);
    });

    it("探针5 旧 Project 释放失败后切换：错误可观察，且后续切换不被污染", async () => {
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner, session}) => fakeHandle(owner, vi.fn(async () => {
                if (session.scope === "project") throw new Error("探针 Project 释放失败");
            }))),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const projectA = await context.enterProject(readyA);
        await expectReadyOwner(await projectA.owner("nbook.p"));

        await expect(context.enterProject(readyB)).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(context.target).toEqual({kind: "project", ready: readyB});
        await expect(context.projectOwner("nbook.p")).resolves.toMatchObject({
            status: "unavailable",
            reason: "project-unavailable",
        });

        const projectB = await context.enterProject(readyB);
        expect(projectB.available).toBe(true);
        await context.release();
    });

    it("探针6 样例遇到 corrupt 与 unsupported-version 时抛错，不写回损坏记录", async () => {
        const writes: string[] = [];
        const reads: Record<string, "corrupt" | "unsupported-version"> = {
            preference: "corrupt",
            "object-memory": "unsupported-version",
        };
        const transportFor = (): StorageValueTransport => ({
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") {
                    const kind = reads[action.key] ?? "missing";
                    if (kind === "missing") return await missingRead();
                    if (kind === "corrupt") {
                        return {kind: "read", result: {
                            kind: "corrupt",
                            diagnosis: "探针偏好记录损坏",
                            repair: {partitionGeneration: 1, contentFingerprint: "probe-corrupt"},
                        }};
                    }
                    return {kind: "read", result: {
                        kind: "unsupported-version",
                        wrapperVersion: 1,
                        schemaVersion: 9,
                        diagnosis: "探针记录版本高于当前定义",
                        repair: {partitionGeneration: 1, contentFingerprint: "probe-newer"},
                    }};
                }
                writes.push(action.kind);
                throw new Error(`探针不应写入：${action.kind}`);
            },
        });
        const harness = adapters({
            openOwnerHandle: vi.fn(async (options) => openStorageOwnerHandle({...options, transport: transportFor()})),
        });
        const workbench = createWorkbenchStorageContext({adapters: harness});
        const project = await workbench.enterProject(readyA);
        const sample = createStoragePluginSample(workbench, project);

        await expect(sample.loadPreference()).rejects.toThrow("探针偏好记录损坏");
        await expect(sample.loadObjectMemory("chapter-1", () => true)).rejects.toThrow("探针记录版本高于当前定义");
        expect(writes).toEqual([]);
        await workbench.release();
    });

    it("探针7 失效信号触发的释放失败不产生未处理拒绝，并经 released 可观察", async () => {
        const rejections: unknown[] = [];
        const onUnhandled = (reason: unknown): void => { rejections.push(reason); };
        process.on("unhandledRejection", onUnhandled);
        try {
            const harness = adapters({
                openOwnerHandle: vi.fn(async ({owner, session}) => fakeHandle(owner, vi.fn(async () => {
                    if (session.scope === "project") throw new Error("探针 Project 释放失败");
                }))),
            });
            const context = createWorkbenchStorageContext({adapters: harness});
            const invalidation = new AbortController();
            const project = await context.enterProject(readyA, {invalidation: invalidation.signal});
            await expectReadyOwner(await project.owner("nbook.p"));

            invalidation.abort();
            await expect(project.released).rejects.toThrow("释放工作台 Storage 资源失败");
            await drain();
            await tick();
            await drain();

            expect(rejections).toEqual([]);
            expect(project.available).toBe(false);
            await context.release();
            expect(rejections).toEqual([]);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("探针8 工作台释放时 user 已接纳写入仍排空，释放等待它完成", async () => {
        const saveGate = Promise.withResolvers<void>();
        const order: string[] = [];
        const transport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") return await missingRead();
                if (action.kind === "save") {
                    await saveGate.promise;
                    order.push("save");
                    return {kind: "save", credential: {revision: "r1", partitionGeneration: 1}};
                }
                throw new Error(`探针未实现动作：${action.kind}`);
            },
        };
        const harness = adapters({
            openOwnerHandle: vi.fn(async (options) => openStorageOwnerHandle({
                ...options,
                transport,
                subscribe: {intervalMs: 60_000, maxBackoffMs: 60_000},
            })),
            closeContext: vi.fn(async (session) => { order.push(`close:${session.scope}`); }),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const facade = await expectReadyOwner(await context.userOwner("nbook.u"));
        const accepted = facade.save(userDefinition, {expected: MISSING, value: {compact: true}});

        let releaseSettled = false;
        const releasing = context.release().then(() => { releaseSettled = true; }, () => { releaseSettled = true; });
        await drain();

        expect(releaseSettled).toBe(false);
        await expect(facade.read(userDefinition)).rejects.toThrow("工作台 Storage 上下文已释放");
        saveGate.resolve();
        await expect(accepted).resolves.toMatchObject({revision: "r1"});
        await releasing;
        expect(order).toEqual(["save", "close:user"]);
    });

    it("探针9 释放期间失败的 owner 打开被计入 release 失败，借用方只看到已释放", async () => {
        const openingFailure = new Error("探针 owner 打开失败（非清理失败）");
        const openingGate = Promise.withResolvers<void>();
        const harness = adapters({
            openOwnerHandle: vi.fn(async () => { await openingGate.promise; throw openingFailure; }),
        });
        const context = createWorkbenchStorageContext({adapters: harness});
        const borrowing = context.userOwner("nbook.u");
        await drain();

        const releasing = context.release();
        openingGate.resolve();
        await expect(borrowing).resolves.toMatchObject({status: "unavailable", reason: "workbench-released"});
        await expect(releasing).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(harness.closeContext).toHaveBeenCalledOnce();
    });
});
