/**
 * 窗口的页面路由。router 归宿主而不是某个插件：一个文档只有一个 router，它绑定 `window.history`、装进宿主创建的
 * Vue 应用；窗口每次重试都建立新的运行实例，router 不能跟着重建。页面由 `nbook.workbench` 的页面表给出，
 * 窗口 ready 时取一次（运行期插件集合变化尚未实现，见 runtime.browser-host 场景 5）。
 */

import {createRouter} from "vue-router";
import type {Router, RouterHistory} from "vue-router";

import type {WorkbenchPage} from "nbook/plugins/workbench/web/contracts";

import NotFoundPage from "./NotFoundPage.vue";

declare module "vue-router" {
    interface RouteMeta {
        title?: string;
        reloadOnLeave?: boolean;
    }
}

export interface PageRouterOptions {
    readonly pages: ReadonlyArray<WorkbenchPage>;
    readonly history: RouterHistory;
    /** 整页加载到 `href`；生产是 `location.assign`。 */
    readonly navigateDocument: (href: string) => void;
}

const NOT_FOUND_TITLE = "页面不存在";

export function createPageRouter(options: PageRouterOptions): Router {
    const router = createRouter({
        history: options.history,
        routes: [
            ...options.pages.map((page) => ({path: page.path, component: () => page.load(), meta: {title: page.title, reloadOnLeave: page.reloadOnLeave === true}})),
            {path: "/:unknown(.*)*", component: NotFoundPage, meta: {title: NOT_FOUND_TITLE}},
        ],
    });
    router.beforeEach((to, from) => {
        if (from.meta.reloadOnLeave !== true || to.path === from.path) return true;
        options.navigateDocument(to.fullPath);
        // 让这次导航一直挂起：文档马上被替换，不让 router 先渲染目标页、也不让它回滚地址栏去和整页加载抢。
        return new Promise<never>(() => undefined);
    });
    router.afterEach((to) => {
        document.title = to.meta.title ?? NOT_FOUND_TITLE;
    });
    return router;
}
