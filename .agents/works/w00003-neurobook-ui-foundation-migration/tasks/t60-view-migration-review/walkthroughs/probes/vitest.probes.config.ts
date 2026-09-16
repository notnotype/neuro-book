/**
 * 对抗探针专用 vitest 配置（只读复核用，不进产品）。
 *
 * 为什么需要它：产品 vitest 配置的 `include` 只收 `packages/neuro-book/**`，
 * 而本次复核的只读约束要求探针只落在本 Task 目录下，因此这里用同一套
 * root/alias 指向产品包，只把 include 换成探针目录。
 *
 * 跑法（cwd = worktree 根）：
 *   bunx vitest run --config .agents/works/.../t60-view-migration-review/walkthroughs/probes/vitest.probes.config.ts
 */
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";

const worktreeRoot = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const packageDir = fileURLToPath(new URL("../../../../../../../packages/neuro-book/", import.meta.url));
const probesDir = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    root: packageDir,
    resolve: {
        alias: {
            nbook: packageDir,
            "#scripts": `${worktreeRoot}scripts/`,
        },
    },
    test: {
        globals: true,
        dir: probesDir,
        include: ["*.probe.test.ts"],
        reporters: ["verbose"],
    },
});
