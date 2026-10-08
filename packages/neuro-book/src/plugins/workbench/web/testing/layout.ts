/**
 * 在 Storage 场地的浏览器窗口里建工作台布局 store（`nbook.storage` 按插件分命名空间：测试插件用工作台的 id，记录地址
 * 与产品一致）。只由测试使用，不含断言。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {layoutStoreFor} from "../state/layout-store";
import type {LayoutStore} from "../state/layout-store";

export interface LayoutWindow {
    readonly store: LayoutStore;
    readonly storage: StorageService;
    readonly window: WorldWindow;
}

/** `bound` 决定尺寸记录的分区，也决定窗口是否绑定项目 `book`。等到三条记录都读完才返回。 */
export async function openLayout(world: StorageWorld, id: string, client: string, bound = false): Promise<LayoutWindow> {
    const hosted: {current: {store: LayoutStore; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                hosted.current = {store: layoutStoreFor(bound).create(context, {storage, diagnostics: context.services.require(diagnosticsKey)}), storage};
                return {};
            },
        }],
    };
    const window = await world.window(id, client, [plugin], {bound});
    if (hosted.current === null) throw new Error("store 没有创建");
    const {store, storage} = hosted.current;
    await waitUntil(`${id} 的布局就绪`, () => store.state.ready);
    return {store, storage, window};
}
