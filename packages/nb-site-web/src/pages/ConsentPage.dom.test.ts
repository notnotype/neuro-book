/**
 * 同意页（`ConsentPage.vue`）：装起整个站点（`testing/site-harness.ts`）。缺同意的用户怎样被带到这里（守卫、同意门槛的统一处理），
 * 两项都勾才能提交，补交之后回到 `next`，补交时条款又换了，退出登录。
 */

import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import type {ConsentRequest, ConsentResponse, MetaResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../locales/zh-CN.json";
import {DRAFT_KEY, OPEN_META, TERMS_VERSION, cleanUp, failure, identityUrl, invalidNames, me, settledAt, startAt, statusTextOf} from "../testing/site-harness";
import type {Handler, Harness, Role, StartOptions} from "../testing/site-harness";

const CONSENT = `POST ${identityUrl(IDENTITY_PATHS.meConsent)}`;
const LOGOUT = `POST ${identityUrl(IDENTITY_PATHS.logout)}`;
const SESSIONS = identityUrl(IDENTITY_PATHS.meSessions);

/** 补交成功：会话不再缺同意，回自己的资料。 */
const consented: Handler = (_body, server) => {
    const session = {...server.session!, consentRequired: false};
    server.session = session;
    return Response.json(me(session) satisfies ConsentResponse);
};

afterEach(cleanUp);

interface Form {
    readonly form: HTMLFormElement;
    readonly terms: HTMLInputElement;
    readonly overseas: HTMLInputElement;
    readonly submit: HTMLButtonElement;
    readonly status: HTMLElement;
}

function formOf({target}: Harness): Form {
    const form = target.querySelector("form")!;
    return {
        form,
        terms: form.querySelector<HTMLInputElement>('input[name="termsConsent"]')!,
        overseas: form.querySelector<HTMLInputElement>('input[name="overseasStorage"]')!,
        submit: form.querySelector<HTMLButtonElement>('button[type="submit"]')!,
        status: form.querySelector<HTMLElement>("[data-site-form-status]")!,
    };
}

const consentBodies = ({requests}: Harness): unknown[] => requests.filter((request) => `${request.method} ${request.path}` === CONSENT).map((request) => request.body);

function needsConsent(role: Role, options: StartOptions = {}): StartOptions {
    return {session: {role, consentRequired: true}, ...options, handlers: {[CONSENT]: consented, ...options.handlers}};
}

async function agreeAndSubmit(harness: Harness): Promise<Form> {
    const form = formOf(harness);
    form.terms.click();
    form.overseas.click();
    await vi.waitFor(() => expect(form.submit.disabled).toBe(false));
    form.submit.click();
    return form;
}

describe("同意页", () => {
    it("列出两份条款与当前版本；两项都勾了才能提交", async () => {
        const harness = startAt("/consent", needsConsent("user"));
        await settledAt(harness, "/consent", "consent");
        const form = formOf(harness);
        await vi.waitFor(() => expect([...harness.target.querySelectorAll("[data-site-consent-version]")].map((element) => element.textContent)).toEqual(Array(2).fill(zhCN.consent.version.replace("{{version}}", TERMS_VERSION))));
        expect([...harness.target.querySelectorAll(".consent-doc a")].map((link) => link.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
        expect(form.submit.disabled).toBe(true);
        form.terms.click();
        await vi.waitFor(() => expect(form.terms.checked).toBe(true));
        expect(form.submit.disabled).toBe(true);
        form.terms.click();
        form.overseas.click();
        await vi.waitFor(() => expect(form.overseas.checked).toBe(true));
        expect(form.submit.disabled).toBe(true);
        form.form.dispatchEvent(new Event("submit", {cancelable: true}));
        expect(consentBodies(harness)).toEqual([]);
    });

    it("补交之后回到 next：请求带当前条款版本与境外存放的同意", async () => {
        const harness = startAt("/consent?next=%2Fadmin%2Faudit", needsConsent("admin"));
        await settledAt(harness, "/consent?next=%2Fadmin%2Faudit", "consent");
        await agreeAndSubmit(harness);
        await settledAt(harness, "/admin/audit", "admin-audit");
        expect(consentBodies(harness)).toEqual([{termsVersion: TERMS_VERSION, overseasStorage: true} satisfies ConsentRequest]);
    });

    it("别的页上的请求撞上同意门槛：带着那一页的地址来，补交之后回去", async () => {
        const harness = startAt("/account", {session: {role: "user", consentRequired: false}, handlers: {[CONSENT]: consented}});
        await settledAt(harness, "/account", "account");
        // 条款换了版本：服务端起把这个会话挡在门槛外。
        harness.server.session = {role: "user", consentRequired: true};
        harness.server.handlers.set(`GET ${SESSIONS}`, () => failure({error: {code: "consent_required"}}, 403));
        await harness.site.api.request({method: "GET", path: SESSIONS});
        await settledAt(harness, "/consent?next=%2Faccount", "consent");

        await agreeAndSubmit(harness);
        await settledAt(harness, "/account", "account");
    });

    it("补交时条款又换了版本（consent_required）：两个勾撤掉、标红，状态行说条款又更新了，留在同意页", async () => {
        let version = TERMS_VERSION;
        const harness = startAt("/consent", needsConsent("user", {
            meta: () => Response.json({...OPEN_META, termsVersion: version} satisfies MetaResponse),
            handlers: {
                [CONSENT]: () => {
                    version = "2026-11-20";
                    return failure({error: {code: "consent_required"}}, 403);
                },
            },
        }));
        await settledAt(harness, "/consent", "consent");
        const form = await agreeAndSubmit(harness);
        await vi.waitFor(() => expect(statusTextOf(form.status)).toBe(zhCN.consent.termsChanged));
        expect([form.terms.checked, form.overseas.checked]).toEqual([false, false]);
        expect(invalidNames(form.form)).toEqual(["termsConsent", "overseasStorage"]);
        await vi.waitFor(() => expect(harness.target.querySelector("[data-site-consent-version]")?.textContent).toBe(zhCN.consent.version.replace("{{version}}", "2026-11-20")));
        expect(harness.site.router.currentRoute.value.path).toBe("/consent");
    });

    it("补交失败（服务不可用）写在状态行，两个勾还在", async () => {
        const harness = startAt("/consent", needsConsent("user", {handlers: {[CONSENT]: () => failure({error: {code: "unavailable"}}, 503)}}));
        await settledAt(harness, "/consent", "consent");
        const form = await agreeAndSubmit(harness);
        await vi.waitFor(() => expect(statusTextOf(form.status)).toBe(zhCN.errors.identity.unavailable));
        expect([form.terms.checked, form.overseas.checked]).toEqual([true, true]);
    });

    it("退出登录：结束会话、清掉社交注册的草稿，回到首页的登录表单", async () => {
        window.sessionStorage.setItem(DRAFT_KEY, "{}");
        const harness = startAt("/consent", needsConsent("user", {
            handlers: {
                [LOGOUT]: (_body, server) => {
                    server.session = undefined;
                    return Response.json({});
                },
            },
        }));
        await settledAt(harness, "/consent", "consent");
        const signOut = [...harness.target.querySelectorAll("button")].find((button) => button.textContent?.trim() === zhCN.consent.signOut)!;
        signOut.click();
        await settledAt(harness, "/", "home");
        expect(harness.site.account.state.value).toEqual({kind: "anonymous"});
        expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });
});
