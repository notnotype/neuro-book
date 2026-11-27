/**
 * 装配根应用（`site.operations` 的输入一节、输出 3、4、8、11、12）：请求编号与请求日志 → 读不出主机名的请求回 400 → 两个健康检查
 * 与测试控制入口（设了口令时）→ 按主机名分到站点或写入口的子应用 → 各模块的 mount → 站点上谁都没接的请求交给网页（设了产物目录时）。
 *
 * 两个入口各是一个 Hono 应用，根应用把请求原样交给其中一个的 `fetch`：同一个前缀在两个入口上可以各挂各的模块。
 * 交出去之后根应用的上下文变量就看不到了，所以请求的状态（命中了哪个模块、请求编号）放在随 `fetch` 第二个参数传下去的
 * `RequestState` 里；模块的子应用经 `app.route` 挂进入口应用，抛出的异常由入口应用的 `onError` 接住。
 */

import type {Server} from "bun";
import {randomUUID} from "node:crypto";

import {Hono} from "hono";

import type {ReadinessReport} from "./health";
import {hostnameKey} from "./hostname";
import {errorType, type Logger} from "./log";
import type {ModuleMount, Surface} from "./module";
import type {WebHandler} from "./web";

/** 入口经 `fetch` 的第二个参数交给每个请求的东西；`server` 用来取 TCP 对端地址（`client-address.ts`）。 */
export interface SiteBindings {
    readonly server: Server<undefined>;
    readonly request: RequestState;
}

/** 一个请求在入口里的状态。`module` 是日志里的 `module`：命中了 mount 就是那个模块，交给了网页是 `web`，否则是 `site`。 */
export interface RequestState {
    module: string;
    readonly requestId: string;
}

type SiteEnv = {Bindings: SiteBindings};

export interface MountedModule {
    readonly module: string;
    readonly mount: ModuleMount;
}

export interface SiteAppOptions {
    readonly mounts: readonly MountedModule[];
    /** 写入口的主机名（`hostnameKey` 之后）；为 null 时所有请求都到站点。 */
    readonly telemetryHost: string | null;
    readonly readiness: () => ReadinessReport;
    readonly log: Logger;
    /** 测试控制入口（`test-control.ts`）；没设口令时不给，`/test-control/*` 就与别的不存在的地址一样落到站点的 404。 */
    readonly testControl?: Hono;
    /** 网页（`web.ts`）；没设前端产物目录时不给，站点上谁都没接的请求照旧回 404。 */
    readonly web?: WebHandler;
}

const NOT_FOUND = {code: "not_found"} as const;

/**
 * 请求的主机名；读不出时为 null。没有 `Host`、`Host` 不合语法（带用户信息、端口不是数字、带路径）时 Bun 交来的 `req.url`
 * 不是合法的绝对地址：有时只是请求目标本身（`/api/...`），有时是拼坏的地址。
 */
function hostnameOf(url: string): string | null {
    const hostname = URL.parse(url)?.hostname;
    return hostname === undefined || hostname === "" ? null : hostname;
}

function surfaceApp(surface: Surface, options: SiteAppOptions): Hono<SiteEnv> {
    const app = new Hono<SiteEnv>();
    for (const {module, mount} of options.mounts) {
        if (mount.surface !== surface) continue;
        const tag = async (c: {env: SiteBindings}, next: () => Promise<void>): Promise<void> => {
            c.env.request.module = module;
            await next();
        };
        app.use(mount.prefix, tag);
        app.use(`${mount.prefix}/*`, tag);
        app.route(mount.prefix, mount.app);
    }
    // 走到这里说明这个入口上没有路由接这个请求（模块子应用自己的 `notFound` 经 `app.route` 挂进来时不跟着走，见各模块的兜底路由）：
    // 网页因此排在每个模块之后。写入口上不发网页。
    app.notFound((c) => {
        const served = surface === "site" ? options.web?.(c.req.raw, c.env.request.requestId) : undefined;
        if (served === undefined) return c.json(NOT_FOUND, 404);
        c.env.request.module = "web";
        return served;
    });
    app.onError((error, c) => {
        options.log.error("http.unhandled_error", "request handler threw", {requestId: c.env.request.requestId, module: c.env.request.module, errorType: errorType(error)});
        return c.json({code: "internal"}, 500);
    });
    return app;
}

