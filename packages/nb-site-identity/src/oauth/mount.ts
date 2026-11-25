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
 * 交库就是 `auth.handler(请求)`：库按完整路径认端点，子应用挂在前缀下不改写地址。授权端点另有判断与改写（`authorizeEndpoint`）。
 */

import {Hono, type Context, type Handler} from "hono";
import {bodyLimit} from "hono/body-limit";

import type {SocialProvider} from "@notnotype/nb-site-identity-contract";

import {LIBRARY_PUBLIC_ENDPOINTS, type IdentityAuth} from "../auth";
import {isForeignKeyViolation, type IdentityConnection} from "../db/connection";
import {failureFor, failureResponse, MAX_BODY_BYTES, respondFailure} from "../errors";
import type {IdentityLog} from "../index";
import {checkClientAndRedirect} from "./clients";
import {errorPageLocation, rewriteLibraryLocation, singleParam, type LibraryLocationOptions} from "./library-location";

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

export interface OAuthMountOptions {
    readonly auth: IdentityAuth;
    /** 授权端点的第 1 步读客户端（`checkClientAndRedirect`）。 */
    readonly conn: IdentityConnection;
    /** 站点地址的 origin：认库的错误页与站内页面（`library-location.ts`）。 */
    readonly siteOrigin: string;
    readonly log: Pick<IdentityLog, "warn" | "error">;
    /** 开放了的社交上游：只有它们的回调地址可达（`site.accounts` 的社交回调），没开放的落到兜底 404。 */
    readonly socialProviders: readonly SocialProvider[];
}

type LibraryPath = (typeof LIBRARY_PUBLIC_ENDPOINTS)[number]["path"];
type Method = (typeof LIBRARY_PUBLIC_ENDPOINTS)[number]["methods"][number];

/** `Content-Type` 的媒体类型部分（去掉参数、小写）；没有这个头时为 null。 */
function mediaTypeOf(message: Request | Response): string | null {
    const header = message.headers.get("content-type");
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

/** 交给库的授权请求不带的参数（`authorizeEndpoint` 的第 2 点）。 */
const DROPPED_AUTHORIZE_PARAMS = ["resource", "claims"] as const;

/** 改成 GET 交库时去掉的头：体已经读成参数，不再有体。 */
const BODY_HEADERS = ["content-type", "content-length", "transfer-encoding"] as const;

/**
 * 库的授权响应要把浏览器带去哪里；不是跳转时为 null。库 1.7.27 的 `handleRedirect` 有两种形状（升级清单“授权的跳转形状”一行）：
 * 普通的请求是 302 加 `Location`；请求带 `Sec-Fetch-Mode: cors`（浏览器的 `fetch`）或 `Accept` 含 `application/json` 时是 200、
 * 体为 `{"redirect":true,"url":…}`。两种都认：只认 302 时，`fetch` 发起的授权会把库的原始地址（含它的错误页）原样带出去。
 */
async function libraryRedirectTarget(response: Response): Promise<string | null> {
    if (response.status >= 300 && response.status < 400) return response.headers.get("location");
    if (response.status !== 200 || mediaTypeOf(response) !== "application/json") return null;
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return null;
    const {redirect, url} = body as {readonly redirect?: unknown; readonly url?: unknown};
    return redirect === true && typeof url === "string" ? url : null;
}

/**
 * 授权端点（计划 3.8 的第 1、4 步；`site.oauth-provider` 输出 3 到 5）。先后：
 *
 * 1. 参数：GET 取查询串；POST 只收表单（输出 3），别的类型与白名单外的方法一样回 404，表单体读成参数（POST 时地址上的查询串
 *    不算，与库对 POST 只读体一致）。之后两种走同一套。
 * 2. 去掉 `resource` 与 `claims`（输出 3，计划 omp 设计审查第 7、15 条）：带了 `resource` 库会按它发 JWT 访问令牌、不写
 *    `oauthAccessToken` 行，自家撤销够不到（升级清单“允许的访问令牌都有 `oauthAccessToken` 行”）；`claims` 会让库按它拒绝或改
 *    id_token。RFC 6749 让不认识的参数被忽略，去掉与库不认识它等价。
 * 3. 客户端与回调地址（`checkClientAndRedirect`）：不合格时不交库、不跳回客户端，带去本站错误页。
 * 4. 以同样参数的 GET 交库。POST 也改成 GET：库对带会话 Cookie 的 POST 做来源检查，没有 `Origin` 回 403，GET 不查（授权端点的 GET
 *    本来就允许别的站点发起）；同一组参数换了方法结果不该不同（升级清单“授权的 POST”一行）。
 * 5. 库的跳转交 `rewriteLibraryLocation`，一律回 302。库以 `APIError` 做的跳转（`redirectOnError`）经 `handler` 已是普通响应，
 *    走同一条（omp 设计审查第 12 条）。库没给跳转的响应原样回。
 */
function authorizeEndpoint(options: OAuthMountOptions): Handler {
    const {auth, conn} = options;
    const locations: LibraryLocationOptions = {conn, log: options.log, siteOrigin: options.siteOrigin};
    return async (c) => {
        let params: URLSearchParams;
        if (c.req.method === "POST") {
            if (mediaTypeOf(c.req.raw) !== FORM_MEDIA_TYPE) return notFound(c);
            params = new URLSearchParams(await c.req.raw.text());
        } else {
            params = new URL(c.req.raw.url).searchParams;
        }
        for (const name of DROPPED_AUTHORIZE_PARAMS) params.delete(name);

        const check = await conn.read((tx) => checkClientAndRedirect(tx, singleParam(params, "client_id"), singleParam(params, "redirect_uri")));
        if (!check.ok) return c.redirect(errorPageLocation(check.code), 302);

        const url = new URL(c.req.raw.url);
        url.search = params.toString();
        const headers = new Headers(c.req.raw.headers);
        for (const name of BODY_HEADERS) headers.delete(name);
        const response = await auth.handler(new Request(url.href, {method: "GET", headers}));

        const target = await libraryRedirectTarget(response);
        if (target === null) return response;
        const answer = new Headers(response.headers);
        // 库的 302 也带着 JSON 的类型头；改写后的回答没有体。
        for (const name of BODY_HEADERS) answer.delete(name);
        answer.set("Location", await rewriteLibraryLocation(locations, target, params));
        return new Response(null, {status: 302, headers: answer});
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
        "/oauth2/authorize": authorizeEndpoint(options),
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
