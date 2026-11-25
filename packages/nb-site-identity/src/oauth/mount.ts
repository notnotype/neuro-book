/**
 * 挂载层：库的对外端点挂在 `LIB_BASE_PATH` 下的子应用（计划 3.6；`site.oauth-provider` 输入表与输出 1）。只有
 * `LIBRARY_PUBLIC_ENDPOINTS` 里的“方法加路径”交库，其余一律 404，兜底不交库：库的管理端点、删会话与改账号的端点经站点到不了
 * （ADR 0060）。`disabledPaths` 是第二道（`auth.ts`）。
 *
 * 登记的先后就是请求经过的先后：请求体上限 → 白名单里的各路由 → 兜底 404。这一层不经来源头检查：标准端点由别的站点的客户端调，
 * Spec 不对它们要求来源。
 *
 * HEAD：Hono 把 HEAD 按 GET 分派（`c.req.method` 仍是 `HEAD`，最后去掉正文），所以 HEAD 不能单独登记，由 GET 的路由按表判：
 * 表里没有 HEAD 的端点回 404；有的（公钥）先把请求换成 GET 再进处理，因为库对 HEAD 一律 404（升级清单“对外端点的方法”一行）。
 * 换法跟着表走：表里给哪个端点加了 HEAD，它的 HEAD 就按 GET 交库。
 *
 * 交库就是 `auth.handler(请求)`：库按完整路径认端点，子应用挂在前缀下不改写地址。
 */

import {Hono, type Context, type Handler} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {SocialProvider} from "@notnotype/nb-site-identity-contract";

import {LIBRARY_PUBLIC_ENDPOINTS, type IdentityAuth} from "../auth";
import {isForeignKeyViolation} from "../db/connection";
import {failureFor, failureResponse, MAX_BODY_BYTES, respondFailure} from "../errors";
import type {IdentityLog} from "../index";

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

export interface OAuthMountOptions {
    readonly auth: IdentityAuth;
    readonly log: Pick<IdentityLog, "warn" | "error">;
    /** 开放了的社交上游：只有它们的回调地址可达（`site.accounts` 的社交回调），没开放的落到兜底 404。 */
    readonly socialProviders: readonly SocialProvider[];
}

type LibraryPath = (typeof LIBRARY_PUBLIC_ENDPOINTS)[number]["path"];
type Method = (typeof LIBRARY_PUBLIC_ENDPOINTS)[number]["methods"][number];

/** `Content-Type` 的媒体类型部分（去掉参数、小写）；没有这个头时为 null。 */
function mediaTypeOf(request: Request): string | null {
    const header = request.headers.get("content-type");
    if (header === null) return null;
    return header.split(";", 1)[0]!.trim().toLowerCase();
}

/** 标准端点的错误体（RFC 6749 第 5.2 节的形状），不许缓存。 */
function oauthError(c: Context, error: "invalid_request" | "invalid_grant"): Response {
    c.header("Cache-Control", "no-store");
    return c.json({error}, 400);
}

/** 复制一份响应再补 `Cache-Control: no-store`：库给的响应头可能是不可改的。 */
function noStore(response: Response): Response {
    const copy = new Response(response.body, response);
    copy.headers.set("Cache-Control", "no-store");
    return copy;
}

function notFound(c: Context): Response {
    return respondFailure(c, failureResponse("not_found"));
}

/**
 * 授权端点。GET 交库；POST 只收表单（`site.oauth-provider` 输出 3），别的类型与白名单外的方法一样回 404。
 *
 * 3.8 的判断与改写（参数读成同一个 `URLSearchParams`、去掉 `resource` 与 `claims`、改写库的跳转）接在这个函数里，替掉直接交库的
 * 那一行；GET 的查询串与 POST 的表单体在这里汇合。
 */
function authorizeEndpoint(auth: IdentityAuth): Handler {
    return (c) => {
        if (c.req.method === "POST" && mediaTypeOf(c.req.raw) !== FORM_MEDIA_TYPE) return notFound(c);
        return auth.handler(c.req.raw);
    };
}

