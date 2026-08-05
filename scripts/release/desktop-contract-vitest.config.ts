import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

/** Desktop 合同测试不加载 Nuxt、Agent 或全局 workspace fixture。 */
export default defineConfig({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    resolve: {
        alias: {
            nbook: fileURLToPath(new URL("../../", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        include: [
            "shared/desktop-contract.test.ts",
            "shared/desktop-menu-command.test.ts",
            "desktop/spikes/shared/src/electron-packaging-contract.test.ts",
        ],
    },
});
