/**
 * 授权确认页的接口：`GET`、`POST oauth/authorization`（`site.oauth-provider` 输出 14；w00037 t08 计划 3.9）。
 *
 * 确认标识是库带人去确认页时给的那段签名参数（`oauth/continue.ts`）。两个接口的先后相同：
 * 1. 要会话，受同意门槛约束（`requireSession`）。这一道不能省：库给确认页的签名参数带 `ba_pl`（发起时的会话 id），提交的会话就是
 *    它时库不再判站点同意，同一会话在打开确认页之后条款版本提高，库照样发码（计划 3.9；升级清单“确认标识带发起会话”一行）。
 * 2. 验签与 10 分钟（模块时钟），不合格 `authorization_expired`。
 * 3. 签名参数里的客户端与回调地址按授权端点的第 1 步再判（`checkClientAndRedirect`）：GET 与 POST 之间客户端可能被停用、回调地址
 *    可能被改，同意与拒绝都回这一步的码、不给跳回地址。
 *
 * 标识不绑定会话、不是一次性的（输出 14；计划“设计审查（omp）的处理”第 8 条）：它与授权请求本身等价，谁都能重新发起同一个授权
 * 请求拿到新的标识，绑定会话挡不住什么。同意或拒绝按提交时的会话算，有效期内可再次提交，再次同意时库再发一个码。
 */

import type {Context, Hono} from "hono";

import {
    IDENTITY_PATHS,
    OAUTH_SCOPES,
    OAuthAuthorizationQuery,
    OAuthDecisionRequest,
    type OAuthAuthorizationResponse,
    type OAuthDecisionResponse,
    type OAuthScope,
} from "@notnotype/nb-site-identity-contract";

import type {IdentityConnection} from "../db/connection";
import {IdentityFailure, readBody, readQuery} from "../errors";
import type {IdentityLog} from "../index";
import {requireSession} from "../middleware";
import type {Sessions} from "../session";
import {checkClientAndRedirect} from "./clients";
import {verifySignedQuery, type SignedQuery} from "./continue";
import {classifyLibraryLocation, errorPageCode, pageLocation, singleParam, type LibraryLocationOptions} from "./library-location";

/**
 * 交库的确认：`signedQuery` 是库签名的原始查询串，`cookie` 是这次请求的会话 Cookie；回库给的跳转地址。产品用库的
 * `oauth2Consent`（`module.ts`）；包内测试包一层，在“这里判完、库还没判”之间改客户端（计划 3.9 的“三步判之后、调库之前才改”）。
 */
export type ConsentDecision = (accept: boolean, signedQuery: string, cookie: string | null) => Promise<string>;

export interface OAuthConsentOptions {
    readonly sessions: Sessions;
    readonly conn: IdentityConnection;
    readonly clock: {now(): number};
    readonly log: Pick<IdentityLog, "warn">;
    /** 站点地址的 origin。 */
    readonly siteOrigin: string;
    /** 库上下文的 `secret`：验确认标识的签名。 */
    readonly secret: string;
    readonly decide: ConsentDecision;
}

const KNOWN_SCOPES: ReadonlySet<string> = new Set(OAUTH_SCOPES);

/** 签名参数里的范围。库发确认页之前已按允许的范围判过（`auth.ts` 的 `scopes`），出现别的是库与配置走样了，程序错误。 */
function scopesOf(params: URLSearchParams): OAuthScope[] {
    const scopes = new Set<OAuthScope>();
    for (const scope of (params.get("scope") ?? "").split(" ")) {
        if (scope === "") continue;
        if (!KNOWN_SCOPES.has(scope)) throw new Error("a signed authorization request carries a scope outside the allowed set");
        scopes.add(scope as OAuthScope);
    }
    return [...scopes];
}

export function registerOAuthConsentRoutes(app: Hono, options: OAuthConsentOptions): void {
    const {sessions, conn, clock, siteOrigin} = options;
    const locations: LibraryLocationOptions = {conn, log: options.log, siteOrigin};
    const path = IDENTITY_PATHS.oauthAuthorization;

    /** 先后的第 2、3 步；合格时回签名参数与客户端的名字。 */
    const open = async (token: string): Promise<{readonly query: SignedQuery; readonly clientName: string; readonly redirectUri: string}> => {
        const query = await verifySignedQuery(token, clock.now(), options.secret);
        if (query === null) throw new IdentityFailure("authorization_expired");
        const redirectUri = singleParam(query.params, "redirect_uri");
        const check = await conn.read((tx) => checkClientAndRedirect(tx, singleParam(query.params, "client_id"), redirectUri));
        if (!check.ok) throw new IdentityFailure(check.code);
        // 第 1 步合格时回调地址一定恰好一个。
        if (redirectUri === null) throw new Error("a matched authorization request has no redirect_uri");
        return {query, clientName: check.name, redirectUri};
    };

    app.get(path, async (c: Context) => {
        await requireSession(c, sessions, `GET ${path}`);
        const {request} = readQuery(c, OAuthAuthorizationQuery);
        const {query, clientName, redirectUri} = await open(request);
        // `host` 带非缺省端口（输出 14）。
        const response: OAuthAuthorizationResponse = {clientName, redirectHost: new URL(redirectUri).host, scopes: scopesOf(query.params)};
        return c.json(response);
    });

    app.post(path, async (c: Context) => {
        await requireSession(c, sessions, `POST ${path}`);
        const body = await readBody(c, OAuthDecisionRequest);
        const {query} = await open(body.request);
        const location = await options.decide(body.accept, query.signed, c.req.header("Cookie") ?? null);
        // 库在确认里重跑整套授权（同意时）或按回调地址可不可信给地址（拒绝时），给的地址与授权端点给的是同几类（升级清单“确认
        // 重跑授权”一行），一律先归类（计划 3.9）。
        const target = classifyLibraryLocation(location, siteOrigin);
        if (target.kind === "error") throw new IdentityFailure(await errorPageCode(locations, query.params, target.libraryCode));
        // 登录页与站点同意页：签名参数带 `prompt=login` 而会话早于标识、或这期间站点同意失效时库会给这两类。合同的跳回地址必须是
        // 绝对地址，站内页面也写成绝对的。
        const redirectUrl = target.kind === "other" ? target.location : `${siteOrigin}${pageLocation(target.kind, target.token)}`;
        // 跳回客户端的地址是客户端登记的回调地址，只能是 `https://` 或 `http://` 回环（`clients.ts`）；别的形状是库给了不认得的地址。
        if (!/^https?:\/\//u.test(redirectUrl)) throw new Error("the library's consent answer is not an absolute http(s) address");
        const response: OAuthDecisionResponse = {redirectUrl};
        return c.json(response);
    });
}
