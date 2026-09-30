import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";

// 插件作者侧的构建：两种产物都把宿主共享的模块留作外部依赖，不打进插件包。
// --mode esm：原生 ESM，由页面上的 import map 把裸模块名解析到宿主转发模块。
// --mode cjs：登记工厂式 CommonJS，由宿主模块表提供 require。
// --mode selfvue：反例（对照组），把 Vue 打进插件包，只共享 nb-ui 与 SDK，用来确认验证能发现“两份 Vue”。
const SHARED = ["vue", "@notnotype/nb-ui/components", "@neurobook/plugin-sdk"];
const PLUGIN_ID = "example.g1";

export default defineConfig(({mode}) => {
    const cjs = mode === "cjs";
    const selfVue = mode === "selfvue";
    return {
        plugins: [vue()],
        define: {
            "process.env.NODE_ENV": JSON.stringify("production"),
        },
        build: {
            outDir: cjs ? "dist/cjs" : selfVue ? "dist/selfvue" : "dist/esm",
            emptyOutDir: true,
            minify: false,
            sourcemap: false,
            cssCodeSplit: false,
            lib: {
                entry: "src/index.ts",
                formats: [cjs ? "cjs" : "es"],
                fileName: () => (cjs ? "plugin.cjs.js" : "plugin.mjs"),
                cssFileName: "plugin",
            },
            rollupOptions: {
                external: selfVue ? SHARED.filter((id) => id !== "vue") : SHARED,
                output: cjs
                    ? {
                        // 登记工厂：脚本执行只登记，不运行模块体；宿主物化时才注入 require/module/exports。
                        banner: `window.__NB_MODULES__.register(${JSON.stringify(PLUGIN_ID)}, function (require, module, exports) {`,
                        footer: "});",
                        exports: "named",
                    }
                    : {},
            },
        },
    };
});