/**
 * 令牌端点。只收表单：库本来也只收它（别的类型回 415，形状不是 RFC 6749 的），这里先挡，免得去 `resource` 这一步被别的编码
 * 绕过。
 *
 * 去掉 `resource` 再交库（`site.oauth-provider` 输出 6；计划 omp 设计审查第 7 条）：带了它库就发 JWT 访问令牌、不写
 * `oauthAccessToken` 行，自家撤销够不到（升级清单“允许的访问令牌都有 `oauthAccessToken` 行”）。RFC 6749 让不认识的参数被忽略，
 * 去掉它与库不认识它等价。
 *
 * 撞会话外键：库换码时先删码、再插令牌，整段不在一个事务里；两步之间会话被删时插入因外键失败，库把 `SQLiteError` 原样抛出
 * （计划问 10）。这时码已用掉、会话已不在，按“码无效”回 `invalid_grant`（升级清单“令牌端点撞会话外键”一行）。
 */
function tokenEndpoint(auth: IdentityAuth, log: OAuthMountOptions["log"]): Handler {
    return async (c) => {
        if (mediaTypeOf(c.req.raw) !== FORM_MEDIA_TYPE) return oauthError(c, "invalid_request");
        const form = new URLSearchParams(await c.req.raw.text());
        form.delete("resource");
        const headers = new Headers(c.req.raw.headers);
        // 体重新编码过，长度可能变；交给 `Request` 按新的体算。
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        const request = new Request(c.req.raw.url, {method: "POST", headers, body: form.toString()});
        try {
            return noStore(await auth.handler(request));
        } catch (error) {
            if (!isForeignKeyViolation(error)) throw error;
            log.warn("identity.oauth_token_raced", "the session behind an authorization code was removed while the code was being exchanged", {});
            return oauthError(c, "invalid_grant");
        }
    };
}

/** 用户信息与撤销：交库、不许缓存（回答里有令牌换来的资料，或针对某个令牌）。 */
function passThroughNoStore(auth: IdentityAuth): Handler {
    return async (c) => noStore(await auth.handler(c.req.raw));
}

/**
 * 公钥（HEAD 已换成 GET，正文由 Hono 去掉）。`Content-Length` 显式写上：HEAD 的回答要带与 GET 相同的头（输入表下那句），Hono
 * 去掉正文之后服务器按空体补的是 0。
 */
function jwksEndpoint(auth: IdentityAuth): Handler {
    return async (c) => {
        const response = await auth.handler(c.req.raw);
        const body = await response.arrayBuffer();
        const copy = new Response(body, response);
        copy.headers.set("Content-Length", String(body.byteLength));
        return copy;
    };
}

/** 社交回调（第 8 片接上 `social/` 的处理）：只放开放了的上游，没开放的与未知的 id 都是 404。 */
function callbackEndpoint(auth: IdentityAuth, providers: readonly SocialProvider[]): Handler {
    const open = new Set<string>(providers);
    return (c) => (open.has(c.req.param("id") ?? "") ? auth.handler(c.req.raw) : notFound(c));
}

export function createOAuthApp(options: OAuthMountOptions): Hono {
    const {auth, log} = options;
    const app = new Hono();

    // 这几个端点不要会话，谁都能发；站点没有全局上限（`Bun.serve` 缺省收到 128 MB），所以在白名单之前挡。超了回标准端点的错误体。
    app.use("*", bodyLimit({maxSize: MAX_BODY_BYTES, onError: (c) => oauthError(c, "invalid_request")}));

    // 每个对外路径一个处理；`satisfies` 让表里多了路径而这里没跟上时类型检查失败。
    const handlers = {
        "/oauth2/authorize": authorizeEndpoint(auth),
        "/oauth2/token": tokenEndpoint(auth, log),
        "/oauth2/userinfo": passThroughNoStore(auth),
        "/oauth2/revoke": passThroughNoStore(auth),
        "/jwks": jwksEndpoint(auth),
        "/callback/:id": callbackEndpoint(auth, options.socialProviders),
    } satisfies Record<LibraryPath, Handler>;

    for (const endpoint of LIBRARY_PUBLIC_ENDPOINTS) {
        const methods: readonly Method[] = endpoint.methods;
        const handler: Handler = handlers[endpoint.path];
        const allowsHead = methods.includes("HEAD");
        const routed = methods.filter((method) => method !== "HEAD");
        app.on(routed, endpoint.path, (c, next) => {
            if (c.req.method !== "HEAD") return handler(c, next);
            if (!allowsHead) return notFound(c);
            c.req.raw = new Request(c.req.raw, {method: "GET"});
            return handler(c, next);
        });
    }

    app.all("*", notFound);
    app.onError((error, c) => respondFailure(c, failureFor(error, log)));
    return app;
}
