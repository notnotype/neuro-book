import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type {ConfigBootstrapDto} from "nbook/shared/dto/config.dto";

/**
 * 启动时把**配色轴**读回来：当前配色 id 与用户配色库。
 *
 * 为什么单开一个插件：Global Config 是配色的唯一持久化，而两轴（themeId / appearance）的恢复
 * 已经在 `pages/index.vue` 里做了，那里只喂了两个轴、不认识配色字段；用户配色库又必须**在每个入口**
 * 都装回去——刷新后的工作台、登录页、管理页共享同一份模块单例，少一个入口就会出现
 * 「同一台机器上有的页面是我配的色，有的不是」。
 *
 * 读不到就维持内置配色（登录页没有会话、离线、服务端没起来都会这样）：配色是渲染偏好，
 * 不该在控制台留 error / warning，也不该挡住页面。用户改配色时走 `useThemeSettings` 写回，
 * 那条路径失败会明确提示并回滚。
 */
export default defineNuxtPlugin({
    name: "theme-colorway",
    async setup() {
        const theme = useProductTheme();
        try {
            const settings = await $fetch<ConfigBootstrapDto>("/api/config/bootstrap", {
                query: {workspaceKind: "user-assets"},
            });
            theme.applyStoredColorways({
                colorwayId: settings.ui.colorwayId,
                userColorways: settings.ui.userColorways,
            });
        } catch (error) {
            console.debug("[theme] 配色配置未读取，使用内置配色", error);
        }
    },
});
