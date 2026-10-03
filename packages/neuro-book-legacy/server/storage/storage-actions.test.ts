import {describe, expect, it} from "vitest";
import type {StorageValueActionRequest} from "nbook/shared/storage/action";
import {defineStorageState, StorageStateRegistry, type DefinedStorageState} from "nbook/shared/storage/definition";
import {parseStorageActionRequest, requireStorageActionState} from "nbook/server/storage/storage-actions";

type LayoutState = {readonly width: number};

const layout: DefinedStorageState<LayoutState> = defineStorageState<LayoutState>({
    owner: "test.action",
    key: "layout",
    scope: "user",
    locality: "local",
    records: "single",
    schemaVersion: 1,
    defaultValue: {width: 320},
    validate: (value): value is LayoutState => typeof value === "object" && value !== null
        && typeof (value as LayoutState).width === "number",
});

function registry(): StorageStateRegistry {
    const registry = new StorageStateRegistry();
    registry.register(layout);
    return registry;
}

const binding = {local: 1, shared: 1};
const readAction = {kind: "read", owner: layout.owner, key: layout.key, schemaVersion: layout.schemaVersion, binding};

/**
 * 解析并收窄为值动作。
 *
 * 解析结果还可能是没有地址的 `bind`；直接把它传进注册表解析不是合法的调用形状，
 * 因此测试在这里显式收窄，而不是用类型断言跳过判别联合。
 */
function parseValueAction(body: unknown): StorageValueActionRequest {
    const action = parseStorageActionRequest(body);
    if (action.kind === "bind") {
        throw new Error("本用例只解析值动作");
    }
    return action;
}

describe("parseStorageActionRequest", () => {
    it("接受本合同的绑定、读取、保存与回收动作", () => {
        expect(parseStorageActionRequest({kind: "bind", owner: layout.owner})).toEqual({kind: "bind", owner: layout.owner});
        expect(parseStorageActionRequest(readAction)).toEqual(readAction);
        expect(parseStorageActionRequest({
            kind: "save",
            owner: layout.owner,
            key: layout.key,
            schemaVersion: layout.schemaVersion,
            binding,
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1},
        })).toMatchObject({kind: "save", value: {width: 1}});
        expect(parseStorageActionRequest({
            kind: "reclaim",
            owner: layout.owner,
            key: layout.key,
            schemaVersion: layout.schemaVersion,
            binding,
            targets: [{resource: "first"}, {}],
        })).toMatchObject({kind: "reclaim", targets: [{resource: "first"}, {}]});
    });

    it("拒绝未知动作、未知字段与非法边界值", () => {
        const rejected: readonly unknown[] = [
            {kind: "purge", owner: layout.owner, key: layout.key},
            {...readAction, scope: "project"},
            {...readAction, binding: {local: 1, shared: 1, subject: "user:7"}},
            {kind: "read", owner: layout.owner, schemaVersion: layout.schemaVersion, binding},
            {kind: "save", owner: layout.owner, key: layout.key, schemaVersion: layout.schemaVersion, binding, expected: {revision: null, partitionGeneration: 0}, value: {width: 1}},
            {kind: "reclaim", owner: layout.owner, key: layout.key, schemaVersion: layout.schemaVersion, binding, targets: []},
            {kind: "bind", owner: layout.owner, key: layout.key},
            {kind: "bind", owner: layout.owner, binding},
            {...readAction, schemaVersion: 0},
            {...readAction, schemaVersion: 1.5},
            {...readAction, schemaVersion: "1"},
            {...readAction, schemaVersion: Number.MAX_SAFE_INTEGER + 1},
        ];
        for (const body of rejected) {
            expect(() => parseStorageActionRequest(body))
                .toThrowError(expect.objectContaining({code: "STORAGE_REQUEST_INVALID", reason: "action"}));
        }
    });

    it("值动作缺少分区代次绑定即被拒绝，不会退回“采用当前代次”", () => {
        for (const kind of ["read", "save", "remove", "migrate", "repair", "reclaim"] as const) {
            const body = {
                kind,
                owner: layout.owner,
                key: layout.key,
                schemaVersion: layout.schemaVersion,
                expected: {revision: null, partitionGeneration: 1},
                value: {width: 1},
                targets: [{resource: "first"}],
            };
            expect(() => parseStorageActionRequest(body))
                .toThrowError(expect.objectContaining({code: "STORAGE_REQUEST_INVALID", reason: "action"}));
        }
    });

    it("值动作缺少本次消费的定义版本即被拒绝，不能替服务端猜测版本", () => {
        for (const kind of ["read", "save", "remove", "migrate", "repair", "reclaim"] as const) {
            const body = {
                kind,
                owner: layout.owner,
                key: layout.key,
                binding,
                expected: {revision: null, partitionGeneration: 1},
                value: {width: 1},
                targets: [{resource: "first"}],
            };
            expect(() => parseStorageActionRequest(body))
                .toThrowError(expect.objectContaining({code: "STORAGE_REQUEST_INVALID", reason: "action"}));
        }
    });
});

describe("requireStorageActionState", () => {
    it("只从注册表取回注册时的定义实例", () => {
        expect(requireStorageActionState(registry(), parseValueAction(readAction))).toBe(layout);
    });

    it("调用方消费的定义版本与注册版本不一致时拒绝，不替它解释当前值语义", () => {
        const mismatch = parseValueAction({...readAction, schemaVersion: layout.schemaVersion + 1});
        expect(() => requireStorageActionState(registry(), mismatch))
            .toThrowError(expect.objectContaining({code: "STORAGE_SCHEMA_MISMATCH"}));
    });

    it("未登记的 owner/key 与服务端注册错误区分", () => {
        const action = parseValueAction({kind: "read", owner: "test.other", key: "layout", schemaVersion: layout.schemaVersion, binding});
        expect(() => requireStorageActionState(registry(), action))
            .toThrowError(expect.objectContaining({code: "STORAGE_STATE_UNREGISTERED"}));
    });

    it("拒绝不安全的逻辑标识，且不把它当作未注册处理", () => {
        const unsafe: readonly {readonly address: {readonly owner: string; readonly key: string; readonly resource?: string}; readonly reason: string}[] = [
            {address: {owner: "Test.Action", key: "layout"}, reason: "owner"},
            {address: {owner: "test.action", key: "a/b"}, reason: "key"},
            {address: {owner: "test.action", key: "layout", resource: "A"}, reason: "resource"},
        ];
        for (const {address, reason} of unsafe) {
            const action = parseValueAction({kind: "read", ...address, schemaVersion: layout.schemaVersion, binding});
            expect(() => requireStorageActionState(registry(), action))
                .toThrowError(expect.objectContaining({code: "STORAGE_ADDRESS_INVALID", reason}));
        }
    });
});
