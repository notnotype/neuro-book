/**
 * `nbook.http` 对其它插件公开的合同：贡献点 `http.routes` 的形状。只用标准的 `Request`、`Response`，不依赖 Hono。
 * 其它插件在运行时只引用本文件（docs/adr/0025-service-keys-by-id.md）。
 */

/**
 * 贡献点 id。每个插件至多一条贡献，贡献 id 写插件自己的 id：内核要求贡献 id 在同一贡献点内唯一，两个插件用了
 * 同一个 id 时两条都被拒绝（runtime.plugins）。挂载前缀也由插件 id 决定：`/api/<插件 id>/`。
 */
export const HTTP_ROUTES_POINT = "http.routes";

/** 分发给插件处理器的请求环境。 */
export interface HttpRouteEnv {
    /**
     * 把当前请求登记为事件流：此后不再计入排空等待，排空开始时调用 `close` 关闭它。
     * 一个请求只能登记一次。
     */
    registerEventStream(close: () => void | Promise<void>): void;
}

/**
 * `http.routes` 的实现：收到的请求已去掉挂载前缀（`/api/<插件 id>/tree` 到达时路径为 `/tree`）。
 * Hono 应用的 `fetch(request, env)` 满足此形状，`env` 在 Hono 中即 `c.env`；Hono 应用要设 `onError(rethrowRouteError)`。
 */
export interface HttpRouteHandler {
    fetch(request: Request, env: HttpRouteEnv): Response | Promise<Response>;
}

/**
 * Hono 应用的错误处理器：`new Hono().onError(rethrowRouteError)`。Hono 缺省接住处理器抛的错、打到标准错误并回纯文本 500，
 * `fetch` 不抛，分发层统一的诊断与 JSON 响应（docs/specs/runtime/server-host.md 的“请求分发”）就走不到。这里重新抛给分发层；
 * 带 `getResponse` 的是 Hono 的 `HTTPException`，它自己就是要给客户端的响应，不算出错。
 */
export function rethrowRouteError(error: Error): Response {
    if ("getResponse" in error && typeof error.getResponse === "function") return error.getResponse() as Response;
    throw error;
}
