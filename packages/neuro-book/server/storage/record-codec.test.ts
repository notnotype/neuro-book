import {describe, expect, it} from "vitest";
import {
    parseStorageRecord,
    serializeStorageRecord,
    storageContentFingerprint,
} from "nbook/server/storage/record-codec";

const REVISION = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseStorageRecord", () => {
    it("识别值记录与删除标记", () => {
        const value = serializeStorageRecord({kind: "value", revision: REVISION, schemaVersion: 3, value: {width: 320}});
        expect(parseStorageRecord(value)).toEqual({
            kind: "value",
            revision: REVISION,
            schemaVersion: 3,
            value: {width: 320},
        });

        const deleted = serializeStorageRecord({kind: "deleted", revision: REVISION});
        expect(parseStorageRecord(deleted)).toEqual({kind: "deleted", revision: REVISION});
    });

    it("把非法 JSON、非法 revision、未知状态与未知字段归为损坏", () => {
        for (const raw of [
            "{broken",
            "[]",
            JSON.stringify({wrapper: 1, revision: REVISION, state: "value"}),
            JSON.stringify({wrapper: 1, revision: "not-a-uuid", state: "deleted"}),
            JSON.stringify({wrapper: 1, revision: REVISION, state: "unknown"}),
            JSON.stringify({wrapper: 1, revision: REVISION, state: "deleted", extra: true}),
            JSON.stringify({wrapper: 1, revision: REVISION, state: "value", schemaVersion: 1, value: 1, extra: true}),
            JSON.stringify({wrapper: 1, revision: REVISION, state: "value", schemaVersion: 0, value: 1}),
        ]) {
            expect(parseStorageRecord(raw), raw).toMatchObject({kind: "corrupt"});
        }
    });

    it("更高封装版本与损坏区分，并保留可读到的 schemaVersion", () => {
        const parsed = parseStorageRecord(JSON.stringify({
            wrapper: 9,
            revision: REVISION,
            state: "value",
            schemaVersion: 4,
            value: {width: 1},
        }));
        expect(parsed).toMatchObject({kind: "unsupported-version", wrapperVersion: 9, schemaVersion: 4});
    });

    it("值记录允许 null 与嵌套结构，缺少 value 字段按损坏处理", () => {
        expect(parseStorageRecord(JSON.stringify({
            wrapper: 1,
            revision: REVISION,
            state: "value",
            schemaVersion: 1,
            value: null,
        }))).toMatchObject({kind: "value", value: null});
        expect(parseStorageRecord(JSON.stringify({
            wrapper: 1,
            revision: REVISION,
            state: "value",
            schemaVersion: 1,
        }))).toMatchObject({kind: "corrupt"});
    });
});

describe("storageContentFingerprint", () => {
    it("只随原始字节变化，且不包含未摘要的原文", () => {
        const first = storageContentFingerprint("{\"a\":1}\n");
        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(storageContentFingerprint("{\"a\":1}\n")).toBe(first);
        expect(storageContentFingerprint("{\"a\":2}\n")).not.toBe(first);
        expect(first).not.toContain("{\"a\":1}");
    });
});
