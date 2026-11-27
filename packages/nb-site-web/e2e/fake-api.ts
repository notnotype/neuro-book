/**
 * 假接口（t10 计划 3.10）：`page.route` 截下页面发往 `/api/` 的请求，按合同的形状回答，数据取 `fixtures/`。
 * 会话像 Cookie 那样记在这里：登录、注册成功时建起，登出时结束，`whoami`、`me` 按它回答。没准备的请求记进 `unexpected`，用例结束时断言为空，
 * 免得页面多发了请求而场景照样通过。各片接上新接口时在 `answer` 里加一支，不另写一份。
 *
 * 看板的接口（统计模块的查询接口）按路径连同查询串回答（`dashboard`），只答管理员的会话；数据取 `fixtures/dashboard.ts`。
 * 管理接口（`site.admin`）也只答管理员的会话：四个列表按查询参数从整张表里筛、切页，处置改表里的那一条，下一次 `GET` 按改过的回答。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, SOCIAL_PROVIDERS, identityPath} from "@notnotype/nb-site-identity-contract";
import type {
    AdminInviteCodeItem,
    AdminUserItem,
    AuditItem,
    ConsentRequest,
    ConsentResponse,
    ErrorBody,
    IdentityItem,
    InviteCodeItem,
    LoginRequest,
    MeResponse,
    MetaResponse,
    PatchMeRequest,
    RegisterRequest,
    RegistrationCodeItem,
    SessionItem,
    SocialProvider,
    SocialStartRequest,
} from "@notnotype/nb-site-identity-contract";
import {TELEMETRY_API_PREFIX} from "@notnotype/nb-site-telemetry-contract";
import type {Page, Route} from "@playwright/test";

import {DASHBOARD_PATHS} from "../src/pages/admin/dashboard/source";
import {
    dashboardActive,
    dashboardEmpty,
    dashboardOnline,
    dashboardProblems,
    dashboardRetention,
    dashboardSystems,
    dashboardToday,
    dashboardVersions,
} from "./fixtures/dashboard";

import {
    adminInviteCodeItems,
    adminMe,
    adminUserItems,
    anonymousWhoami,
    auditItems,
    identityList,
    inviteCodeList,
    meta,
    registerResponse,
    registrationCodeItems,
    resetPasswordResponse,
    selfForbidden,
    sessionList,
    socialStartResponse,
    unauthenticated,
    userLogin,
    userMe,
} from "./fixtures/identity";

export interface FakeAnswer {
    readonly status: number;
    readonly body: unknown;
    readonly headers?: Readonly<Record<string, string>>;
}

export type FakeRole = "user" | "admin";

export interface FakeIdentity {
    /** 浏览器带着的会话；`undefined` 是匿名。 */
    session: FakeRole | undefined;
    /** 会话还缺同意（`me` 的 `consentRequired`，只对普通用户的会话）。 */
    consentRequired: boolean;
    /** 普通用户会话的 `me`（`consentRequired` 另由上一项决定）。账号页改资料、设密码时跟着改。 */
    me: MeResponse;
    /** 账号页的三份列表；结束会话、解绑、生成与停用邀请码时跟着改，下一次 `GET` 按改过的回答。 */
    sessions: SessionItem[];
    identities: IdentityItem[];
    invites: InviteCodeItem[];
    /** 改资料的回答。缺省是成功：把请求体并进 `me`。 */
    patchMe: (body: PatchMeRequest, fake: FakeIdentity) => FakeAnswer;
    /** 解绑的回答。缺省是成功：从列表里去掉。 */
    unlink: (id: number, fake: FakeIdentity) => FakeAnswer;
    /** `GET meta` 的回答。 */
    meta: MetaResponse;
    /** 设了就等它完成再答 `GET meta`：`meta` 晚到的场景。 */
    metaArrives: Promise<void> | undefined;
    /** 登录请求的回答。缺省是成功，以普通用户登录。 */
    login: (body: LoginRequest, fake: FakeIdentity) => FakeAnswer;
    /** 注册请求的回答。缺省是成功，建起普通用户的会话。 */
    register: (body: RegisterRequest, fake: FakeIdentity) => FakeAnswer;
    /** 社交发起的回答。缺省回上游地址。 */
    socialStart: (provider: SocialProvider, body: SocialStartRequest, fake: FakeIdentity) => FakeAnswer;
    /** 收到的登录请求体，按先后。 */
    readonly logins: LoginRequest[];
    readonly registers: RegisterRequest[];
    readonly consents: ConsentRequest[];
    readonly socialStarts: {readonly provider: SocialProvider; readonly body: SocialStartRequest}[];
    /** 账号页发出的改动请求（不含读列表），`方法 路径` 与请求体，按先后。 */
    readonly accountChanges: {readonly request: string; readonly body: unknown}[];
    /**
     * 看板的接口的回答，`path` 连同查询串（`/api/telemetry/v1/series/active?days=28`）；回 `undefined` 记为没准备的请求。
     * 缺省按 `fixtures/dashboard.ts` 回答（`dashboardSucceeds`）。只在管理员的会话里调用：别的会话由假接口先回 401、403。
     */
    dashboard: (path: string, fake: FakeIdentity) => FakeAnswer | Promise<FakeAnswer> | undefined;
    /** 看板发出的请求（路径连同查询串），按先后。 */
    readonly dashboardRequests: string[];
    /** 管理面板的四张表；处置与发放跟着改。缺省是 `fixtures/identity.ts` 的那几份的副本。 */
    adminUsers: AdminUserItem[];
    registrationCodes: RegistrationCodeItem[];
    adminInvites: AdminInviteCodeItem[];
    audit: AuditItem[];
    /**
     * 管理接口的回答先问它（`request` 是 `方法 路径`，不带查询串）：回 `undefined` 时照表回答。用例在这里让某个处置失败、让列表晚到。
     */
    admin: (request: string, fake: FakeIdentity) => FakeAnswer | Promise<FakeAnswer> | undefined;
    /** 管理接口收到的请求（`方法 路径` 连同查询串）与请求体，按先后。 */
    readonly adminRequests: {readonly request: string; readonly body: unknown}[];
    /** 没准备的请求（`方法 路径`）。 */
    readonly unexpected: string[];
}

