/**
 * 账号模块的失败码与错误体（docs/specs/site/accounts.md 的失败表与输出 22、23；docs/specs/site/admin.md 的失败表）。
 * 码只追加、不改已有码的含义（两份 Spec 的“边界与兼容”）。对外 OAuth 自家接口的码（`authorization_expired` 等）
 * 随 t08 追加在本文件里，不另起一套错误体。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {literalUnion, strictObject} from "./schema";

/**
 * 失败表里有 HTTP 状态的全部码：`site.accounts` 的加上 `site.admin` 另有的 `forbidden`、`self_forbidden`。
 * 社交与关联的几个（`provider_disabled`、`identity_taken`、`identity_exists`、`last_login_method`）由 t08 实现，
 * 现在就列着：前端的文案目录要遍历全部码。运行时数组：服务端、合同测试与前端按它穷尽。
 */
export const IDENTITY_FAILURE_CODES = [
    "validation_failed",
    "unauthenticated",
    "invalid_credentials",
    "account_banned",
    "forbidden_origin",
    "consent_required",
    "registration_closed",
    "provider_disabled",
    "registration_code_invalid",
    "invite_code_invalid",
    "username_taken",
    "email_taken",
    "identity_taken",
    "identity_exists",
    "last_login_method",
    "invite_code_limit",
    "rate_limited",
    "overloaded",
    "unavailable",
    "not_found",
    "internal",
    "forbidden",
    "self_forbidden",
] as const;

export type IdentityFailureCode = (typeof IDENTITY_FAILURE_CODES)[number];

/**
 * 每个码的 HTTP 状态（两份 Spec 的失败表）。模块的出错出口与合同测试都按它取状态，不各写一份。
 * `invalid_credentials` 与 `unauthenticated` 同为 401：调用方按码分支，不按状态（只有后者表示会话没了）。
 */
export const IDENTITY_FAILURE_STATUS = {
    validation_failed: 400,
    unauthenticated: 401,
    invalid_credentials: 401,
    account_banned: 403,
    forbidden_origin: 403,
    consent_required: 403,
    registration_closed: 403,
    provider_disabled: 403,
    registration_code_invalid: 422,
    invite_code_invalid: 422,
    username_taken: 409,
    email_taken: 409,
    identity_taken: 409,
    identity_exists: 409,
    last_login_method: 409,
    invite_code_limit: 409,
    rate_limited: 429,
    overloaded: 503,
    unavailable: 503,
    not_found: 404,
    internal: 500,
    forbidden: 403,
    self_forbidden: 409,
} as const satisfies Record<IdentityFailureCode, number>;

/**
 * 社交流程没完成时，浏览器被带回站点的页面上 `social_error` 查询参数能出现的码（`site.accounts` 输出 23）：
 * 失败表里标“跳转参数”的三个，加上四个也能以 HTTP 失败出现的码。由 t08 实现，前端现在就按它备文案。
 */
export const SOCIAL_ERROR_CODES = [
    "social_not_registered",
    "social_email_missing",
    "social_state_invalid",
    "email_taken",
    "identity_taken",
    "identity_exists",
    "account_banned",
] as const;

export type SocialErrorCode = (typeof SOCIAL_ERROR_CODES)[number];

/** 落点页上带码的查询参数名（输出 23）。 */
export const SOCIAL_ERROR_PARAM = "social_error";

type CodeWithoutFields = Exclude<IdentityFailureCode, "validation_failed">;

const CODES_WITHOUT_FIELDS = IDENTITY_FAILURE_CODES.filter((code): code is CodeWithoutFields => code !== "validation_failed");

/**
 * 失败的响应体（`site.accounts` 输出 22）：只有 `error.code`；`validation_failed` 另带 `fields`，是不合规则的字段名，
 * 也就是请求体或查询串里的键名（请求体太大、不是 JSON 或不是对象时为空数组），别的码不带它。
 * 各层都拒收多余的键：合同测试用它核对响应里没有给人看的文字、堆栈与内部路径。
 */
export const ErrorBody = Type.Union([
    strictObject({error: strictObject({code: Type.Literal("validation_failed"), fields: Type.Array(Type.String())})}),
    strictObject({error: strictObject({code: literalUnion(CODES_WITHOUT_FIELDS)})}),
]);

export type ErrorBody = Static<typeof ErrorBody>;
