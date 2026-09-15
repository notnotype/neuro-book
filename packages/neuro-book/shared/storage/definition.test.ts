import {describe, expect, it} from "vitest";
import type {StorageReadResult} from "nbook/shared/storage/contract";
import {
    defineStorageState,
    StorageStateRegistry,
    type DefinedStorageState,
    type StorageStateDefinition,
} from "nbook/shared/storage/definition";
import {projectStorageState} from "nbook/shared/storage/projection";
import {isStorageDomainError} from "nbook/shared/storage/storage-errors";

type LayoutState = {
    readonly width: number;
    readonly height: number;
};

function isLayoutState(value: unknown): value is LayoutState {
    return typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number"
        && typeof (value as LayoutState).height === "number";
}

function defineLayout(overrides: Partial<StorageStateDefinition<LayoutState>> = {}): DefinedStorageState<LayoutState> {
    return defineStorageState({
        owner: "test.layout",
        key: "main",
        scope: "user",
        locality: "local",
        records: "single",
        schemaVersion: 1,
        defaultValue: {width: 320, height: 240},
        validate: isLayoutState,
        ...overrides,
    });
}

describe("StorageStateRegistry", () => {
    it("结构相同但未经工厂校验的可变对象不能注册", () => {
        const registry = new StorageStateRegistry();
        expect(() => registry.register({...defineLayout()})).toThrow(expect.objectContaining({code: "STORAGE_DEFINITION_INVALID"}));
        expect(() => defineLayout({schemaVersion: Number.MAX_SAFE_INTEGER + 1})).toThrow(expect.objectContaining({code: "STORAGE_DEFINITION_INVALID"}));
    });

    it("同一类型 token 重复登记幂等，重建定义不能替换既有策略", () => {
        const registry = new StorageStateRegistry();
        const first = registry.register(defineLayout());
        const reloaded = registry.register(first);

        expect(registry.resolve(reloaded)).toBe(reloaded);
        expect(registry.resolve(first)).toBe(reloaded);
        expect(registry.list()).toHaveLength(1);

        for (const incompatible of [
            defineLayout(),
            defineLayout({validate: (value): value is LayoutState => isLayoutState(value) && value.width === 320}),
            defineLayout({scope: "project"}),
            defineLayout({locality: "shared"}),
            defineLayout({records: "identified"}),
            defineLayout({schemaVersion: 2}),
            defineLayout({defaultValue: {width: 1, height: 1}}),
            defineLayout({limits: {maxValueBytes: 2048}}),
        ]) {
            const error = (() => {
                try {
                    registry.register(incompatible);
                    return null;
                } catch (caught: unknown) {
                    return caught;
                }
            })();
            expect(isStorageDomainError(error, "STORAGE_REGISTRATION_CONFLICT")).toBe(true);
            expect(error).toMatchObject({owner: "test.layout", key: "main"});
        }
    });

    it("未注册定义不能被解析，避免普通读写绕过注册表", () => {
        const registry = new StorageStateRegistry();
        registry.register(defineLayout());
        const error = (() => {
            try {
                registry.resolve(defineLayout({key: "unregistered"}));
                return null;
            } catch (caught: unknown) {
                return caught;
            }
        })();
        expect(isStorageDomainError(error, "STORAGE_STATE_UNREGISTERED")).toBe(true);
    });
});

describe("defineStorageState", () => {
    it("省略 locality 使用 local，默认值与外部对象分离且嵌套不可改写", () => {
        const source = {panel: {width: 320}};
        const definition = defineStorageState({
            owner: "test.defaults", key: "layout", scope: "user", records: "single", schemaVersion: 1,
            defaultValue: source,
            validate: (value): value is typeof source => typeof value === "object" && value !== null && "panel" in value,
        });
        source.panel.width = 900;
        expect(definition.locality).toBe("local");
        expect(definition.defaultValue.panel.width).toBe(320);
        expect(() => { definition.defaultValue.panel.width = 1; }).toThrow();
    });

    it("拒绝会成为不安全文件地址的逻辑标识", () => {
        for (const key of ["../escape", "a/b", "a\\b", ".", "..", "con", "LPT1", "trailing.", "with space", ""]) {
            const error = (() => {
                try {
                    defineLayout({key});
                    return null;
                } catch (caught: unknown) {
                    return caught;
                }
            })();
            expect(isStorageDomainError(error, "STORAGE_DEFINITION_INVALID"), key).toBe(true);
        }
    });

    it("拒绝非法 schemaVersion、越界容量与不合格默认值", () => {
        const cases: Array<Partial<StorageStateDefinition<LayoutState>>> = [
            {schemaVersion: 0},
            {schemaVersion: 1.5},
            {limits: {maxValueBytes: 1024 * 1024 + 1}},
            {limits: {maxRecords: 1025}},
            {limits: {maxPartitionBytes: 16 * 1024 * 1024 + 1}},
            {defaultValue: {width: Number.NaN, height: 240}},
            {defaultValue: {width: "320", height: 240} as unknown as LayoutState},
        ];
        for (const override of cases) {
            const error = (() => {
                try {
                    defineLayout(override);
                    return null;
                } catch (caught: unknown) {
                    return caught;
                }
            })();
            expect(isStorageDomainError(error, "STORAGE_DEFINITION_INVALID"), JSON.stringify(override)).toBe(true);
        }
    });

    it("补全默认容量并允许显式降低分区上限", () => {
        const definition = defineLayout({limits: {maxRecords: 4, maxPartitionBytes: 4096}});
        expect(definition.limits).toEqual({
            maxValueBytes: 64 * 1024,
            maxRecords: 4,
            maxPartitionBytes: 4096,
        });
        expect(definition.address).toBe("user/test.layout/main");
        expect(Object.isFrozen(definition)).toBe(true);
    });
});

describe("projectStorageState", () => {
    const definition = defineLayout();
    const credential = {revision: "0f8fad5b-d9cb-469f-a165-70867728950e", partitionGeneration: 1};

    it("已确认值、默认显示与不可用必须区分", () => {
        expect(projectStorageState(definition, {
            kind: "value",
            value: {width: 400, height: 200},
            schemaVersion: 1,
            credential,
        })).toEqual({
            status: "confirmed",
            value: {width: 400, height: 200},
            schemaVersion: 1,
            credential,
            diagnosis: null,
        });

        for (const result of [
            {kind: "missing", credential},
            {kind: "deleted", credential},
        ] satisfies StorageReadResult<LayoutState>[]) {
            expect(projectStorageState(definition, result)).toMatchObject({
                status: "default",
                value: definition.defaultValue,
                credential,
            });
        }

        expect(projectStorageState(definition, {
            kind: "legacy-value",
            value: {width: 1, height: 1},
            schemaVersion: 0,
            credential,
        })).toMatchObject({status: "legacy", value: definition.defaultValue, credential});

        const repair = {partitionGeneration: 1, contentFingerprint: "sha256:abc"};
        expect(projectStorageState(definition, {
            kind: "corrupt",
            diagnosis: "不是合法 JSON",
            repair,
        })).toMatchObject({status: "unavailable", value: definition.defaultValue, credential: null, diagnosis: "不是合法 JSON"});
        expect(projectStorageState(definition, {
            kind: "unsupported-version",
            wrapperVersion: 2,
            schemaVersion: null,
            diagnosis: "记录封装版本 2 高于当前支持的 1",
            repair,
        })).toMatchObject({status: "unavailable", credential: null});
    });
});
