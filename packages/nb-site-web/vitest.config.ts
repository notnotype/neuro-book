/**
 * 组件与浏览器接口的测试（`src/` 下的 `*.dom.test.ts`）：在 happy-dom 里跑，`.vue` 由 Vue 插件编译。纯逻辑与构建的测试在 `tests/`，
 * 由 `bun test` 运行，包内 `bunfig.toml` 让它跳过这些文件。要真实布局的交互走 Playwright（B2 起）。
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
