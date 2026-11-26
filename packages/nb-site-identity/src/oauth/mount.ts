/**
 * 挂载层：库的对外端点挂在 `LIB_BASE_PATH` 下的子应用（计划 3.6；`site.oauth-provider` 输入表与输出 1）。只有
 * `LIBRARY_PUBLIC_ENDPOINTS` 里的“方法加路径”交库，其余一律 404，兜底不交库：库的管理端点、删会话与改账号的端点经站点到不了
 * （ADR 0060）。`disabledPaths` 是第二道（`auth.ts`）。
 *
 * 登记的先后就是请求经过的先后：路径写法 → 请求体上限 → 白名单里的各路由 → 兜底 404。这一层不经来源头检查：标准端点由别的站点的
 * 客户端调，Spec 不对它们要求来源。
 *
 * 路径写法：Hono 按 `decodeURI` 之后的路径匹配路由，交库的却是原样的请求地址，库按没解码的那一条认端点。路径里有能解码的百分号
 * 编码时（`/oauth2/%61uthorize`），两边看到的不是同一条路径，白名单判的就不是库收到的“方法加路径”，所以原样的与解码后的不相等
 * 时一律 404、不交库（计划“实现审查（第 4 到 7 片）的处理”第 1 条）。`%2F` 与 `%25` 不被 Hono 解码，两边相同，照常落到兜底 404。
 *
 * HEAD：Hono 把 HEAD 按 GET 分派（`c.req.method` 仍是 `HEAD`，最后去掉正文），所以 HEAD 不能单独登记，由 GET 的路由按表判：
 * 表里没有 HEAD 的端点回 404；有的（公钥）先把请求换成 GET 再进处理，因为库对 HEAD 一律 404（升级清单“对外端点的方法”一行）。
 * 换法跟着表走：表里给哪个端点加了 HEAD，它的 HEAD 就按 GET 交库。
 *
 * 交库就是 `auth.handler(请求)`：库按完整路径认端点，子应用挂在前缀下不改写地址。授权端点另有判断与改写（`authorizeEndpoint`）。
 */

import {Hono, type Context, type Handler} from "hono";
import {bodyLimit} from "hono/body-limit";

import {USERINFO_CLAIMS, type SocialProvider} from "@notnotype/nb-site-identity-contract";

import {LIBRARY_PUBLIC_ENDPOINTS, type IdentityAuth} from "../auth";
import {isForeignKeyViolation, type IdentityConnection} from "../db/connection";
import {failureFor, failureResponse, MAX_BODY_BYTES, respondFailure} from "../errors";
import type {IdentityLog} from "../index";
import type {Sessions} from "../session";
import type {SocialCallback} from "../social/callback";
import {authorizeErrorRedirect, libraryAuthorizeParams, rejectedAuthorizeParameter, requestedMaxAgeSeconds} from "./authorize-request";
import {checkClientAndRedirect} from "./clients";
import {errorPageLocation, rewriteLibraryLocation, singleParam, type LibraryLocationOptions} from "./library-location";

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

