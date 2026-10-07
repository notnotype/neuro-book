/**
 * e2e 测试外壳的构建：与产品前端同一份配置，入口换成 `src/web/testing/index.html`（多装一个测试插件），输出到
 * `dist/e2e/web`。产品的 `dist/web` 与 `check:dist` 不受影响。
 */

import {fileURLToPath} from "node:url";

import {mergeConfig} from "vite";

import base from "./vite.config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default mergeConfig(base, {
    root: `${packageRoot}src/web/testing`,
    build: {outDir: `${packageRoot}dist/e2e/web`, emptyOutDir: true},
});
