/**
 * 页面是否承载产品宿主。
 *
 * 产品宿主＝启动时的产品会话、配置与存储接线：鉴权、Global Config 配色、旧桶原件保护与迁移。
 * 开发工具页（Component Lab）用 `definePageMeta({productHost: false})` 声明自己不是产品宿主，
 * 于是整份文档启动时不发产品配置 / Project / Storage 请求，也不建立产品会话。
 *
 * 判定只看**文档启动时**的首个路由：跳过产品启动的文档之后若 SPA 导航到产品页，
 * 由 `00.product-host.global.ts` 改成整页加载，让产品启动完整重跑，而不是在半接线状态下运行。
 */
export type ProductHostRoute = Readonly<{meta: Readonly<{productHost?: boolean}>}>;

export function routeHostsProduct(route: ProductHostRoute): boolean {
    return route.meta.productHost !== false;
}
