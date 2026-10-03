import {fileURLToPath} from "node:url";

import {transform} from "esbuild";
import {defineConfig} from "vitest/config";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));

/**
 * runtime-foundation 验证入口：只收 runtime 机制以及后续环境适配、基础服务插件的相邻测试。
 * 与应用默认 vitest.config.ts 分开，是因为默认配置会加载 Agent fixture 与产品 setup，
 * 而机制合同要求在没有 Nuxt 生成态、没有任何产品初始化的干净 checkout 上可运行。
 * 临时根仍走仓库统一的 test-support setup（setupFiles 第一项 + globalSetup）。
 */
export default defineConfig({
    root: packageRoot,
    // 应用 tsconfig.json extends 生成态 .nuxt/tsconfig.json；本入口必须在未执行 nuxt prepare 的
    // checkout 上可运行，因此关闭 OXC 的 nearest-tsconfig 发现，改用显式 esbuild 转换
    // （与 scripts/release/desktop-contract-vitest.config.ts 同一做法）。Vite 8 关闭 OXC 后
    // 不再自带 esbuild 转换，所以这里必须保留这个小插件。
    oxc: false,
    plugins: [
        {
            name: "runtime-foundation-typescript",
            enforce: "pre",
            async transform(code, id) {
                const normalizedId = id.replaceAll("\\", "/");
                if (
                    normalizedId.includes("/node_modules/") ||
                    !/\.(?:[cm]?ts|tsx)$/u.test(normalizedId) ||
                    normalizedId.endsWith(".d.ts")
                ) {
                    return;
                }

                const result = await transform(code, {
                    loader: normalizedId.endsWith(".tsx") ? "tsx" : "ts",
                    format: "esm",
                    platform: "node",
                    target: "es2022",
                    sourcefile: id,
                    // 用独立 map 而不是 inline：inline 时 result.map 为空串，Vite 拿不到映射，
                    // 失败堆栈会指到错误行号。
                    sourcemap: true,
                    tsconfigRaw: {
                        compilerOptions: {
                            module: "ESNext",
                            moduleResolution: "Bundler",
                            target: "ES2022",
                            useDefineForClassFields: true,
                        },
                    },
                });

                return {
                    code: result.code,
                    map: result.map,
                };
            },
        },
    ],
    resolve: {
        alias: {
            nbook: packageRoot,
        },
    },
    test: {
        environment: "node",
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        include: [
            "runtime/**/*.test.ts",
            "server/runtime/foundation/**/*.test.ts",
            "app/runtime/browser-host.test.ts",
            "server/features/**/*.test.ts",
            "app/features/**/*.test.ts",
        ],
    },
});
