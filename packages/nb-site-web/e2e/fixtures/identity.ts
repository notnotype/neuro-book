/**
 * 假接口回答的账号模块数据（t10 计划 3.10“假接口的数据”）。每份用合同类型 `satisfies` 写，写错形状时类型检查失败；
 * `tests/e2e-fixtures.test.ts` 再用合同的 schema 把 `IDENTITY_FIXTURES` 里的每份过一遍 `Value.Check`（类型查不出的：用户名、
 * 时间的格式这类 pattern）。形状由合同保证，行为由真实冒烟（B10）保证。管理面板的几份是整张表的条目，`fake-api.ts` 按查询参数从里面切页。
 */

import {
    AdminInviteCodeItem,
    AdminUserItem,
    AUDIT_ACTIONS,
    AuditItem,
    ConsentResponse,
    ErrorBody,
    IdentityListResponse,
    InviteCodeListResponse,
    LoginResponse,
    MeResponse,
    MetaResponse,
    RegisterResponse,
    RegistrationCodeItem,
    ResetPasswordResponse,
    SessionListResponse,
    SocialStartResponse,
    WhoamiResponse,
} from "@notnotype/nb-site-identity-contract";
import {Type} from "typebox";
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

/**
 * 管理面板的账号列表（`fake-api.ts` 按查询参数从里面切页、筛选、搜索）：150 个，8 页，多于 7 页时分页条是 7 格（t09 第 12 条），
 * 最后一页 10 条。第 1 个是当前登录的管理员 root（`adminMe`），另有 2 个管理员；每 7 个里一个已封禁，每 11 个里一个邮箱待补。
 */
export const adminUserItems = Array.from({length: 150}, (_, index): AdminUserItem => {
    const id = index + 1;
    if (id === adminMe.id) return {id, username: adminMe.username, displayName: adminMe.displayName, email: adminMe.email, emailPending: false, role: "admin", banned: false, createdAt: adminMe.createdAt, lastLoginAt: "2026-11-26T09:00:00.000Z"};
    const pending = id % 11 === 0;
    return {
        id,
        username: `writer${String(id).padStart(3, "0")}`,
        displayName: `作者 ${id}`,
        email: pending ? null : `writer${id}@example.com`,
        emailPending: pending,
        role: id === 2 || id === 3 ? "admin" : "user",
        banned: id % 7 === 0,
        createdAt: new Date(Date.UTC(2026, 9, 1 + (id % 50), 8)).toISOString(),
        lastLoginAt: id % 13 === 0 ? null : new Date(Date.UTC(2026, 10, 1 + (id % 25), 8)).toISOString(),
    };
}) satisfies AdminUserItem[];

/** 注册码：45 个，3 页。每 9 个里一个已停用，每 10 个里一个已用完，带备注的是一半。 */
export const registrationCodeItems = Array.from({length: 45}, (_, index): RegistrationCodeItem => {
    const id = index + 1;
    const disabled = id % 9 === 0;
    const exhausted = id % 10 === 0;
    return {
        id,
        code: `NB-REG-${String(1000 + id)}`,
        maxUses: id % 3 === 0 ? null : 5,
        usedCount: exhausted ? 5 : id % 4,
        expiresAt: id % 4 === 0 ? "2027-03-31T15:59:59.999Z" : null,
        note: id % 2 === 0 ? `第 ${id} 批内测` : null,
        disabled,
        usable: !disabled && !exhausted,
        createdAt: new Date(Date.UTC(2026, 10, 1 + (id % 25), 8)).toISOString(),
        createdBy: id % 5 === 0 ? null : {id: adminMe.id, username: adminMe.username},
    };
}) satisfies RegistrationCodeItem[];

/** 全站的邀请码：12 个，一页；有一个找不到主人。 */
export const adminInviteCodeItems = Array.from({length: 12}, (_, index): AdminInviteCodeItem => {
    const id = index + 1;
    return {
        id,
        code: `NB-INV-${String(2000 + id)}`,
        createdAt: new Date(Date.UTC(2026, 10, 1 + id, 8)).toISOString(),
        usedCount: id % 3,
        maxUses: null,
        expiresAt: null,
        usable: id % 5 !== 0,
        owner: id === 4 ? null : {id: 10 + id, username: `writer${String(10 + id).padStart(3, "0")}`},
    };
}) satisfies AdminInviteCodeItem[];

/** 审计记录：60 条，3 页，动作轮着来；每 8 条里一条是命令行做的。 */
export const auditItems = Array.from({length: 60}, (_, index): AuditItem => {
    const id = 60 - index;
    const action = AUDIT_ACTIONS[index % AUDIT_ACTIONS.length]!;
    const targetType = action.startsWith("registration_code") ? "registration_code" : action.startsWith("oauth_client") ? "oauth_client" : "user";
    return {
        id,
        createdAt: new Date(Date.UTC(2026, 10, 26, 9, 0) - index * 3_600_000).toISOString(),
        actor: index % 8 === 0 ? null : {id: adminMe.id, username: adminMe.username},
        action,
        target: {type: targetType, id: 10 + (index % 20)},
        params: action === "user.role" ? {from: "user", to: "admin"} : action === "user.revoke_sessions" ? {sessions: 3} : action === "registration_code.create" ? {maxUses: 5, expiresAt: null} : {},
    };
}) satisfies AuditItem[];

/** 重置密码成功：新密码只在这一次回答里。 */
export const resetPasswordResponse = {password: "Kq7-vT2m-Rw9x"} satisfies ResetPasswordResponse;

export const notFound = {error: {code: "not_found"}} satisfies ErrorBody;
export const selfForbidden = {error: {code: "self_forbidden"}} satisfies ErrorBody;

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
    {name: "adminUserItems", schema: Type.Array(AdminUserItem), value: adminUserItems},
    {name: "registrationCodeItems", schema: Type.Array(RegistrationCodeItem), value: registrationCodeItems},
    {name: "adminInviteCodeItems", schema: Type.Array(AdminInviteCodeItem), value: adminInviteCodeItems},
    {name: "auditItems", schema: Type.Array(AuditItem), value: auditItems},
    {name: "resetPasswordResponse", schema: ResetPasswordResponse, value: resetPasswordResponse},
    {name: "notFound", schema: ErrorBody, value: notFound},
    {name: "selfForbidden", schema: ErrorBody, value: selfForbidden},
];
