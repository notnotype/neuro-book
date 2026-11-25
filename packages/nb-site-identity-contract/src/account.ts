/**
 * 账号自己的接口的请求与响应（docs/specs/site/accounts.md）。每个 schema 的注释写它对应的输出；
 * 字段规则在 `./fields`，时间写法在 `./time`。请求都拒收多余的键（`strictObject`）。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {Bio, ContinueToken, ContinueUrl, DisplayName, Email, ExistingPassword, Id, LoginIdentifier, NewPassword, Username, UsernameInput, WebUrl} from "./fields";
import {literalUnion, nullable, strictObject} from "./schema";
import {IsoTimestamp, TermsVersion} from "./time";

/** 账号的角色（`site.admin` 术语：管理员是角色为 `admin` 的用户）。 */
export const ROLES = ["user", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const RoleSchema = literalUnion(ROLES);

/** 上游（术语“上游”）。社交登录本身归 t08，上游名在这里是因为上游身份列表与管理详情都要它。 */
export const SOCIAL_PROVIDERS = ["google", "github"] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SocialProviderSchema = literalUnion(SOCIAL_PROVIDERS);

const publicProfileProperties = {
    id: Id,
    username: Username,
    displayName: DisplayName,
    avatarUrl: nullable(WebUrl),
    website: nullable(WebUrl),
    bio: nullable(Bio),
    role: RoleSchema,
    createdAt: IsoTimestamp,
};

/** 公开资料（术语“公开资料”）：`username` 是小写的登录名，原样的写法不对外，显示由显示名承担。 */
export const PublicProfile = strictObject(publicProfileProperties);

export type PublicProfile = Static<typeof PublicProfile>;

/**
 * 密码注册（输出 1 到 3）。`displayName` 省略时取用户名；`inviteCode` 可省。两个码只要求是字符串：首尾空白
 * 由服务端去掉（字段规则表前的说明），查不到就回 `registration_code_invalid` 或 `invite_code_invalid`。`overseasStorage` 是布尔而不是
 * `true` 字面量：给 `false` 时回 `consent_required`（输出 3 把它归在同意里），不是 `validation_failed`。
 * `continue` 是续接令牌（输出 4）：合格时响应带 `continueUrl`，不合格照常注册。
 */
export const RegisterRequest = strictObject({
    username: UsernameInput,
    displayName: Type.Optional(DisplayName),
    email: Email,
    password: NewPassword,
    registrationCode: Type.String(),
    inviteCode: Type.Optional(Type.String()),
    termsVersion: TermsVersion,
    overseasStorage: Type.Boolean(),
    continue: Type.Optional(ContinueToken),
});

export type RegisterRequest = Static<typeof RegisterRequest>;

/** 注册成功（输出 1）：会话已随 `Set-Cookie` 建立。请求带的续接令牌合格时另有 `continueUrl`（输出 4）。 */
export const RegisterResponse = strictObject({user: PublicProfile, continueUrl: Type.Optional(ContinueUrl)});

export type RegisterResponse = Static<typeof RegisterResponse>;

/** 登录（输出 4）：密码只查上限；`continue` 是续接令牌，登录成功之后才解，不合格照常登录。 */
export const LoginRequest = strictObject({
    identifier: LoginIdentifier,
    password: ExistingPassword,
    continue: Type.Optional(ContinueToken),
});

export type LoginRequest = Static<typeof LoginRequest>;

/** 登录成功（输出 4）。请求带的续接令牌合格时另有 `continueUrl`，浏览器去那里回到授权请求。 */
export const LoginResponse = strictObject({user: PublicProfile, continueUrl: Type.Optional(ContinueUrl)});

export type LoginResponse = Static<typeof LoginResponse>;

/** 问身份（输出 7）的三种回答之二；账号库不可读时是 503 的 `ErrorBody`（`unavailable`）。 */
export const WhoamiResponse = Type.Union([
    strictObject({state: Type.Literal("anonymous")}),
    strictObject({state: Type.Literal("authenticated"), user: strictObject({id: Id, username: Username, role: RoleSchema})}),
]);

export type WhoamiResponse = Static<typeof WhoamiResponse>;

/**
 * 自己的资料（输出 8）：公开资料加邮箱（待补时为 `null`）、邮箱是否待补、是否有密码、是否还缺同意
 * （输出 10 的门槛）。`POST me/consent` 成功时回的 `ConsentResponse` 是它加可选的继续地址。
 */
export const MeResponse = strictObject({
    ...publicProfileProperties,
    email: nullable(Email),
    emailPending: Type.Boolean(),
    hasPassword: Type.Boolean(),
    consentRequired: Type.Boolean(),
});

export type MeResponse = Static<typeof MeResponse>;

/**
 * 改自己的资料（输出 8）：至少一项，空对象是 `validation_failed`、`fields: []`。头像、网站、签名给 `null` 清空；
 * 头像与网站另要 `isWebUrl`。用户名不能改，带了就是多余的键。
 */
export const PatchMeRequest = strictObject(
    {
        displayName: Type.Optional(DisplayName),
        email: Type.Optional(Email),
        avatarUrl: Type.Optional(nullable(WebUrl)),
        website: Type.Optional(nullable(WebUrl)),
        bio: Type.Optional(nullable(Bio)),
    },
    {minProperties: 1},
);

export type PatchMeRequest = Static<typeof PatchMeRequest>;

/**
 * 改密码或给没有密码的账号设密码（输出 9）。有密码的账号要带 `currentPassword`（缺了是 `validation_failed`，
 * 由服务端按账号判）；它只查上限，不套新密码的下限。
 */
export const ChangePasswordRequest = strictObject({
    currentPassword: Type.Optional(ExistingPassword),
    newPassword: NewPassword,
});

export type ChangePasswordRequest = Static<typeof ChangePasswordRequest>;

/**
 * 补交同意（输出 10）；版本不是当前的或 `overseasStorage` 为 `false` 回 `consent_required`。成功回 `ConsentResponse`。
 * `continue` 是站点同意页地址上的续接令牌（`site.oauth-provider` 输出 12）。
 */
export const ConsentRequest = strictObject({
    termsVersion: TermsVersion,
    overseasStorage: Type.Boolean(),
    continue: Type.Optional(ContinueToken),
});

export type ConsentRequest = Static<typeof ConsentRequest>;

/**
 * 补交同意成功：自己的资料，请求带的续接令牌合格时另有 `continueUrl`（`site.oauth-provider` 输出 12：规则同登录，
 * 但这次补交不算重新登录）。
 */
export const ConsentResponse = strictObject({...MeResponse.properties, continueUrl: Type.Optional(ContinueUrl)});

export type ConsentResponse = Static<typeof ConsentResponse>;

/** 成功而没有内容可回的接口（登出、改密码、结束会话）的响应体（输出 22）。 */
export const EmptyResponse = strictObject({});

export type EmptyResponse = Static<typeof EmptyResponse>;

/**
 * 会话列表的一项（输出 17）：最后使用时间精确到一小时以内；浏览器标识只给概要，浏览器名与系统名各一个，
 * 认不出时为 `null`。
 */
export const SessionItem = strictObject({
    id: Id,
    createdAt: IsoTimestamp,
    lastUsedAt: IsoTimestamp,
    browser: nullable(Type.String()),
    os: nullable(Type.String()),
    current: Type.Boolean(),
});

export type SessionItem = Static<typeof SessionItem>;

export const SessionListResponse = strictObject({items: Type.Array(SessionItem)});

export type SessionListResponse = Static<typeof SessionListResponse>;

/**
 * 上游身份列表的一项（输出 24）：上游账号的名字是注册或关联时记下的，只给本人看。列表 `IdentityListResponse` 在 `./social`。
 */
export const IdentityItem = strictObject({
    id: Id,
    provider: SocialProviderSchema,
    accountName: Type.String(),
    linkedAt: IsoTimestamp,
});

export type IdentityItem = Static<typeof IdentityItem>;

const inviteCodeProperties = {
    id: Id,
    code: Type.String(),
    createdAt: IsoTimestamp,
    usedCount: Type.Integer({minimum: 0}),
    maxUses: nullable(Type.Integer({minimum: 1})),
    expiresAt: nullable(IsoTimestamp),
    usable: Type.Boolean(),
};

/**
 * 自己的邀请码（输出 18）：新生成的码 `maxUses`、`expiresAt` 都为 `null`（不限次数、不过期）；旧站导入的保留原值。
 * `usable` 是“没停用、没过期、没用完”。`POST me/invite-codes` 与 `PATCH me/invite-codes/:id` 都回这一项。
 */
export const InviteCodeItem = strictObject(inviteCodeProperties);

export type InviteCodeItem = Static<typeof InviteCodeItem>;

export const InviteCodeListResponse = strictObject({items: Type.Array(InviteCodeItem)});

export type InviteCodeListResponse = Static<typeof InviteCodeListResponse>;

/** 停用自己的一个邀请码（输出 18）：只能停用，已停用的再停用照样成功。 */
export const PatchInviteCodeRequest = strictObject({disabled: Type.Literal(true)});

export type PatchInviteCodeRequest = Static<typeof PatchInviteCodeRequest>;

/** `GET meta`：当前条款版本、注册是否开放、各上游是否开放（上游的开关由 t08 接上配置）。 */
export const MetaResponse = strictObject({
    termsVersion: TermsVersion,
    registrationOpen: Type.Boolean(),
    providers: strictObject({google: Type.Boolean(), github: Type.Boolean()}),
});

export type MetaResponse = Static<typeof MetaResponse>;
