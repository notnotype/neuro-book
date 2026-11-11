import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

/**
 * 后台任务（docs/specs/workbench/background-tasks.md）：插件的服务端入口登记要跑一阵的事，清单只在服务进程的内存里，
 * 所有窗口经远程服务看到同一份。服务端入口拥有清单与规则。
 */
export const descriptor: PluginDescriptor = {
    id: "nbook.tasks",
    version: PRODUCT_VERSION,
    locations: ["server"],
};
