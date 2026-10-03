/**
 * 真实浏览器验收（测试分类中的 e2e 层，`bun run test:e2e`）：本机 Chrome（`channel: "chrome"`），不下载 Playwright
 * 自带的浏览器。Playwright 由 Node 运行：Bun 下启动浏览器时 CDP 握手会超时（nb-ui 的同一结论）。
 * 被测服务由各用例自己启动与停止（生产构建与开发会话各一套），不用 webServer：用例要控制它们的停止与退出码。
 */

import {tmpdir} from "node:os";
import {join} from "node:path";

import {defineConfig} from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: {timeout: 15_000},
    reporter: [["list"]],
    outputDir: join(tmpdir(), "neuro-book", "playwright", "neuro-book"),
    use: {channel: "chrome", headless: true, trace: "retain-on-failure"},
});