const path = (relative: string): string => `${IDENTITY_API_PREFIX}${relative}`;

/** 登录成功：建起会话。 */
export function loginSucceeds(role: FakeRole): FakeIdentity["login"] {
    return (_body, fake) => {
        fake.session = role;
        const user = role === "admin" ? {...userLogin.user, id: adminMe.id, username: adminMe.username, displayName: adminMe.displayName, role: adminMe.role} : userLogin.user;
        return {status: 200, body: {user}};
    };
}

/** 请求失败，回这个错误体；登录、注册、社交发起都能用。 */
export function fails(status: number, body: ErrorBody, headers?: Readonly<Record<string, string>>): () => FakeAnswer {
    return () => ({status, body, ...(headers === undefined ? {} : {headers})});
}

/** 登录失败，回这个错误体。 */
export const loginFails: (status: number, body: ErrorBody, headers?: Readonly<Record<string, string>>) => FakeIdentity["login"] = fails;

/** 注册成功：建起普通用户的会话（新账号的同意已交齐）。 */
export function registerSucceeds(): FakeIdentity["register"] {
    return (_body, fake) => {
        fake.session = "user";
        fake.consentRequired = false;
        return {status: 200, body: registerResponse};
    };
}

const SOCIAL_START = new Map(SOCIAL_PROVIDERS.map((provider) => [path(identityPath.socialStart(provider)), provider]));

/** 改资料成功：请求体并进 `me`，回新的 `me`。 */
export function patchMeSucceeds(): FakeIdentity["patchMe"] {
    return (body, fake) => {
        fake.me = {...fake.me, ...body} as MeResponse;
        return {status: 200, body: fake.me};
    };
}

/** 解绑成功：从列表里去掉。 */
export function unlinkSucceeds(): FakeIdentity["unlink"] {
    return (id, fake) => {
        fake.identities = fake.identities.filter((item) => item.id !== id);
        return {status: 200, body: {}};
    };
}

const notFound = {status: 404, body: {error: {code: "not_found"}} satisfies ErrorBody};

