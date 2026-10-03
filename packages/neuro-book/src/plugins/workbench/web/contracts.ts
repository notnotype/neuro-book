import type {Component} from "vue";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 工作台交给窗口挂载的根界面。窗口在 `nbook.workbench` 激活、解析到它之后才挂载。 */
export interface WorkbenchRoot {
    readonly component: Component;
}

export const workbenchRootKey: ServiceKey<WorkbenchRoot> = defineServiceKey<WorkbenchRoot>("nbook.workbench/root");
