/**
 * 官方站前端的浏览器场景（t10 计划 3.10，`bun run test:e2e`，先构建）：对着构建产物（Vite 的预览服务）跑，账号服务的接口由各用例
 * 用 `page.route` 按合同的形状回答（`fake-api.ts`）。本机 Chrome（`channel: "chrome"`），不下载 Playwright 自带的浏览器；
 * Playwright 由 Node 运行。减弱动效：几何的断言量的是过渡结束后的位置，过渡本身在开发服务的真实页面上看（ui-development 第 6 条）。
 *
 * 两个项目：`fake` 是上面这些；`real` 是真实冒烟（`e2e/real/`，段 B 第 10 片），起真的 `nb-site serve` 发同一份构建产物，浏览器经
 * 本地 TLS 转发以 `https://site.test` 打开（做法与取舍见 `e2e/real/site.ts`）。放进同一份配置而不另起脚本：`test:e2e` 一次跑两种，
 * 两边共用输出目录与“先构建”这一步；只跑一种时加 `--project fake` 或 `--project real`。真实冒烟的浏览器由它自己的 fixture 起
 * （要先知道转发服务的端口），不用下面的预览服务，也不进 `test:affected`（那里只跑 `bun test` 与 vitest）。
 */

import {defineConfig} from "@playwright/test";

import {resolveAgentPlaywrightRoot} from "@notnotype/neuro-book-test-support/paths";

/** 预览服务的端口。几个 worktree 同时跑时用环境变量错开；`strictPort` 让端口被占时直接失败，不悄悄换一个。 */
const port = Number(process.env.NB_SITE_WEB_E2E_PORT ?? 4360);

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: {timeout: 10_000},
    reporter: [["list"]],
    // 按检出分开：几个 worktree 共用一个输出目录时，开跑会清掉别的会话的失败现场，`--last-failed` 也读到别人的清单。
    outputDir: resolveAgentPlaywrightRoot("nb-site-web", import.meta.dirname),
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        channel: "chrome",
        headless: true,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        contextOptions: {reducedMotion: "reduce"},
    },
    projects: [
        {name: "fake", testIgnore: "real/**"},
        {name: "real", testDir: "./real"},
    ],
    webServer: {
        command: `bun run preview --port ${port} --strictPort --host 127.0.0.1`,
        cwd: `${import.meta.dirname}/..`,
        url: `http://127.0.0.1:${port}/`,
        reuseExistingServer: false,
        timeout: 60_000,
    },
});
