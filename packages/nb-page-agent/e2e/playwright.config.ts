/**
 * 页面引擎的真实浏览器测试（`bun run test:e2e`，先把引擎打成一个 IIFE 包）：本机 Chrome（`channel: "chrome"`）。
 * 夹具页只测与具体弹层库无关的规则；真实弹层、命令面板与设置窗口的用例在应用的 e2e。Playwright 由 Node 运行。
 */

import {defineConfig} from "@playwright/test";

import {resolveAgentPlaywrightRoot} from "@notnotype/neuro-book-test-support/paths";

export default defineConfig({
    testDir: ".",
    testMatch: "*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 30_000,
    expect: {timeout: 5_000},
    reporter: [["list"]],
    // 按检出分开：几个 worktree 共用一个输出目录时，开跑会清掉别的会话的失败现场。
    outputDir: resolveAgentPlaywrightRoot("nb-page-agent", import.meta.dirname),
    use: {channel: "chrome", headless: true, trace: "retain-on-failure", viewport: {width: 1280, height: 800}},
});
