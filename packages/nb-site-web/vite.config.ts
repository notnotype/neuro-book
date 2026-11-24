import {resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vite";

/** 官方站前端：根是 src，产物进 dist（不入库）。t10 起由镜像的构建脚本把产物放进镜像，由进程入口发出去。 */
export default defineConfig({
    root: resolve(import.meta.dirname, "src"),
    base: "/",
    plugins: [vue(), tailwindcss()],
    build: {
        outDir: resolve(import.meta.dirname, "dist"),
        emptyOutDir: true,
        rolldownOptions: {
            // rolldown 在插件耗时占比高时往 stderr 打 `[PLUGIN_TIMINGS]` 的性能建议。它随机器负载出现，构建本身没有问题；
            // 关掉它，`tests/build.test.ts` 的“stderr 为空”才只挡真警告。选项见 rolldown 1.1 的 `InputOptions.checks`。
            checks: {pluginTimings: false},
        },
    },
});
