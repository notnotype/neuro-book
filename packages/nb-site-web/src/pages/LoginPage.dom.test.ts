/**
 * 登录页（`LoginPage.vue`）：装起整个站点（`startSite`，真实的路由、守卫、接口层与当前账号），账号服务的回答由注入的 `fetch`
 * 按路径给出，时间由手动时钟推进。断言的是用户看得到的：字段是否标红、焦点、状态行的字、按钮能不能点、最后停在哪一页。
 * 量位置的验收（状态行出现与消失时字段不动、格线与卡片对齐）要真实布局，在 `e2e/login.e2e.ts`。
 */

import {IDENTITY_API_PREFIX, IDENTITY_PATHS, SOCIAL_PROVIDERS, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {
    ErrorBody,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MetaResponse,
    SocialProvider,
    SocialStartRequest,
    SocialStartResponse,
    WhoamiResponse,
} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createMemoryHistory} from "vue-router";

import zhCN from "../locales/zh-CN.json";
import {startSite} from "../site";
import type {Site} from "../site";
import {manualClock} from "../testing/manual-clock";
import type {ManualClock} from "../testing/manual-clock";

const WHOAMI = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.whoami}`;
const ME = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.me}`;
const LOGIN = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.login}`;
const META = `${IDENTITY_API_PREFIX}${IDENTITY_PATHS.meta}`;
const SOCIAL_START = new Map(SOCIAL_PROVIDERS.map((provider) => [`${IDENTITY_API_PREFIX}${identityPath.socialStart(provider)}`, provider]));

const OPEN_META: MetaResponse = {termsVersion: "2026-11-01", registrationOpen: true, providers: {google: true, github: true}};
const upstreamUrl = (provider: SocialProvider): string => `https://${provider}.example/authorize?state=s1`;

type Role = MeResponse["role"];

function me(role: Role): MeResponse {
    return {
        id: 7,
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        website: null,
        bio: null,
        role,
        createdAt: "2026-11-01T00:00:00.000Z",
        email: "alice@example.com",
        emailPending: false,
        hasPassword: true,
        consentRequired: false,
    };
}

const failure = (body: ErrorBody, status: number, headers?: HeadersInit): Response => Response.json(body, {status, headers});

/**
 * 账号服务：`session` 是浏览器带着的会话（登录成功时由 `login` 建起来，像 `Set-Cookie` 那样）；`login` 决定登录请求的回答。
 * 没准备的路径记进 `unexpected`，每条用例结束时断言为空。
 */
interface Server {
    session: Role | undefined;
    login: (body: LoginRequest, server: Server) => Response;
    meta: () => Response;
    socialStart: (provider: SocialProvider, body: SocialStartRequest) => Response;
}

/** 登录成功：建起会话，回公开资料。 */
const succeedAs = (role: Role) => (_body: LoginRequest, server: Server): Response => {
    server.session = role;
    const {email: _email, emailPending: _pending, hasPassword: _hasPassword, consentRequired: _consent, ...profile} = me(role);
    return Response.json({user: profile} satisfies LoginResponse);
};

interface Started {
    readonly site: Site;
    readonly target: HTMLElement;
    readonly server: Server;
    readonly clock: ManualClock;
    readonly logins: LoginRequest[];
    /** 社交发起的请求，按先后。 */
    readonly starts: {readonly provider: SocialProvider; readonly body: SocialStartRequest}[];
    /** `leave` 收到的地址。 */
    readonly left: string[];
}

interface ServerOptions {
    readonly login?: Server["login"];
    readonly meta?: Server["meta"];
    readonly socialStart?: Server["socialStart"];
}

const started: Site[] = [];
const unexpected: string[] = [];

afterEach(() => {
    for (const site of started.splice(0)) site.stop();
    document.body.replaceChildren();
    expect(unexpected.splice(0)).toEqual([]);
});

