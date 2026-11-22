/**
 * `ModelsConfigStore` 的合同测试（接口注释见 `core/store.ts`）：使用方给出一个实现与夹具，这里逐条核对服务核心依赖的语义。
 * 本包的内存实现与各应用的设置适配器各跑一遍：服务核心的测试用内存实现，“替身与真实实现对过契约”靠的就是这份。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {DEFAULT_ROLES} from "../config/shapes";
import type {StoredProvider, RolesConfig} from "../config/shapes";
import type {ConfigKey, ModelsConfigStore} from "../core/store";

export interface ModelsConfigFixture {
    /** 一个新的存储，可写那一层里还没有 `providers` 与 `roles`。 */
    readonly store: ModelsConfigStore;
    /** 绕过存储，从别处改可写那一层的一个键（另一个进程、用户手改文件）。交回时存储不必已经看到。 */
    writeExternally(key: "providers" | "roles", value: unknown): Promise<void>;
    /** 推一下，让存储有机会跟上别处的写入（例如推手动时钟让文件变化的重读发生）；会被反复调用。 */
    settle(): void;
    /**
     * 把可写那一层弄成这个状态（`invalid`：内容坏了；`unavailable`：读不了）。只以 `runModelsConfigStoreContract` 的
     * `layerStates` 里列出的状态调用。
     */
    breakLayer(state: LayerState): Promise<void>;
    close(): Promise<void>;
}

export type LayerState = "unavailable" | "invalid";

const provider = (id: string, name = id): StoredProvider => ({id, kind: "custom", name, baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", auth: "default", models: []});
/** 同一个服务商，对象的键按相反的顺序写。 */
const reordered = (value: StoredProvider): StoredProvider => Object.fromEntries(Object.entries(value).reverse()) as StoredProvider;
const boundRoles = (model: string): RolesConfig => ({items: DEFAULT_ROLES.items.map((role) => (role.id === "main" ? {...role, model} : role))});

/**
 * 用 `setup` 交回的夹具跑一遍合同；`name` 出现在 describe 里，分清是哪个实现。每个用例一个新的夹具。`layerStates`：夹具
 * 做得出来的可写层坏状态，各核对一遍。
 */
export function runModelsConfigStoreContract(name: string, setup: () => Promise<ModelsConfigFixture>, layerStates: ReadonlyArray<LayerState> = ["unavailable", "invalid"]): void {
    describe(`ModelsConfigStore 合同：${name}`, () => {
        let fixture: ModelsConfigFixture;
        let changes: Array<ReadonlySet<ConfigKey>>;
        let off: () => void;

        beforeEach(async () => {
            fixture = await setup();
            changes = [];
            off = fixture.store.onChange((changed) => changes.push(new Set(changed)));
        });
        afterEach(async () => {
            off();
            await fixture.close();
        });

        /** 推着存储跟上，直到收到一次带 `key` 的变化。 */
        const changeOf = (key: ConfigKey, after: number) => waitUntil(`收到 ${key} 的变化`, () => {
            fixture.settle();
            return changes.slice(after).some((changed) => changed.has(key));
        });

        it("没写过时读到缺省值、可写那一层没有这个键；写入成功后立刻读到新值", async () => {
            const {store} = fixture;
            expect(store.providers.read()).toEqual([]);
            expect(store.providers.editable()).toEqual({status: "ok", value: undefined});
            expect(store.roles.read()).toEqual(DEFAULT_ROLES);

            expect(await store.providers.write([provider("one")], {value: undefined})).toEqual({ok: true});
            expect(store.providers.read()).toEqual([provider("one")]);
            expect(store.providers.editable()).toEqual({status: "ok", value: [provider("one")]});
            expect(await store.roles.write(boundRoles("one/m"), {value: undefined})).toEqual({ok: true});
            expect(store.roles.read()).toEqual(boundRoles("one/m"));
        });

        it("自己的写入也经 onChange 通知、带变化的键；取消订阅之后不再通知", async () => {
            const {store} = fixture;
            expect(await store.roles.write(boundRoles("one/m"), {value: undefined})).toEqual({ok: true});
            await changeOf("roles", 0);
            expect(changes.every((changed) => !changed.has("providers"))).toBe(true);

            off();
            const seen = changes.length;
            expect(await store.providers.write([provider("one")], {value: undefined})).toEqual({ok: true});
            fixture.settle();
            expect(store.providers.read()).toEqual([provider("one")]);
            expect(changes.length).toBe(seen);
        });

        it("expect 与可写那一层的当前值不等得 conflict、不写；比较不看对象的键序", async () => {
            const {store} = fixture;
            expect(await store.providers.write([provider("one")], {value: undefined})).toEqual({ok: true});
            expect(await store.providers.write([provider("two")], {value: undefined})).toMatchObject({ok: false, code: "conflict"});
            expect(await store.providers.write([provider("two")], {value: [provider("other")]})).toMatchObject({ok: false, code: "conflict"});
            expect(store.providers.read()).toEqual([provider("one")]);

            expect(await store.providers.write([provider("two")], {value: [reordered(provider("one"))]})).toEqual({ok: true});
            expect(store.providers.read()).toEqual([provider("two")]);
        });

        it("别处改过之后带旧 expect 的写入得 conflict；存储随后经 onChange 送来那次变化，读到别处的值", async () => {
            const {store} = fixture;
            expect(await store.providers.write([provider("one")], {value: undefined})).toEqual({ok: true});
            const mine = store.providers.editable();
            const after = changes.length;
            await fixture.writeExternally("providers", [provider("one"), provider("outside")]);

            expect(await store.providers.write([provider("one", "改过")], {value: mine.status === "ok" ? mine.value : undefined})).toMatchObject({ok: false, code: "conflict"});
            await changeOf("providers", after);
            await waitUntil("读到别处写的值", () => {
                fixture.settle();
                return store.providers.read().some((item) => item.id === "outside");
            });
            expect(store.providers.read()).toEqual([provider("one"), provider("outside")]);
        });

        it("不符合形状的值得 invalid-value 并带原因，不写", async () => {
            const {store} = fixture;
            const result = await store.providers.write([{...provider("one"), id: "Not An Id"}], {value: undefined});
            expect(result).toMatchObject({ok: false, code: "invalid-value"});
            expect(result.ok === false && "detail" in result ? result.detail : "").not.toBe("");
            expect(store.providers.read()).toEqual([]);
        });

        for (const state of layerStates) {
            it(`可写那一层 ${state}：editable 照实交回，写入失败且不是 conflict`, async () => {
                const {store} = fixture;
                await fixture.breakLayer(state);
                await waitUntil(`可写那一层变成 ${state}`, () => {
                    fixture.settle();
                    return store.providers.editable().status === state;
                });
                const result = await store.providers.write([provider("one")], {value: undefined});
                expect(result.ok).toBe(false);
                expect(result.ok === false ? result.code : "").not.toBe("conflict");
            });
        }
    });
}
