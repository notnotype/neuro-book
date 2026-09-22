import {fileURLToPath} from "node:url";
import vue from "@vitejs/plugin-vue";
import {defineConfig} from "vitest/config";

/** 审查探针专用临时配置：root 指向 worktree 根，只收集本目录的 *.probe.test.ts。 */
const worktreeRoot = fileURLToPath(new URL("../../../../../../..", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    root: worktreeRoot,
    resolve: {
        alias: {
            nbook: fileURLToPath(new URL("../../../../../../../packages/neuro-book", import.meta.url)),
            "#scripts": fileURLToPath(new URL("../../../../../../../scripts", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        globals: true,
        maxWorkers: 1,
        include: [".agents/works/w00003-neurobook-ui-foundation-migration/tasks/t46-checkpoint-a-review/walkthroughs/probes/*.probe.test.ts"],
    },
});
