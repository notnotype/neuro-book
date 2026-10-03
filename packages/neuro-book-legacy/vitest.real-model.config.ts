import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {loadEnv} from "vite";
import {defineConfig} from "vitest/config";

const rootDir = fileURLToPath(new URL("./", import.meta.url));
const repositoryRoot = resolve(rootDir, "../..");

/**
 * 真实模型 smoke 的独立配置：只收集 `scripts/smoke/real-model/**`，默认测试门禁不收集。
 *
 * - 凭据从仓库根 `.env` **白名单**注入（不覆盖进程已有变量），不把根 dotenv 全量透传进 worker；
 * - 缺凭据/缺 dev server 的用例自行 skip；
 * - 真实调用是慢 IO 且共享同一隔离 State Root 的全局配置，固定单 worker 顺序执行。
 */
const dotenv = loadEnv("real-model", repositoryRoot, "");
const allowedDotenvKeys = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_API_BASE",
    "AGENT_HTTP_BASE_URL",
    "REAL_MODEL_SMOKE_MODEL",
    "REAL_MODEL_SMOKE_PROJECT",
    "REAL_MODEL_SMOKE_CHAPTERS",
    "REAL_MODEL_SMOKE_WRITE_CHAPTER",
] as const;
const injectedEnv: Record<string, string> = {};
for (const key of allowedDotenvKeys) {
    const value = dotenv[key];
    if (value !== undefined && process.env[key] === undefined) {
        injectedEnv[key] = value;
    }
}

export default defineConfig({
    root: rootDir,
    resolve: {
        alias: {
            nbook: rootDir,
        },
    },
    test: {
        environment: "node",
        globals: true,
        maxWorkers: 1,
        hookTimeout: 120_000,
        testTimeout: 300_000,
        env: injectedEnv,
        globalSetup: [
            "server/agent/test/global-setup.ts",
            "@notnotype/neuro-book-test-support/vitest",
        ],
        setupFiles: [
            "@notnotype/neuro-book-test-support/vitest",
            "server/agent/test/setup.ts",
        ],
        include: ["scripts/smoke/real-model/**/*.test.ts"],
    },
});
