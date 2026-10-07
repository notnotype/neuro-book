/**
 * `test.remote-probe` 三端共用的 Storage 示例记录与读写：服务端入口直用 user 记录，项目入口直用 project 记录，
 * 浏览器入口经代理访问两种；测试从各端的观察入口读写同一条记录，核对三端看到的是同一个命名空间。只由测试引用。
 */

import {Type} from "typebox";

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

export interface ProbeStorage {
    /** 打开失败时交出 `open` 的失败。 */
    read(name: ProbeRecordName): Promise<ProbeSnapshot | StorageFailed>;
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
