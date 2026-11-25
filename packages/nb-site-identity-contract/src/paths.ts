/**
 * 账号模块各接口的路径，相对 `IDENTITY_API_PREFIX`（`site.accounts` 与 `site.admin` 输入与前置条件的接口表）。
 * 前端与合同测试按它拼地址，不另写一份。`me/identities`、`social/:provider/start` 与对外 OAuth 的自家接口
 * 由 t08 追加：它们的请求形状随社交登录与 OIDC 一起定。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {DECIMAL_ID_PATTERN} from "./fields";
import {strictObject} from "./schema";

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
    adminUsers: "/admin/users",
    adminRegistrationCodes: "/admin/registration-codes",
    adminInviteCodes: "/admin/invite-codes",
    adminAudit: "/admin/audit",
} as const;

/** 管理员对一个账号的处置，各是 `POST admin/users/:id/<处置>`（`site.admin` 的接口表）。 */
export const ADMIN_USER_ACTIONS = ["ban", "unban", "role", "revoke-sessions", "reset-password"] as const;

export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

/** 带 id 的路径。id 是账号、会话或码的数字 id。 */
export const identityPath = {
    meSession: (id: number) => `/me/sessions/${id}`,
    meInviteCode: (id: number) => `/me/invite-codes/${id}`,
    adminUser: (id: number) => `/admin/users/${id}`,
    adminUserAction: (id: number, action: AdminUserAction) => `/admin/users/${id}/${action}`,
    adminRegistrationCode: (id: number) => `/admin/registration-codes/${id}`,
} as const;

/**
 * 路径里的 `:id`：十进制正整数。不合时回 `validation_failed`、`fields: ["id"]`；合写法、却不存在或不是自己的
 * 回 `not_found`（`site.accounts` 失败表）。
 */
export const IdParams = strictObject({id: Type.String({pattern: DECIMAL_ID_PATTERN})});

export type IdParams = Static<typeof IdParams>;
