/**
 * 页面级宿主声明的类型：`definePageMeta` 的入参（`#app` PageMeta）与路由守卫里的 `to.meta`
 * （vue-router RouteMeta）各扩一次——Nuxt 的 RouteMeta 从 PageMeta 派生时不带回扩展字段，
 * 与 `@nuxtjs/i18n` 生成的声明同一写法。
 */
declare module "#app" {
    interface PageMeta {
        /**
         * `false`：本页不是产品宿主，文档启动时跳过产品启动接线（配色配置、旧桶迁移）。
         * 只给开发工具页用；判定与跨宿主导航规则见 `app/utils/product-host.ts`。
         */
        productHost?: boolean;
    }
}

declare module "vue-router" {
    interface RouteMeta {
        productHost?: boolean;
    }
}

export {};
