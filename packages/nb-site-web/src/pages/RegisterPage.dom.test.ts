/**
 * 注册页（`RegisterPage.vue`）：装起整个站点（`testing/site-harness.ts`），断言用户看得到的与离开站点时留下的：哪些项标红、焦点、
 * 状态行的字、按钮与图标能不能点、发出的请求体、跳去上游之前存下的草稿、最后停在哪一页。
 * 量位置的验收（状态行出现时字段不动、窄屏不横向滚动）要真实布局，在 `e2e/register.e2e.ts`。
 */

import {IDENTITY_PATHS, SOCIAL_ERROR_CODES, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {ErrorBody, MetaResponse, RegisterRequest, RegisterResponse, SocialStartRequest, SocialStartResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../locales/zh-CN.json";
import {SOCIAL_REGISTER_DRAFT_TTL_MS, createSiteStorage} from "../host/storage";
import type {SocialRegisterDraft} from "../host/storage";
import {
    DRAFT_KEY,
    NOW,
    OPEN_META,
    TERMS_VERSION,
    cleanUp,
    failure,
    identityUrl,
    invalidNames,
    leaveField,
    profile,
    settledAt,
    socialButton,
    socialButtons,
    startAt,
    statusTextOf,
    stopKeepingStorage,
    type,
} from "../testing/site-harness";
import type {Handler, Harness, StartOptions} from "../testing/site-harness";

const REGISTER = `POST ${identityUrl(IDENTITY_PATHS.register)}`;
const START_GITHUB = `POST ${identityUrl(identityPath.socialStart("github"))}`;
const UPSTREAM = "https://github.example/login/oauth/authorize?state=s1";

/** 注册成功：建起会话（新账号，同意已交齐），回公开资料。 */
const registered: Handler = (_body, server) => {
    server.session = {role: "user", consentRequired: false};
    return Response.json({user: profile("user")} satisfies RegisterResponse);
};

const toUpstream: Handler = () => Response.json({url: UPSTREAM} satisfies SocialStartResponse);

afterEach(cleanUp);

interface Form {
    readonly form: HTMLFormElement;
    readonly registrationCode: HTMLInputElement;
    readonly username: HTMLInputElement;
    readonly displayName: HTMLInputElement;
    readonly email: HTMLInputElement;
    readonly password: HTMLInputElement;
    readonly inviteCode: HTMLInputElement;
    readonly terms: HTMLInputElement;
    readonly overseas: HTMLInputElement;
    readonly submit: HTMLButtonElement;
    readonly status: HTMLElement;
}

function formOf({target}: Harness): Form {
    const form = target.querySelector("form")!;
    const input = (name: string): HTMLInputElement => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    return {
        form,
        registrationCode: input("registrationCode"),
        username: input("username"),
        displayName: input("displayName"),
        email: input("email"),
        password: input("password"),
        inviteCode: input("inviteCode"),
        terms: input("termsConsent"),
        overseas: input("overseasStorage"),
        submit: form.querySelector<HTMLButtonElement>('button[type="submit"]')!,
        status: form.querySelector<HTMLElement>("[data-site-form-status]")!,
    };
}

const statusText = (form: Form): string => statusTextOf(form.status);

async function onRegisterPage(path = "/register", options?: StartOptions): Promise<Harness> {
    const harness = startAt(path, options);
    await settledAt(harness, "/register", "register");
    return harness;
}

/** 填好必填的四项（不含两项同意）。 */
function fillRequired(form: Form): void {
    type(form.registrationCode, "  CODE-1  ");
    type(form.username, "Alice_01");
    type(form.email, "alice@example.com");
    type(form.password, "correct horse");
}

/** 勾选框照用户那样点（happy-dom 的点击会翻转并发 `change`）。 */
function agree(form: Form, which: "terms" | "overseas" | "both" = "both"): void {
    if (which !== "overseas") form.terms.click();
    if (which !== "terms") form.overseas.click();
}

/** 填齐并勾上两项、提交。 */
async function fillAndSubmit(harness: Harness): Promise<Form> {
    const form = formOf(harness);
    fillRequired(form);
    agree(form);
    await vi.waitFor(() => expect(form.submit.disabled).toBe(false));
    form.submit.click();
    return form;
}

const registerBodies = ({requests}: Harness): unknown[] => requests.filter((request) => `${request.method} ${request.path}` === REGISTER).map((request) => request.body);
const startBodies = ({requests}: Harness): unknown[] => requests.filter((request) => `${request.method} ${request.path}` === START_GITHUB).map((request) => request.body);

describe("密码注册", () => {
    it("规则都合、两项同意都勾了提交按钮才可用；显示名留空、邀请码只有空白时请求里没有它们；成功后按分派进账号页", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[REGISTER]: registered}});
        const form = formOf(harness);
        expect(harness.target.querySelector("h1")?.textContent).toBe(zhCN.register.title);
        fillRequired(form);
        type(form.inviteCode, "   ");
        await vi.waitFor(() => expect(form.username.value).toBe("Alice_01"));
        expect(form.submit.disabled).toBe(true);
        agree(form, "terms");
        await vi.waitFor(() => expect(form.terms.checked).toBe(true));
        expect(form.submit.disabled).toBe(true);
        agree(form, "overseas");
        await vi.waitFor(() => expect(form.submit.disabled).toBe(false));

        form.submit.click();
        await settledAt(harness, "/account", "account");
        // 用户名照原样发（服务端转小写，显示名省略时取原样的用户名，`site.accounts` 输出 1）；注册码的空白由服务端去掉。
        expect(registerBodies(harness)).toEqual([{
            username: "Alice_01",
            email: "alice@example.com",
            password: "correct horse",
            registrationCode: "  CODE-1  ",
            termsVersion: TERMS_VERSION,
            overseasStorage: true,
        } satisfies RegisterRequest]);
    });

    it("填了显示名与邀请码时照原样带上", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[REGISTER]: registered}});
        const form = formOf(harness);
        type(form.displayName, " 爱丽丝 ");
        type(form.inviteCode, "INV-9");
        await fillAndSubmit(harness);
        await settledAt(harness, "/account", "account");
        expect(registerBodies(harness)).toEqual([expect.objectContaining({displayName: " 爱丽丝 ", inviteCode: "INV-9"})]);
    });

    it("只勾第二项（境外存放）也不能提交", async () => {
        const harness = await onRegisterPage();
        const form = formOf(harness);
        fillRequired(form);
        agree(form, "overseas");
        await vi.waitFor(() => expect(form.overseas.checked).toBe(true));
        expect(form.submit.disabled).toBe(true);
        form.form.dispatchEvent(new Event("submit", {cancelable: true}));
        expect(registerBodies(harness)).toEqual([]);
    });

    it("离开一个填了字却不合规则的输入框：它标红、状态行写规则，焦点不拉回来；改了它就撤掉", async () => {
        const harness = await onRegisterPage();
        const form = formOf(harness);
        form.email.focus();
        type(form.email, "not-an-email");
        form.password.focus();
        leaveField(form.email);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.register.rules.email));
        expect(invalidNames(form.form)).toEqual(["email"]);
        expect(document.activeElement).toBe(form.password);
        type(form.email, "alice@example.com");
        await vi.waitFor(() => expect(statusText(form)).toBe(""));
        expect(invalidNames(form.form)).toEqual([]);
    });

    it("规则说明只在改了它说的那一项时撤掉：改别的项时说明与标红都留着", async () => {
        const harness = await onRegisterPage();
        const form = formOf(harness);
        type(form.email, "not-an-email");
        leaveField(form.email);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.register.rules.email));

        type(form.username, "alice");
        await Promise.resolve();
        expect(statusText(form)).toBe(zhCN.register.rules.email);
        expect(invalidNames(form.form)).toEqual(["email"]);

        type(form.email, "alice@example.com");
        await vi.waitFor(() => expect(statusText(form)).toBe(""));
        expect(invalidNames(form.form)).toEqual([]);
    });
});

