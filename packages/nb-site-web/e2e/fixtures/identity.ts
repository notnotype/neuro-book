/**
 * 假接口回答的账号模块数据（t10 计划 3.10“假接口的数据”）。每份用合同类型 `satisfies` 写，写错形状时类型检查失败；
 * `tests/e2e-fixtures.test.ts` 再用合同的 schema 把 `IDENTITY_FIXTURES` 里的每份过一遍 `Value.Check`（类型查不出的：用户名、
 * 时间的格式这类 pattern）。形状由合同保证，行为由真实冒烟（B10）保证。
 */

import {
    ConsentResponse,
    ErrorBody,
    IdentityListResponse,
    InviteCodeListResponse,
    LoginResponse,
    MeResponse,
    MetaResponse,
    RegisterResponse,
    SessionListResponse,
    SocialStartResponse,
    WhoamiResponse,
} from "@notnotype/nb-site-identity-contract";
import type {TSchema} from "typebox";

export const anonymousWhoami = {state: "anonymous"} satisfies WhoamiResponse;

export const userMe = {
    id: 7,
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    website: null,
    bio: null,
    role: "user",
    createdAt: "2026-11-01T00:00:00.000Z",
    email: "alice@example.com",
    emailPending: false,
    hasPassword: true,
    consentRequired: false,
} satisfies MeResponse;

export const adminMe = {...userMe, id: 1, username: "root", displayName: "Root", role: "admin"} satisfies MeResponse;

export const userWhoami = {state: "authenticated", user: {id: userMe.id, username: userMe.username, role: userMe.role}} satisfies WhoamiResponse;

export const userLogin = {
    user: {
        id: userMe.id,
        username: userMe.username,
        displayName: userMe.displayName,
        avatarUrl: null,
        website: null,
        bio: null,
        role: userMe.role,
        createdAt: userMe.createdAt,
    },
} satisfies LoginResponse;

export const meta = {termsVersion: "2026-11-01", registrationOpen: true, providers: {google: true, github: true}} satisfies MetaResponse;

/** 缺同意的普通用户（条款换了版本之后）：守卫把他留在同意页。 */
export const userMeNeedsConsent = {...userMe, consentRequired: true} satisfies MeResponse;

/** 注册成功：新账号的公开资料。 */
export const registerResponse = {user: {...userLogin.user, id: 8, username: "bob", displayName: "Bob", createdAt: "2026-11-26T10:00:00.000Z"}} satisfies RegisterResponse;

/** 补交同意成功：自己的资料，已不缺同意。 */
export const consentResponse = {...userMe} satisfies ConsentResponse;

/** 社交发起成功：上游的授权地址（假接口场景里浏览器不真的过去，由 `page.route` 截下）。 */
export const socialStartResponse = {url: "https://github.com/login/oauth/authorize?client_id=nb-site-test&state=s1"} satisfies SocialStartResponse;

/** 上游注册、还没补邮箱的普通用户（t09 第 8、11 条）：账号页的资料一节显示“待补”。 */
export const userMeWithoutEmail = {...userMe, email: null, emailPending: true} satisfies MeResponse;

/** 账号页“已登录的设备”：这台设备一个，别的两个（其中一个认不出浏览器与系统）。 */
export const sessionList = {
    items: [
        {id: 1, createdAt: "2026-11-20T08:00:00.000Z", lastUsedAt: "2026-11-26T10:00:00.000Z", browser: "Chrome", os: "Windows", current: true},
        {id: 2, createdAt: "2026-11-19T08:00:00.000Z", lastUsedAt: "2026-11-25T09:00:00.000Z", browser: "Safari", os: "iOS", current: false},
        {id: 3, createdAt: "2026-11-18T08:00:00.000Z", lastUsedAt: "2026-11-24T09:00:00.000Z", browser: null, os: null, current: false},
    ],
} satisfies SessionListResponse;

/** 账号页“登录与安全”：关联了 GitHub，没关联 Google。 */
export const identityList = {items: [{id: 21, provider: "github", accountName: "alice-writes", linkedAt: "2026-11-02T00:00:00.000Z"}]} satisfies IdentityListResponse;

/** 账号页“邀请码”：旧站导入的一个（有次数与过期时间）、新生成的一个、停用了的一个。 */
export const inviteCodeList = {
    items: [
        {id: 31, code: "NB-7K2M-Q9", createdAt: "2026-11-10T00:00:00.000Z", usedCount: 1, maxUses: 3, expiresAt: "2026-12-24T00:00:00.000Z", usable: true},
        {id: 32, code: "NB-4H8T-X3", createdAt: "2026-11-12T00:00:00.000Z", usedCount: 0, maxUses: null, expiresAt: null, usable: true},
        {id: 33, code: "NB-2P6W-L5", createdAt: "2026-11-01T00:00:00.000Z", usedCount: 2, maxUses: null, expiresAt: null, usable: false},
    ],
} satisfies InviteCodeListResponse;

export const usernameTaken = {error: {code: "username_taken"}} satisfies ErrorBody;

export const invalidCredentials = {error: {code: "invalid_credentials"}} satisfies ErrorBody;
export const rateLimited = {error: {code: "rate_limited"}} satisfies ErrorBody;
export const unauthenticated = {error: {code: "unauthenticated"}} satisfies ErrorBody;

/** 合同 schema 的检查清单：上面每一份都要在这里。 */
export const IDENTITY_FIXTURES: readonly {readonly name: string; readonly schema: TSchema; readonly value: unknown}[] = [
    {name: "anonymousWhoami", schema: WhoamiResponse, value: anonymousWhoami},
    {name: "userWhoami", schema: WhoamiResponse, value: userWhoami},
    {name: "userMe", schema: MeResponse, value: userMe},
    {name: "adminMe", schema: MeResponse, value: adminMe},
    {name: "userLogin", schema: LoginResponse, value: userLogin},
    {name: "meta", schema: MetaResponse, value: meta},
    {name: "userMeNeedsConsent", schema: MeResponse, value: userMeNeedsConsent},
    {name: "registerResponse", schema: RegisterResponse, value: registerResponse},
    {name: "consentResponse", schema: ConsentResponse, value: consentResponse},
    {name: "socialStartResponse", schema: SocialStartResponse, value: socialStartResponse},
    {name: "userMeWithoutEmail", schema: MeResponse, value: userMeWithoutEmail},
    {name: "sessionList", schema: SessionListResponse, value: sessionList},
    {name: "identityList", schema: IdentityListResponse, value: identityList},
    {name: "inviteCodeList", schema: InviteCodeListResponse, value: inviteCodeList},
    {name: "usernameTaken", schema: ErrorBody, value: usernameTaken},
    {name: "invalidCredentials", schema: ErrorBody, value: invalidCredentials},
    {name: "rateLimited", schema: ErrorBody, value: rateLimited},
    {name: "unauthenticated", schema: ErrorBody, value: unauthenticated},
];
