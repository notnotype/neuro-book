import {describe, expect, it, vi} from "vitest";
import type {
    StorageContextUnavailable,
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

const CREDENTIAL = "0123456789abcdef".repeat(4);

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
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
    const unsupported = async (): Promise<never> => { throw new Error("测试未实现的句柄动作"); };
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
    const openedHandles: StorageOwnerHandle[] = [];
    const value: WorkbenchStorageAdapters = {
        openUserContext: vi.fn(async () => ({status: "ready" as const, session: userSession(String(++sequence))})),
        openProjectContext: vi.fn(async (target: StorageProjectContextTarget) => ({
            status: "ready" as const,
            session: projectSession(target, String(++sequence)),
        })),
        openOwnerHandle: vi.fn(async ({owner}) => {
            const handle = fakeHandle(owner);
            openedHandles.push(handle);
            return handle;
        }),
        closeContext: vi.fn(async () => undefined),
        ...overrides,
    };
    return {value, openedHandles};
}

const readyA = {projectRoot: "/workspace/a", publicId: "runtime-a:1", revision: 1};
const readyB = {projectRoot: "/workspace/b", publicId: "runtime-b:1", revision: 2};

async function expectReadyOwner(result: WorkbenchStorageOwnerResult) {
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error(result.diagnosis);
    return result.handle;
}