/** 看板每条请求的路径与它的回答（数据取 `fixtures/dashboard.ts`）。 */
export const DASHBOARD_BODIES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
    [DASHBOARD_PATHS.today, dashboardToday],
    [DASHBOARD_PATHS.active(7), dashboardActive[7]],
    [DASHBOARD_PATHS.active(28), dashboardActive[28]],
    [DASHBOARD_PATHS.active(90), dashboardActive[90]],
    [DASHBOARD_PATHS.online, dashboardOnline],
    [DASHBOARD_PATHS.breakdown("version"), dashboardVersions],
    [DASHBOARD_PATHS.breakdown("os"), dashboardSystems],
    [DASHBOARD_PATHS.retention, dashboardRetention],
    [DASHBOARD_PATHS.problems, dashboardProblems],
]);

/** 还没有任何上报的看板。 */
export const EMPTY_DASHBOARD_BODIES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
    [DASHBOARD_PATHS.today, dashboardEmpty.today],
    [DASHBOARD_PATHS.active(7), dashboardEmpty.active],
    [DASHBOARD_PATHS.active(28), dashboardEmpty.active],
    [DASHBOARD_PATHS.active(90), dashboardEmpty.active],
    [DASHBOARD_PATHS.online, dashboardEmpty.online],
    [DASHBOARD_PATHS.breakdown("version"), dashboardEmpty.breakdown],
    [DASHBOARD_PATHS.breakdown("os"), dashboardEmpty.breakdown],
    [DASHBOARD_PATHS.retention, dashboardEmpty.retention],
    [DASHBOARD_PATHS.problems, dashboardEmpty.problems],
]);

/** 看板的接口按 `bodies` 回答；缺省是 `fixtures/dashboard.ts` 的那一份。 */
export function dashboardSucceeds(bodies: ReadonlyMap<string, unknown> = DASHBOARD_BODIES): FakeIdentity["dashboard"] {
    return (path) => {
        const body = bodies.get(path);
        return body === undefined ? undefined : {status: 200, body};
    };
}

/** 看板的接口要在会话之后判断：统计模块先问身份（`site.telemetry-dashboard` 输出 1）。 */
function answerDashboard(fake: FakeIdentity, path: string): FakeAnswer | Promise<FakeAnswer> | undefined {
    if (fake.session === undefined) return {status: 401, body: unauthenticated};
    if (fake.session !== "admin") return {status: 403, body: {error: {code: "forbidden"}} satisfies ErrorBody};
    fake.dashboardRequests.push(path);
    return fake.dashboard(path, fake);
}

/** 列表的一页（`site.admin` 分页参数表之后一段）：按 `page`、`pageSize` 切，带回请求的基准，没带时给一个。 */
function pageOf<Item>(items: readonly Item[], query: URLSearchParams): {items: Item[]; total: number; page: number; pageSize: number; anchor: string} {
    const page = Number(query.get("page") ?? 1);
    const pageSize = Number(query.get("pageSize") ?? 20);
    return {items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, anchor: query.get("anchor") ?? "t1764151200000"};
}

const USER_FILTERS: Readonly<Record<string, (user: AdminUserItem) => boolean>> = {
    all: () => true,
    admin: (user) => user.role === "admin",
    banned: (user) => user.banned,
    email_pending: (user) => user.emailPending,
};

const CODE_FILTERS: Readonly<Record<string, (item: RegistrationCodeItem) => boolean>> = {
    all: () => true,
    usable: (item) => item.usable,
    exhausted_or_expired: (item) => !item.disabled && !item.usable,
    disabled: (item) => item.disabled,
};

function countsOf<Item>(items: readonly Item[], filters: Readonly<Record<string, (item: Item) => boolean>>): Record<string, number> {
    return Object.fromEntries(Object.entries(filters).map(([name, matches]) => [name, items.filter(matches).length]));
}

