import {fileURLToPath} from "node:url";

import {transform} from "esbuild";
import {defineConfig} from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Desktop 合同测试不加载 Nuxt、Agent 或全局 workspace fixture。 */
export default defineConfig({
    root: repositoryRoot,
    // The repository root tsconfig extends the generated .nuxt/tsconfig.json.
    // Desktop contract CI intentionally skips Nuxt preparation, so use Vite's
    // standalone transformer instead of OXC's nearest-tsconfig discovery. Vite
    // 8 no longer installs an esbuild transform when OXC is disabled, so keep
    // this small explicit transform in the contract config.
    oxc: false,
    plugins: [
        {
            name: "desktop-contract-typescript",
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
            nbook: repositoryRoot,
        },
    },
    test: {
        environment: "node",
        include: [
            "shared/desktop-contract.test.ts",
            "shared/desktop-menu-command.test.ts",
            "app/composables/useWorkbenchChrome.test.ts",
            "app/utils/workbench-chrome.test.ts",
            "desktop/spikes/shared/src/electron-packaging-contract.test.ts",
            "desktop/spikes/shared/src/desktop-distribution-packaging-contract.test.ts",
            "desktop/spikes/shared/src/desktop-ui-contract.test.ts",
        ],
    },
});