function start(path: string, options: ServerOptions = {}): Started {
    const target = document.createElement("div");
    document.body.append(target);
    const history = createMemoryHistory();
    history.replace(path);
    const server: Server = {
        session: undefined,
        login: options.login ?? (() => failure({error: {code: "invalid_credentials"}}, 401)),
        meta: options.meta ?? (() => Response.json(OPEN_META)),
        socialStart: options.socialStart ?? ((provider) => Response.json({url: upstreamUrl(provider)} satisfies SocialStartResponse)),
    };
    const logins: LoginRequest[] = [];
    const starts: Started["starts"][number][] = [];
    const left: string[] = [];
    const clock = manualClock(Date.parse("2026-11-26T10:00:00Z"));
    const site = startSite({
        target,
        window,
        history,
        clock,
        leave: (url) => left.push(url),
        fetch: async (input, init) => {
            if (input === WHOAMI) {
                return Response.json((server.session === undefined ? {state: "anonymous"} : {state: "authenticated", user: {id: 7, username: "alice", role: server.session}}) satisfies WhoamiResponse);
            }
            if (input === ME) return server.session === undefined ? failure({error: {code: "unauthenticated"}}, 401) : Response.json(me(server.session));
            if (input === LOGIN && init.method === "POST") {
                const body = JSON.parse(String(init.body)) as LoginRequest;
                logins.push(body);
                return server.login(body, server);
            }
            if (input === META && init.method === "GET") return server.meta();
            const provider = SOCIAL_START.get(input);
            if (provider !== undefined && init.method === "POST") {
                const body = JSON.parse(String(init.body)) as SocialStartRequest;
                starts.push({provider, body});
                return server.socialStart(provider, body);
            }
            unexpected.push(`${String(init.method)} ${input}`);
            return failure({error: {code: "not_found"}}, 404);
        },
    });
    started.push(site);
    return {site, target, server, clock, logins, starts, left};
}

/** 等到路由停在 `fullPath`（解码后比较路径与查询参数）、页面画出 `page`。 */
async function settledAt({site, target}: Started, fullPath: string, page: string): Promise<void> {
    const url = new URL(fullPath, "http://site.invalid");
    const expected = {path: url.pathname, query: Object.fromEntries(url.searchParams)};
    await vi.waitFor(() => {
        const route = site.router.currentRoute.value;
        expect({path: route.path, query: route.query}).toEqual(expected);
        expect(target.querySelector(`[data-site-page="${page}"]`)).not.toBeNull();
    });
}

interface Form {
    readonly form: HTMLFormElement;
    readonly identifier: HTMLInputElement;
    readonly password: HTMLInputElement;
    readonly submit: HTMLButtonElement;
    readonly status: HTMLElement;
}

function formOf({target}: Started): Form {
    const form = target.querySelector("form")!;
    return {
        form,
        identifier: form.querySelector<HTMLInputElement>('input[name="identifier"]')!,
        password: form.querySelector<HTMLInputElement>('input[name="password"]')!,
        submit: form.querySelector<HTMLButtonElement>('button[type="submit"]')!,
        status: form.querySelector<HTMLElement>("[data-site-form-status]")!,
    };
}

function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input"));
}

/** 填好两个字段并提交，返回表单的几个部件。 */
async function fillAndSubmit(started: Started, identifier = "alice", password = "correct horse"): Promise<Form> {
    const form = formOf(started);
    type(form.identifier, identifier);
    type(form.password, password);
    await vi.waitFor(() => expect(form.submit.disabled).toBe(false));
    form.submit.click();
    return form;
}

/** 状态行上看得见的字：去掉只给读屏的那句。 */
function statusText(form: Form): string {
    const copy = form.status.cloneNode(true) as HTMLElement;
    for (const spoken of copy.querySelectorAll("[data-site-form-status-spoken]")) spoken.remove();
    return copy.textContent?.trim() ?? "";
}

/** 状态行（live region）里读屏读得到的字：去掉 `aria-hidden` 的部分。 */
function spokenText(form: Form): string {
    const copy = form.status.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    return copy.textContent?.trim() ?? "";
}
const invalidFields = (form: Form): string[] => [form.identifier, form.password].filter((input) => input.getAttribute("aria-invalid") === "true").map((input) => input.name);

async function onLoginPage(path = "/login", options?: ServerOptions | Server["login"]): Promise<Started> {
    const started = start(path, typeof options === "function" ? {login: options} : options);
    const url = new URL(path, "http://site.invalid");
    await settledAt(started, `${url.pathname}${url.search}`, url.pathname === "/" ? "home" : "login");
    return started;
}

