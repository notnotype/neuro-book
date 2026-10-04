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
        include: ["src/**/*.dom.test.ts"],
        setupFiles: [testSupport],
        globalSetup: [testSupport],
    },
}));
