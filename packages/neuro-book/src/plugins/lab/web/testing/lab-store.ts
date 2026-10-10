/**
 * 在 Storage 场地的浏览器窗口里建 Lab 的偏好 store（`nbook.storage` 按插件分命名空间：测试插件用 Lab 的 id，记录地址
 * 与产品一致）。`lazy` 时先不建 store，由调用方在断线等布置之后调 `create`。只由测试使用，不含断言。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {labStore} from "../lab-preferences-store";
import type {LabStore} from "../lab-preferences-store";

export interface LabWindow {
    readonly storage: StorageService;
    readonly window: WorldWindow;
    /** 建 store；不 `lazy` 时已经建好并读完。 */
    create(): LabStore;
    /** 已建好的 store；还没建时抛错。 */
    readonly store: LabStore;
}

export async function openLab(world: StorageWorld, id: string, client: string, options: {readonly lazy?: boolean} = {}): Promise<LabWindow> {
    const hosted: {current: {context: ActivationContext; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.lab",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                hosted.current = {context, storage: context.services.require(storageKey)};
                return {};
            },
        }],
    };
    const window = await world.window(id, client, [plugin], {bound: false});
    if (hosted.current === null) throw new Error("Lab 的测试入口没有激活");
    const {context, storage} = hosted.current;
    let store: LabStore | null = null;
    const create = (): LabStore => {
        store ??= labStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
        return store;
    };
    if (options.lazy !== true) {
        const created = create();
        await waitUntil(`${id} 的偏好就绪`, () => created.state.preferences.ready);
    }
    return {
        storage,
        window,
        create,
        get store(): LabStore {
            if (store === null) throw new Error("store 还没有建立");
            return store;
        },
    };
}
