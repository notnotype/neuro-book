/**
 * 包的公开入口 `@notnotype/nb-site-contract-tests/testing`：给别的包的测试复用起进程、造账号、扮演 OAuth 客户端的底座。
 * 现在的使用方是官方站前端的真实冒烟（`nb-site-web/e2e/real/`，Playwright 由 Node 跑），所以这里只转出不依赖测试运行器、
 * 不用 Bun 专有接口的几个文件：收口由调用方在自己的钩子里调 `createSiteSandbox` 返回的 `open`、`close`。
 * `bun:test` 的钩子版（`useSiteSandbox`）、开库的故障注入与统计的上报样例只给本包的合同测试用，不在这里。
 */

export * from "./identity";
export * from "./oauth-client";
export * from "./process";
