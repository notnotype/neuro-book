import {resolve} from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import {defineConfig, type Plugin} from "vite";

import {writeWebStamp} from "./src/server/web-stamp";

const packageRoot = import.meta.dirname;

/**
 * 构建结束时记下打进包的源文件的摘要（`dist/web/build-stamp.json`），从源码运行 `nbstory serve` 时据此发现网页包比源码旧
 * （issue 267，src/server/web-stamp.ts）。入口 index.html 不经 transform，单独补上。
 */
function webStamp(): Plugin {
    const ids = new Set<string>([resolve(packageRoot, "src/web/index.html")]);
    return {
        name: "nb-story-web-stamp",
        transform(_code, id) {
            ids.add(id);
            return null;
        },
        async writeBundle(options) {
            await writeWebStamp(options.dir ?? resolve(packageRoot, "dist/web"), packageRoot, ids);
        },
    };
}

/** 查看器前端：根是 src/web，产物进 dist/web（不入库，`nbstory serve` 发现没有产物时先构建）。设置照 dev-panel 的 vite.config.ts。 */
export default defineConfig({
    root: resolve(packageRoot, "src/web"),
    base: "/",
    plugins: [vue(), tailwindcss(), webStamp()],
    build: {
        outDir: resolve(packageRoot, "dist/web"),
        emptyOutDir: true,
        // 只在本机开，产物大小不是问题；图的依赖（sigma、graphology）占大头。
        chunkSizeWarningLimit: 3_000,
        // Lightning CSS 会把 backdrop-filter 与它的 -webkit- 前缀当成同一属性只留一条（见 dev-panel 的 vite.config.ts），换回 esbuild。
        cssMinify: "esbuild",
        rolldownOptions: {checks: {pluginTimings: false}},
    },
});
