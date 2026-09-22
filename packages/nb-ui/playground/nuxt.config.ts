import nbUi from "../src/module";
import {defineNuxtConfig} from "nuxt/config";
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
    ssr: false,
    modules: [nbUi],
    // Tailwind v4 是 Vite 插件 + CSS-first 配置，没有 Nuxt module 形态。
    // 入口 CSS 的 @import "tailwindcss" 自带 preflight，因此不再单独引 reset
    // （原来是 @unocss/reset/tailwind.css，Wind 预设不含 reset）。
    css: ["~/assets/css/main.css"],
    vite: {
        plugins: [tailwindcss()],
        optimizeDeps: {
            include: [
                "@vueuse/core",
                "errx",
                "reka-ui",
                "clsx",
                "tailwind-merge",
                "class-variance-authority",
            ],
        },
    },
    compatibilityDate: "2026-07-03",
    devtools: {
        enabled: false,
    },
});
