/**
 * 请求分发：先经准入，再按路径前缀交给宿主自有路由或插件贡献的处理器，并在响应体发送完毕时归还在途计数。
 *
 * 插件路由随贡献交付挂上、随撤回摘下；分发时每次经 `implementation()` 取实现，入口停止后的请求
 * 得到 503，而不是调用已收口的实现。
 */

import {PluginStateError} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {HttpAdmission, RequestTicket} from "./admission";
import {HttpAdmissionRejected} from "./admission";
import {HTTP_ROUTES_CONTRIBUTION} from "./contracts";
import type {HttpRouteEnv, HttpRouteHandler} from "./contracts";

/** 宿主自有接口的前缀段；插件不能以它为 id 挂载路由。 */
export const HOST_ROUTE_SEGMENT = "runtime";

type RouteHandle = ContributionHandle<unknown, HttpRouteHandler>;

/** `http.routes` 贡献的结构校验：每个插件只有一份 `api` 贡献，且不占用宿主前缀。 */
export function validateRouteContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.id !== HTTP_ROUTES_CONTRIBUTION) return `http.routes 的贡献 id 必须是 ${HTTP_ROUTES_CONTRIBUTION}`;
    if (descriptor.plugin === HOST_ROUTE_SEGMENT) return `插件 id ${HOST_ROUTE_SEGMENT} 与宿主接口前缀冲突`;
    if (descriptor.location !== "server") return "http.routes 只接受后端入口的贡献";
    return null;
}

/** 已挂载的插件路由，按插件 id 索引；同时充当贡献接收者。 */
export class RouteTable {
    readonly #mounted = new Map<string, RouteHandle>();
    readonly #pending = new Set<string>();

    lookup(plugin: string): RouteHandle | null {
        return this.#mounted.get(plugin) ?? null;
    }

    receiver(): ContributionReceiver<unknown, HttpRouteHandler, string> {
        return {
            prepare: (handle) => {
                // 同一插件的两个入口都提交路由时，后到的那次交付失败，已挂载的不受影响。
                if (this.#mounted.has(handle.plugin) || this.#pending.has(handle.plugin)) {
                    throw new Error(`插件 ${handle.plugin} 已挂载 http.routes`);
                }
                this.#pending.add(handle.plugin);
                return handle.plugin;
            },
            commit: (handle, plugin) => {
                this.#pending.delete(plugin);
                this.#mounted.set(plugin, handle);
            },
            revoke: (handle, plugin) => {
                this.#pending.delete(plugin);
                if (this.#mounted.get(plugin) === handle) this.#mounted.delete(plugin);
            },
        };
    }
}

export interface DispatchOptions {
    readonly admission: HttpAdmission;
    readonly routes: RouteTable;
    /** `/api/runtime/` 下的宿主自有接口。 */
    readonly hostRoutes: HttpRouteHandler;
    /** 处理器抛错时的诊断；不改变响应。 */
    readonly reportError: (error: unknown, context: {readonly plugin: string | null; readonly path: string}) => void;
}

const API_PATH_PATTERN = /^\/api\/([^/]+)(\/.*)?$/u;

export function createDispatcher(options: DispatchOptions): (request: Request) => Promise<Response> {
    return async (request) => {
        let ticket: RequestTicket;
        try {
            ticket = await options.admission.admit();
        } catch (error) {
            if (error instanceof HttpAdmissionRejected) return errorResponse(503, error.code, error.message);
            throw error;
        }
        const url = new URL(request.url);
        const match = API_PATH_PATTERN.exec(url.pathname);
        if (match === null) {
            ticket.release();
            return errorResponse(404, "not-found", "没有这个接口。");
        }
        const segment = decodeSegment(match[1] as string);
        if (segment === null) {
            ticket.release();
            return errorResponse(404, "not-found", "没有这个接口。");
        }
        const plugin = segment === HOST_ROUTE_SEGMENT ? null : segment;
        let handler: HttpRouteHandler;
        if (plugin === null) {
            handler = options.hostRoutes;
        } else {
            const handle = options.routes.lookup(plugin);
            if (handle === null) {
                ticket.release();
                return errorResponse(404, "not-found", "没有这个接口。");
            }
            try {
                handler = handle.implementation();
            } catch (error) {
                ticket.release();
                if (error instanceof PluginStateError) return errorResponse(503, "plugin-unavailable", `插件 ${plugin} 当前不可用。`);
                throw error;
            }
        }
        const env: HttpRouteEnv = {registerEventStream: (close) => ticket.stream(close)};
        let response: Response;
        try {
            response = await handler.fetch(forwardedRequest(request, url, match[2] ?? "/"), env);
        } catch (error) {
            ticket.release();
            options.reportError(error, {plugin, path: url.pathname});
            return errorResponse(500, "internal-error", "处理请求时出错。");
        }
        return releaseWhenSent(response, ticket, request.signal);
    };
}

/** 路径段按 URL 编码解码；编码非法时返回 null，按不存在的接口处理。 */
function decodeSegment(segment: string): string | null {
    try {
        return decodeURIComponent(segment);
    } catch (error) {
        if (error instanceof URIError) return null;
        throw error;
    }
}

/** 去掉挂载前缀后转交；方法、头、正文与取消信号随原请求保留。 */
function forwardedRequest(request: Request, url: URL, path: string): Request {
    const target = new URL(url);
    target.pathname = path;
    return new Request(target.href, request);
}

/**
 * 响应体发送完毕、出错或被客户端取消时归还在途计数；没有正文的响应立即归还。
 * 事件流在处理器内登记后已移出等待，这里的归还只是把它从排空关闭名单中摘掉。
 */
function releaseWhenSent(response: Response, ticket: RequestTicket, signal: AbortSignal): Response {
    const body = response.body;
    if (body === null) {
        ticket.release();
        return response;
    }
    let finished = false;
    const finish = (): void => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", finish);
        ticket.release();
    };
    signal.addEventListener("abort", finish, {once: true});
    const reader = body.getReader();
    const tracked = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const chunk = await reader.read();
                if (chunk.done) {
                    controller.close();
                    finish();
                    return;
                }
                controller.enqueue(chunk.value);
            } catch (error) {
                controller.error(error);
                finish();
            }
        },
        async cancel(reason) {
            finish();
            await reader.cancel(reason);
        },
    });
    return new Response(tracked, {status: response.status, statusText: response.statusText, headers: response.headers});
}

export function errorResponse(status: number, code: string, message: string): Response {
    return Response.json({error: {code, message}}, {status});
}
