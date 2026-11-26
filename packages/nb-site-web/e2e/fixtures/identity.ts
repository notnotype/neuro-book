/**
 * 假接口回答的账号模块数据（t10 计划 3.10“假接口的数据”）。每份用合同类型 `satisfies` 写，写错形状时类型检查失败；
 * `tests/e2e-fixtures.test.ts` 再用合同的 schema 把 `IDENTITY_FIXTURES` 里的每份过一遍 `Value.Check`（类型查不出的：用户名、
 * 时间的格式这类 pattern）。形状由合同保证，行为由真实冒烟（B10）保证。
 */

import {ConsentResponse, ErrorBody, LoginResponse, MeResponse, MetaResponse, RegisterResponse, SocialStartResponse, WhoamiResponse} from "@notnotype/nb-site-identity-contract";
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
    {name: "usernameTaken", schema: ErrorBody, value: usernameTaken},
    {name: "invalidCredentials", schema: ErrorBody, value: invalidCredentials},
    {name: "rateLimited", schema: ErrorBody, value: rateLimited},
    {name: "unauthenticated", schema: ErrorBody, value: unauthenticated},
];
