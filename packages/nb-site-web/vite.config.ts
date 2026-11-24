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
        // Vite 8 缺省用 Lightning CSS 压缩 CSS，它把 `backdrop-filter` 与 `-webkit-backdrop-filter` 当成同一属性的前缀变体、
        // 只留后写的那条；nb-ui 先写不带前缀的，结果只剩 Chrome 不认的 `-webkit-`，浮层（对话框）没有背景模糊、背后的字透出来。
        // 换回 esbuild 压缩就两条都留着（与 dev-panel 同一个原因）。nb-ui 改成前缀在前之后可以去掉这一行。
        cssMinify: "esbuild",
        rolldownOptions: {
            // rolldown 在插件耗时占比高时往 stderr 打 `[PLUGIN_TIMINGS]` 的性能建议。它随机器负载出现，构建本身没有问题；
            // 关掉它，`tests/build.test.ts` 的“stderr 为空”才只挡真警告。选项见 rolldown 1.1 的 `InputOptions.checks`。
            checks: {pluginTimings: false},
        },
    },
});
