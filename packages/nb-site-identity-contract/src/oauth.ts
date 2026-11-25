/**
 * 对外 OAuth 服务的合同（docs/specs/site/oauth-provider.md）：标准端点与发现文档的地址、页面地址与查询参数名、确认页的接口、
 * 已给的授权、客户端的管理，以及合同测试核对用户信息与发现文档用的严格形状。失败码在 `./errors`，与账号的码共用一套错误体。
 *
 * 自家接口的路径在 `./paths`（相对 `IDENTITY_API_PREFIX`）；标准端点不在那个前缀下，地址写成从站点根起的绝对路径。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {PageQuery, PageResponse} from "./admin";
import {codePointPattern, DECIMAL_ID_PATTERN, DisplayName, Email, Id, Username} from "./fields";
import {literalUnion, strictObject} from "./schema";
import {IsoTimestamp} from "./time";

/** 标准端点与社交回调所在的前缀（输出 1：这个前缀下只有列出的地址可达）。 */
export const IDENTITY_AUTH_PREFIX = "/api/identity/auth";

/** 标准端点（输入与前置条件的端点表）。一经对外公布不再改（边界与兼容）。方法见那张表：授权收 GET 与 POST（表单）。 */
export const OAUTH_ENDPOINT_PATHS = {
    authorize: `${IDENTITY_AUTH_PREFIX}/oauth2/authorize`,
    token: `${IDENTITY_AUTH_PREFIX}/oauth2/token`,
    userinfo: `${IDENTITY_AUTH_PREFIX}/oauth2/userinfo`,
    revoke: `${IDENTITY_AUTH_PREFIX}/oauth2/revoke`,
    jwks: `${IDENTITY_AUTH_PREFIX}/jwks`,
} as const;

/** 两份内容相同的发现文档（输出 2）。 */
export const OIDC_DISCOVERY_PATHS = ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"] as const;

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

export const OAuthScopeSchema = literalUnion(OAUTH_SCOPES);

/** 一组范围：不重复。 */
const Scopes = Type.Array(OAuthScopeSchema, {uniqueItems: true});

/**
 * 客户端的名字。Spec 没写长度，这里定为 1 到 100 个码点（与字段规则一样按码点数），不去首尾空白：它显示在授权确认页与
 * “已授权的应用”里，要有个上限。
 */
export const OAUTH_CLIENT_NAME = {minLength: 1, maxLength: 100, pattern: codePointPattern(1, 100)} as const;

export const OAuthClientName = Type.String({pattern: OAUTH_CLIENT_NAME.pattern});

/** `GET oauth/authorization?request=`（输出 14）。标识被篡改或过期回 `authorization_expired`，不是 `validation_failed`，所以只要求是字符串。 */
export const OAuthAuthorizationQuery = strictObject({request: Type.String()});

export type OAuthAuthorizationQuery = Static<typeof OAuthAuthorizationQuery>;

/** 待确认的授权请求（输出 14）：客户端名字、客户端回调地址的主机名（页面写“允许后回到 <主机名>”）、要的范围。 */
export const OAuthAuthorizationResponse = strictObject({
    clientName: OAuthClientName,
    redirectHost: Type.String({minLength: 1}),
    scopes: Scopes,
});

export type OAuthAuthorizationResponse = Static<typeof OAuthAuthorizationResponse>;

/** `POST oauth/authorization`（输出 14）：同意或拒绝。 */
export const OAuthDecisionRequest = strictObject({request: Type.String(), accept: Type.Boolean()});

export type OAuthDecisionRequest = Static<typeof OAuthDecisionRequest>;

/**
 * 同意或拒绝之后跳回客户端的地址（输出 14）：同意时带授权码，拒绝时带 `access_denied`。页面把浏览器带去这里。
 * 回调地址只能是 `https://` 或本机回环的 `http://`（输入与前置条件），所以这里要求是这两种开头之一。
 */
export const OAuthDecisionResponse = strictObject({redirectUrl: Type.String({pattern: "^https?://"})});

export type OAuthDecisionResponse = Static<typeof OAuthDecisionResponse>;

/** 已给的授权的一项（输出 15）：给出的时间是同意时记下的。 */
export const GrantItem = strictObject({
    id: Id,
    clientName: OAuthClientName,
    scopes: Scopes,
    createdAt: IsoTimestamp,
});

export type GrantItem = Static<typeof GrantItem>;

/** `GET me/grants`：免确认的客户端不在列表里。 */
export const GrantListResponse = strictObject({items: Type.Array(GrantItem)});

