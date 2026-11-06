/**
 * Vue 组件测试（`*.dom.test.ts`）：沿用前端的 Vite 配置（别名、Vue 插件），在 happy-dom 里挂载组件。
 * 其余测试由 `bun test` 运行，包内 `bunfig.toml` 排除了这些文件：Bun 不能加载 `.vue`，也没有 `import.meta.glob`。
 * 需要真实布局的交互（尺寸、拖放、滚动）不在这里测，走 Playwright（`e2e/`）。
 */

import {fileURLToPath} from "node:url";

import {defineConfig, mergeConfig} from "vitest/config";

import viteConfig from "./vite.config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const testSupport = "@notnotype/neuro-book-test-support/vitest";

export default mergeConfig(viteConfig, defineConfig({
    root: packageRoot,
    test: {
        environment: "happy-dom",
        // 用例第一次挂载异步组件时 Vitest 才转换 nb-ui、编辑器这些模块，别的进程占着 CPU 时能到十几秒。这个上限只在失败时才等满，不让通过的用例变慢。
        testTimeout: 30_000,
        // Node 26 自带的全局 localStorage 在没有 --localstorage-file 时只打印实验警告；关掉它，页面里的 localStorage
        // 由 happy-dom 提供。
        execArgv: ["--no-experimental-webstorage"],
        // 示例插件的界面组件同样在这里测（`plugin-sdk/examples/README.md` 的“运行”）；`plugin-sdk/` 顶层的是用生成的 SDK 包在仓库外
        // 构建、再在这里渲染的第三方插件。
        include: ["src/**/*.dom.test.ts", "plugin-sdk/*.dom.test.ts", "plugin-sdk/examples/**/*.dom.test.ts"],
        setupFiles: [testSupport],
        globalSetup: [testSupport],
    },
}));
