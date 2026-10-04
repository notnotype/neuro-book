/** `nbook.lab` 浏览器入口：向工作台贡献 `/lab` 页面，页面组件在导航到它时才加载。 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {WORKBENCH_PAGES_POINT, WorkbenchPageDeclaration, WorkbenchPageImplementation} from "nbook/plugins/workbench/web/contracts";

import {descriptor} from "../plugin";

const PAGES: typeof WORKBENCH_PAGES_POINT = "workbench.pages";
const LAB_PATH = "/lab";

export function createLabBrowserPlugin(): PluginDefinition {
    // Lab 改写 <html> 上的主题并挂全局监听，离开时不保证全部复原，所以离开 Lab 整页加载（ui.component-lab 场景 17）。
    const declaration: WorkbenchPageDeclaration = {path: LAB_PATH, title: "组件 Lab", reloadOnLeave: true};
    const page: WorkbenchPageImplementation = {load: async () => (await import("./LabPage.vue")).default};
    return {
        id: descriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [{capability: PAGES, id: LAB_PATH, declaration}],
            activate: () => ({contributions: {[PAGES]: {[LAB_PATH]: page}}}),
        }],
    };
}
