/**
 * `nbook.http` 后端入口：Bun 监听、经准入分发请求，并接收其它插件的 `http.routes` 贡献。
 *
 * 监听归本入口的激活作用域，入口关闭时强制断开剩余连接；排空由宿主在内核停止前完成，
 * 这里不再等待在途请求。宿主自有接口挂在 `/api/runtime/`，其中 `/health` 在就绪后返回 200。
 */

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import type {HttpAdmission} from "./admission";
import {HTTP_ROUTES_POINT} from "./contracts";
import type {HttpRouteEnv} from "./contracts";
import {createDispatcher, errorResponse, RouteTable, validateRouteContribution} from "./dispatch";

export interface HttpPluginOptions {
    readonly admission: HttpAdmission;
    readonly host: string;
    readonly port: number;
    /** 监听成功后报告实际地址（端口为 0 时由系统分配）。 */
    readonly onListening: (url: string) => void;
}

export function createHttpPlugin(options: HttpPluginOptions): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [{id: HTTP_ROUTES_POINT, implementation: "required", validate: validateRouteContribution}],
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: diagnosticsKey}],
            receives: [HTTP_ROUTES_POINT],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const reportError = (error: unknown, detail: {readonly plugin: string | null; readonly path: string}): void => {
                    diagnostics.record({
                        level: "error",
                        event: "http.request.failed",
                        message: "处理请求时出错",
                        error,
                        data: detail,
                        source: {plugin: detail.plugin ?? descriptor.id},
                    });
                };
                const routes = new RouteTable();
                const hostRoutes = new Hono<{Bindings: HttpRouteEnv}>().get("/health", (c) => c.json({status: "ok"}));
                const server = Bun.serve({
                    hostname: options.host,
                    port: options.port,
                    // 关闭空闲超时：长请求与事件流由排空合同收口，不被 Bun 默认的 10 秒空闲断开。
                    idleTimeout: 0,
                    fetch: createDispatcher({admission: options.admission, routes, hostRoutes, reportError}),
                    error: (error) => {
                        reportError(error, {plugin: null, path: ""});
                        return errorResponse(500, "internal-error", "处理请求时出错。");
                    },
                });
                context.scope.register({kind: "http-listener", label: "server", value: server, release: (listener) => listener.stop(true)});
                const url = server.url.href;
                diagnostics.record({level: "info", event: "http.listening", message: "HTTP 已开始监听", data: {url}, source: {plugin: descriptor.id}});
                options.onListening(url);
                return {receivers: {[HTTP_ROUTES_POINT]: routes.receiver()}};
            },
        }],
    };
}
