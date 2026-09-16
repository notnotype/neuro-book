/**
 * 探针专用 vitest 配置：root 指向探针目录，`nbook` 别名指到产品包。
 * 目的：让探针文件留在本 Task 目录（只读约束：不改产品代码/测试、不动 t50 目录），
 * 同时用产品代码的原样 import 路径（`nbook/app/...`）跑真组件。
 *
 * 运行（cwd 必须是 worktree 根）：
 *   bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/vitest.probe.config.ts
 */
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";

const probesDir = fileURLToPath(new URL("./", import.meta.url));
const packageDir = fileURLToPath(new URL("../../../../../../../packages/neuro-book/", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    root: probesDir,
    resolve: {alias: {nbook: packageDir}},
    test: {
        environment: "jsdom",
        globals: true,
        include: ["*.probe.test.ts"],
    },
});
