/**
 * 读取分类到宿主投影的纯映射。
 *
 * 投影只决定“当前该显示什么”：缺失与删除回落到产品默认值，损坏与未知版本回落并给出诊断，
 * 但默认显示不产生文件、不替换原记录。宿主据此区分“已确认值”“默认显示”和“不可用”。
 */

import type {DefinedStorageState} from "nbook/shared/storage/definition";
import type {StorageCredential, StorageReadResult} from "nbook/shared/storage/contract";

/** 投影状态；`confirmed` 是唯一可以直接当作已保存事实的状态。 */
export type StorageProjectedStatus = "confirmed" | "legacy" | "default" | "unavailable";

export type StorageProjectedState<T> = {
    readonly status: StorageProjectedStatus;
    readonly value: T;
    readonly schemaVersion: number | null;
    readonly credential: StorageCredential | null;
    readonly diagnosis: string | null;
};

/** 把读取分类投影为可显示状态；默认显示与诊断不改变任何持久化事实。 */
export function projectStorageState<T>(
    definition: DefinedStorageState<T>,
    result: StorageReadResult<T>,
): StorageProjectedState<T> {
    switch (result.kind) {
        case "value":
            return {
                status: "confirmed",
                value: result.value,
                schemaVersion: result.schemaVersion,
                credential: result.credential,
                diagnosis: null,
            };
        case "legacy-value":
            return {
                status: "legacy",
                value: definition.defaultValue,
                schemaVersion: result.schemaVersion,
                credential: result.credential,
                diagnosis: `记录仍是 schemaVersion ${String(result.schemaVersion)}，需要 owner 迁移后才能覆盖`,
            };
        case "missing":
        case "deleted":
            return {
                status: "default",
                value: definition.defaultValue,
                schemaVersion: null,
                credential: result.credential,
                diagnosis: null,
            };
        case "unsupported-version":
        case "corrupt":
            return {
                status: "unavailable",
                value: definition.defaultValue,
                schemaVersion: null,
                credential: null,
                diagnosis: result.diagnosis,
            };
    }
}
