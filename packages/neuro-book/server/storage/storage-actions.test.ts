import {describe, expect, it} from "vitest";
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

const readAction = {kind: "read", owner: layout.owner, key: layout.key};

describe("parseStorageActionRequest", () => {
    it("接受本合同的读取、保存与回收动作", () => {
        expect(parseStorageActionRequest(readAction)).toEqual(readAction);
        expect(parseStorageActionRequest({
            kind: "save",
            owner: layout.owner,
            key: layout.key,
            expected: {revision: null, partitionGeneration: 1},
            value: {width: 1},
        })).toMatchObject({kind: "save", value: {width: 1}});
        expect(parseStorageActionRequest({
            kind: "reclaim",
            owner: layout.owner,
            key: layout.key,
            targets: [{resource: "first"}, {}],
        })).toMatchObject({kind: "reclaim", targets: [{resource: "first"}, {}]});
    });

    it("拒绝未知动作、未知字段与非法边界值", () => {
        const rejected: readonly unknown[] = [
            {kind: "purge", owner: layout.owner, key: layout.key},
            {...readAction, scope: "project"},
            {kind: "read", owner: layout.owner},
            {kind: "save", owner: layout.owner, key: layout.key, expected: {revision: null, partitionGeneration: 0}, value: {width: 1}},
            {kind: "reclaim", owner: layout.owner, key: layout.key, targets: []},
        ];
        for (const body of rejected) {
            expect(() => parseStorageActionRequest(body))
                .toThrowError(expect.objectContaining({code: "STORAGE_REQUEST_INVALID", reason: "action"}));
        }
    });
});

describe("requireStorageActionState", () => {
    it("只从注册表取回注册时的定义实例", () => {
        const states = registry();
        expect(requireStorageActionState(states, parseStorageActionRequest(readAction))).toBe(layout);
    });

    it("未登记的 owner/key 与服务端注册错误区分", () => {
        const action = parseStorageActionRequest({kind: "read", owner: "test.other", key: "layout"});
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
            const action = parseStorageActionRequest({kind: "read", ...address});
            expect(() => requireStorageActionState(registry(), action))
                .toThrowError(expect.objectContaining({code: "STORAGE_ADDRESS_INVALID", reason}));
        }
    });
});
