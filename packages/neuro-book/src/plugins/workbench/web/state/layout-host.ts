/**
 * 布局 store 的惰性持有（docs/specs/ui/workbench-shell.md“边界与兼容”的 Lab 一条）：产品外壳页面第一次挂载时才创建，
 * 所以直接打开 Lab 的窗口不打开、不订阅产品布局记录。创建出的 store 登记在工作台入口这一代的作用域上，随入口释放；
 * 页面卸载再挂载拿到的是同一个。公开状态与面板命令读 `current`，store 还没创建时按未就绪处理。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {LayoutStore} from "./layout-store";

export interface LayoutHost {
    readonly current: Readonly<ShallowRef<LayoutStore | null>>;
    /** 取 store，第一次调用时创建。 */
    acquire(): LayoutStore;
}

export function createLayoutHost(create: () => LayoutStore): LayoutHost {
    const current = shallowRef<LayoutStore | null>(null);
    return {
        current,
        acquire: () => {
            current.value ??= create();
            return current.value;
        },
    };
}