/** 模块交来的 mount 不合格：这是那个模块的程序错误，`serve` 按 `start_failed` 报出 `module`。 */
export class MountError extends Error {
    override readonly name = "MountError";

    constructor(
        readonly module: string,
        message: string,
    ) {
        super(message);
    }
}

/** 校验 mount 的形状：前缀写法、同一个入口上前缀不重复。 */
function checkMounts(mounts: readonly MountedModule[]): void {
    const seen = new Set<string>();
    for (const {module, mount} of mounts) {
        if (!/^\/[^?#]*[^/?#]$/u.test(mount.prefix)) throw new MountError(module, `mount prefix must start with "/" and not end with "/"`);
        const key = `${mount.surface} ${mount.prefix}`;
        if (seen.has(key)) throw new MountError(module, `mount prefix is already used on the ${mount.surface} surface`);
        seen.add(key);
    }
}

export function createSiteApp(options: SiteAppOptions): Hono<SiteEnv> {
    checkMounts(options.mounts);
    const site = surfaceApp("site", options);
    const ingest = surfaceApp("ingest", options);
    const root = new Hono<SiteEnv>();

    root.use(async (c, next) => {
        const started = performance.now();
        // `req.url` 不是合法的绝对地址时 Hono 切出来的路径会丢掉第一段，与请求的路径对不上，这时日志里的路径记 null。
        const path = URL.parse(c.req.url) === null ? null : c.req.path;
        await next();
        // 交给入口应用的 `fetch` 得到的是一个新的 Response，`next()` 之前设的头不会带过去，所以在这里加。
        const response = new Response(c.res.body, c.res);
        response.headers.set("X-Request-Id", c.env.request.requestId);
        c.res = response;
        options.log.info("http.request", "request handled", {
            requestId: c.env.request.requestId,
            module: c.env.request.module,
            method: c.req.method,
            // 只有路径：查询串里可能有令牌。
            path,
            status: c.res.status,
            durationMs: Math.round(performance.now() - started),
        });
    });

    // 读不出主机名就无从分派，是请求方的错：回 400，不进 `onError`，不记 error 级日志。
    root.use(async (c, next) => {
        if (hostnameOf(c.req.url) === null) return c.json({code: "bad_request"}, 400);
        await next();
    });

    // 健康检查在分派之前，任何主机名上都能用；反向代理与容器的健康检查用回环地址来。
    root.get("/health/live", (c) => c.json({status: "live"}));
    root.get("/health/ready", (c) => {
        const report = options.readiness();
        return report.ready ? c.json({status: "ready", modules: report.modules}) : c.json({status: "not_ready", code: "not_ready", modules: report.modules}, 503);
    });

    // 与健康检查同一层、在分派之前：任何读得出的主机名上都可用（`site.operations` 输出 11）。
    if (options.testControl !== undefined) root.route("/test-control", options.testControl);

    root.all("*", (c) => {
        // 主机名在上面已经核对过读得出来。
        const toIngest = options.telemetryHost !== null && hostnameKey(hostnameOf(c.req.url)!) === options.telemetryHost;
        return (toIngest ? ingest : site).fetch(c.req.raw, c.env);
    });
    root.onError((error, c) => {
        options.log.error("http.unhandled_error", "request handler threw", {requestId: c.env.request.requestId, module: c.env.request.module, errorType: errorType(error)});
        return c.json({code: "internal"}, 500);
    });
    return root;
}

/**
 * 交给 `Bun.serve` 的 `fetch`：每个请求新建它的状态，连同 `server` 作为第二个参数传下去。请求编号由这里生成，
 * 不读请求方给的 `X-Request-Id`（`site.operations` 输出 8）。
 */
export function siteFetch(app: Hono<SiteEnv>): (request: Request, server: Server<undefined>) => Response | Promise<Response> {
    return (request, server) => app.fetch(request, {server, request: {module: "site", requestId: randomUUID()}});
}
