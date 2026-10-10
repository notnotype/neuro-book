/**
 * `nbook.lab` 浏览器入口：向工作台贡献 `/lab` 页面，页面组件在导航到它时才加载。
 *
 * 偏好 store 在第一次打开 `/lab` 时才建立：开发模式的每个窗口都激活 Lab，产品页的窗口不该为它读 Lab 的偏好记录。
 * store 仍登记在这一代入口的作用域上，随入口释放。
 */

import {defineComponent, h} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {WORKBENCH_PAGES_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchPageDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchPageImplementation} from "nbook/plugins/workbench/web/contracts";

import {descriptor} from "../plugin";
import {labStore} from "./lab-preferences-store";
import type {LabStore} from "./lab-preferences-store";

const LAB_PATH = "/lab";

// Lab 改写 <html> 上的主题并挂全局监听，离开时不保证全部复原，所以离开 Lab 整页加载（ui.component-lab 场景 17）。
const declaration: WorkbenchPageDeclaration = {path: LAB_PATH, title: "组件 Lab", reloadOnLeave: true};

export const labBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: storageKey}, {key: diagnosticsKey}],
        contributions: [{capability: WORKBENCH_PAGES_POINT, id: LAB_PATH, declaration}],
        activate: (context) => {
            const storage = context.services.require(storageKey);
            const diagnostics = context.services.require(diagnosticsKey);
            let store: LabStore | null = null;
            const page: WorkbenchPageImplementation = {
                load: async () => {
                    const LabPage = (await import("./LabPage.vue")).default;
                    store ??= labStore.create(context, {storage, diagnostics});
                    const created = store;
                    // 渲染函数包一层把 store 交给页面；页面出口透传的窗口标记落在 LabPage 的根上。
                    return defineComponent({name: "LabPageHost", setup: () => () => h(LabPage, {store: created})});
                },
            };
            return {contributions: {[WORKBENCH_PAGES_POINT]: {[LAB_PATH]: page}}};
        },
    })],
};
