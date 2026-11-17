/**
 * 真实浏览器验收（测试分类中的 e2e 层，`bun run test:e2e`）：本机 Chrome（`channel: "chrome"`），不下载 Playwright
 * 自带的浏览器。Playwright 由 Node 运行：Bun 下启动浏览器时 CDP 握手会超时（nb-ui 的同一结论）。
 * 被测服务由各用例自己启动与停止（生产构建与开发会话各一套），不用 webServer：用例要控制它们的停止与退出码。
 */

import {defineConfig} from "@playwright/test";

import {resolveAgentPlaywrightRoot} from "@notnotype/neuro-book-test-support/paths";

import {guardWideRun} from "./wide-run-guard";

guardWideRun(import.meta.dirname);

export default defineConfig({
    testDir: ".",
    testMatch: "*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: {timeout: 15_000},
    reporter: [["list"]],
    // 按检出分开：Playwright 每次开跑清空输出目录，trace、错误现场与 `--last-failed` 的清单都在里面，几个 worktree 共用时会互相清掉、互相读到。
    outputDir: resolveAgentPlaywrightRoot("neuro-book", import.meta.dirname),
    // 默认减少动态效果：约 113 个用例在程序开关后马上量几何，470ms 的外框过渡会让它们量到中间值。测动画的用例用
    // `page.emulateMedia({reducedMotion: "no-preference"})` 开回来。
    use: {channel: "chrome", headless: true, trace: "retain-on-failure", contextOptions: {reducedMotion: "reduce"}},
});