/** 管理接口（`site.admin` 的接口表）。不是管理接口时回 `undefined`。 */
async function answerAdmin(fake: FakeIdentity, method: string, pathname: string, query: URLSearchParams, body: unknown): Promise<FakeAnswer | undefined> {
    if (!pathname.startsWith(path("/admin/"))) return undefined;
    if (fake.session === undefined) return {status: 401, body: unauthenticated};
    if (fake.session !== "admin") return {status: 403, body: {error: {code: "forbidden"}} satisfies ErrorBody};
    const request = `${method} ${pathname}`;
    const search = query.toString();
    fake.adminRequests.push({request: search === "" ? request : `${request}?${search}`, body});
    const override = await fake.admin(request, fake);
    if (override !== undefined) return override;

    if (method === "GET" && pathname === path(IDENTITY_PATHS.adminUsers)) {
        const q = query.get("q")?.toLowerCase() ?? "";
        const searched = fake.adminUsers.filter((user) => q === "" || [user.username, user.displayName, user.email ?? ""].some((value) => value.toLowerCase().startsWith(q)));
        const matches = USER_FILTERS[query.get("filter") ?? "all"] ?? USER_FILTERS.all!;
        return {status: 200, body: {...pageOf(searched.filter(matches), query), counts: countsOf(searched, USER_FILTERS)}};
    }
    if (method === "GET" && pathname === path(IDENTITY_PATHS.adminRegistrationCodes)) {
        const matches = CODE_FILTERS[query.get("filter") ?? "all"] ?? CODE_FILTERS.all!;
        return {status: 200, body: {...pageOf(fake.registrationCodes.filter(matches), query), counts: countsOf(fake.registrationCodes, CODE_FILTERS)}};
    }
    if (method === "GET" && pathname === path(IDENTITY_PATHS.adminInviteCodes)) return {status: 200, body: pageOf(fake.adminInvites, query)};
    if (method === "GET" && pathname === path(IDENTITY_PATHS.adminAudit)) {
        const actor = query.get("actorId");
        const matches = (item: AuditItem): boolean =>
            (actor === null || (actor === "cli" ? item.actor === null : item.actor?.id === Number(actor)))
            && (query.get("targetType") === null || item.target.type === query.get("targetType"))
            && (query.get("targetId") === null || item.target.id === Number(query.get("targetId")))
            && (query.get("action") === null || item.action === query.get("action"));
        return {status: 200, body: pageOf(fake.audit.filter(matches), query)};
    }

    const userAction = new RegExp(`^${path("/admin/users")}/(\\d+)/([a-z-]+)$`, "u").exec(pathname);
    if (method === "POST" && userAction !== null) {
        const id = Number(userAction[1]);
        const index = fake.adminUsers.findIndex((user) => user.id === id);
        if (index < 0) return notFound;
        const action = userAction[2];
        if ((action === "ban" || action === "role") && id === adminMe.id) return {status: 409, body: selfForbidden};
        if (action === "reset-password") return {status: 200, body: resetPasswordResponse};
        const user = fake.adminUsers[index]!;
        const changed: AdminUserItem = action === "ban" ? {...user, banned: true} : action === "unban" ? {...user, banned: false} : action === "role" ? {...user, role: (body as {role: AdminUserItem["role"]}).role} : user;
        fake.adminUsers[index] = changed;
        return {status: 200, body: changed};
    }
    if (method === "POST" && pathname === path(IDENTITY_PATHS.adminRegistrationCodes)) {
        const request = body as {maxUses: number | null; expiresAt?: string | null; note?: string};
        const id = Math.max(0, ...fake.registrationCodes.map((item) => item.id)) + 1;
        const created: RegistrationCodeItem = {
            id,
            code: `NB-REG-NEW-${id}`,
            maxUses: request.maxUses,
            usedCount: 0,
            expiresAt: request.expiresAt ?? null,
            note: request.note ?? null,
            disabled: false,
            usable: true,
            createdAt: new Date().toISOString(),
            createdBy: {id: adminMe.id, username: adminMe.username},
        };
        fake.registrationCodes = [created, ...fake.registrationCodes];
        return {status: 200, body: created};
    }
    const codeId = idAfter(pathname, IDENTITY_PATHS.adminRegistrationCodes);
    if (method === "PATCH" && codeId !== undefined) {
        const index = fake.registrationCodes.findIndex((item) => item.id === codeId);
        if (index < 0) return notFound;
        const disabled = {...fake.registrationCodes[index]!, disabled: true, usable: false};
        fake.registrationCodes[index] = disabled;
        return {status: 200, body: disabled};
    }
    return undefined;
}

