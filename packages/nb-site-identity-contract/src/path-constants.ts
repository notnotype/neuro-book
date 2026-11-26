/**
 * 账号模块各接口的路径前缀与路径（`site.accounts`、`site.admin` 与 `site.oauth-provider` 输入与前置条件的接口表）。
 * 前端与合同测试按它拼地址，不另写一份。对外 OAuth 的标准端点不在这个前缀下，地址在 `./oauth`。
 *
 * 这个文件不导入 TypeBox：它经 `./constants` 进浏览器的入口块（`constants.test.ts` 检查）；路径参数的 schema 在 `./paths`。
 */

import type {SocialProvider} from "./account-constants";

/** 账号模块的全部接口挂在这个前缀下；改它等于改对外合同。下面的路径都相对它。 */
export const IDENTITY_API_PREFIX = "/api/identity/v1";

/** 不带参数的路径。 */
export const IDENTITY_PATHS = {
    register: "/register",
    login: "/login",
    logout: "/logout",
    whoami: "/whoami",
    meta: "/meta",
    me: "/me",
    mePassword: "/me/password",
    meConsent: "/me/consent",
    meSessions: "/me/sessions",
    meInviteCodes: "/me/invite-codes",
    meIdentities: "/me/identities",
    meGrants: "/me/grants",
    oauthAuthorization: "/oauth/authorization",
    adminUsers: "/admin/users",
    adminRegistrationCodes: "/admin/registration-codes",
    adminInviteCodes: "/admin/invite-codes",
    adminAudit: "/admin/audit",
    adminOAuthClients: "/admin/oauth-clients",
} as const;

/** 管理员对一个账号的处置，各是 `POST admin/users/:id/<处置>`（`site.admin` 的接口表）。 */
export const ADMIN_USER_ACTIONS = ["ban", "unban", "role", "revoke-sessions", "reset-password"] as const;

export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

/**
 * 带参数的路径。数字 id 是账号、会话、码、上游身份或授权的 id；OAuth 客户端用客户端 id（字符串，`ClientIdParams` 的写法）。
 * 客户端 id 经 `encodeURIComponent`：合写法的 id 原样不变，测试故意给的坏 id 也只落在这一段路径里。
 */
export const identityPath = {
    meSession: (id: number) => `/me/sessions/${id}`,
    meInviteCode: (id: number) => `/me/invite-codes/${id}`,
    meIdentity: (id: number) => `/me/identities/${id}`,
    meGrant: (id: number) => `/me/grants/${id}`,
    socialStart: (provider: SocialProvider) => `/social/${provider}/start`,
    adminUser: (id: number) => `/admin/users/${id}`,
    adminUserAction: (id: number, action: AdminUserAction) => `/admin/users/${id}/${action}`,
    adminRegistrationCode: (id: number) => `/admin/registration-codes/${id}`,
    adminOAuthClient: (clientId: string) => `/admin/oauth-clients/${encodeURIComponent(clientId)}`,
    adminOAuthClientRotate: (clientId: string) => `/admin/oauth-clients/${encodeURIComponent(clientId)}/rotate-secret`,
} as const;
