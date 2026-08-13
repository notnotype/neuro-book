import {fileURLToPath} from "node:url";

import {defineConfig} from "vitest/config";

/** Manager clean-checkout合同不加载Nuxt或Agent测试的全局fixture。 */
export default defineConfig({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    test: {
        environment: "node",
        setupFiles: ["server/workspace-files/vitest-tmpdir-setup.ts"],
        globalSetup: ["server/workspace-files/vitest-global-setup.ts"],
        include: ["scripts/release/manager-release-contract.test.ts"],
    },
});