describe("注册的拒绝落在哪", () => {
    // 每个码：状态行的字与标红的项（焦点给第一项）。
    const cases: readonly {readonly body: ErrorBody; readonly status: number; readonly invalid: readonly string[]}[] = [
        {body: {error: {code: "registration_code_invalid"}}, status: 400, invalid: ["registrationCode"]},
        {body: {error: {code: "invite_code_invalid"}}, status: 400, invalid: ["inviteCode"]},
        {body: {error: {code: "username_taken"}}, status: 409, invalid: ["username"]},
        {body: {error: {code: "email_taken"}}, status: 409, invalid: ["email"]},
        // `fields` 是请求体的键名：`termsVersion` 落在第一个勾选框上。
        {body: {error: {code: "validation_failed", fields: ["termsVersion", "username"]}}, status: 400, invalid: ["username", "termsConsent"]},
        {body: {error: {code: "consent_required"}}, status: 400, invalid: ["termsConsent", "overseasStorage"]},
    ];

    for (const {body, status, invalid} of cases) {
        it(`${body.error.code}：${invalid.join("、")} 标红并聚焦第一项，原因在状态行，留在注册页`, async () => {
            const harness = await onRegisterPage("/register", {handlers: {[REGISTER]: () => failure(body, status)}});
            const form = await fillAndSubmit(harness);
            await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity[body.error.code]));
            await vi.waitFor(() => expect(invalidNames(form.form)).toEqual(invalid));
            await vi.waitFor(() => expect((document.activeElement as HTMLInputElement | null)?.name).toBe(invalid[0]));
            expect(harness.site.router.currentRoute.value.path).toBe("/register");
        });
    }

    it("consent_required 而条款版本已换：两个勾撤掉，状态行说条款刚更新过", async () => {
        let version = TERMS_VERSION;
        const harness = await onRegisterPage("/register", {
            meta: () => Response.json({...OPEN_META, termsVersion: version} satisfies MetaResponse),
            handlers: {
                [REGISTER]: () => {
                    version = "2026-11-20";
                    return failure({error: {code: "consent_required"}}, 400);
                },
            },
        });
        const form = await fillAndSubmit(harness);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.register.termsChanged));
        expect([form.terms.checked, form.overseas.checked]).toEqual([false, false]);
        expect(invalidNames(form.form)).toEqual(["termsConsent", "overseasStorage"]);
        expect(form.submit.disabled).toBe(true);
    });

    it("registration_closed：状态行写现在不开放注册，整张表单与社交图标都不可用", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[REGISTER]: () => failure({error: {code: "registration_closed"}}, 403)}});
        const form = await fillAndSubmit(harness);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.registration_closed));
        expect([form.registrationCode, form.username, form.displayName, form.email, form.password, form.inviteCode, form.terms, form.overseas].map((input) => input.disabled)).toEqual(Array(8).fill(true));
        expect(form.submit.disabled).toBe(true);
        expect(socialButtons(harness.target).map((button) => button.disabled)).toEqual([true, true]);
    });

    it("meta 说注册关闭：一进来就是关闭的样子，点社交图标不发起", async () => {
        const harness = await onRegisterPage("/register", {meta: () => Response.json({...OPEN_META, registrationOpen: false} satisfies MetaResponse)});
        const form = formOf(harness);
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.errors.identity.registration_closed));
        expect(form.username.disabled).toBe(true);
        expect(form.submit.disabled).toBe(true);
        const github = socialButton(harness.target, "github");
        expect(github.disabled).toBe(true);
        github.click();
        expect(startBodies(harness)).toEqual([]);
        expect(harness.left).toEqual([]);
    });
});

