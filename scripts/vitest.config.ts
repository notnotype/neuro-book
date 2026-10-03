import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {defineConfig} from "vitest/config";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

export default defineConfig({
    root: repositoryRoot,
    resolve: {
        alias: {
            "#scripts": resolve(repositoryRoot, "scripts"),
        },
    },
    test: {
        environment: "node",
        globals: true,
        maxWorkers: 2,
        hookTimeout: 60_000,
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        include: [
            "scripts/ci/**/*.test.ts",
            "scripts/cli/**/*.test.ts",
            "scripts/utils/**/*.test.ts",
        ],
    },
});
