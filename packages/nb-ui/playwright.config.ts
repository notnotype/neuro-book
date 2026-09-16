import { defineConfig, devices } from "@playwright/test";

// Bun 下直接跑 playwright 会在 CDP 握手超时（design-language 坑 #20），
// 因此 package.json 的 test:e2e 走 `playwright test`（.bin shim 由 Node 执行），
// 不能写死包内 node_modules 路径——monorepo 下 @playwright/test 被 hoisted 到根。
// 另注意：package.json 必须是严格 JSON，注释会让 exsolve 这类 JSON.parse 消费方
// 静默解析失败（2026-08 实测：nuxt dev 因此报 "Cannot resolve module @nuxt/kit"）。
//
// 宿主必须是被测对象本身：默认拒绝复用端口上已有的服务（否则别人的 dev server 会被当成被测页面），
// 需要复用手工启动的 playground 时显式 `NB_UI_E2E_REUSE_SERVER=1`；端口用 `NB_UI_E2E_PORT` 显式指定。
const port = process.env.NB_UI_E2E_PORT ?? "3100";
const reuseExistingServer = process.env.NB_UI_E2E_REUSE_SERVER === "1";

export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    expect: {timeout: 15_000},
    retries: 0,
    workers: 1,
    reporter: [["list"]],
    use: {
        baseURL: `http://localhost:${port}`,
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: `node ../../node_modules/nuxt/bin/nuxt.mjs dev playground --port ${port}`,
        url: `http://localhost:${port}/`,
        reuseExistingServer,
        timeout: 120_000,
    },
});
