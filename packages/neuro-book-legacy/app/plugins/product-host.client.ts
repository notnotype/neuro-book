import {routeHostsProduct} from "nbook/app/utils/product-host";

/**
 * 记录这份文档启动时是否承载产品宿主，供产品启动插件与跨宿主导航守卫读取。
 *
 * 依赖 `nuxt:router`：路由插件已等到初始导航完成，`currentRoute` 就是本次文档加载的目标页，
 * 页面 meta 来自静态导入的 `definePageMeta`。初始导航失败时 meta 为空，按产品宿主处理。
 */
export default defineNuxtPlugin({
    name: "product-host",
    enforce: "pre",
    dependsOn: ["nuxt:router"],
    setup(): {provide: {productHost: boolean}} {
        return {provide: {productHost: routeHostsProduct(useRouter().currentRoute.value)}};
    },
});
