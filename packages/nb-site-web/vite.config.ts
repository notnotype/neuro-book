import {resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vite";

import {isReleaseBuild, legalDocuments} from "./build/legal-docs";

/**
 * 官方站前端：根是 src，产物进 dist（不入库）。t10 起由镜像的构建脚本把产物放进镜像，由进程入口发出去。
 * 条款正文在构建时转成 HTML；设了 `NB_SITE_RELEASE=1` 的发布构建不收占位正文（`build/legal-docs.ts`）。
 */
export default defineConfig({
    root: resolve(import.meta.dirname, "src"),
    base: "/",
    plugins: [legalDocuments({root: resolve(import.meta.dirname, "src", "legal"), release: isReleaseBuild(process.env)}), vue(), tailwindcss()],
    build: {
        outDir: resolve(import.meta.dirname, "dist"),
        emptyOutDir: true,
        // 看板的块带着按需导入的 ECharts，压缩后约 525 KB（gzip 约 175 KB），超过 Vite 缺省的 500 KB 提醒线；它只在管理员点到看板时
        // 才下载。体积由 `tests/build.test.ts` 按 gzip 设上限守着，这里把提醒线放到它上面一点，免得每次构建都报一条已知的警告、
        // 盖住真正的新警告（构建测试断言标准错误为空）。看板再大到超过这条线时先看是不是有人整包导入了 ECharts。
        chunkSizeWarningLimit: 600,
        rolldownOptions: {
            // rolldown 在插件耗时占比高时往 stderr 打 `[PLUGIN_TIMINGS]` 的性能建议。它随机器负载出现，构建本身没有问题；
            // 关掉它，`tests/build.test.ts` 的“stderr 为空”才只挡真警告。选项见 rolldown 1.1 的 `InputOptions.checks`。
            checks: {pluginTimings: false},
            // nb-ui 的 `package.json` 没写 `sideEffects`，rolldown 只能把它的每个源文件都当作有副作用：入口经
            // `@notnotype/nb-ui/components` 那个汇总出口只用了几个组件，汇总里列出的其余组件（对话框、菜单与它们拉进来的 reka-ui）
            // 也全被留下，落进入口块（B4 审查第 19 条：访客入口 gzip 从约 59 KB 涨到 120 KB）。nb-ui 的 `.ts` 与 `.vue` 模块导入时
            // 不做事，在这里声明它们没有副作用，没用到的就摇掉；`.vue?vue&type=style…` 这些样式子模块不在内，用到的组件照样带着样式。
            // nb-ui 自己声明 `sideEffects` 之后这条可以去掉（上游候选）。`tests/build.test.ts` 的入口上限与来源断言守着它。
            // 两个合同包不在这里：前端只从它们不带 schema 的 `./constants` 子路径导入（`tests/boundary.test.ts`）。
            treeshake: {
                moduleSideEffects: [
                    {test: /\/nb-ui\/src\/.*\.(?:ts|vue)$/u, sideEffects: false},
                ],
            },
        },
    },
});
