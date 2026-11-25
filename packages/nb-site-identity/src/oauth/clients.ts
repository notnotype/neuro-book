/**
 * 对外 OAuth 客户端的回调地址规则（`site.oauth-provider` 输入一节；w00037 t08 计划 3.1、3.9，“设计审查的处理”第 3 条）。登记、
 * 改动（`admin/oauth-clients.ts`）与授权、确认（第 5 片）共用这一份。
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

import type {OAuthClientType} from "@notnotype/nb-site-identity-contract";

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
