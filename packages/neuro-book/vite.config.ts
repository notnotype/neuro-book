/**
 * 前端构建与开发服务的共同配置。开发监督进程在此基础上改为中间件模式并加代理，生产只用 `vite build`。
 */

import {fileURLToPath} from "node:url";

import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import {defineConfig} from "vite";

/** 浏览器基线（runtime.browser-host）：内核用到 Promise.withResolvers 与 AbortSignal.any。 */
export const BROWSER_TARGETS = ["chrome119", "edge119", "firefox124", "safari17.4"];

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    root: `${packageRoot}src/web`,
    cacheDir: `${packageRoot}node_modules/.vite`,
    // root 是 src/web，UnoCSS 默认在 root 下找配置，所以显式指定包根的 uno.config.ts。
    plugins: [vue(), UnoCSS({configFile: `${packageRoot}uno.config.ts`})],
    resolve: {alias: [{find: /^nbook\//u, replacement: `${packageRoot}src/`}]},
    // 关闭依赖发现、只预构建 vue：依赖发现进行中时 Vite 的 close() 不结算（Bun 与 Node 都是），
    // 开发监督进程停止时会卡住。新增需要预构建的依赖时加进 include。
    optimizeDeps: {noDiscovery: true, include: ["vue", "vue-router"]},
    build: {outDir: `${packageRoot}dist/web`, emptyOutDir: true, target: BROWSER_TARGETS},
});
