import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";
import vue from "@vitejs/plugin-vue";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

/**
 * 当前测试以 Node 环境为默认值，前端纯逻辑测试不引入 Nuxt 浏览器运行时。
 * 真实 Vue SFC 由现有 Vue 插件转换；需要 DOM 的组件测试按文件显式声明 jsdom。
 */
export default defineConfig({
    plugins: [vue()],
    root: rootDir,
    resolve: {
        alias: {
            nbook: rootDir,
            "#scripts": fileURLToPath(new URL("../../scripts/", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        globals: true,
        // Product bundle 与隔离 workspace fixture 会显著抬高单 worker 内存；
        // Windows 实测 4 workers 会触发进程池异常退出，2 workers 能保持完整门禁稳定。
        maxWorkers: 2,
        // 默认 10s 不够：beforeEach 里开 Project 会加载 14 个 profile artifact，
        // 而单个 artifact 目前有 27.3 MiB（宿主实现被打进 bundle，见 Task 125 Phase 3）。
        // 这是承认当前 artifact 体积的真实成本，不是掩盖挂起——真正的修复是把 artifact 压小。
        hookTimeout: 60_000,
        // run 级：先由 Agent fixture 设置 runId，再注册受控临时根清理；teardown 逆序执行。
        globalSetup: [
            "server/agent/test/global-setup.ts",
            "@notnotype/neuro-book-test-support/vitest",
        ],
        setupFiles: [
            "@notnotype/neuro-book-test-support/vitest",
            "server/agent/test/setup.ts",
        ],
        include: [
            "app/composables/**/*.test.ts",
            "app/component-lab/**/*.test.ts",
            "app/components/novel-ide/**/*.test.ts",
            "app/components/common/**/*.test.ts",
            "app/components/markdown-studio/**/*.test.ts",
            "app/components/profile-template-editor/**/*.test.ts",
            "app/utils/theme/**/*.test.ts",
            "app/utils/workbench/**/*.test.ts",
            "app/stores/**/*.test.ts",
            "app/utils/novel-ide-settings-responsive.contract.test.ts",
            "app/utils/novel-ide-settings-current-project.contract.test.ts",
            "app/utils/project-picker-recovery.contract.test.ts",
            "app/utils/world-engine-ide-entry.test.ts",
            "app/utils/world-engine-workbench-preview.test.ts",
            "server/**/*.test.ts",
            "server/**/*.test.tsx",
            "shared/**/*.test.ts",
            "scripts/**/*.test.ts",
            "scripts/**/*.test.tsx",
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: [
                "server/agent/**/*.ts",
                "shared/dto/agent-chat.dto.ts",
            ],
        },
    },
});