describe("登录页的表单", () => {
    it("主页与 /login 都是登录页；两个字段都填了提交按钮才可用", async () => {
        await onLoginPage("/");
        const started = await onLoginPage("/login");
        const form = formOf(started);
        expect(started.target.querySelector("h1")?.textContent).toBe(zhCN.login.title);
        expect(form.submit.disabled).toBe(true);
        type(form.identifier, "alice");
        await vi.waitFor(() => expect(form.identifier.value).toBe("alice"));
        expect(form.submit.disabled).toBe(true);
        type(form.password, "correct horse");
        await vi.waitFor(() => expect(form.submit.disabled).toBe(false));
        expect(statusText(form)).toBe("");
        expect(started.logins).toEqual([]);
    });

    it("invalid_credentials：两个字段都标红，焦点到第一个，原因写在固定位置的状态行，表单的部件不增不减", async () => {
        const started = await onLoginPage();
        const before = [...formOf(started).form.querySelectorAll("*")];
        const form = await fillAndSubmit(started, "alice", "wrong");

        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.invalid_credentials));
        expect(started.logins).toEqual([{identifier: "alice", password: "wrong"}]);
        expect(invalidFields(form)).toEqual(["identifier", "password"]);
        // 读屏从字段拿到原因：字段的描述就是状态行上的那句话；状态行本身也播报同一句。
        const descriptions = [form.identifier, form.password].map((input) => document.getElementById(input.getAttribute("aria-describedby") ?? ""));
        expect(descriptions.map((element) => element?.textContent)).toEqual([zhCN.errors.identity.invalid_credentials, zhCN.errors.identity.invalid_credentials]);
        expect(spokenText(form)).toBe(zhCN.errors.identity.invalid_credentials);
        await vi.waitFor(() => expect(document.activeElement).toBe(form.identifier));
        // 看得见的原因只写在状态行里：状态行以外多出来的只有两个字段给读屏的描述（`Field` 的 `error`，不占位置，e2e 量排版不变）。
        const added = [...form.form.querySelectorAll("*")].filter((element) => !before.includes(element));
        expect(added.filter((element) => element.closest("[data-site-form-status]") === null)).toEqual(descriptions);
        // 状态行就是原来那一行，夹在密码与提交按钮之间。
        expect(form.status).toBe(before.find((element) => element.matches("[data-site-form-status]")));
        expect(form.status.previousElementSibling?.querySelector('input[name="password"]')).not.toBeNull();
        expect(form.status.nextElementSibling).toBe(form.submit);
        expect(started.site.router.currentRoute.value.path).toBe("/login");

        // 改了字段，标红就撤掉；原因留到下一次提交。
        type(form.password, "wrong again");
        await vi.waitFor(() => expect(invalidFields(form)).toEqual([]));
        expect(statusText(form)).toBe(zhCN.errors.identity.invalid_credentials);
    });

    it("account_banned 只写状态行，不标字段", async () => {
        const started = await onLoginPage("/login", () => failure({error: {code: "account_banned"}}, 403));
        const form = await fillAndSubmit(started);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.account_banned));
        expect(invalidFields(form)).toEqual([]);
    });

    it("validation_failed：fields 里的字段标红并聚焦第一个，别的不标", async () => {
        const started = await onLoginPage("/login", () => failure({error: {code: "validation_failed", fields: ["password"]}}, 400));
        const form = await fillAndSubmit(started);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.validation_failed));
        expect(invalidFields(form)).toEqual(["password"]);
        await vi.waitFor(() => expect(document.activeElement).toBe(form.password));
    });

    it("rate_limited：状态行按 Retry-After 每秒倒数、读屏只听到一句不带秒数的，倒数完之前提交按钮不可用，倒数完状态行清空、按钮可用", async () => {
        const started = await onLoginPage("/login", () => failure({error: {code: "rate_limited"}}, 429, {"Retry-After": "3"}));
        const form = await fillAndSubmit(started);
        const waiting = (seconds: number): string => zhCN.errors.identity.rate_limited.replace("{{seconds}}", String(seconds));

        await vi.waitFor(() => expect(statusText(form)).toBe(waiting(3)));
        expect(form.submit.disabled).toBe(true);
        // live region 里每秒变的字会被每秒播报一次：读屏能读到的只有固定的那句。
        expect(spokenText(form)).toBe(zhCN.form.rateLimitedSpoken);
        started.clock.advance(1_000);
        await vi.waitFor(() => expect(statusText(form)).toBe(waiting(2)));
        expect(form.submit.disabled).toBe(true);
        expect(spokenText(form)).toBe(zhCN.form.rateLimitedSpoken);
        started.clock.advance(1_000);
        await vi.waitFor(() => expect(statusText(form)).toBe(waiting(1)));
        expect(form.submit.disabled).toBe(true);
        expect(spokenText(form)).toBe(zhCN.form.rateLimitedSpoken);
        started.clock.advance(1_000);
        await vi.waitFor(() => expect(statusText(form)).toBe(""));
        expect(form.submit.disabled).toBe(false);
        expect(started.logins).toHaveLength(1);
    });

    it("连不上服务：状态行写网络的原因，留在登录页", async () => {
        const started = await onLoginPage("/login", () => {
            throw new TypeError("Failed to fetch");
        });
        const form = await fillAndSubmit(started);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.web.network));
        expect(started.site.router.currentRoute.value.path).toBe("/login");
    });

    it("登录回了成功、重取身份仍是匿名（会话没建起来）：状态行说没生效，留在登录页", async () => {
        const started = await onLoginPage("/login", () => Response.json({user: {id: 7, username: "alice", displayName: "Alice", avatarUrl: null, website: null, bio: null, role: "user", createdAt: "2026-11-01T00:00:00.000Z"}} satisfies LoginResponse));
        const form = await fillAndSubmit(started);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.login.notApplied));
        expect(started.site.router.currentRoute.value.path).toBe("/login");
    });
});

