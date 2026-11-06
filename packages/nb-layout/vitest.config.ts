/**
 * Vue 渲染层的测试（`src/vue/` 下的 `*.dom.test.ts`）：在 happy-dom 里挂载组件。核心的测试由 `bun test` 运行，包内
 * `bunfig.toml` 排除了这些文件。需要真实布局与指针的用例在应用 Component Lab 的 Playwright 里。
 */

import {fileURLToPath} from "node:url";

import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vitest/config";

const testSupport = "@notnotype/neuro-book-test-support/vitest";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [vue()],
    test: {
        environment: "happy-dom",
        // Node 26 自带的全局 localStorage 在没有 --localstorage-file 时不可用，还会盖住 happy-dom 的；关掉它。
        execArgv: ["--no-experimental-webstorage"],
        include: ["src/**/*.dom.test.ts"],
        setupFiles: [testSupport],
        globalSetup: [testSupport],
    },
});
