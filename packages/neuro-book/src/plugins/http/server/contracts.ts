/**
 * `nbook.http` 对其它插件公开的合同：贡献点 `http.routes` 的形状。
 *
 * 其它插件只以 `import type` 引用这里，运行时经内核的贡献交付与本插件协作。
 */

/** 贡献点 id。 */
export const HTTP_ROUTES_POINT = "http.routes";

/** 每个插件在 `http.routes` 下的唯一贡献 id；挂载前缀由插件 id 决定：`/api/<插件 id>/`。 */
export const HTTP_ROUTES_CONTRIBUTION = "api";

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
 * Hono 应用的 `fetch(request, env)` 满足此形状，`env` 在 Hono 中即 `c.env`。
 */
export interface HttpRouteHandler {
    fetch(request: Request, env: HttpRouteEnv): Response | Promise<Response>;
}
