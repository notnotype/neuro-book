/**
 * 前端构建与开发服务的共同配置。开发监督进程在此基础上改为中间件模式并加代理，生产只用 `vite build`。
 */

import {fileURLToPath} from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vite";
import type {Plugin} from "vite";

import {SDK_ENTRIES} from "./src/sdk/entries";

/** 浏览器基线（runtime.browser-host）：内核用到 Promise.withResolvers 与 AbortSignal.any。 */
export const BROWSER_TARGETS = ["chrome119", "edge119", "firefox124", "safari17.4"];

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * `boot.ts` 导入的样式入口。Tailwind 按目录扫描源码，不看构建图，所以生产构建换成排除了 Lab 与 e2e 外壳目录的入口，
 * 只在那里用到的类不进可分发产物（ui.component-lab 的产物门禁）；开发服务与 e2e 外壳用完整入口。
 */
export const STYLE_ENTRY = "nbook-tailwind.css";
export const FULL_STYLE_ENTRY = `${packageRoot}src/web/tailwind.css`;

/** 开发服务（含 Vitest）改用完整入口。插件在 `config` 钩子里给的别名排在基础配置之前，所以盖过下面的生产入口。 */
function developmentStyles(): Plugin {
    return {
        name: "nbook-development-styles",
        config: (_config, {command}) => command === "serve" ? {resolve: {alias: [{find: STYLE_ENTRY, replacement: FULL_STYLE_ENTRY}]}} : undefined,
    };
}

export default defineConfig({
    root: `${packageRoot}src/web`,
    cacheDir: `${packageRoot}node_modules/.vite`,
    // `neurobook-*` 是品牌成品里的原生自定义元素（`src/ui/brand/`），不是 Vue 组件，模板编译时不去解析它。
    plugins: [vue({template: {compilerOptions: {isCustomElement: (tag) => tag.startsWith("neurobook-")}}}), tailwindcss(), developmentStyles()],
    resolve: {
        alias: [
            {find: STYLE_ENTRY, replacement: `${packageRoot}src/web/tailwind.product.css`},
            {find: /^nbook\//u, replacement: `${packageRoot}src/`},
            // 示例插件按第三方插件的写法从 SDK 包名导入；仓库里直接用 SDK 的源码（runtime/plugin-api.md 的“SDK”）。子路径按 SDK 的子路径表。
            ...SDK_ENTRIES.map((entry) => ({find: new RegExp(`^${entry.specifier.replaceAll("/", "\\/")}$`, "u"), replacement: `${packageRoot}src/sdk/${entry.file}`})),
        ],
    },
    // 关闭依赖发现、预构建清单写死：依赖发现进行中时 Vite 的 close() 不结算（Bun 与 Node 都是），开发监督进程停止时
    // 会卡住。不在清单里的第三方依赖按源码逐个文件提供，其中的 CommonJS 模块（例如 vanilla-jsoneditor 依赖的 ajv）
    // 在浏览器里加载失败，所以页面直接或经 nb-ui 用到的第三方包都要列进来。
    optimizeDeps: {
        noDiscovery: true,
        include: [
            "vue",
            // 插件状态 store 直接用它；必须与 vue 用同一份预构建，否则组件里读 store 的 computed 不刷新
            "@vue/reactivity",
            "vue-router",
            // nb-ui 的运行依赖（nb-ui 本身是 workspace 源码，不预构建）
            "reka-ui",
            "@vueuse/core",
            "clsx",
            "tailwind-merge",
            // JsonViewer、MarkdownView
            "json-editor-vue",
            "vanilla-jsoneditor",
            "marked",
            "dompurify",
            // 远程服务合同、引导与 Storage 的 schema、命令声明的编译检查器。用到的每个子路径都要列：漏一个，开发模式每次
            // 整页加载就要逐个请求几百个模块文件，Chrome 会以 ERR_INSUFFICIENT_RESOURCES 拒绝其中一些，页面停在启动中。
            "typebox",
            "typebox/value",
            "typebox/compile",
            // 窗口读第三方插件的清单、判断插件版本范围（`nbook/plugin-platform/shared/versions`）；它是 CommonJS，不预构建在浏览器里加载不了。
            "semver",
            // 页面引擎（@notnotype/nb-page-agent，nbook.page-agent 的浮层）算可访问名用它。
            "dom-accessibility-api",
            // 页面引擎的截图入口（@notnotype/nb-page-agent/capture）。
            "@zumer/snapdom",
        ],
    },
    // 第三方许可清单（JSON）：应用的 npm 包据此生成 THIRD-PARTY-NOTICES.md（scripts/pack-app.ts），它不随页面发出去。
    build: {outDir: `${packageRoot}dist/web`, emptyOutDir: true, target: BROWSER_TARGETS, license: {fileName: ".vite/license.json"}},
});
