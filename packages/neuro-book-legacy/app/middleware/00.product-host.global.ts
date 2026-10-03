import {routeHostsProduct} from "nbook/app/utils/product-host";
import {routeNeedsBrowserRuntime} from "nbook/app/runtime/browser-window";

/**
 * 跨宿主导航守卫：未建立窗口实例的文档不能 SPA 挂载产品工作台。
 *
 * Lab 跳过产品接线，登录页不创建窗口实例；进入产品路由时整页加载，
 * 让迁移、配置与浏览器引导门禁在主页挂载前完整执行。
 *
 * 文件名前缀保证它排在其它全局中间件（鉴权）之前。路由中间件在全部插件执行后才开始运行
 * （初始导航由 `app:created` 强制重放），因此这里总能读到 `$productHost`。
 */
export default defineNuxtRouteMiddleware((to, from) => {
    const app = useNuxtApp();
    const browserStatus = app.$browserWindow?.state.value.status;
    const enteringBrowserHost = routeNeedsBrowserRuntime(to)
        && (browserStatus === "idle" || (from.path === "/login" && browserStatus === "unauthorized"));
    if (!enteringBrowserHost && (app.$productHost !== false || !routeHostsProduct(to))) return;
    // 经路由解析出完整 href（含 app.baseURL），不能直接拿 fullPath 当地址。
    return navigateTo(useRouter().resolve(to).href, {external: true});
});