export type GrantListResponse = Static<typeof GrantListResponse>;

/** 客户端的种类（术语“客户端”）：登记后不能改。机密的认证方式是 `client_secret_basic`，公开的是 `none`。 */
export const OAUTH_CLIENT_TYPES = ["confidential", "public"] as const;

export type OAuthClientType = (typeof OAUTH_CLIENT_TYPES)[number];

export const OAuthClientTypeSchema = literalUnion(OAUTH_CLIENT_TYPES);

/**
 * 客户端 id 的写法：服务端生成的是 32 个大小写字母，这里放宽到 1 到 64 个 URL 安全的字符，免得生成方式变了就改合同。
 * 路径里的 `:id` 不合时回 `validation_failed`、`fields: ["id"]`；合写法却不存在回 `not_found`。
 */
export const CLIENT_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";

export const ClientId = Type.String({pattern: CLIENT_ID_PATTERN});

/** `PATCH admin/oauth-clients/:id` 与 `POST admin/oauth-clients/:id/rotate-secret` 的路径参数：`:id` 是客户端 id。 */
export const ClientIdParams = strictObject({id: ClientId});

export type ClientIdParams = Static<typeof ClientIdParams>;

/**
 * 回调地址：一个客户端一到五个，每个至多 500 个码点（沿用 `site.accounts` 网址字段的上限）。schema 只管这些；
 * 按种类的规则（片段、用户信息、空白与控制字符、`https` 与本机回环）由服务端判，不合回 `redirect_uri_invalid`，
 * 不是 `validation_failed`（输入与前置条件、输出 16）。
 */
export const REDIRECT_URI = {maxLength: 500, minCount: 1, maxCount: 5} as const;

export const RedirectUri = Type.String({pattern: codePointPattern(1, REDIRECT_URI.maxLength)});

const RedirectUris = Type.Array(RedirectUri, {minItems: REDIRECT_URI.minCount, maxItems: REDIRECT_URI.maxCount});

/**
 * 客户端列表的一项（输出 16）：不含密钥。登记的时间是登记时记下的。`id` 是客户端在库里的数字 id，审计记录的对象 id 就是它
 * （`site.admin` 的审计按对象筛）；接口地址里的 `:id` 用 `clientId`。
 */
export const OAuthClientItem = strictObject({
    id: Id,
    clientId: ClientId,
    name: OAuthClientName,
    redirectUris: RedirectUris,
    type: OAuthClientTypeSchema,
    skipConsent: Type.Boolean(),
    disabled: Type.Boolean(),
    createdAt: IsoTimestamp,
});

export type OAuthClientItem = Static<typeof OAuthClientItem>;

/** `GET admin/oauth-clients`：`site.admin` 的分页参数，没有搜索与筛选（输出 16）。 */
export const OAuthClientListQuery = PageQuery;

export type OAuthClientListQuery = Static<typeof OAuthClientListQuery>;

export const OAuthClientListResponse = PageResponse(OAuthClientItem);

export type OAuthClientListResponse = Static<typeof OAuthClientListResponse>;

/** `POST admin/oauth-clients`（输出 9）：是否免确认只用于自家的应用。 */
export const CreateOAuthClientRequest = strictObject({
    name: OAuthClientName,
    redirectUris: RedirectUris,
    type: OAuthClientTypeSchema,
    skipConsent: Type.Boolean(),
});

export type CreateOAuthClientRequest = Static<typeof CreateOAuthClientRequest>;

/** 登记成功（输出 9）：机密客户端的密钥只在这里出现一次，公开客户端为 `null`。 */
export const CreateOAuthClientResponse = strictObject({client: OAuthClientItem, clientSecret: Type.Union([Type.String({minLength: 1}), Type.Null()])});

export type CreateOAuthClientResponse = Static<typeof CreateOAuthClientResponse>;

/**
 * `PATCH admin/oauth-clients/:id`（输出 16）：改名字、回调地址（按这个客户端的种类判）、是否免确认、是否停用，至少一项；
 * 空对象是 `validation_failed`、`fields: []`。种类不能改，带了就是多余的键。停用可以撤回：再启用时停用前的令牌不恢复（输出 8）。
 */
export const PatchOAuthClientRequest = strictObject(
    {
        name: Type.Optional(OAuthClientName),
        redirectUris: Type.Optional(RedirectUris),
        skipConsent: Type.Optional(Type.Boolean()),
        disabled: Type.Optional(Type.Boolean()),
    },
    {minProperties: 1},
);

export type PatchOAuthClientRequest = Static<typeof PatchOAuthClientRequest>;