describe("社交注册的发起", () => {
    it("图标在表单下面，读屏名字是“用 … 注册”；上游没开放的那枚不画", async () => {
        const harness = await onRegisterPage("/register", {meta: () => Response.json({...OPEN_META, providers: {google: true, github: false}} satisfies MetaResponse)});
        await vi.waitFor(() => expect(socialButtons(harness.target).map((button) => button.getAttribute("aria-label"))).toEqual([zhCN.social.register.google]));
    });

    it("没勾两项同意：不发起、不离开，两个勾选框标红，状态行请他先勾", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: toUpstream}});
        const form = formOf(harness);
        fillRequired(form);
        agree(form, "terms");
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.register.consentMissing));
        expect(invalidNames(form.form)).toEqual(["overseasStorage"]);
        expect(startBodies(harness)).toEqual([]);
        expect(harness.left).toEqual([]);
    });

    it("表单不合规则：不发起、不离开，不合的项标红并聚焦，状态行写它的规则；邮箱与密码不用填", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: toUpstream}});
        const form = formOf(harness);
        type(form.registrationCode, "CODE-1");
        type(form.username, "a b");
        agree(form);
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(statusText(form)).toBe(zhCN.register.rules.username));
        expect(invalidNames(form.form)).toEqual(["username"]);
        await vi.waitFor(() => expect(document.activeElement).toBe(form.username));
        expect(startBodies(harness)).toEqual([]);

        type(form.username, "alice");
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([UPSTREAM]));
    });

    it("发起成功：请求带齐注册内容（不带邮箱与密码），先存草稿再离开；草稿里有注册码、没有密码", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: toUpstream}});
        const form = formOf(harness);
        fillRequired(form);
        type(form.inviteCode, "INV-9");
        agree(form);
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(harness.left).toHaveLength(1));

        expect(startBodies(harness)).toEqual([{
            intent: "register",
            username: "Alice_01",
            registrationCode: "  CODE-1  ",
            inviteCode: "INV-9",
            termsVersion: TERMS_VERSION,
            overseasStorage: true,
        } satisfies SocialStartRequest]);
        const [{url, draft}] = harness.left as [Harness["left"][number]];
        expect(url).toBe(UPSTREAM);
        // 离开的那一刻草稿已经在存储里。
        expect(draft).not.toBeNull();
        expect(JSON.parse(draft!)).toEqual({
            v: 1,
            savedAt: NOW,
            provider: "github",
            username: "Alice_01",
            displayName: "",
            inviteCode: "INV-9",
            registrationCode: "  CODE-1  ",
            consent: {termsVersion: TERMS_VERSION, overseas: true},
        });
        expect(draft).not.toContain("correct horse");
    });

    it("发起回 unavailable、forbidden_origin、rate_limited：原因写在状态行，不存草稿、不离开", async () => {
        for (const [code, status, headers] of [["unavailable", 503, undefined], ["forbidden_origin", 403, undefined], ["rate_limited", 429, {"Retry-After": "5"}]] as const) {
            const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: () => failure({error: {code}}, status, headers)}});
            const form = formOf(harness);
            fillRequired(form);
            agree(form);
            await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
            socialButton(harness.target, "github").click();
            const expected = code === "rate_limited" ? zhCN.errors.identity.rate_limited.replace("{{seconds}}", "5") : zhCN.errors.identity[code];
            await vi.waitFor(() => expect(statusText(form)).toBe(expected));
            expect(harness.left).toEqual([]);
            expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
            cleanUp();
        }
    });

    it("发起后从上游点返回、页面从往返缓存恢复（pageshow 的 persisted 为真）：图标与提交按钮又能点了", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: toUpstream}});
        const form = formOf(harness);
        fillRequired(form);
        agree(form);
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(harness.left).toHaveLength(1));
        await vi.waitFor(() => expect(socialButtons(harness.target).map((button) => button.disabled)).toEqual([true, true]));
        expect(form.submit.disabled).toBe(true);

        window.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: false}));
        await Promise.resolve();
        expect(socialButtons(harness.target).map((button) => button.disabled)).toEqual([true, true]);

        window.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: true}));
        await vi.waitFor(() => expect(socialButtons(harness.target).map((button) => button.disabled)).toEqual([false, false]));
        expect(form.submit.disabled).toBe(false);
    });

    it("发起回 username_taken：用户名标红，留在注册页", async () => {
        const harness = await onRegisterPage("/register", {handlers: {[START_GITHUB]: () => failure({error: {code: "username_taken"}}, 409)}});
        const form = formOf(harness);
        fillRequired(form);
        agree(form);
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(invalidNames(form.form)).toEqual(["username"]));
        expect(statusText(form)).toBe(zhCN.errors.identity.username_taken);
        expect(harness.left).toEqual([]);
    });
});

