import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [vue()],
    test: {
        include: ["src/**/*.test.ts", "themes/**/*.test.ts", "playground/**/*.test.ts"],
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        globals: true,
        environment: "happy-dom",
        // e2e/ 是 Playwright 用例，由 test:e2e 单独跑，vitest 不扫
        exclude: ["e2e/**", "**/node_modules/**"],
    },
});
