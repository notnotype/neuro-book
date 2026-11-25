/**
 * 对外 OAuth 客户端的回调地址规则（`site.oauth-provider` 输入一节；w00037 t08 计划 3.1、3.9，“设计审查的处理”第 3 条）。登记、
 * 改动（`admin/oauth-clients.ts`）与授权、确认（`checkClientAndRedirect`）共用这一份。
 *
 * 为什么自己判、不交给库：库登记时的 `validateClientRedirectUri` 放过自定义协议（`com.example.app:/cb`）和带空白的地址，Spec
 * 不许；库的改动接口只许客户端的登记者改，管理员之间互改走自家 SQL，那一路库根本不判。所以这里是每个入口的第一道，规则只能比库
 * 严、不能比库宽：比库宽的地址登记时被库拒收，回 `redirect_uri_invalid` 并记 `identity.oauth_client_rule_drift`
 * （`admin/oauth-clients.ts`）；改动时没有库这一道，登记进去的地址授权时被库带去它的错误页。“比库严”由包内用例逐格对照库的
 * 结果守着（`clients.test.ts`），升级清单“回调地址的两套规则”一行。
 *
 * 公开客户端的 `http` 地址按原始写法里的主机判，不按 `new URL` 归一化后的：库也这样判（`getRawHttpHostname`），`127.1`、
 * `0x7f.1` 归一化后都是 `127.0.0.1`，库照样拒收。
 */

import type {OAuthClientType, OAuthErrorPageCode} from "@notnotype/nb-site-identity-contract";

import type {IdentityTx} from "../db/connection";

/** 空白与控制字符：库的 `z.url()` 放过路径里的空格与制表符，Spec 不许。 */
const WHITESPACE_OR_CONTROL = /[\p{White_Space}\p{Cc}]/u;