/** 路径末尾的数字 id：`prefix` 是 `/me/sessions` 这样不带 id 的那段。 */
function idAfter(pathname: string, prefix: string): number | undefined {
    const match = new RegExp(`^${path(prefix)}/(\\d+)$`, "u").exec(pathname);
    return match === null ? undefined : Number(match[1]);
}

/** 账号页的接口（`site.accounts` 输出 8、9、17、18、24）。只对普通用户的会话；匿名回 401。 */
function answerAccount(fake: FakeIdentity, method: string, pathname: string, body: unknown): FakeAnswer | undefined {
    const listed: Readonly<Record<string, () => unknown>> = {
        [path(IDENTITY_PATHS.meSessions)]: () => ({items: fake.sessions}),
        [path(IDENTITY_PATHS.meIdentities)]: () => ({items: fake.identities}),
        [path(IDENTITY_PATHS.meInviteCodes)]: () => ({items: fake.invites}),
    };
    const list = listed[pathname];
    const sessionId = idAfter(pathname, IDENTITY_PATHS.meSessions);
    const identityId = idAfter(pathname, IDENTITY_PATHS.meIdentities);
    const inviteId = idAfter(pathname, IDENTITY_PATHS.meInviteCodes);
    const isAccount = list !== undefined || sessionId !== undefined || identityId !== undefined || inviteId !== undefined
        || pathname === path(IDENTITY_PATHS.mePassword) || (method === "PATCH" && pathname === path(IDENTITY_PATHS.me));
    if (!isAccount) return undefined;
    if (fake.session === undefined) return {status: 401, body: unauthenticated};
    if (method === "GET" && list !== undefined) return {status: 200, body: list()};
    fake.accountChanges.push({request: `${method} ${pathname}`, body});
    if (method === "PATCH" && pathname === path(IDENTITY_PATHS.me)) return fake.patchMe(body as PatchMeRequest, fake);
    if (method === "POST" && pathname === path(IDENTITY_PATHS.mePassword)) {
        fake.me = {...fake.me, hasPassword: true};
        return {status: 200, body: {}};
    }
    if (method === "DELETE" && sessionId !== undefined) {
        if (!fake.sessions.some((item) => item.id === sessionId)) return notFound;
        fake.sessions = fake.sessions.filter((item) => item.id !== sessionId);
        return {status: 200, body: {}};
    }
    if (method === "DELETE" && identityId !== undefined) return fake.unlink(identityId, fake);
    if (method === "POST" && pathname === path(IDENTITY_PATHS.meInviteCodes)) {
        const id = Math.max(0, ...fake.invites.map((item) => item.id)) + 1;
        const created: InviteCodeItem = {id, code: `NB-NEW-${id}`, createdAt: new Date().toISOString(), usedCount: 0, maxUses: null, expiresAt: null, usable: true};
        fake.invites = [...fake.invites, created];
        return {status: 200, body: created};
    }
    if (method === "PATCH" && inviteId !== undefined) {
        const found = fake.invites.find((item) => item.id === inviteId);
        if (found === undefined) return notFound;
        const disabled = {...found, usable: false};
        fake.invites = fake.invites.map((item) => (item.id === inviteId ? disabled : item));
        return {status: 200, body: disabled};
    }
    return undefined;
}

