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
    // 关闭依赖发现、预构建清单写死：依赖发现进行中时 Vite 的 close() 不结算（Bun 与 Node 都是），开发监督进程停止时
    // 会卡住。不在清单里的第三方依赖按源码逐个文件提供，其中的 CommonJS 模块（例如 vanilla-jsoneditor 依赖的 ajv）
    // 在浏览器里加载失败，所以页面直接或经 nb-ui 用到的第三方包都要列进来。
    optimizeDeps: {
        noDiscovery: true,
        include: [
            "vue",
            "vue-router",
            // nb-ui 的运行依赖（nb-ui 本身是 workspace 源码，不预构建）
            "reka-ui",
            "@vueuse/core",
            "class-variance-authority",
            "clsx",
            "tailwind-merge",
            // JsonViewer、MarkdownView
            "json-editor-vue",
            "vanilla-jsoneditor",
            "marked",
            "dompurify",
        ],
    },
    build: {outDir: `${packageRoot}dist/web`, emptyOutDir: true, target: BROWSER_TARGETS},
});
