import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
    root,
    resolve: {
        alias: {
            nbook: root,
        },
    },
    test: {
        environment: "node",
        globals: true,
        setupFiles: ["server/workspace-files/vitest-tmpdir-setup.ts"],
        globalSetup: ["server/workspace-files/vitest-global-setup.ts"],
        include: [
            "desktop/electron/src/**/*.test.ts",
            "desktop/shared/src/**/*.test.ts",
            "shared/desktop-contract.test.ts",
            "shared/product-runtime-contract.test.ts",
            "shared/product-runtime-receipt.test.ts",
        ],
        maxWorkers: 1,
        minWorkers: 1,
    },
});