function answer(fake: FakeIdentity, method: string, pathname: string, body: unknown): FakeAnswer | undefined {
    if (method === "GET" && pathname === path(IDENTITY_PATHS.whoami)) {
        if (fake.session === undefined) return {status: 200, body: anonymousWhoami};
        const me = fake.session === "admin" ? adminMe : fake.me;
        return {status: 200, body: {state: "authenticated", user: {id: me.id, username: me.username, role: me.role}}};
    }
    if (method === "GET" && pathname === path(IDENTITY_PATHS.me)) {
        if (fake.session === undefined) return {status: 401, body: unauthenticated};
        if (fake.session === "admin") return {status: 200, body: adminMe};
        return {status: 200, body: {...fake.me, consentRequired: fake.consentRequired}};
    }
    if (method === "GET" && pathname === path(IDENTITY_PATHS.meta)) return {status: 200, body: fake.meta};
    if (method === "POST" && pathname === path(IDENTITY_PATHS.register)) {
        const request = body as RegisterRequest;
        fake.registers.push(request);
        return fake.register(request, fake);
    }
    if (method === "POST" && pathname === path(IDENTITY_PATHS.meConsent)) {
        if (fake.session === undefined) return {status: 401, body: unauthenticated};
        fake.consents.push(body as ConsentRequest);
        fake.consentRequired = false;
        return {status: 200, body: {...fake.me, consentRequired: false} satisfies ConsentResponse};
    }
    if (method === "POST" && pathname === path(IDENTITY_PATHS.logout)) {
        fake.session = undefined;
        return {status: 200, body: {}};
    }
    const account = answerAccount(fake, method, pathname, body);
    if (account !== undefined) return account;
    const provider = SOCIAL_START.get(pathname);
    if (method === "POST" && provider !== undefined) {
        const request = body as SocialStartRequest;
        fake.socialStarts.push({provider, body: request});
        return fake.socialStart(provider, request, fake);
    }
    if (method === "POST" && pathname === path(IDENTITY_PATHS.login)) {
        const request = body as LoginRequest;
        fake.logins.push(request);
        return fake.login(request, fake);
    }
    return undefined;
}

/** 给这一页装上假接口。要在 `page.goto` 之前调用：第一个请求（`whoami`）在页面一加载就发出。 */
export async function installFakeIdentity(
    page: Page,
    initial: Partial<Pick<FakeIdentity, "session" | "consentRequired" | "me" | "meta" | "metaArrives" | "login" | "register" | "socialStart" | "sessions" | "identities" | "invites" | "patchMe" | "unlink" | "dashboard" | "adminUsers" | "registrationCodes" | "adminInvites" | "audit" | "admin">> = {},
): Promise<FakeIdentity> {
    const fake: FakeIdentity = {
        session: initial.session,
        consentRequired: initial.consentRequired ?? false,
        me: initial.me ?? userMe,
        sessions: initial.sessions ?? [...sessionList.items],
        identities: initial.identities ?? [...identityList.items],
        invites: initial.invites ?? [...inviteCodeList.items],
        patchMe: initial.patchMe ?? patchMeSucceeds(),
        unlink: initial.unlink ?? unlinkSucceeds(),
        meta: initial.meta ?? meta,
        metaArrives: initial.metaArrives,
        login: initial.login ?? loginSucceeds("user"),
        register: initial.register ?? registerSucceeds(),
        socialStart: initial.socialStart ?? (() => ({status: 200, body: socialStartResponse})),
        logins: [],
        registers: [],
        consents: [],
        socialStarts: [],
        accountChanges: [],
        dashboard: initial.dashboard ?? dashboardSucceeds(),
        dashboardRequests: [],
        adminUsers: initial.adminUsers ?? [...adminUserItems],
        registrationCodes: initial.registrationCodes ?? [...registrationCodeItems],
        adminInvites: initial.adminInvites ?? [...adminInviteCodeItems],
        audit: initial.audit ?? [...auditItems],
        admin: initial.admin ?? (() => undefined),
        adminRequests: [],
        unexpected: [],
    };
    await page.route((url) => url.pathname.startsWith("/api/"), async (route: Route) => {
        const request = route.request();
        const {pathname, search} = new URL(request.url());
        const body = request.postData() === null ? undefined : request.postDataJSON();
        if (request.method() === "GET" && pathname === path(IDENTITY_PATHS.meta) && fake.metaArrives !== undefined) await fake.metaArrives;
        const dashboard = request.method() === "GET" && pathname.startsWith(`${TELEMETRY_API_PREFIX}/`);
        const reply = dashboard
            ? await answerDashboard(fake, `${pathname}${search}`)
            : ((await answerAdmin(fake, request.method(), pathname, new URLSearchParams(search), body)) ?? answer(fake, request.method(), pathname, body));
        if (reply === undefined) {
            fake.unexpected.push(`${request.method()} ${pathname}${search}`);
            await route.fulfill({status: 404, json: {error: {code: "not_found"}} satisfies ErrorBody});
            return;
        }
        await route.fulfill({status: reply.status, json: reply.body, headers: {"Cache-Control": "no-store", ...reply.headers}});
    });
    return fake;
}
