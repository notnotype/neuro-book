/**
 * 假接口（t10 计划 3.10）：`page.route` 截下页面发往 `/api/` 的请求，按合同的形状回答，数据取 `fixtures/`。
 * 会话像 Cookie 那样记在这里：登录、注册成功时建起，登出时结束，`whoami`、`me` 按它回答。没准备的请求记进 `unexpected`，用例结束时断言为空，
 * 免得页面多发了请求而场景照样通过。各片接上新接口时在 `answer` 里加一支，不另写一份。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, SOCIAL_PROVIDERS, identityPath} from "@notnotype/nb-site-identity-contract";
import type {ConsentRequest, ErrorBody, LoginRequest, MetaResponse, RegisterRequest, SocialProvider, SocialStartRequest} from "@notnotype/nb-site-identity-contract";
import type {Page, Route} from "@playwright/test";

import {
    adminMe,
    anonymousWhoami,
    consentResponse,
    meta,
    registerResponse,
    socialStartResponse,
    unauthenticated,
    userLogin,
    userMe,
    userMeNeedsConsent,
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
    /** `GET meta` 的回答。 */
    meta: MetaResponse;
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

function answer(fake: FakeIdentity, method: string, pathname: string, body: unknown): FakeAnswer | undefined {
    if (method === "GET" && pathname === path(IDENTITY_PATHS.whoami)) {
        if (fake.session === undefined) return {status: 200, body: anonymousWhoami};
        const me = fake.session === "admin" ? adminMe : userMe;
        return {status: 200, body: {state: "authenticated", user: {id: me.id, username: me.username, role: me.role}}};
    }
    if (method === "GET" && pathname === path(IDENTITY_PATHS.me)) {
        if (fake.session === undefined) return {status: 401, body: unauthenticated};
        if (fake.session === "admin") return {status: 200, body: adminMe};
        return {status: 200, body: fake.consentRequired ? userMeNeedsConsent : userMe};
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
        return {status: 200, body: consentResponse};
    }
    if (method === "POST" && pathname === path(IDENTITY_PATHS.logout)) {
        fake.session = undefined;
        return {status: 200, body: {}};
    }
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
    initial: Partial<Pick<FakeIdentity, "session" | "consentRequired" | "meta" | "login" | "register" | "socialStart">> = {},
): Promise<FakeIdentity> {
    const fake: FakeIdentity = {
        session: initial.session,
        consentRequired: initial.consentRequired ?? false,
        meta: initial.meta ?? meta,
        login: initial.login ?? loginSucceeds("user"),
        register: initial.register ?? registerSucceeds(),
        socialStart: initial.socialStart ?? (() => ({status: 200, body: socialStartResponse})),
        logins: [],
        registers: [],
        consents: [],
        socialStarts: [],
        unexpected: [],
    };
    await page.route((url) => url.pathname.startsWith("/api/"), async (route: Route) => {
        const request = route.request();
        const {pathname} = new URL(request.url());
        const body = request.postData() === null ? undefined : request.postDataJSON();
        const reply = answer(fake, request.method(), pathname, body);
        if (reply === undefined) {
            fake.unexpected.push(`${request.method()} ${pathname}`);
            await route.fulfill({status: 404, json: {error: {code: "not_found"}} satisfies ErrorBody});
            return;
        }
        await route.fulfill({status: reply.status, json: reply.body, headers: {"Cache-Control": "no-store", ...reply.headers}});
    });
    return fake;
}
