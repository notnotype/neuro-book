import {exitOnProductStartupFailure, productRuntimeReady} from "nbook/server/runtime/product-startup";

// Middleware 模块在 Nitro 建立 listener 前加载；启动任务立即开始，首批请求共享同一结果。
const startup = productRuntimeReady();
// 启动失败必须终止进程，不能留下只会返回部分能力的服务。
void startup.catch(exitOnProductStartupFailure);

/** 任何 HTTP 能力都必须等待 Workspace、migration 与 Session Store 完整 ready。 */
export default defineEventHandler(async () => {
    await startup;
});
