/**
 * 开发模式的页面服务：Vite（中间件模式）挂在监督进程自己的 HTTP 服务上，`/api` 先过前置门再代理到后端。
 *
 * 由我们监听而不是 `vite.listen()`：Vite 把端口 0 当作缺省端口，测试与并行的 worktree 需要系统分配端口。
 * 前置门让重启中的请求等后端就绪，后端不可用时直接给 503，浏览器据此显示连接失败页（与生产一致）。
 */

import {createServer as createHttpServer} from "node:http";
import type {IncomingMessage, ServerResponse} from "node:http";

import {createServer as createViteServer} from "vite";

import type {GateDecision} from "./supervisor";

export interface DevFrontendOptions {
    readonly host: string;
    readonly port: number;
    readonly backendUrl: string;
    readonly configFile: string;
    readonly admit: () => Promise<GateDecision>;
}

export interface DevFrontend {
    readonly url: string;
    close(): Promise<void>;
}

export async function startDevFrontend(options: DevFrontendOptions): Promise<DevFrontend> {
    const http = createHttpServer();
    const vite = await createViteServer({
        configFile: options.configFile,
        appType: "spa",
        server: {middlewareMode: true, hmr: {server: http}, proxy: {"/api": {target: options.backendUrl}}},
    });
    http.on("request", (request: IncomingMessage, response: ServerResponse) => {
        if (!isApiRequest(request)) {
            vite.middlewares(request, response);
            return;
        }
        void options.admit().then((decision) => {
            if (decision === "open") vite.middlewares(request, response);
            else unavailable(response, decision);
        });
    });
    try {
        await new Promise<void>((resolve, reject) => {
            http.once("error", reject);
            http.listen(options.port, options.host, () => {
                http.off("error", reject);
                resolve();
            });
        });
    } catch (error) {
        await vite.close();
        throw error;
    }
    const address = http.address();
    const port = typeof address === "object" && address !== null ? address.port : options.port;
    return {
        url: `http://${options.host}:${String(port)}/`,
        async close() {
            await vite.close();
            // 浏览器的长连接与 HMR 连接不会自己断开，不强制关闭的话 close 等到它们超时。
            http.closeAllConnections();
            await new Promise<void>((resolve) => http.close(() => resolve()));
        },
    };
}

function isApiRequest(request: IncomingMessage): boolean {
    const url = request.url ?? "/";
    return url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");
}

function unavailable(response: ServerResponse, decision: Exclude<GateDecision, "open">): void {
    const code = decision === "stopping" ? "stopping" : "backend-unavailable";
    const message = decision === "stopping" ? "开发服务正在关闭。" : "后端没有运行：启动失败或已退出，修改后端文件后会重新启动。";
    response.writeHead(503, {"content-type": "application/json; charset=utf-8"});
    response.end(JSON.stringify({error: {code, message}}));
}
