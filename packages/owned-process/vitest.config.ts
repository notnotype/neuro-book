import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

export default defineConfig({
    root: fileURLToPath(new URL("../..", import.meta.url)),
    resolve: {
        alias: {
            "#owned-process": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        include: ["packages/owned-process/tests/**/*.test.ts"],
        environment: "node",
        setupFiles: ["server/workspace-files/vitest-tmpdir-setup.ts"],
        globalSetup: ["server/workspace-files/vitest-global-setup.ts"],
        testTimeout: 20_000,
    },
});
