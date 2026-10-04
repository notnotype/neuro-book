/** `nbook.workbench` 浏览器入口：提供窗口挂载的页面表，定义页面贡献点 `workbench.pages`。 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {WORKBENCH_PAGES_POINT, workbenchRootKey} from "./contracts";
import {EmptyWorkbench} from "./empty-workbench";
import {PageTable, validatePageContribution} from "./pages";

export function createWorkbenchBrowserPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [{id: WORKBENCH_PAGES_POINT, implementation: "required", validate: validatePageContribution}],
        entries: [{
            id: "browser",
            location: "browser",
            provides: [workbenchRootKey],
            receives: [WORKBENCH_PAGES_POINT],
            activate: () => {
                const pages = new PageTable([{path: "/", title: "NeuroBook", load: async () => EmptyWorkbench}]);
                return {
                    services: [provide(workbenchRootKey, {pages: () => pages.list()})],
                    receivers: {[WORKBENCH_PAGES_POINT]: pages.receiver()},
                };
            },
        }],
    };
}
