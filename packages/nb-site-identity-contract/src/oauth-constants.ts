/**
 * 对外 OAuth 服务里不带 TypeBox 运行时的常量（docs/specs/site/oauth-provider.md）：授权流程里浏览器会到的页面与它们的查询参数名、
 * 范围、客户端名字与回调地址的规则、客户端的种类。schema 在 `./oauth`，由这里的值生成，并从那里转出。
 *
 * 这个文件不导入 TypeBox：它经 `./constants` 进浏览器的入口块（`constants.test.ts` 检查）；官方站前端按这些值读地址上的参数、
 * 画范围的文案、限登记客户端的字段。
 */

import {codePointPattern} from "./field-rules";

/**
 * 授权流程里浏览器会到的站点页面（输出 3、4、5、12）：登录页带 `continue`，站点同意页带 `continue`，授权确认页带 `request`
 * 或（客户端、回调地址不对时）`error`。
 */
export const OAUTH_PAGES = {login: "/login", siteConsent: "/consent", consent: "/oauth/consent"} as const;

/** 登录页与站点同意页地址上续接令牌的查询参数名，也是登录、注册、补交同意与社交发起的请求体里的键名。 */
export const CONTINUE_PARAM = "continue";

/** 授权确认页地址上确认标识的查询参数名，也是确认页接口的查询参数与请求体里的键名（输出 14）。 */
export const OAUTH_REQUEST_PARAM = "request";

/** 授权确认页地址上错误码的查询参数名（输出 3）。 */
export const OAUTH_ERROR_PARAM = "error";

/** 授权端点把浏览器带到 `/oauth/consent?error=<码>` 时能出现的码（输出 3）；两个都在 `IDENTITY_FAILURE_CODES` 里。 */
export const OAUTH_ERROR_PAGE_CODES = ["client_not_found", "redirect_uri_invalid"] as const;

export type OAuthErrorPageCode = (typeof OAUTH_ERROR_PAGE_CODES)[number];

/** 范围（输入与前置条件）：授权请求必须带 `openid`。页面按它取“它会得到什么”的文案。 */
export const OAUTH_SCOPES = ["openid", "profile", "email"] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * 客户端的名字。Spec 没写长度，这里定为 1 到 100 个码点（与字段规则一样按码点数），不去首尾空白：它显示在授权确认页与
 * “已授权的应用”里，要有个上限。
 */
export const OAUTH_CLIENT_NAME = {minLength: 1, maxLength: 100, pattern: codePointPattern(1, 100)} as const;

/** 客户端的种类（术语“客户端”）：登记后不能改。机密的认证方式是 `client_secret_basic`，公开的是 `none`。 */
export const OAUTH_CLIENT_TYPES = ["confidential", "public"] as const;

export type OAuthClientType = (typeof OAUTH_CLIENT_TYPES)[number];

/**
 * 回调地址：一个客户端一到五个，每个至多 500 个码点（沿用 `site.accounts` 网址字段的上限）。schema 只管这些；
 * 按种类的规则（片段、用户信息、空白与控制字符、`https` 与本机回环）由服务端判，不合回 `redirect_uri_invalid`，
 * 不是 `validation_failed`（输入与前置条件、输出 16）。
 */
export const REDIRECT_URI = {maxLength: 500, minCount: 1, maxCount: 5} as const;
