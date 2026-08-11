import {fileURLToPath} from "node:url";

import {transform} from "esbuild";
import {defineConfig} from "vitest/config";

export default defineConfig({
    // Manager 需要 transform 仓库内 `server/**` 源码（如 boot-config）；CI 不做 Nuxt
    // prepare，不存在 .nuxt/tsconfig.json，OXC 的 nearest-tsconfig 查找会报
    // TSCONFIG_ERROR。与 desktop-contract-vitest.config.ts 一样改用独立 esbuild
    // transform，不再依赖 Nuxt 生成的 tsconfig。
    oxc: false,
    plugins: [
        {
            name: "manager-vitest-typescript",
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
                    sourcemap: "inline",
                    tsconfigRaw: {
                        compilerOptions: {
                            module: "ESNext",
                            moduleResolution: "Bundler",
                            target: "ES2022",
                            jsx: "react-jsx",
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
            "#manager": fileURLToPath(new URL("./src", import.meta.url)),
            "nbook": fileURLToPath(new URL("../../", import.meta.url)),
        },
    },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        // Manager回归包含真实Git、PowerShell和子进程冷启动；共享runner负载下5秒不足以区分慢启动与挂死。
        testTimeout: 20_000,
    },
});
