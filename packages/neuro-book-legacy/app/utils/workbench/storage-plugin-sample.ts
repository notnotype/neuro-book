import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";
import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import type {
    ProjectSelectionMemory,
    WorkbenchProjectStorageContext,
    WorkbenchStorageContext,
} from "nbook/app/utils/workbench/storage-context";

export const STORAGE_PLUGIN_SAMPLE_OWNER = "nbook.storage-sample";

export type StoragePluginSamplePreference = {
    readonly compact: boolean;
};

export type StoragePluginSampleObjectMemory = {
    readonly pinned: boolean;
};

export const storagePluginSamplePreference: DefinedStorageState<StoragePluginSamplePreference> = defineStorageState({
    owner: STORAGE_PLUGIN_SAMPLE_OWNER,
    key: "preference",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {compact: false},
    validate: (value): value is StoragePluginSamplePreference => typeof value === "object" && value !== null
        && "compact" in value && typeof value.compact === "boolean",
});

export const storagePluginSampleObjectMemory: DefinedStorageState<StoragePluginSampleObjectMemory> = defineStorageState({
    owner: STORAGE_PLUGIN_SAMPLE_OWNER,
    key: "object-memory",
    scope: "project",
    locality: "local",
    records: "identified",
    schemaVersion: 1,
    defaultValue: {pinned: false},
    validate: (value): value is StoragePluginSampleObjectMemory => typeof value === "object" && value !== null
        && "pinned" in value && typeof value.pinned === "boolean",
});

export type StoragePluginSampleProjection<T> = {
    readonly value: T;
    readonly credential: StorageCredential;
};

export type StoragePluginSample = {
    loadPreference(): Promise<StoragePluginSampleProjection<StoragePluginSamplePreference>>;
    savePreference(
        projection: StoragePluginSampleProjection<StoragePluginSamplePreference>,
        value: StoragePluginSamplePreference,
    ): Promise<StoragePluginSampleProjection<StoragePluginSamplePreference>>;
    loadObjectMemory(
        resource: string,
        objectExists: (resource: string) => boolean,
    ): Promise<StoragePluginSampleProjection<StoragePluginSampleObjectMemory> | null>;
    saveObjectMemory(
        resource: string,
        projection: StoragePluginSampleProjection<StoragePluginSampleObjectMemory>,
        value: StoragePluginSampleObjectMemory,
        objectExists: (resource: string) => boolean,
    ): Promise<StoragePluginSampleProjection<StoragePluginSampleObjectMemory>>;
    readonly selection: ProjectSelectionMemory;
};

/**
 * 第二消费者样例：定义拥有格式，工作台拥有访问生命周期，Project owner 决定对象是否仍存在。
 * 每个实例持有自己的投影；相同 resource 只共享持久化地址，不共享未确认值或释放权。
 */
export function createStoragePluginSample(
    workbench: WorkbenchStorageContext,
    project: WorkbenchProjectStorageContext,
): StoragePluginSample {
    return {
        async loadPreference() {
            const result = await workbench.userOwner(STORAGE_PLUGIN_SAMPLE_OWNER);
            if (result.status === "unavailable") throw new Error(result.diagnosis);
            return projectReadable(result.handle.read(storagePluginSamplePreference), storagePluginSamplePreference);
        },
        async savePreference(projection, value) {
            const result = await workbench.userOwner(STORAGE_PLUGIN_SAMPLE_OWNER);
            if (result.status === "unavailable") throw new Error(result.diagnosis);
            const credential = await result.handle.save(storagePluginSamplePreference, {
                expected: projection.credential,
                value: {...projection.value, compact: value.compact},
            });
            return {value: {...projection.value, compact: value.compact}, credential};
        },
        async loadObjectMemory(resource, objectExists) {
            if (!objectExists(resource)) return null;
            const result = await project.owner(STORAGE_PLUGIN_SAMPLE_OWNER);
            if (result.status === "unavailable") throw new Error(result.diagnosis);
            return projectReadable(
                result.handle.read(storagePluginSampleObjectMemory, {resource}),
                storagePluginSampleObjectMemory,
            );
        },
        async saveObjectMemory(resource, projection, value, objectExists) {
            if (!objectExists(resource)) throw new Error(`插件对象已不存在，不能保存其记忆：${resource}`);
            const result = await project.owner(STORAGE_PLUGIN_SAMPLE_OWNER);
            if (result.status === "unavailable") throw new Error(result.diagnosis);
            const nextValue = {...projection.value, pinned: value.pinned};
            const credential = await result.handle.save(storagePluginSampleObjectMemory, {
                expected: projection.credential,
                value: nextValue,
                resource,
            });
            return {value: nextValue, credential};
        },
        selection: project.memory.selection(STORAGE_PLUGIN_SAMPLE_OWNER),
    };
}

async function projectReadable<T>(
    reading: Promise<StorageReadResult<T>>,
    definition: DefinedStorageState<T>,
): Promise<StoragePluginSampleProjection<T>> {
    const snapshot = await reading;
    if (snapshot.kind === "value") return {value: snapshot.value, credential: snapshot.credential};
    if (snapshot.kind === "missing" || snapshot.kind === "deleted") {
        return {value: definition.defaultValue, credential: snapshot.credential};
    }
    if (snapshot.kind === "legacy-value") throw new Error(`Storage 样例状态需要显式迁移：${definition.address}`);
    throw new Error(snapshot.diagnosis);
}
