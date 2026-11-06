/**
 * 在 Storage 场地的浏览器窗口里建一棵树的布局 store（`nbook.storage` 按插件分命名空间：测试插件用工作台的 id，记录地址与产品一致）。只由测试使用，不含断言。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {layoutDocStoreFor} from "../state/layout-doc-store";
import type {LayoutDocStore} from "../state/layout-doc-store";
import type {ViewCatalog} from "../views/placement";

export interface LayoutDocWindow {
    readonly store: LayoutDocStore;
    readonly storage: StorageService;
    readonly window: WorldWindow;
}

/** 侧栏一个视图，右栏与面板各一个。 */
export const BUSY_LAYOUT_CATALOG: ViewCatalog = new Map([
    ["test.side", {title: {"zh-CN": "资源", "en-US": "Files"}, icon: "i-side", location: "sidebar", layout: "scroll"}],
    ["test.aux", {title: {"zh-CN": "大纲", "en-US": "Outline"}, icon: "i-aux", location: "auxiliarybar", layout: "scroll"}],
    ["test.panel", {title: {"zh-CN": "输出", "en-US": "Output"}, icon: "i-panel", location: "panel", layout: "scroll"}],
]);

export async function openLayoutDoc(world: StorageWorld, id: string, client: string, bound = false, catalog: ViewCatalog = BUSY_LAYOUT_CATALOG): Promise<LayoutDocWindow> {
    const hosted: {current: {store: LayoutDocStore; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                const store = layoutDocStoreFor(bound).create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
                store.actions.acceptViewCatalog(catalog);
                hosted.current = {store, storage};
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