describe("工作台 Storage 消费上下文", () => {
    it("同一工作台复用同 scope/owner 句柄，不同工作台不共享 session 或句柄", async () => {
        const firstAdapters = adapters();
        const secondAdapters = adapters();
        const first = createWorkbenchStorageContext({adapters: firstAdapters.value});
        const second = createWorkbenchStorageContext({adapters: secondAdapters.value});

        const [firstA, firstB, secondA] = await Promise.all([
            first.userOwner("nbook.sample"),
            first.userOwner("nbook.sample"),
            second.userOwner("nbook.sample"),
        ]);

        expect(await expectReadyOwner(firstA)).toBe(await expectReadyOwner(firstB));
        expect(await expectReadyOwner(firstA)).not.toBe(await expectReadyOwner(secondA));
        expect(firstAdapters.value.openUserContext).toHaveBeenCalledOnce();
        expect(firstAdapters.value.openOwnerHandle).toHaveBeenCalledOnce();
        expect(secondAdapters.value.openUserContext).toHaveBeenCalledOnce();
        await Promise.all([first.release(), second.release()]);
    });

    it("空闲与用户资产是显式 user 目标，缺少 Project 时明确不可用且不 fallback", async () => {
        const harness = adapters();
        const context = createWorkbenchStorageContext({adapters: harness.value});

        expect(context.target).toEqual({kind: "idle"});
        const missing = await context.projectOwner("nbook.sample");
        expect(missing).toMatchObject({status: "unavailable", reason: "project-unavailable"});
        expect(harness.value.openUserContext).not.toHaveBeenCalled();
        expect(harness.value.openProjectContext).not.toHaveBeenCalled();

        await context.enterUserSurface("user-assets");
        expect(context.target).toEqual({kind: "user-assets"});
        await expectReadyOwner(await context.userOwner("nbook.sample"));
        expect(harness.value.openUserContext).toHaveBeenCalledOnce();
        expect(harness.value.openProjectContext).not.toHaveBeenCalled();
        await context.release();
    });

    it("A 切 B 会先撤销旧访问和内存，保留合法 user 上下文", async () => {
        const harness = adapters();
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const user = await expectReadyOwner(await context.userOwner("nbook.sample"));
        const projectA = await context.enterProject(readyA);
        const projectAHandle = await expectReadyOwner(await projectA.owner("nbook.sample"));
        const selectionA = projectA.memory.selection("nbook.sample");
        expect(selectionA.set("chapter-a")).toEqual({status: "ready", value: "chapter-a"});

        const projectB = await context.enterProject(readyB);

        expect(projectA.available).toBe(false);
        expect(await projectA.owner("nbook.sample")).toMatchObject({status: "unavailable", reason: "project-invalidated"});
        expect(selectionA.get()).toMatchObject({status: "unavailable", reason: "project-invalidated"});
        expect(harness.openedHandles[1]?.release).toHaveBeenCalledOnce();
        expect(context.target).toEqual({kind: "project", ready: readyB});
        expect(await expectReadyOwner(await context.userOwner("nbook.sample"))).toBe(user);
        expect(await expectReadyOwner(await projectB.owner("nbook.sample"))).not.toBe(projectAHandle);
        await context.release();
    });

    it("同路径的新 ready 代次不会复活旧引用", async () => {
        const harness = adapters();
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const first = await context.enterProject(readyA);
        const firstSelection = first.memory.selection("nbook.sample");
        firstSelection.set("old");

        const second = await context.enterProject({...readyA, publicId: "runtime-a:2", revision: 2});

        expect(firstSelection.get()).toMatchObject({status: "unavailable", reason: "project-invalidated"});
        expect(second.memory.selection("nbook.sample").get()).toEqual({status: "ready", value: null});
        expect(harness.value.openProjectContext).not.toHaveBeenCalled();
        await context.release();
    });

    it("同一 Project 上下文的两消费者共享选择，新工作台互相隔离", async () => {
        const first = createWorkbenchStorageContext({adapters: adapters().value});
        const second = createWorkbenchStorageContext({adapters: adapters().value});
        const firstProject = await first.enterProject(readyA);
        const secondProject = await second.enterProject(readyA);
        const firstView = firstProject.memory.selection("nbook.sample");
        const siblingView = firstProject.memory.selection("nbook.sample");
        const otherWorkbench = secondProject.memory.selection("nbook.sample");

        expect(firstView).toBe(siblingView);
        firstView.set("scene-1");
        expect(siblingView.get()).toEqual({status: "ready", value: "scene-1"});
        const updates: Array<string | null> = [];
        const unsubscribe = siblingView.subscribe((value) => updates.push(value));
        firstView.set("scene-2");
        unsubscribe();
        firstView.set("scene-3");
        expect(updates).toEqual(["scene-2"]);
        expect(otherWorkbench.get()).toEqual({status: "ready", value: null});
        await Promise.all([first.release(), second.release()]);
    });

    it("失效信号立即撤销 Project，且不会关闭仍合法的 user 上下文", async () => {
        const harness = adapters();
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const user = await expectReadyOwner(await context.userOwner("nbook.sample"));
        const invalidation = new AbortController();
        const project = await context.enterProject(readyA, {invalidation: invalidation.signal});
        const projectHandle = await expectReadyOwner(await project.owner("nbook.sample"));

        invalidation.abort();
        await project.released;

        expect(project.available).toBe(false);
        expect(harness.openedHandles[1]?.release).toHaveBeenCalledOnce();
        expect(context.target).toEqual({kind: "idle"});
        expect(await expectReadyOwner(await context.userOwner("nbook.sample"))).toBe(user);
        expect(harness.value.closeContext).toHaveBeenCalledTimes(1);
        await context.release();
        expect(harness.value.closeContext).toHaveBeenCalledTimes(2);
    });

    it("Project 清理失败仍会释放 user，重复 release 共同等待同一结果", async () => {
        const projectFailure = new Error("测试 Project 释放失败");
        const closedScopes: string[] = [];
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner, session}) => fakeHandle(owner, vi.fn(async () => {
                if (session.scope === "project") throw projectFailure;
            }))),
            closeContext: vi.fn(async (session) => { closedScopes.push(session.scope); }),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        await expectReadyOwner(await context.userOwner("nbook.user"));
        const project = await context.enterProject(readyA);
        await expectReadyOwner(await project.owner("nbook.project"));

        const first = context.release();
        expect(context.release()).toBe(first);
        await expect(first).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(closedScopes).toEqual(expect.arrayContaining(["project", "user"]));
        expect(closedScopes).toHaveLength(2);
    });

    it("Project 切换同步封锁已借用 facade，并等待此前已接纳的真实保存完成", async () => {
        const definition = defineStorageState({
            owner: "nbook.sample",
            key: "state",
            scope: "project",
            locality: "local",
            records: "single",
            schemaVersion: 1,
            defaultValue: {enabled: false},
            validate: (value): value is {enabled: boolean} => typeof value === "object" && value !== null
                && "enabled" in value && typeof value.enabled === "boolean",
        });
        const saveGate = deferred<void>();
        const secondOwnerGate = deferred<StorageOwnerHandle>();
        const sent: string[] = [];
        const transport: StorageValueTransport = {
            async send(action: StorageActionRequest): Promise<StorageActionResponse> {
                sent.push(action.kind);
                if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
                if (action.kind === "read") {
                    return {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}};
                }
                if (action.kind === "save") {
                    await saveGate.promise;
                    return {kind: "save", credential: {revision: "saved", partitionGeneration: 1}};
                }
                throw new Error(`测试未实现动作：${action.kind}`);
            },
        };
        const harness = adapters({
            openOwnerHandle: vi.fn(async (options) => options.owner === "nbook.blocked"
                ? secondOwnerGate.promise
                : openStorageOwnerHandle({...options, transport, subscribe: {intervalMs: 60_000, maxBackoffMs: 60_000}})),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const project = await context.enterProject(readyA);
        const facade = await expectReadyOwner(await project.owner("nbook.sample"));
        const subscription = await facade.subscribe(definition);
        const accepted = facade.save(definition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {enabled: true},
        });
        const blockedOpening = project.owner("nbook.blocked");
        const switching = context.enterUserSurface("user-assets");

        await expect(facade.save(definition, {
            expected: {revision: null, partitionGeneration: 1},
            value: {enabled: false},
        })).rejects.toThrow("Project Storage 上下文已失效");
        expect(sent.filter((kind) => kind === "save")).toEqual(["save"]);
        saveGate.resolve();
        secondOwnerGate.resolve(fakeHandle("nbook.blocked"));
        await expect(accepted).resolves.toMatchObject({revision: "saved"});
        await switching;
        await expect(blockedOpening).resolves.toMatchObject({status: "unavailable", reason: "project-invalidated"});
        await expect(subscription.refresh()).rejects.toThrow("Storage 订阅已关闭");
        await context.release();
    });

    it("workbench release 同步封锁 user facade", async () => {
        const rawRead = vi.fn(async (): Promise<never> => { throw new Error("释放后不能委派读取"); });
        const raw: StorageOwnerHandle = {...fakeHandle("nbook.user"), read: rawRead};
        const harness = adapters({openOwnerHandle: vi.fn(async () => raw)});
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const facade = await expectReadyOwner(await context.userOwner("nbook.user"));

        const releasing = context.release();
        await expect(facade.read({} as never)).rejects.toThrow("工作台 Storage 上下文已释放");
        expect(rawRead).not.toHaveBeenCalled();
        await releasing;
    });

    it("选择订阅者异常不会中断其它消费者", async () => {
        const context = createWorkbenchStorageContext({adapters: adapters().value});
        const project = await context.enterProject(readyA);
        const selection = project.memory.selection("nbook.sample");
        const observed: Array<string | null> = [];
        selection.subscribe(() => { throw new Error("测试监听异常"); });
        selection.subscribe((value) => observed.push(value));

        expect(selection.set("chapter-1")).toEqual({status: "ready", value: "chapter-1"});
        expect(selection.get()).toEqual({status: "ready", value: "chapter-1"});
        expect(observed).toEqual(["chapter-1"]);
        await context.release();
    });

    it("release 禁止新借用，等待已接纳初始化并回收迟到 session", async () => {
        const opening = deferred<StorageUserContextSession>();
        const harness = adapters({
            openUserContext: vi.fn(async () => ({status: "ready" as const, session: await opening.promise})),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const borrowing = context.userOwner("nbook.sample");
        const releasing = context.release();

        expect(context.release()).toBe(releasing);
        expect(await context.userOwner("nbook.other")).toMatchObject({status: "unavailable", reason: "workbench-released"});
        opening.resolve(userSession("f"));
        await expect(borrowing).resolves.toMatchObject({status: "unavailable", reason: "workbench-released"});
        await releasing;
        expect(harness.value.openOwnerHandle).toHaveBeenCalledOnce();
        expect(harness.openedHandles[0]?.release).toHaveBeenCalledOnce();
        expect(harness.value.closeContext).toHaveBeenCalledOnce();
    });

    it("release 等待迟到句柄完成自身排空后才关闭 session", async () => {
        const handleOpening = deferred<StorageOwnerHandle>();
        const handleReleased = deferred<void>();
        const release = vi.fn(() => handleReleased.promise);
        const order: string[] = [];
        const harness = adapters({
            openOwnerHandle: vi.fn(async () => await handleOpening.promise),
            closeContext: vi.fn(async () => { order.push("context"); }),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const borrowing = context.userOwner("nbook.sample");
        await Promise.resolve();
        await Promise.resolve();
        const closing = context.release();

        expect(release).not.toHaveBeenCalled();
        expect(harness.value.closeContext).not.toHaveBeenCalled();
        handleOpening.resolve(fakeHandle("nbook.sample", release));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(release).toHaveBeenCalledOnce();
        expect(harness.value.closeContext).not.toHaveBeenCalled();
        order.push("handle");
        handleReleased.resolve();
        await closing;

        expect(await borrowing).toMatchObject({status: "unavailable", reason: "workbench-released"});
        expect(order).toEqual(["handle", "context"]);
    });

    it("等待旧 Project 释放时，较新的用户工作面胜出且迟到 Project 不会复活", async () => {
        const releaseGate = deferred<void>();
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner}) => fakeHandle(owner, vi.fn(() => releaseGate.promise))),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const projectA = await context.enterProject(readyA);
        await projectA.owner("nbook.sample");

        const enteringB = context.enterProject(readyB);
        const enteringUserAssets = context.enterUserSurface("user-assets");
        releaseGate.resolve();
        const [projectB] = await Promise.all([enteringB, enteringUserAssets]);

        expect(context.target).toEqual({kind: "user-assets"});
        expect(projectB.available).toBe(false);
        expect(await context.projectOwner("nbook.sample")).toMatchObject({status: "unavailable", reason: "project-unavailable"});
        await context.release();
    });

    it("释放失败保持可观察并使 released 收口，不留下永远等待的 Promise", async () => {
        const failure = new Error("测试释放失败");
        const harness = adapters({
            openOwnerHandle: vi.fn(async ({owner}) => fakeHandle(owner, vi.fn(async () => { throw failure; }))),
        });
        const context = createWorkbenchStorageContext({adapters: harness.value});
        const project = await context.enterProject(readyA);
        await project.owner("nbook.sample");

        await expect(project.invalidate()).rejects.toThrow("释放工作台 Storage 资源失败");
        await expect(project.released).rejects.toThrow("释放工作台 Storage 资源失败");
        expect(project.available).toBe(false);
        await context.release();
    });


    it("上下文签发失败保留明确原因与诊断，后续借用可以显式重试", async () => {
        const unavailable: StorageContextUnavailable = {
            status: "unavailable",
            reason: "backend-unreachable",
            diagnosis: "测试后端不可达",
            code: null,
            statusCode: null,
        };
        const harness = adapters();
        vi.mocked(harness.value.openUserContext)
            .mockResolvedValueOnce(unavailable)
            .mockResolvedValueOnce({status: "ready", session: userSession("e")});
        const context = createWorkbenchStorageContext({adapters: harness.value});

        expect(await context.userOwner("nbook.sample")).toEqual(unavailable);
        expect(await context.userOwner("nbook.sample")).toMatchObject({status: "ready"});
        expect(harness.value.openUserContext).toHaveBeenCalledTimes(2);
        await context.release();
    });
});