export interface OAuthMountOptions {
    readonly auth: IdentityAuth;
    /** 授权端点的第 1 步读客户端（`checkClientAndRedirect`）。 */
    readonly conn: IdentityConnection;
    /** 授权端点的第 3 步按模块的时钟读会话、判 `max_age`。 */
    readonly sessions: Sessions;
    readonly clock: {now(): number};
    /** 站点地址的 origin：认库的错误页与站内页面（`library-location.ts`），也是第 2 步跳回时带的 `iss`。 */
    readonly siteOrigin: string;
    readonly log: Pick<IdentityLog, "warn" | "error">;
    /**
     * 社交回调：只有开放了的上游的回调地址可达（`site.accounts` 的社交回调），没开放的与未知的 id 落到 404。`callback` 是
     * `social/callback.ts` 的处理，由它交库。
     */
    readonly social: {readonly providers: readonly SocialProvider[]; readonly callback: SocialCallback};
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
 * 授权端点（计划 3.8；`site.oauth-provider` 输出 3 到 5、12、13）。先后：
 *
 * 1. 参数：GET 取查询串；POST 只收表单（输出 3），别的类型与白名单外的方法一样回 404，表单体读成参数（POST 时地址上的查询串
 *    不算，与库对 POST 只读体一致）。之后两种走同一套。
 * 2. 客户端与回调地址（`checkClientAndRedirect`）：不合格时不交库、不跳回客户端，带去本站错误页。
 * 3. 合同要拒、不能交库判的参数（`authorize-request.ts` 的 `rejectedAuthorizeParameter`）：回调地址已核对，自己拼地址跳回客户端。
 * 4. 会话（模块的时钟）：读不出有效会话，或带了 `max_age` 而会话建立以来已超过它时，去掉请求的 `Cookie` 头再交库，让库当作没有
 *    会话、带人去登录页。库自己也判这两样，但按系统时间：合同测试拨的是模块的时钟，库判不出模块里已到期的会话与超时的
 *    `max_age`（升级清单“max_age 按系统时间”一行）。读会话时到期要清的 Cookie 随回答发出。缺站点同意不在这里判，交库的
 *    `postLogin`（`auth.ts`）。
 * 5. 只把认得的参数交库（`libraryAuthorizeParams`；`resource` 与 `claims` 不在其中）：带了 `resource` 库会按它发 JWT 访问令牌、
 *    不写 `oauthAccessToken` 行，自家撤销够不到（升级清单“允许的访问令牌都有 `oauthAccessToken` 行”）；`claims` 会让库按它拒绝
 *    或改 id_token（计划 omp 设计审查第 7、15 条）。以同样参数的 GET 交库。POST 也改成 GET：库对带会话 Cookie 的 POST 做来源检查，
 *    没有 `Origin` 回 403，GET 不查（授权端点的 GET 本来就允许别的站点发起）；同一组参数换了方法结果不该不同（升级清单“授权的
 *    POST”一行）。
 * 6. 库的跳转交 `rewriteLibraryLocation`，一律回 302。库以 `APIError` 做的跳转（`redirectOnError`）经 `handler` 已是普通响应，
 *    走同一条（omp 设计审查第 12 条）。库没给跳转的响应原样回。
 */
function authorizeEndpoint(options: OAuthMountOptions): Handler {
    const {auth, conn, sessions, clock, siteOrigin} = options;
    const locations: LibraryLocationOptions = {conn, log: options.log, siteOrigin};
    return async (c) => {
        let params: URLSearchParams;
        let rawLength: number;
        if (c.req.method === "POST") {
            if (mediaTypeOf(c.req.raw) !== FORM_MEDIA_TYPE) return notFound(c);
            const body = await c.req.raw.text();
            rawLength = body.length;
            params = new URLSearchParams(body);
        } else {
            const {search, searchParams} = new URL(c.req.raw.url);
            // `search` 带开头的 `?`，没有查询串时是空串。
            rawLength = Math.max(0, search.length - 1);
            params = searchParams;
        }

        const redirectUri = singleParam(params, "redirect_uri");
        const check = await conn.read((tx) => checkClientAndRedirect(tx, singleParam(params, "client_id"), redirectUri));
        if (!check.ok) return c.redirect(errorPageLocation(check.code), 302);
        // 第 1 步合格时回调地址一定恰好一个。
        if (redirectUri === null) throw new Error("a matched authorization request has no redirect_uri");

        const rejection = rejectedAuthorizeParameter(rawLength, params);
        if (rejection !== null) return c.redirect(authorizeErrorRedirect(redirectUri, rejection, singleParam(params, "state"), siteOrigin), 302);

        const headers = new Headers(c.req.raw.headers);
        for (const name of BODY_HEADERS) headers.delete(name);
        const {session, cookies} = await sessions.read(headers.get("cookie"), "use");
        const maxAge = requestedMaxAgeSeconds(params);
        if (session === null || (maxAge !== null && clock.now() - session.createdAtMs > maxAge * 1000)) headers.delete("cookie");

        const kept = libraryAuthorizeParams(params);
        const url = new URL(c.req.raw.url);
        url.search = kept.toString();
        const response = await auth.handler(new Request(url.href, {method: "GET", headers}));

        const target = await libraryRedirectTarget(response);
        if (target === null) return response;
        const answer = new Headers(response.headers);
        // 库的 302 也带着 JSON 的类型头；改写后的回答没有体。
        for (const name of BODY_HEADERS) answer.delete(name);
        answer.set("Location", await rewriteLibraryLocation(locations, target, kept));
        for (const cookie of cookies) answer.append("Set-Cookie", cookie);
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
 * 带 `DPoP` 头回 `invalid_request`、不交库（输出 6）：站点不支持 DPoP（发现文档不列它），库却有自己的 DPoP 处理，交库后结果由库
 * 定，不在合同里。在判表单类型之后：不是表单的请求不论带不带这个头都是同一个回答。
 *
 * 撞会话外键：库换码时先删码、再插令牌，整段不在一个事务里；两步之间会话被删时插入因外键失败，库把 `SQLiteError` 原样抛出
 * （计划问 10）。这时码已用掉、会话已不在，按“码无效”回 `invalid_grant`（升级清单“令牌端点撞会话外键”一行）。
 */
function tokenEndpoint(auth: IdentityAuth, log: OAuthMountOptions["log"]): Handler {
    return async (c) => {
        if (mediaTypeOf(c.req.raw) !== FORM_MEDIA_TYPE) return oauthError(c, "invalid_request");
        if (c.req.raw.headers.has("dpop")) return oauthError(c, "invalid_request");
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

const USERINFO_FIELDS: ReadonlySet<string> = new Set(USERINFO_CLAIMS);

/**
 * 库给的用户信息按输出 7 滤一遍：只留合同的字段（库另给 `picture`、`given_name` 之类，升级清单“用户信息的字段”一行）；
 * `email_verified` 恒为 `false`，不取库的 `emailVerified` 列（站点不验证邮箱，社交登录时库会把上游的验证结果写进那一列，计划问 11）；
 * `email_pending` 为真时去掉 `email` 与 `email_verified`。
 */
function filterUserInfo(claims: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(claims)) if (USERINFO_FIELDS.has(name)) kept[name] = value;
    if ("email_verified" in kept) kept.email_verified = false;
    if (kept.email_pending === true) {
        delete kept.email;
        delete kept.email_verified;
    }
    return kept;
}

/** `WWW-Authenticate` 里的一个质询（RFC 7235 第 4.1 节）：方案名与它的参数，参数保留库写的原文（`name=value` 或 `name="…"`）。 */
interface Challenge {
    readonly scheme: string;
    readonly params: string[];
}

/** RFC 7230 的 token 字符。 */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const AUTH_PARAM = new RegExp(`^(${TOKEN})\\s*=\\s*(?:${TOKEN}|"(?:[^"\\\\]|\\\\.)*")$`, "u");
const CHALLENGE_START = new RegExp(`^(${TOKEN})(?:\\s+(.+))?$`, "su");

/**
 * 按 RFC 7235 的结构拆 `WWW-Authenticate`：逗号既分质询也分参数，所以先在引号之外按逗号切开，再看每一段是参数（`name=value`，
 * 归前一个质询）还是新质询的开头（方案名，后面可以跟着它的第一个参数）。有一段两样都不是（例如 token68 写法、引号没闭合）时
 * 回 null，由调用方按认不出处理。
 */
function parseChallenges(header: string): Challenge[] | null {
    const parts: string[] = [];
    let current = "";
    let quoted = false;
    let escaped = false;
    for (const char of header) {
        if (escaped) escaped = false;
        else if (quoted && char === "\\") escaped = true;
        else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (quoted) return null;
    parts.push(current);

    const challenges: Challenge[] = [];
    for (const raw of parts) {
        const part = raw.trim();
        // RFC 7230 的列表写法允许空的元素（`Bearer, , DPoP`）。
        if (part === "") continue;
        if (AUTH_PARAM.test(part)) {
            const last = challenges.at(-1);
            if (last === undefined) return null;
            last.params.push(part);
            continue;
        }
        const start = CHALLENGE_START.exec(part);
        if (start === null) return null;
        const [, scheme, first] = start;
        if (first !== undefined && !AUTH_PARAM.test(first.trim())) return null;
        challenges.push({scheme: scheme!, params: first === undefined ? [] : [first.trim()]});
    }
    return challenges;
}

/** RFC 6750 第 3.1 节的错误码：DPoP 质询里的 `error` 只有这几个能原样挪进 `Bearer` 质询。 */
const BEARER_ERRORS: ReadonlySet<string> = new Set(["invalid_request", "invalid_token", "insufficient_scope"]);

/**
 * 用户信息 401 的 `WWW-Authenticate` 只留 `Bearer` 质询（失败与恢复一节；目标与非目标：不支持 DPoP 绑定的令牌，不能对外宣告
 * DPoP）。库 1.7.27 对不带令牌的请求给 `Bearer, DPoP algs="…"`，对以 `DPoP` 方案带令牌的请求只给 `DPoP error="…", …` 质询
 * （升级清单“用户信息的字段”一行）。有 `Bearer` 质询时原样留它和它的参数（`error`、`error_description`）；没有时补一个，从被
 * 去掉的质询里挪 RFC 6750 的 `error` 与它的 `error_description`。认不出结构时只给 `Bearer`、记一行 warn。
 */
function bearerChallengeOnly(header: string, log: OAuthMountOptions["log"]): string {
    const challenges = parseChallenges(header);
    if (challenges === null) {
        log.warn("identity.oauth_userinfo_challenge_unparsed", "the library's WWW-Authenticate on userinfo could not be parsed; answering with a bare Bearer challenge", {});
        return "Bearer";
    }
    const bearer = challenges.find((challenge) => challenge.scheme.toLowerCase() === "bearer");
    if (bearer !== undefined) return [bearer.scheme, bearer.params.join(", ")].filter((piece) => piece !== "").join(" ");
    const borrowed = challenges.map((challenge) => challenge.params).find((params) => params.some((param) => BEARER_ERRORS.has(paramValue(param, "error") ?? "")));
    const kept = borrowed?.filter((param) => paramValue(param, "error") !== null || paramValue(param, "error_description") !== null) ?? [];
    return kept.length === 0 ? "Bearer" : `Bearer ${kept.join(", ")}`;
}

/** 参数原文是 `name` 时回它的值（去掉引号与转义）；名字不同时为 null。 */
function paramValue(param: string, name: string): string | null {
    const match = AUTH_PARAM.exec(param);
    if (match === null || match[1]!.toLowerCase() !== name) return null;
    const value = param.slice(param.indexOf("=") + 1).trim();
    return value.startsWith('"') ? value.slice(1, -1).replaceAll(/\\(.)/gsu, "$1") : value;
}

/**
 * 用户信息端点：交库，200 的 JSON 按 `filterUserInfo` 滤过再回；401 的 `WWW-Authenticate` 只留 `Bearer` 质询（`bearerChallengeOnly`），
 * 库没给这个头时补上 `Bearer`（失败与恢复一节的 RFC 6750；库 1.7.27 都带着，补的一步防库改了这一处）。都不许缓存：回答里有令牌
 * 换来的资料。
 */
function userInfoEndpoint(auth: IdentityAuth, log: OAuthMountOptions["log"]): Handler {
    return async (c) => {
        const response = await auth.handler(c.req.raw);
        if (response.status === 200) {
            if (mediaTypeOf(response) !== "application/json") throw new Error("the library's userinfo answer is not JSON");
            const body: unknown = await response.json();
            if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("the library's userinfo answer is not a JSON object");
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.set("Cache-Control", "no-store");
            return new Response(JSON.stringify(filterUserInfo(body as Record<string, unknown>)), {status: 200, headers});
        }
        const answer = noStore(response);
        if (response.status === 401) answer.headers.set("WWW-Authenticate", bearerChallengeOnly(answer.headers.get("www-authenticate") ?? "Bearer", log));
        return answer;
    };
}

/** 表单里能证明客户端身份的参数（库 1.7.27 的 `CLIENT_AUTHENTICATION_FIELDS`）。 */
const CLIENT_CREDENTIAL_FIELDS = ["client_secret", "client_assertion", "client_assertion_type"] as const;

/**
 * 客户端认证参数的形状不合格：库 1.7.27 认证客户端之前（`normalizeClientAuthenticationParameters`）对这几种回 400
 * `invalid_request`。判法照库，宽了窄了都会让模块与库对同一个请求给出不同的回答：只数非空的值；`client_id` 与表单里的凭据都不能
 * 出现多次；带 `Authorization` 头（不论哪种方案）时表单里不能再有凭据；密钥与断言不能并存。
 */
function malformedClientAuthentication(form: URLSearchParams, authorization: string | null): boolean {
    const present = (name: string) => form.getAll(name).filter((value) => value !== "").length;
    if (["client_id", ...CLIENT_CREDENTIAL_FIELDS].some((name) => present(name) > 1)) return true;
    const hasSecret = present("client_secret") > 0;
    const hasAssertion = present("client_assertion") > 0 || present("client_assertion_type") > 0;
    const hasHeader = authorization !== null && authorization !== "";
    return (hasHeader && (hasSecret || hasAssertion)) || (hasSecret && hasAssertion);
}

/**
 * 撤销端点：交库、不许缓存。请求带了恰好一个非空的 `token`、库回 400 且 `error` 是 `invalid_request` 时改成 200 空体：库对查不到
 * 的令牌（不存在、已撤销）这样回，输出 10 与 RFC 7009 要 200（计划问 3 实测；只按码认，不看说明文字；升级清单“撤销的回应”
 * 一行）。别的客户端的令牌库本来就回 200、不撤。不带 `token`（或它是空串）库也回 `invalid_request`，这一种原样回（输出 10）。
 *
 * 库在认证客户端之前判认证参数的形状，不合格的也回 `invalid_request`（`malformedClientAuthentication`）。这种请求的客户端根本没
 * 认证，改写会把它说成撤销成功，所以交库之前自己判、回 400 `invalid_request` 而不交库；改写只对过了这一步的请求（计划“实现审查
 * （第 4 到 7 片）的处理”第 2 条）。
 *
 * 读表单用请求的副本，交库的仍是原请求；不是表单的请求不读，原样交库。
 */
function revokeEndpoint(auth: IdentityAuth): Handler {
    return async (c) => {
        const form = mediaTypeOf(c.req.raw) === FORM_MEDIA_TYPE ? new URLSearchParams(await c.req.raw.clone().text()) : null;
        if (form !== null && malformedClientAuthentication(form, c.req.raw.headers.get("authorization"))) return oauthError(c, "invalid_request");
        const tokens = form?.getAll("token") ?? [];
        const response = await auth.handler(c.req.raw);
        if (tokens.length === 1 && tokens[0] !== "" && response.status === 400 && (await libraryErrorCode(response)) === "invalid_request") {
            return new Response(null, {status: 200, headers: {"Cache-Control": "no-store"}});
        }
        return noStore(response);
    };
}

/** 库的 OAuth 错误体里的 `error`；不是 JSON 或没有这一项时为 null。读的是副本，原响应还能原样回。 */
async function libraryErrorCode(response: Response): Promise<string | null> {
    if (mediaTypeOf(response) !== "application/json") return null;
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return null;
    const {error} = body as {readonly error?: unknown};
    return typeof error === "string" ? error : null;
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

/** 社交回调：只放开放了的上游，没开放的与未知的 id 都是 404（库自己接任意 id）。 */
function callbackEndpoint(social: OAuthMountOptions["social"]): Handler {
    return (c) => {
        const id = c.req.param("id");
        const provider = social.providers.find((candidate) => candidate === id);
        return provider === undefined ? notFound(c) : social.callback(c, provider);
    };
}

export function createOAuthApp(options: OAuthMountOptions): Hono {
    const {auth, log} = options;
    const app = new Hono();

    // 路径写法（文件头）：子应用经 `route` 挂在前缀下，`c.req.path` 是解码后的完整路径，与原样的 pathname 同一个起点。
    app.use("*", async (c, next) => {
        if (new URL(c.req.raw.url).pathname !== c.req.path) return notFound(c);
        await next();
    });

    // 这几个端点不要会话，谁都能发；站点没有全局上限（`Bun.serve` 缺省收到 128 MB），所以在白名单之前挡。超了回标准端点的错误体。
    app.use("*", bodyLimit({maxSize: MAX_BODY_BYTES, onError: (c) => oauthError(c, "invalid_request")}));

    // 每个对外路径一个处理；`satisfies` 让表里多了路径而这里没跟上时类型检查失败。
    const handlers = {
        "/oauth2/authorize": authorizeEndpoint(options),
        "/oauth2/token": tokenEndpoint(auth, log),
        "/oauth2/userinfo": userInfoEndpoint(auth, log),
        "/oauth2/revoke": revokeEndpoint(auth),
        "/jwks": jwksEndpoint(auth),
        "/callback/:id": callbackEndpoint(options.social),
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
