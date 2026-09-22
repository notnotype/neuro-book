/**
 * 审查探针的独立 vitest 配置（只读探针，不改产品配置）。
 *
 * 探针文件在本 Task 目录下，产品配置的 `include` 不会收集它们；这里不改产品配置，
 * 而是用一份并列配置：root 与别名与 `packages/neuro-book/vitest.config.ts` 保持一致，
 * 只把 include 指向本目录，复用产品测试的受控临时根 global setup。
 */
import {fileURLToPath} from "node:url";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vitest/config";

const productRoot = fileURLToPath(new URL("../../../../../../../packages/neuro-book/", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    root: productRoot,
    resolve: {alias: {nbook: productRoot}},
    test: {
        environment: "node",
        globals: true,
        maxWorkers: 1,
        hookTimeout: 60_000,
        globalSetup: ["@notnotype/neuro-book-test-support/vitest"],
        setupFiles: ["@notnotype/neuro-book-test-support/vitest"],
        dir: fileURLToPath(new URL("./", import.meta.url)),
        include: ["**/*.probe.test.ts"],
    },
});
