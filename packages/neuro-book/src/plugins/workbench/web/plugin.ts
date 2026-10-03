/** `nbook.workbench` 浏览器入口：提供窗口挂载的根界面。 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {workbenchRootKey} from "./contracts";
import {EmptyWorkbench} from "./empty-workbench";

export function createWorkbenchBrowserPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            provides: [workbenchRootKey],
            activate: () => ({services: [provide(workbenchRootKey, {component: EmptyWorkbench})]}),
        }],
    };
}
