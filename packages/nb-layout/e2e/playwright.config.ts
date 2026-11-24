/**
 * 示例应用的真实浏览器验收（`bun run test:e2e`，先构建全部示例）：本机 Chrome（`channel: "chrome"`），不下载 Playwright
 * 自带的浏览器。Playwright 由 Node 运行（Bun 下启动浏览器时 CDP 握手会超时）。被测的静态服务由各用例自己起停（`serve.ts`）。
 */

import {defineConfig} from "@playwright/test";

import {resolveAgentPlaywrightRoot} from "@notnotype/neuro-book-test-support/paths";

export default defineConfig({
    testDir: ".",
    testMatch: "*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: {timeout: 10_000},
    reporter: [["list"]],
    // 按检出分开：几个 worktree 共用一个输出目录时，开跑会清掉别的会话的失败现场，`--last-failed` 也读到别人的清单。
    outputDir: resolveAgentPlaywrightRoot("nb-layout", import.meta.dirname),
    use: {channel: "chrome", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure", viewport: {width: 1440, height: 900}},
});
