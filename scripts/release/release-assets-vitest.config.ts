import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));

/** Release preflight只运行资产协议，不加载Agent/Nuxt全局fixture。 */
export const releaseAssetsVitestConfig = {
    root: rootDir,
    resolve: {
        alias: {
            nbook: rootDir,
        },
    },
    test: {
        environment: "node",
        setupFiles: ["server/workspace-files/vitest-tmpdir-setup.ts"],
        globalSetup: ["server/workspace-files/vitest-global-setup.ts"],
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
