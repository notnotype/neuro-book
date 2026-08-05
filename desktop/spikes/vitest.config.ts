import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            nbook: root,
        },
    },
    test: {
        environment: "node",
        globals: true,
        include: ["desktop/spikes/shared/src/**/*.test.ts"],
        maxWorkers: 1,
        minWorkers: 1,
    },
});
