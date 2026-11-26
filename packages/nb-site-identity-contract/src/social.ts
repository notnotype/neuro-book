/**
 * 社交登录、注册与关联的合同（docs/specs/site/accounts.md 输出 11 到 16、23、24）。上游名 `SOCIAL_PROVIDERS` 与上游身份的
 * 列表项 `IdentityItem` 在 `./account`（管理详情也用它们），落点码 `SOCIAL_ERROR_CODES` 在 `./errors`，路径在 `./paths`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {IdentityItem, RegisterRequest, type SocialProvider} from "./account";
import {ContinueToken, ExistingPassword} from "./fields";
import {IDENTITY_AUTH_PREFIX} from "./oauth";
import {strictObject} from "./schema";

const register = RegisterRequest.properties;

/**
 * `POST social/:provider/start` 的请求（输出 11、13、15），按 `intent` 分三种，每种拒收别的意图的字段：
 * - `login`：可带续接令牌。
 * - `register`：先带齐注册所需的内容，字段规则与密码注册的同名字段相同；没有邮箱与密码（邮箱回调时取上游的，账号没有密码）。
 *   可带续接令牌。
 * - `link`：要有会话；有密码的账号要带当前密码（缺了是 `validation_failed`，由服务端按账号判），没有密码的免。关联的落点是
 *   `/account`（输出 23），不回到授权请求，所以不收续接令牌。
 */
export const SocialStartRequest = Type.Union([
    strictObject({intent: Type.Literal("login"), continue: Type.Optional(ContinueToken)}),
    strictObject({
        intent: Type.Literal("register"),
        username: register.username,
        displayName: register.displayName,
        registrationCode: register.registrationCode,
        inviteCode: register.inviteCode,
        termsVersion: register.termsVersion,
        overseasStorage: register.overseasStorage,
        continue: Type.Optional(ContinueToken),
    }),
    strictObject({intent: Type.Literal("link"), currentPassword: Type.Optional(ExistingPassword)}),
]);

export type SocialStartRequest = Static<typeof SocialStartRequest>;

export type SocialIntent = SocialStartRequest["intent"];

/** 发起成功（输出 11）：浏览器要去的上游授权地址；发起起 10 分钟内有效、只能用一次（状态与转换）。 */
export const SocialStartResponse = strictObject({url: Type.String({pattern: "^https?://"})});

export type SocialStartResponse = Static<typeof SocialStartResponse>;

/** `GET me/identities`（输出 24）。 */
export const IdentityListResponse = strictObject({items: Type.Array(IdentityItem)});

export type IdentityListResponse = Static<typeof IdentityListResponse>;

/**
 * 两个上游的回调地址（`site.oauth-provider` 输出 1：`/api/identity/auth/` 下可达的地址之一）。在上游登记应用时填的就是
 * 站点地址加上它，改了要去上游重新登记。
 */
export const SOCIAL_CALLBACK_PATHS = {
    google: `${IDENTITY_AUTH_PREFIX}/callback/google`,
    github: `${IDENTITY_AUTH_PREFIX}/callback/github`,
} as const satisfies Record<SocialProvider, string>;
