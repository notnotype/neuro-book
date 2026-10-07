/**
 * `test.remote-probe` 三端共用的 Storage 示例记录与读写：服务端入口直用 user 记录，项目入口直用 project 记录，
 * 浏览器入口经代理访问两种；测试从各端的观察入口读写同一条记录，核对三端看到的是同一个命名空间。只由测试引用。
 */

import {Type} from "typebox";

import {RecordSnapshotSchema, StorageFailureSchema} from "nbook/plugins/storage/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import type {RecordSnapshot, StorageFailed, StorageService, WriteResult} from "nbook/shared/storage";

const Text = Type.Object({text: Type.String()}, {additionalProperties: false});

export const probeRecords = {
    shared: defineRecord({key: "probe-shared", scope: "user", locality: "shared", version: 1, schema: Text}),
    local: defineRecord({key: "probe-local", scope: "user", locality: "local", version: 1, schema: Text}),
    project: defineRecord({key: "probe-project", scope: "project", locality: "shared", version: 1, schema: Text}),
};

export type ProbeRecordName = keyof typeof probeRecords;
export const PROBE_RECORD_NAMES = ["shared", "local", "project"] as const satisfies ReadonlyArray<ProbeRecordName>;
export type ProbeSnapshot = RecordSnapshot<{readonly text: string}>;
/** 读的结果：快照，或 `open` 的失败。 */
export type ProbeRead = ProbeSnapshot | StorageFailed;

const StorageFailedSchema = Type.Object({ok: Type.Literal(false), code: StorageFailureSchema, detail: Type.String()}, {additionalProperties: false});
/** 读写结果在链路上的形状：项目探针的远程合同与控制路由的回应都按它核对。 */
export const ProbeReadSchema = Type.Union([RecordSnapshotSchema, StorageFailedSchema]);
export const ProbeSaveSchema = Type.Union([Type.Object({ok: Type.Literal(true), revision: Type.String()}, {additionalProperties: false}), StorageFailedSchema]);

export interface ProbeStorage {
    read(name: ProbeRecordName): Promise<ProbeRead>;
    save(name: ProbeRecordName, text: string, expect: string | null): Promise<WriteResult>;
}

export function probeStorage(storage: StorageService): ProbeStorage {
    return {
        read: async (name) => {
            const opened = await storage.open(probeRecords[name]);
            return opened.ok ? opened.handle.read() : opened;
        },
        save: async (name, text, expect) => {
            const opened = await storage.open(probeRecords[name]);
            return opened.ok ? opened.handle.save({text}, {expect}) : opened;
        },
    };
}
