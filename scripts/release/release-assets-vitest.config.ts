import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));

/** Release preflight只运行资产协议，不加载Agent/Nuxt全局fixture。 */
export const releaseAssetsVitestConfig = {
    root: rootDir,
    resolve: {
        alias: {
            "#scripts": resolve(rootDir, "scripts"),
            nbook: resolve(rootDir, "packages/neuro-book"),
            // vite-node 转换 zod 官方入口的 namespace 再导出会丢失 `z`，钉到等价 shim。
            zod: resolve(rootDir, "scripts/release/zod-shim.mjs"),
        },
    },
    test: {
        environment: "node",
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        maxWorkers: 1,
        include: [
            "scripts/release/install-dependencies.test.ts",
            "scripts/release/installation-state-root.test.ts",
            "scripts/release/release-assets.test.ts",
            "scripts/release/release-checksums.test.ts",
        ],
    },
};

export default defineConfig(releaseAssetsVitestConfig);