/** 照产品的写法存一份草稿（经 `host/storage.ts`，时刻取 `savedAt`），像上一次跳去上游之前那样。 */
function saveDraft(draft: Partial<SocialRegisterDraft> = {}, savedAt = NOW): void {
    createSiteStorage({storage: () => window.sessionStorage, now: () => savedAt}).saveSocialRegisterDraft({
        provider: "github",
        username: "Alice_01",
        displayName: "爱丽丝",
        inviteCode: "INV-9",
        registrationCode: "CODE-1",
        consent: {termsVersion: TERMS_VERSION, overseas: true},
        ...draft,
    });
}

describe("从上游带着 social_error 回来", () => {
    it("还原草稿：注册码、用户名、显示名、邀请码与两项同意都在，密码空着；码对应的项标红；参数从地址里去掉；草稿读一次就删", async () => {
        saveDraft();
        const harness = startAt("/register?social_error=username_taken&invite=OTHER");
        await settledAt(harness, "/register?invite=OTHER", "register");
        const form = formOf(harness);
        expect(statusText(form)).toBe(zhCN.errors.identity.username_taken);
        expect([form.registrationCode.value, form.username.value, form.displayName.value, form.email.value, form.password.value]).toEqual(["CODE-1", "Alice_01", "爱丽丝", "", ""]);
        // 草稿里有邀请码时以草稿为准，不用地址上的。
        expect(form.inviteCode.value).toBe("INV-9");
        await vi.waitFor(() => expect([form.terms.checked, form.overseas.checked]).toEqual([true, true]));
        expect(invalidNames(form.form)).toEqual(["username"]);
        expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it("再带着 social_error 进来一次：草稿已经读过、删了，表单是空的", async () => {
        saveDraft();
        const first = startAt("/register?social_error=email_taken");
        await settledAt(first, "/register", "register");
        expect(formOf(first).username.value).toBe("Alice_01");
        stopKeepingStorage(first);

        const second = startAt("/register?social_error=email_taken");
        await settledAt(second, "/register", "register");
        expect(formOf(second).username.value).toBe("");
        expect(statusText(formOf(second))).toBe(zhCN.errors.identity.email_taken);
    });

    it("草稿存了超过 10 分钟：不还原，并删掉", async () => {
        saveDraft({}, NOW - SOCIAL_REGISTER_DRAFT_TTL_MS - 1);
        const harness = startAt("/register?social_error=social_email_missing");
        await settledAt(harness, "/register", "register");
        const form = formOf(harness);
        expect([form.registrationCode.value, form.username.value]).toEqual(["", ""]);
        expect(statusText(form)).toBe(zhCN.errors.identity.social_email_missing);
        expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it("条款在这期间换了版本：内容还原，两项同意不勾回去", async () => {
        saveDraft({consent: {termsVersion: "2026-10-01", overseas: true}});
        const harness = startAt("/register?social_error=social_state_invalid");
        await settledAt(harness, "/register", "register");
        const form = formOf(harness);
        expect(form.username.value).toBe("Alice_01");
        // 等 `meta` 回来、页面比过版本之后：社交图标可点时 `meta` 已经到了。
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        expect([form.terms.checked, form.overseas.checked]).toEqual([false, false]);
    });

    it("每个落点码显示自己的文案；合同里没有的一律显示第三方登录没成功", async () => {
        for (const code of [...SOCIAL_ERROR_CODES, "pay_now_to_unlock"]) {
            const harness = startAt(`/register?social_error=${code}`);
            await settledAt(harness, "/register", "register");
            const expected = (zhCN.errors.identity as Record<string, string>)[code] ?? zhCN.errors.identity.social_failed;
            expect(statusText(formOf(harness))).toBe(expected);
            cleanUp();
        }
    });

    it("带着空的 social_error 进来：当作没带，草稿删掉、表单是空的，状态行不写，参数从地址里去掉", async () => {
        saveDraft();
        const harness = startAt("/register?social_error=");
        await settledAt(harness, "/register", "register");
        const form = formOf(harness);
        expect(form.username.value).toBe("");
        expect(statusText(form)).toBe("");
        expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it("码是对象原型上的键名（constructor、toString）：照合同里没有的码处理，不标任何一项", async () => {
        for (const code of ["constructor", "toString", "__proto__"]) {
            saveDraft();
            const harness = startAt(`/register?social_error=${code}`);
            await settledAt(harness, "/register", "register");
            const form = formOf(harness);
            expect({code, text: statusText(form)}).toEqual({code, text: zhCN.errors.identity.social_failed});
            expect({code, invalid: invalidNames(form.form)}).toEqual({code, invalid: []});
            cleanUp();
        }
    });

    it("不带 social_error 进来：上一次没走完的草稿删掉，表单是空的", async () => {
        saveDraft();
        const harness = startAt("/register");
        await settledAt(harness, "/register", "register");
        expect(formOf(harness).username.value).toBe("");
        expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });
});

describe("邀请链接", () => {
    it("/register?invite=<码> 预填邀请码", async () => {
        const harness = startAt("/register?invite=INV-42");
        await settledAt(harness, "/register?invite=INV-42", "register");
        expect(formOf(harness).inviteCode.value).toBe("INV-42");
    });
});

/** 授权端点带来的续接令牌（`site.oauth-provider` 输出 4），与服务端认得它时回的继续地址。 */
const TOKEN = "tok_opaque-1";
const CONTINUE_URL = "/api/identity/auth/oauth2/authorize?client_id=shelf&state=s1";

/** 注册成功，响应带继续地址。 */
const registeredAndContinued: Handler = (_body, server) => {
    server.session = {role: "user", consentRequired: false};
    return Response.json({user: profile("user"), continueUrl: CONTINUE_URL} satisfies RegisterResponse);
};

describe("登录续接（continue）", () => {
    it("注册请求带上地址里的令牌；响应给了继续地址就整页去那里，不按分派进站", async () => {
        const harness = startAt(`/register?continue=${TOKEN}`, {handlers: {[REGISTER]: registeredAndContinued}});
        await settledAt(harness, `/register?continue=${TOKEN}`, "register");
        await fillAndSubmit(harness);
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([CONTINUE_URL]));
        expect(registerBodies(harness)).toEqual([expect.objectContaining({continue: TOKEN})]);
        expect(harness.site.router.currentRoute.value.path).toBe("/register");
    });

    it("“登录”链接把令牌带回登录页", async () => {
        const harness = startAt(`/register?continue=${TOKEN}`);
        await settledAt(harness, `/register?continue=${TOKEN}`, "register");
        expect(harness.target.querySelector(".site-form-alt a")?.getAttribute("href")).toBe(`/login?continue=${TOKEN}`);
    });

    it("社交注册的发起带上令牌，草稿也存着它", async () => {
        const harness = startAt(`/register?continue=${TOKEN}`, {handlers: {[START_GITHUB]: toUpstream}});
        await settledAt(harness, `/register?continue=${TOKEN}`, "register");
        const form = formOf(harness);
        fillRequired(form);
        agree(form);
        await vi.waitFor(() => expect(socialButton(harness.target, "github").disabled).toBe(false));
        socialButton(harness.target, "github").click();
        await vi.waitFor(() => expect(harness.left).toHaveLength(1));
        expect(startBodies(harness)).toEqual([expect.objectContaining({intent: "register", continue: TOKEN})]);
        expect(JSON.parse(harness.left[0]!.draft!)).toEqual(expect.objectContaining({continue: TOKEN}));
    });

    it("从上游带着 social_error 回来（落点地址上没有令牌）：令牌从草稿还原、写回地址，“登录”链接与再次提交都带着它", async () => {
        saveDraft({continue: TOKEN});
        const harness = startAt("/register?social_error=username_taken", {handlers: {[REGISTER]: registeredAndContinued}});
        await settledAt(harness, `/register?continue=${TOKEN}`, "register");
        expect(harness.target.querySelector(".site-form-alt a")?.getAttribute("href")).toBe(`/login?continue=${TOKEN}`);

        const form = formOf(harness);
        type(form.username, "Alice_02");
        type(form.email, "alice@example.com");
        type(form.password, "correct horse");
        await vi.waitFor(() => expect(form.submit.disabled).toBe(false));
        form.submit.click();
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([CONTINUE_URL]));
        expect(registerBodies(harness)).toEqual([expect.objectContaining({username: "Alice_02", continue: TOKEN})]);
    });
});
