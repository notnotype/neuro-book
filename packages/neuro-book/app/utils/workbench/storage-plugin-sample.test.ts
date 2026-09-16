import {describe, expect, it} from "vitest";
import type {StorageActionRequest, StorageActionResponse} from "nbook/shared/storage/action";
import type {
    StorageProjectContextSession,
    StorageProjectContextTarget,
    StorageUserContextSession,
} from "nbook/app/utils/storage/host-context-client";
import {openStorageOwnerHandle} from "nbook/app/utils/storage/owner-handle";
import type {StorageValueTransport} from "nbook/app/utils/storage/value-transport";
import {createWorkbenchStorageContext, type WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import {createStoragePluginSample} from "nbook/app/utils/workbench/storage-plugin-sample";

const ready = {projectRoot: "/workspace/sample", publicId: "runtime-sample:1", revision: 1};
const credential = "0123456789abcdef".repeat(4);

type StoredRecord = {value: unknown; revision: string};

function userSession(): StorageUserContextSession {
    return {scope: "user", contextId: "user-context".padEnd(64, "u"), clientCredential: credential};
}

function projectSession(target: StorageProjectContextTarget): StorageProjectContextSession {
    return {
        scope: "project",
        contextId: "project-context".padEnd(64, "p"),
        clientCredential: credential,
        projectRoot: target.projectRoot,
        publicId: target.publicId,
    };
}

function storageHarness() {
    const records = new Map<string, StoredRecord>();
    let revision = 0;
    const transportFor = (scope: "user" | "project"): StorageValueTransport => ({
        async send(action: StorageActionRequest): Promise<StorageActionResponse> {
            if (action.kind === "bind") return {kind: "bind", binding: {local: 1, shared: 1}};
            const key = `${scope}/${action.owner}/${action.key}/${"resource" in action ? action.resource ?? "" : ""}`;
            if (action.kind === "read") {
                const record = records.get(key);
                return record === undefined
                    ? {kind: "read", result: {kind: "missing", credential: {revision: null, partitionGeneration: 1}}}
                    : {kind: "read", result: {kind: "value", value: record.value, schemaVersion: 1, credential: {
                        revision: record.revision,
                        partitionGeneration: 1,
                    }}};
            }
            if (action.kind === "save") {
                const record = records.get(key);
                if ((record?.revision ?? null) !== action.expected.revision) throw new Error("测试条件写冲突");
                const next = `revision-${String(++revision)}`;
                records.set(key, {value: action.value, revision: next});
                return {kind: "save", credential: {revision: next, partitionGeneration: 1}};
            }
            throw new Error(`测试未实现动作：${action.kind}`);
        },
    });
    const adapters: WorkbenchStorageAdapters = {
        openUserContext: async () => ({status: "ready", session: userSession()}),
        openProjectContext: async (target) => ({status: "ready", session: projectSession(target)}),
        openOwnerHandle: async (options) => openStorageOwnerHandle({
            ...options,
            transport: transportFor(options.session.scope),
        }),
        closeContext: async () => undefined,
    };
    return {adapters, records};
}

describe("工作台 Storage 插件样例", () => {
    it("真实 owner 句柄贯穿偏好和对象记忆的 read/save/reopen，并保留各实例投影", async () => {
        const harness = storageHarness();
        const firstWorkbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const firstProject = await firstWorkbench.enterProject(ready);
        const first = createStoragePluginSample(firstWorkbench, firstProject);
        const sibling = createStoragePluginSample(firstWorkbench, firstProject);
        const objectExists = (resource: string) => resource === "chapter-1";

        const preference = await first.loadPreference();
        await first.savePreference(preference, {compact: true});
        const objectMemory = await first.loadObjectMemory("chapter-1", objectExists);
        expect(objectMemory).not.toBeNull();
        await first.saveObjectMemory("chapter-1", objectMemory!, {pinned: true}, objectExists);
        expect(await sibling.loadObjectMemory("missing", objectExists)).toBeNull();
        expect(first.selection).toBe(sibling.selection);
        sibling.selection.set("chapter-1");
        expect(first.selection.get()).toEqual({status: "ready", value: "chapter-1"});
        await firstWorkbench.release();

        const reopenedWorkbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const reopenedProject = await reopenedWorkbench.enterProject(ready);
        const reopened = createStoragePluginSample(reopenedWorkbench, reopenedProject);
        expect(await reopened.loadPreference()).toMatchObject({value: {compact: true}});
        expect(await reopened.loadObjectMemory("chapter-1", objectExists)).toMatchObject({value: {pinned: true}});
        expect(reopened.selection.get()).toEqual({status: "ready", value: null});
        await reopenedWorkbench.release();
    });

    it("保存已知字段时保留投影中的未知字段", async () => {
        const harness = storageHarness();
        const userKey = `${"user"}/${"nbook.storage-sample"}/${"preference"}/`;
        const projectKey = `${"project"}/${"nbook.storage-sample"}/${"object-memory"}/${"chapter-1"}`;
        harness.records.set(userKey, {value: {compact: false, future: "user"}, revision: "user-1"});
        harness.records.set(projectKey, {value: {pinned: false, future: "project"}, revision: "project-1"});
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const project = await workbench.enterProject(ready);
        const sample = createStoragePluginSample(workbench, project);
        const objectExists = (resource: string) => resource === "chapter-1";

        const preference = await sample.loadPreference();
        await sample.savePreference(preference, {compact: true});
        const objectMemory = await sample.loadObjectMemory("chapter-1", objectExists);
        await sample.saveObjectMemory("chapter-1", objectMemory!, {pinned: true}, objectExists);

        expect(harness.records.get(userKey)?.value).toEqual({compact: true, future: "user"});
        expect(harness.records.get(projectKey)?.value).toEqual({pinned: true, future: "project"});
        await workbench.release();
    });

    it("换代清空 Project 内存，user 偏好继续可用且不存在对象不能保存", async () => {
        const harness = storageHarness();
        const workbench = createWorkbenchStorageContext({adapters: harness.adapters});
        const projectA = await workbench.enterProject(ready);
        const sampleA = createStoragePluginSample(workbench, projectA);
        const preference = await sampleA.loadPreference();
        await sampleA.savePreference(preference, {compact: true});
        sampleA.selection.set("chapter-1");

        const projectB = await workbench.enterProject({...ready, publicId: "runtime-sample:2", revision: 2});
        const sampleB = createStoragePluginSample(workbench, projectB);
        expect(sampleA.selection.get()).toMatchObject({status: "unavailable", reason: "project-invalidated"});
        expect(sampleB.selection.get()).toEqual({status: "ready", value: null});
        expect(await sampleB.loadPreference()).toMatchObject({value: {compact: true}});
        await expect(sampleB.saveObjectMemory(
            "deleted-object",
            {value: {pinned: false}, credential: {revision: null, partitionGeneration: 1}},
            {pinned: true},
            () => false,
        )).rejects.toThrow("插件对象已不存在");
        await workbench.release();
    });
});
