/**
 * 宿主提供给插件的本地能力（docs/adr/0026-plugin-definitions-as-constants.md）：插件要宿主的东西时，在入口的
 * `dependencies` 里声明这里的键，不经工厂参数。和项目有关的能力（`projectsKey`、`windowProjectKey`、
 * `currentProjectKey`）在 `projects.ts`。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 服务端的状态根。宿主拥有根的位置，根下的布局归各插件（例如 Storage 的 `storage/user.sqlite`）。 */
export interface StateRoot {
    /** 宿主已解析的绝对路径（不保证是 realpath）；首次启动时目录可能还不存在，用到的插件自己建。 */
    readonly path: string;
}

/** 服务端宿主提供；状态根不发给浏览器。 */
export const stateRootKey: ServiceKey<StateRoot> = defineServiceKey<StateRoot>("nbook/state-root");

/** 本窗口的整页导航。 */
export interface WindowNavigation {
    /** 整页加载到 `href`（生产是 `location.assign`）。 */
    navigateDocument(href: string): void;
}

/** 浏览器宿主提供给本窗口的插件。 */
export const windowNavigationKey: ServiceKey<WindowNavigation> = defineServiceKey<WindowNavigation>("nbook/window-navigation");
