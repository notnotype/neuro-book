/**
 * 库给的跳转地址归类与改写（w00037 t08 计划 3.8 第 4 步；`site.oauth-provider` 输出 3 到 5、12、14）。授权端点（`oauth/mount.ts`）
 * 与确认页接口（`oauth/consent-api.ts`）用同一份：库在确认里会重跑整套授权，给的地址与授权端点给的是同几类。
 *
 * 库 1.7.27 给的几类地址（升级清单“库的跳转地址”一行）：
 * - 登录页、站点同意页（`postLogin`）、确认页：配置的页面路径（`auth.ts`，站内相对地址）加 `?<签名参数>`；
 * - 它的错误页：`<站点地址><LIB_BASE_PATH>/error?error=<码>&error_description=…`，前端不认这个地址；
 * - 跳回客户端：客户端的回调地址带码或带错误。
 *
 * 前三类包成续接令牌或确认标识（`oauth/continue.ts`），错误页换成本站的 `/oauth/consent?error=<码>`，跳回客户端的原样。
 */

import {CONTINUE_PARAM, OAUTH_ERROR_PARAM, OAUTH_PAGES, OAUTH_REQUEST_PARAM, type OAuthErrorPageCode} from "@notnotype/nb-site-identity-contract";

import {LIB_BASE_PATH} from "../auth";
import type {IdentityConnection} from "../db/connection";
import type {IdentityLog} from "../index";
import {checkClientAndRedirect} from "./clients";
import {continueTokenFromLibraryRedirect} from "./continue";

/** 库的错误页的路径（`getErrorURL` 用 `baseURL` 加 `/error`；`onAPIError.errorURL` 没配）。 */
const LIBRARY_ERROR_PATH = `${LIB_BASE_PATH}/error`;

/** 站内三类页面：浏览器去这里，页面带着令牌或标识调自家接口。 */
export type PageKind = "login" | "site-consent" | "consent";

export type LibraryLocation =
    | {readonly kind: PageKind; readonly token: string}
    | {readonly kind: "error"; readonly libraryCode: string | null}
    /** 跳回客户端，或不认得的地址：原样。 */
    | {readonly kind: "other"; readonly location: string};

const PAGE_PATHS: ReadonlyMap<string, PageKind> = new Map([
    [OAUTH_PAGES.login, "login"],
    [OAUTH_PAGES.siteConsent, "site-consent"],
    [OAUTH_PAGES.consent, "consent"],
]);

/**
 * 库的错误码到本站错误页的码（计划 3.8 第 4 步）。第 1 步与库判的是同一份客户端与回调地址规则，所以第 1 步之后再到这里多半是
 * 两步之间客户端被改了；按库的码分开两种。不在表里的码（库因别的原因给了错误页）一律 `client_not_found` 并记一行：说明库多了
 * 一种第 1 步没判的情况，要看是不是该在第 1 步或第 2 步补判。
 */
const LIBRARY_ERROR_CODES: ReadonlyMap<string, OAuthErrorPageCode> = new Map([
    ["invalid_client", "client_not_found"],
    ["client_disabled", "client_not_found"],
    ["unauthorized_client", "client_not_found"],
    ["invalid_redirect", "redirect_uri_invalid"],
    ["invalid_request", "redirect_uri_invalid"],
]);

/** 按路径归类库给的地址（相对地址按站点地址解析）。站内页面要带签名（`sig`）才算库的跳转，否则原样。 */
export function classifyLibraryLocation(location: string, siteOrigin: string): LibraryLocation {
    const url = URL.parse(location, siteOrigin);
    if (url === null || url.origin !== siteOrigin) return {kind: "other", location};
    if (url.pathname === LIBRARY_ERROR_PATH) return {kind: "error", libraryCode: url.searchParams.get("error")};
    const page = PAGE_PATHS.get(url.pathname);
    const token = page === undefined || !url.searchParams.has("sig") ? null : continueTokenFromLibraryRedirect(location);
    if (page === undefined || token === null) return {kind: "other", location};
    return {kind: page, token};
}

/** 站内页面的地址：登录页与站点同意页带续接令牌，确认页带确认标识。 */
export function pageLocation(kind: PageKind, token: string): string {
    const query = new URLSearchParams({[kind === "consent" ? OAUTH_REQUEST_PARAM : CONTINUE_PARAM]: token});
    const path = kind === "login" ? OAUTH_PAGES.login : kind === "site-consent" ? OAUTH_PAGES.siteConsent : OAUTH_PAGES.consent;
    return `${path}?${query}`;
}

/** 本站错误页的地址（输出 3）。 */
export function errorPageLocation(code: OAuthErrorPageCode): string {
    return `${OAUTH_PAGES.consent}?${new URLSearchParams({[OAUTH_ERROR_PARAM]: code})}`;
}

/** 参数恰好出现一次时的值；没有或重复时为 null（重复的 `client_id`、`redirect_uri` 取哪一个都是猜，按不合格算）。 */
export function singleParam(params: URLSearchParams, name: string): string | null {
    const values = params.getAll(name);
    return values.length === 1 ? values[0]! : null;
}

export interface LibraryLocationOptions {
    readonly conn: IdentityConnection;
    readonly log: Pick<IdentityLog, "warn">;
    /** 站点地址的 origin：库的错误页与站内页面都在它下面。 */
    readonly siteOrigin: string;
}

/**
 * 库给了错误页时本站错误页的码：先按 `query` 里的客户端与回调地址重判第 1 步（这期间客户端被停用、回调地址被改时与第 1 步判出
 * 的码相同；确认时库对拒绝一律给 `access_denied`，也靠这一步分得出），合格时按库的码查表（`LIBRARY_ERROR_CODES`）。
 */
export async function errorPageCode(options: LibraryLocationOptions, query: URLSearchParams, libraryCode: string | null): Promise<OAuthErrorPageCode> {
    const check = await options.conn.read((tx) => checkClientAndRedirect(tx, singleParam(query, "client_id"), singleParam(query, "redirect_uri")));
    if (!check.ok) return check.code;
    const mapped = libraryCode === null ? undefined : LIBRARY_ERROR_CODES.get(libraryCode);
    if (mapped !== undefined) return mapped;
    // 只记库的码：`error_description` 与请求参数里可能有客户端给的文字。
    options.log.warn("identity.oauth_library_error_page", "the library sent the browser to its error page for a reason the authorization checks did not cover", {libraryCode});
    return "client_not_found";
}

/**
 * 计划 3.8 第 4 步的改写：库给的地址换成浏览器该去的地址。`query` 是交给库的那组授权参数，库给错误页时按它重判（`errorPageCode`）。
 */
export async function rewriteLibraryLocation(options: LibraryLocationOptions, location: string, query: URLSearchParams): Promise<string> {
    const target = classifyLibraryLocation(location, options.siteOrigin);
    if (target.kind === "other") return target.location;
    if (target.kind === "error") return errorPageLocation(await errorPageCode(options, query, target.libraryCode));
    return pageLocation(target.kind, target.token);
}