/** `POST admin/oauth-clients/:id/rotate-secret`（输出 9）：新密钥只出现这一次，旧密钥立即不能用。公开客户端回 `client_public`。 */
export const RotateSecretResponse = strictObject({clientSecret: Type.String({minLength: 1})});

export type RotateSecretResponse = Static<typeof RotateSecretResponse>;

/**
 * 用户信息端点的响应（输出 7）。`sub` 总有；`preferred_username`、`name` 随 `profile` 范围，`email_pending` 随 `email` 范围，
 * 它为 `false` 时另有 `email` 与恒为 `false` 的 `email_verified`。哪些字段随哪个范围出现由合同测试逐个组合核对，schema 只管
 * “不出现别的字段”：拒收多余的键，账号设了头像也不能有 `picture`。
 */
export const UserInfoResponse = strictObject({
    sub: Type.String({pattern: DECIMAL_ID_PATTERN}),
    preferred_username: Type.Optional(Username),
    name: Type.Optional(DisplayName),
    email_pending: Type.Optional(Type.Boolean()),
    email: Type.Optional(Email),
    email_verified: Type.Optional(Type.Literal(false)),
});

export type UserInfoResponse = Static<typeof UserInfoResponse>;

/** 用户信息端点可能给出的字段（输出 7），发现文档的 `claims_supported` 由它与 `ID_TOKEN_CLAIMS` 合成。 */
export const USERINFO_CLAIMS = ["sub", "preferred_username", "name", "email_pending", "email", "email_verified"] as const;

/** id_token 载荷里的字段（输出 11）；`nonce` 只在授权请求带了它时出现。 */
export const ID_TOKEN_CLAIMS = ["iss", "sub", "aud", "iat", "exp", "auth_time", "at_hash", "acr", "nonce"] as const;

/**
 * 恰好是这组值的数组，先后不限：每项都在这组里、不重复、个数相同，就只能是这组值的一种排列。发现文档里这些字段的含义是集合，
 * 不把先后写进合同。
 */
function exactSet<const Values extends readonly string[]>(values: Values) {
    return Type.Array(literalUnion(values), {uniqueItems: true, minItems: values.length, maxItems: values.length});
}

const CLAIMS_SUPPORTED = [...new Set<string>([...USERINFO_CLAIMS, ...ID_TOKEN_CLAIMS])];

/**
 * `claims_supported`：恰好是两组字段的并集（`sub` 两边都有，只列一次）。并集不是元组，交给 `exactSet` 推出的静态类型是 `never[]`，
 * 实现方写不出合格的值；所以每项取两组字面量之一，个数按并集的大小限定，校验的含义与 `exactSet` 相同。
 */
const ClaimsSupported = Type.Array(Type.Union([literalUnion(USERINFO_CLAIMS), literalUnion(ID_TOKEN_CLAIMS)]), {uniqueItems: true, minItems: CLAIMS_SUPPORTED.length, maxItems: CLAIMS_SUPPORTED.length});

/**
 * 发现文档（输出 2）。端点地址随签发者变，只要求是字符串，“列出的都可达”由合同测试逐个请求；能力字段写死成 Spec 列的值。
 * 拒收多余的键：多出内省、动态注册、登出端点或 DPoP、`claims_parameter_supported` 的字段就不合。
 */
export const DiscoveryDocument = strictObject({
    issuer: Type.String(),
    authorization_endpoint: Type.String(),
    token_endpoint: Type.String(),
    userinfo_endpoint: Type.String(),
    jwks_uri: Type.String(),
    revocation_endpoint: Type.String(),
    response_types_supported: exactSet(["code"]),
    grant_types_supported: exactSet(["authorization_code"]),
    code_challenge_methods_supported: exactSet(["S256"]),
    token_endpoint_auth_methods_supported: exactSet(["client_secret_basic", "none"]),
    revocation_endpoint_auth_methods_supported: exactSet(["client_secret_basic", "none"]),
    scopes_supported: exactSet(OAUTH_SCOPES),
    subject_types_supported: exactSet(["public"]),
    id_token_signing_alg_values_supported: exactSet(["RS256"]),
    prompt_values_supported: exactSet(["none", "login", "consent"]),
    response_modes_supported: exactSet(["query"]),
    claims_supported: ClaimsSupported,
    authorization_response_iss_parameter_supported: Type.Literal(true),
    request_parameter_supported: Type.Literal(false),
    request_uri_parameter_supported: Type.Literal(false),
});

export type DiscoveryDocument = Static<typeof DiscoveryDocument>;