describe("登录成功之后按分派走", () => {
    it("管理员去看板，普通用户去账号页", async () => {
        const admin = await onLoginPage("/", succeedAs("admin"));
        await fillAndSubmit(admin);
        await settledAt(admin, "/admin", "admin-dashboard");

        const user = await onLoginPage("/login", succeedAs("user"));
        await fillAndSubmit(user);
        await settledAt(user, "/account", "account");
    });

    it("带着站内的 next 时去 next；站外的 next 当作没带", async () => {
        const inside = await onLoginPage("/login?next=%2Fadmin%2Faudit", succeedAs("admin"));
        await fillAndSubmit(inside);
        await settledAt(inside, "/admin/audit", "admin-audit");

        const outside = await onLoginPage("/login?next=%2F%2Fevil.example%2F", succeedAs("user"));
        await fillAndSubmit(outside);
        await settledAt(outside, "/account", "account");
    });
});

describe("social_error", () => {
    it("显示码的文案，再从地址里去掉；地址里别的参数留着", async () => {
        const started = start("/login?social_error=account_banned&next=%2Faccount");
        await settledAt(started, "/login?next=%2Faccount", "login");
        expect(statusText(formOf(started))).toBe(zhCN.errors.identity.account_banned);
    });

    it("social_not_registered 后面跟一个去注册的链接", async () => {
        const started = start("/login?social_error=social_not_registered");
        await settledAt(started, "/login", "login");
        const form = formOf(started);
        expect(statusText(form)).toBe(`${zhCN.errors.identity.social_not_registered}${zhCN.login.goRegister}`);
        expect(form.status.querySelector("a")?.getAttribute("href")).toBe("/register");
    });

    it("合同里没有的码一律显示第三方登录没成功：像码的不回显，一段话也不照抄", async () => {
        const unknown = start("/login?social_error=pay_now_to_unlock");
        await settledAt(unknown, "/login", "login");
        expect(statusText(formOf(unknown))).toBe(zhCN.errors.identity.social_failed);

        const prose = start(`/login?social_error=${encodeURIComponent("请改去 evil.example 登录")}`);
        await settledAt(prose, "/login", "login");
        expect(statusText(formOf(prose))).toBe(zhCN.errors.identity.social_failed);
    });
});

