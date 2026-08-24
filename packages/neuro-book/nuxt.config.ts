import {fileURLToPath} from "node:url";
import {join, resolve} from "node:path";
import {
    isProductRuntimeIslandModule,
    productRuntimeIslandPackageNames,
} from "../../scripts/build/product-runtime-islands";

const rootDir = fileURLToPath(new URL("./", import.meta.url));
const repositoryRoot = resolve(rootDir, "..", "..");
const serverDir = fileURLToPath(new URL("./server/", import.meta.url));
const i18nConfigPath = fileURLToPath(new URL("./app/i18n/i18n.config.ts", import.meta.url));
const configuredStateRoot = process.env.NEURO_BOOK_STATE_ROOT?.trim();
const runtimeWorkspaceRoot = configuredStateRoot ? resolve(configuredStateRoot, "workspace").replace(/\\/g, "/").replace(/\/$/u, "") : "";
const productImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
const requestedOutputRoot = process.env.NEURO_BOOK_OUTPUT_DIR?.trim();
const productSourceDigest = process.env.NEURO_BOOK_PRODUCT_SOURCE_DIGEST?.trim();
if (Boolean(productImageRoot) !== Boolean(requestedOutputRoot)) {
    throw new Error("Product Nuxt build 必须由 Product Runtime Image Builder 同时注入 image root 与 output root。");
}
if (productImageRoot && resolve(rootDir, productImageRoot) !== resolve(rootDir, requestedOutputRoot!)) {
    throw new Error("Product Runtime Image Builder 注入的 image root 与 output root 不一致。");
}
if (Boolean(productImageRoot) !== Boolean(productSourceDigest)) {
    throw new Error("Product Nuxt build 必须由 Product Runtime Image Builder 注入 Source digest。");
}
if (productSourceDigest && !/^sha256:[0-9a-f]{64}$/u.test(productSourceDigest)) {
    throw new Error("Product Runtime Image Builder 注入的 Source digest 无效。");
}
const productBuildId = productSourceDigest?.slice("sha256:".length);
// 普通 Nuxt build 只产生可删除的 Developer Build State，永远不直接拥有 `.output`。
const rawProductOutputDir = productImageRoot
    ? resolve(rootDir, productImageRoot)
    : resolve(rootDir, ".nuxt", "product-raw");
const runtimeWorkspaceWatchIgnore = [
    "workspace",
    "workspace/**",
    ...(runtimeWorkspaceRoot
        ? [
            runtimeWorkspaceRoot,
            `${runtimeWorkspaceRoot}/**`,
            runtimeWorkspaceRoot.replace(/\//g, "\\"),
            `${runtimeWorkspaceRoot.replace(/\//g, "\\")}\\**`,
        ]
        : []),
];

export default defineNuxtConfig({
    ssr: false,
    buildId: productBuildId,
    alias: {
        nbook: rootDir,
    },
    vite: {
        cacheDir: process.env.NEURO_BOOK_CACHE_ROOT?.trim()
            ? join(process.env.NEURO_BOOK_CACHE_ROOT.trim(), "vite")
            : undefined,
        server: {
            watch: {
                ignored: runtimeWorkspaceWatchIgnore,
            },
        },
        optimizeDeps: {
            entries: [
                "./app/app.vue",
                "./app/pages/index.vue",
            ],
            include: [
                "@dnd-kit/dom",
                "@dnd-kit/vue",
                "@milkdown/core",
                "@milkdown/prose",
                "@tiptap/core",
                "@tiptap/extension-placeholder",
                "@tiptap/markdown",
                "@tiptap/starter-kit",
                "@tiptap/suggestion",
                "@tiptap/vue-3",
                "@vue-flow/background",
                "@vue-flow/controls",
                "@vue-flow/core",
                "@vue-flow/minimap",
                "dayjs",
                "dompurify",
                "json-editor-vue",
            ],
            exclude: [
                "monaco-editor",
                "monaco-editor/esm/vs/editor/editor.api.js",
                "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js",
                "monaco-editor/esm/vs/editor/editor.worker.js",
            ],
        },
        build: {
            reportCompressedSize: false,
        },
    },
    components: [
        {
            path: "~/components/common",
            pathPrefix: false,
            extensions: ["vue"],
        },
        {
            path: "~/components/markdown-studio",
            pathPrefix: false,
            extensions: ["vue"],
        },
        {
            path: "~/components",
            extensions: ["vue"],
        },
    ],
    nitro: {
        output: {dir: rawProductOutputDir},
        devStorage: {
            root: {
                driver: "fs",
                readOnly: true,
                base: rootDir,
                watchOptions: {
                    ignored: runtimeWorkspaceWatchIgnore,
                },
            },
            src: {
                driver: "fs",
                readOnly: true,
                base: serverDir,
                watchOptions: {
                    ignored: runtimeWorkspaceWatchIgnore,
                },
            },
        },
        watchOptions: {
            ignored: runtimeWorkspaceWatchIgnore,
        },
        externals: {
            external: [
                "@earendil-works/pi-ai",
                "@earendil-works/pi-agent-core",
                // Runtime package islands 由 Product 后处理复制并重写为镜像内相对路径。
                ...productRuntimeIslandPackageNames(repositoryRoot),
                // 函数 matcher 的优先级高于 Nitro 的 runtime inline 路径，物理 package id 仍保持 external。
                isProductRuntimeIslandModule,
                // Bun 内置模块：Rollup 解析不到，运行时由 Bun 宿主提供（Windows reparse 检测的惰性 FFI）。
                "bun:ffi",
            ],
            trace: false,
        },
        alias: {
            nbook: rootDir,
        },
        experimental: {
            openAPI: true,
        },
        openAPI: {
            meta: {
                title: "Neuro Book API",
                version: "1.0.0",
                description: "AI-powered novel writing platform — novels, chapters, plot management, settings, and workspace files",
            },
        },
    },
    css: [
        "the-new-css-reset/css/reset.css",
        "nbook/app/styles/theme-vars.css",
        "nbook/app/styles/reference-chips.css",
        "@vue-flow/core/dist/style.css",
        "@vue-flow/core/dist/theme-default.css",
        "@vue-flow/controls/dist/style.css",
        "@vue-flow/minimap/dist/style.css",
    ],
    modules: [
        "nuxt-auth-utils",
        "@pinia/nuxt",
        "pinia-plugin-persistedstate/nuxt",
        "@nuxtjs/i18n",
        "@unocss/nuxt",
        "@nuxtjs/color-mode",
        "@vueuse/nuxt",
    ],
    i18n: {
        strategy: "no_prefix",
        defaultLocale: "zh-CN",
        detectBrowserLanguage: false,
        locales: [
            {
                code: "zh-CN",
                language: "zh-CN",
                name: "简体中文",
            },
            {
                code: "en-US",
                language: "en-US",
                name: "English",
            },
        ],
        vueI18n: i18nConfigPath,
    },
    piniaPluginPersistedstate: {
        storage: "localStorage",
    },
    colorMode: {
        preference: "dark",
        fallback: "dark",
        classSuffix: "",
    },
    compatibilityDate: "2026-03-02",
    devtools: {
        enabled: productImageRoot ? false : process.env.NUXT_DEVTOOLS === "1",
    },
    experimental: {
        // Product 由 Manager 管理代次，不需要 Nuxt 基于 Date.now() 生成的在线旧版本检测 manifest。
        appManifest: productImageRoot ? false : undefined,
    },
});