/** 协议与 `//` 之后、路径或查询之前的一段（与库取原始主机的写法相同：不在 `\` 处断开）。 */
const AUTHORITY = /^(https?):\/\/([^/?#]*)/iu;

/** 公开客户端许用 `http` 的三个主机，按原始写法小写后逐字比。 */
const PUBLIC_HTTP_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** `new URL` 归一化后的 IPv4 写法（四段十进制）；`127.0.0.0/8` 看第一段。 */
const IPV4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

/** IPv4 映射的 IPv6（`[::ffff:127.0.0.1]` 归一化成 `[::ffff:7f00:1]`）：映射的是 `127.0.0.0/8` 时也是回环，库同样认。 */
const MAPPED_LOOPBACK = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u;

/**
 * 归一化后的主机是不是本机回环：`127.0.0.0/8`、`[::1]`、`localhost`。`localhost.` 这类带结尾点的也算（库对它直接拒收）；
 * `app.localhost` 不算，库也不算。
 */
function isLoopbackHost(hostname: string): boolean {
    if (hostname.replace(/\.+$/u, "") === "localhost") return true;
    if (hostname === "[::1]" || MAPPED_LOOPBACK.test(hostname)) return true;
    return IPV4.exec(hostname)?.[1] === "127";
}

/** 原始写法里的主机（去掉端口，方括号的 IPv6 保留括号），小写。 */
function rawHost(authority: string): string {
    if (authority.startsWith("[")) {
        const end = authority.indexOf("]");
        return end < 0 ? authority.toLowerCase() : authority.slice(0, end + 1).toLowerCase();
    }
    return (authority.split(":")[0] ?? "").toLowerCase();
}

/**
 * 回调地址合不合这个种类的规则。都不含片段、用户信息、空白与控制字符；机密客户端只许主机不是回环的 `https`；公开客户端另许
 * 主机恰为 `127.0.0.1`、`[::1]`、`localhost` 的 `http`（端口任意），不许 `https` 的回环与自定义协议。
 */
export function checkRedirectUri(uri: string, type: OAuthClientType): boolean {
    if (WHITESPACE_OR_CONTROL.test(uri) || uri.includes("#")) return false;
    const parts = AUTHORITY.exec(uri);
    const url = URL.parse(uri);
    if (parts === null || url === null) return false;
    const scheme = parts[1] ?? "";
    const authority = parts[2] ?? "";
    // 用户信息看原始写法里有没有 `@`：`https://@a.example/` 的用户信息是空的，`new URL` 的 `username` 读不出它。
    if (authority.includes("@")) return false;
    if (scheme.toLowerCase() === "https") return !isLoopbackHost(url.hostname);
    return type === "public" && PUBLIC_HTTP_HOSTS.has(rawHost(authority));
}

/** `oauthClient.redirectUris` 列是库写的 JSON 数组文本；不是字符串数组时是数据被别的写法改过，程序错误。 */
export function redirectUrisOf(text: string): string[] {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("oauthClient.redirectUris is not a JSON array of strings");
    return value as string[];
}

/**
 * `http` 回环地址去掉端口后的写法；不是 `http` 回环、或端口不是数字时为 undefined。照库的 `stripLoopbackRedirectPort` 写：按原始
 * 写法切出主机与端口，只去掉端口那一段，其余逐字保留（`localhost` 与 `127.0.0.1` 去掉端口后仍不相等）。
 */
function withoutLoopbackPort(uri: string): string | undefined {
    const url = URL.parse(uri);
    if (url === null || url.protocol !== "http:" || !isLoopbackHost(url.hostname)) return undefined;
    const parts = AUTHORITY.exec(uri);
    if (parts === null) return undefined;
    const authority = parts[2] ?? "";
    const authorityStart = (parts[0] ?? "").length - authority.length;
    let portStart: number;
    if (authority.startsWith("[")) {
        const end = authority.indexOf("]");
        if (end < 0) return undefined;
        if (authority[end + 1] !== ":") return uri;
        portStart = end + 1;
    } else {
        portStart = authority.lastIndexOf(":");
        if (portStart < 0) return uri;
    }
    if (!/^\d*$/u.test(authority.slice(portStart + 1))) return undefined;
    return `${uri.slice(0, authorityStart + portStart)}${uri.slice(authorityStart + authority.length)}`;
}

/**
 * 请求的回调地址与登记的某一个相等，照库 1.7.27 的 `findRegisteredRedirectUri`：带片段（含末尾一个 `#`）或用户信息的都不算；逐字
 * 相等；不是 `web` 的客户端（公开客户端登记为 `native`）的 `http` 回环地址去掉端口后相等也算（RFC 8252；开发者 2026-11-25 确认）。
 * 规则与库同一份，库在授权的第 1 步之后就不会因为回调地址带人去它的错误页（升级清单“授权的客户端与回调地址”一行）。
 */
function matchesRegistered(registered: readonly string[], requested: string, isWebClient: boolean): boolean {
    const url = URL.parse(requested);
    if (url === null || requested.includes("#") || url.username !== "" || url.password !== "") return false;
    const requestedWithoutPort = isWebClient ? undefined : withoutLoopbackPort(requested);
    return registered.some((uri) => uri === requested || (requestedWithoutPort !== undefined && withoutLoopbackPort(uri) === requestedWithoutPort));
}

/** 授权请求的客户端与回调地址合格时带客户端的名字（确认页要显示），不合格时带错误页的码（`site.oauth-provider` 输出 3）。 */
export type ClientCheck = {readonly ok: true; readonly name: string} | {readonly ok: false; readonly code: OAuthErrorPageCode};

interface ClientMatchRow {
    readonly name: string | null;
    readonly disabled: number | null;
    readonly redirectUris: string;
    readonly applicationType: string | null;
}

/**
 * 授权的第 1 步（计划 3.8；确认页接口 3.9 也用）：没有这个客户端或它停用了是 `client_not_found`，回调地址与登记的都不匹配是
 * `redirect_uri_invalid`。参数缺了（null）按不合格算。自家 SQL 读 `oauthClient`，不经库：这样判出的码不随库的错误页变。
 */
export function checkClientAndRedirect(tx: IdentityTx, clientId: string | null, redirectUri: string | null): ClientCheck {
    if (clientId === null) return {ok: false, code: "client_not_found"};
    const row = tx
        .query<ClientMatchRow, [string]>(`SELECT "name" AS name, "disabled" AS disabled, "redirectUris" AS redirectUris, "applicationType" AS applicationType FROM "oauthClient" WHERE "clientId" = ?`)
        .get(clientId);
    if (row === null || row.disabled === 1) return {ok: false, code: "client_not_found"};
    if (redirectUri === null || !matchesRegistered(redirectUrisOf(row.redirectUris), redirectUri, row.applicationType === "web")) return {ok: false, code: "redirect_uri_invalid"};
    // 名字由登记接口按合同包的规则写入，没有名字是数据被别的写法改过。
    if (row.name === null) throw new Error("oauthClient.name is empty");
    return {ok: true, name: row.name};
}