/** 社交图标，按画出来的先后。 */
const socialButtons = ({target}: Started): HTMLButtonElement[] => [...target.querySelectorAll<HTMLButtonElement>("[data-site-social-provider]")];

describe("社交登录的两枚图标", () => {
    it("在表单下面，GitHub 在前、Google 在后，读屏名字是“用 … 登录”；点了发起登录意图，拿到上游地址就离开站点", async () => {
        const started = await onLoginPage();
        const form = formOf(started);
        await vi.waitFor(() => expect(socialButtons(started).map((button) => button.disabled)).toEqual([false, false]));
        const row = started.target.querySelector("[data-site-social]")!;
        // 表单之后（`DOCUMENT_POSITION_FOLLOWING`），不在表单里。
        expect(form.form.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(form.form.contains(row)).toBe(false);
        expect(socialButtons(started).map((button) => button.getAttribute("aria-label"))).toEqual([zhCN.social.login.github, zhCN.social.login.google]);

        socialButtons(started)[1]!.click();
        await vi.waitFor(() => expect(started.left).toEqual([upstreamUrl("google")]));
        expect(started.starts).toEqual([{provider: "google", body: {intent: "login"}}]);
        expect(started.logins).toEqual([]);
    });

    it("上游没开放的那枚不画；两个都没开放时“或”与图标整行不画", async () => {
        const onlyGithub = await onLoginPage("/login", {meta: () => Response.json({...OPEN_META, providers: {google: false, github: true}} satisfies MetaResponse)});
        await vi.waitFor(() => expect(socialButtons(onlyGithub).map((button) => button.dataset.siteSocialProvider)).toEqual(["github"]));

        const none = await onLoginPage("/login", {meta: () => Response.json({...OPEN_META, providers: {google: false, github: false}} satisfies MetaResponse)});
        await vi.waitFor(() => expect(none.target.querySelector("[data-site-social]")).toBeNull());
        expect(formOf(none).form).not.toBeNull();
    });

    it("meta 取不到时两枚图标都在、不可点，密码登录照常可用", async () => {
        const started = await onLoginPage("/login", {meta: () => failure({error: {code: "unavailable"}}, 503)});
        const form = await fillAndSubmit(started, "alice", "wrong");
        // 登录的回答到了时 `meta` 早已答完（它先发）：图标这时仍不可点，就不是“还在取”的那一段。
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.invalid_credentials));
        expect(socialButtons(started).map((button) => button.disabled)).toEqual([true, true]);
    });

    it("发起回 unavailable、forbidden_origin、provider_disabled：原因写在状态行，不离开站点，图标还能再点", async () => {
        for (const [code, status] of [["unavailable", 503], ["forbidden_origin", 403], ["provider_disabled", 400]] as const) {
            const started = await onLoginPage("/login", {socialStart: () => failure({error: {code}}, status)});
            await vi.waitFor(() => expect(socialButtons(started)[0]!.disabled).toBe(false));
            socialButtons(started)[0]!.click();
            const form = formOf(started);
            await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity[code]));
            expect(started.left).toEqual([]);
            expect(socialButtons(started)[0]!.disabled).toBe(false);
        }
    });

    it("发起回 rate_limited：状态行倒数，倒数完之前图标与提交按钮都不可用", async () => {
        const started = await onLoginPage("/login", {socialStart: () => failure({error: {code: "rate_limited"}}, 429, {"Retry-After": "2"})});
        await vi.waitFor(() => expect(socialButtons(started)[0]!.disabled).toBe(false));
        const form = formOf(started);
        type(form.identifier, "alice");
        type(form.password, "correct horse");
        socialButtons(started)[0]!.click();
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.rate_limited.replace("{{seconds}}", "2")));
        expect(socialButtons(started).map((button) => button.disabled)).toEqual([true, true]);
        expect(form.submit.disabled).toBe(true);
        started.clock.advance(2_000);
        await vi.waitFor(() => expect(socialButtons(started).map((button) => button.disabled)).toEqual([false, false]));
        expect(form.submit.disabled).toBe(false);
        expect(started.left).toEqual([]);
    });
});
