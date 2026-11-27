/**
 * 授权确认页（`OAuthConsentPage.vue`）：装起整个站点（`testing/site-harness.ts`）。确认卡片画什么、允许与拒绝去哪、哪些码换成整张
 * 说明卡片、`?error=` 谁都能看、要登录与交齐同意的人被带去哪、取数慢与取数失败的样子。量位置的验收（与登录卡片同一位置、三档宽度
 * 不横向滚动）在 `e2e/oauth.e2e.ts`。
 */

import {IDENTITY_PATHS} from "@notnotype/nb-site-identity-contract/constants";
import type {OAuthAuthorizationResponse, OAuthDecisionRequest, OAuthDecisionResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../locales/zh-CN.json";
import {cleanUp, failure, identityUrl, nextTask, settledAt, startAt, statusTextOf} from "../testing/site-harness";
import type {Handler, Harness, StartOptions} from "../testing/site-harness";

const AUTHORIZATION = identityUrl(IDENTITY_PATHS.oauthAuthorization);
const GET_AUTHORIZATION = `GET ${AUTHORIZATION}`;
const DECIDE = `POST ${AUTHORIZATION}`;
const LOGOUT = `POST ${identityUrl(IDENTITY_PATHS.logout)}`;

const REQUEST = "req_7f3a";
const PAGE = `/oauth/consent?request=${REQUEST}`;
const text = zhCN.oauthConsent;

const INFO: OAuthAuthorizationResponse = {clientName: "书架同步助手", redirectHost: "shelf.example.com", scopes: ["openid", "profile", "email"]};
const ALLOWED = "https://shelf.example.com/callback?code=c1&state=s1";
const DENIED = "https://shelf.example.com/callback?error=access_denied&state=s1";

const fill = (template: string, values: Record<string, string>): string => template.replace(/\{\{(\w+)\}\}/gu, (_whole, key: string) => values[key] ?? "");

/** 照请求里的 `accept` 回跳回客户端的地址。 */
const decided: Handler = (body) => Response.json({redirectUrl: (body as OAuthDecisionRequest).accept ? ALLOWED : DENIED} satisfies OAuthDecisionResponse);

afterEach(cleanUp);

function signedIn(options: StartOptions = {}): StartOptions {
    return {
        session: {role: "user", consentRequired: false},
        ...options,
        handlers: {[GET_AUTHORIZATION]: () => Response.json(INFO), [DECIDE]: decided, ...options.handlers},
    };
}

async function onConsentPage(options: StartOptions = signedIn(), path = PAGE): Promise<Harness> {
    const harness = startAt(path, options);
    await settledAt(harness, path, "oauth-consent");
    return harness;
}

async function ready(harness: Harness): Promise<HTMLElement> {
    await vi.waitFor(() => expect(harness.target.querySelector("[data-site-oauth-ready]")).not.toBeNull());
    return harness.target.querySelector<HTMLElement>("[data-site-oauth-ready]")!;
}

async function endedCard(harness: Harness, code: string): Promise<HTMLElement> {
    await vi.waitFor(() => expect(harness.target.querySelector(`[data-site-oauth-ended="${code}"]`)).not.toBeNull());
    return harness.target.querySelector<HTMLElement>(`[data-site-oauth-ended="${code}"]`)!;
}

const button = (root: ParentNode, attribute: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[${attribute}]`)!;
const bodiesOf = ({requests}: Harness, key: string): unknown[] => requests.filter((request) => `${request.method} ${new URL(request.path, "http://site.invalid").pathname}` === key).map((request) => request.body);
/** 页面里能点的东西（不算稿纸版式底部的条款链接）。 */
const controlsIn = ({target}: Harness): Element[] => [...target.querySelectorAll('[data-site-page="oauth-consent"] :is(button, a)')];
const statusOf = (root: HTMLElement): string => statusTextOf(root.querySelector<HTMLElement>("[data-site-form-status]")!);

describe("确认卡片", () => {
    it("标题写客户端名字；下面是当前账号与“换一个账号”，要的范围逐项一行，允许与拒绝两个按钮，最后一行写允许后回到哪个主机", async () => {
        const harness = await onConsentPage();
        const card = await ready(harness);
        expect(card.querySelector("[data-site-oauth-heading]")?.textContent).toBe(fill(text.heading, {client: "书架同步助手"}));
        expect(card.querySelector(".oauth-consent__name")?.textContent).toBe("alice");
        expect(card.querySelector("[data-site-oauth-switch]")?.textContent?.trim()).toBe(text.switchAccount);
        expect([...card.querySelectorAll("[data-site-oauth-scope]")].map((item) => [item.getAttribute("data-site-oauth-scope"), item.textContent?.trim()])).toEqual([
            ["openid", text.scopes.openid],
            ["profile", text.scopes.profile],
            ["email", text.scopes.email],
        ]);
        expect([button(card, "data-site-oauth-deny"), button(card, "data-site-oauth-allow")].map((element) => element.textContent?.trim())).toEqual([text.deny, text.allow]);
        expect(card.querySelector("[data-site-oauth-return]")?.textContent?.trim()).toBe(fill(text.returnTo, {host: "shelf.example.com"}));
        // 取数照地址上的 `request`。
        expect(harness.requests.filter((request) => request.method === "GET" && request.path.startsWith(AUTHORIZATION)).map((request) => request.path)).toEqual([`${AUTHORIZATION}?request=${REQUEST}`]);
    });

    it("只要了一部分范围：只列那几项", async () => {
        const harness = await onConsentPage(signedIn({handlers: {[GET_AUTHORIZATION]: () => Response.json({...INFO, scopes: ["openid"]} satisfies OAuthAuthorizationResponse)}}));
        const card = await ready(harness);
        expect([...card.querySelectorAll("[data-site-oauth-scope]")].map((item) => item.getAttribute("data-site-oauth-scope"))).toEqual(["openid"]);
    });

    it("允许：发一次带 accept 为真的确认，整页去回来的客户端地址", async () => {
        const harness = await onConsentPage();
        const card = await ready(harness);
        button(card, "data-site-oauth-allow").click();
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([ALLOWED]));
        expect(bodiesOf(harness, DECIDE)).toEqual([{request: REQUEST, accept: true} satisfies OAuthDecisionRequest]);
    });

    it("拒绝：发一次 accept 为假的确认，整页去回来的地址（客户端收到 access_denied）", async () => {
        const harness = await onConsentPage();
        const card = await ready(harness);
        button(card, "data-site-oauth-deny").click();
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([DENIED]));
        expect(bodiesOf(harness, DECIDE)).toEqual([{request: REQUEST, accept: false} satisfies OAuthDecisionRequest]);
    });

    it("提交还没回来：两个按钮都不能点，连点不发第二次", async () => {
        let answer!: (response: Response) => void;
        const harness = await onConsentPage(signedIn({handlers: {[DECIDE]: () => new Promise<Response>((resolve) => {
            answer = resolve;
        })}}));
        const card = await ready(harness);
        button(card, "data-site-oauth-allow").click();
        await vi.waitFor(() => expect([button(card, "data-site-oauth-deny").disabled, button(card, "data-site-oauth-allow").disabled]).toEqual([true, true]));
        button(card, "data-site-oauth-allow").click();
        button(card, "data-site-oauth-deny").click();
        await nextTask();
        expect(bodiesOf(harness, DECIDE)).toHaveLength(1);
        answer(Response.json({redirectUrl: ALLOWED} satisfies OAuthDecisionResponse));
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([ALLOWED]));
    });

    it("提交回别的失败（unavailable）：原因写状态行，卡片留着，按钮还能点，再点就再发一次", async () => {
        let attempts = 0;
        const harness = await onConsentPage(signedIn({handlers: {[DECIDE]: (body, server, query) => (++attempts === 1 ? failure({error: {code: "unavailable"}}, 503) : decided(body, server, query))}}));
        const card = await ready(harness);
        button(card, "data-site-oauth-allow").click();
        await vi.waitFor(() => expect(statusOf(card)).toBe(zhCN.errors.identity.unavailable));
        expect(harness.left).toEqual([]);
        await vi.waitFor(() => expect(button(card, "data-site-oauth-allow").disabled).toBe(false));
        button(card, "data-site-oauth-allow").click();
        await vi.waitFor(() => expect(harness.left.map((leave) => leave.url)).toEqual([ALLOWED]));
        expect(bodiesOf(harness, DECIDE)).toHaveLength(2);
    });

    it("提交回 authorization_expired、client_not_found、redirect_uri_invalid：整张卡片换成原因，没有按钮", async () => {
        for (const [code, status] of [["authorization_expired", 400], ["client_not_found", 400], ["redirect_uri_invalid", 400]] as const) {
            const harness = await onConsentPage(signedIn({handlers: {[DECIDE]: () => failure({error: {code}}, status)}}));
            const card = await ready(harness);
            button(card, "data-site-oauth-allow").click();
            const ended = await endedCard(harness, code);
            expect(ended.querySelector("h1")?.textContent).toBe(text.ended[code].title);
            expect(ended.textContent).toContain(text.ended[code].detail);
            expect(harness.target.querySelector("[data-site-oauth-ready]")).toBeNull();
            expect(controlsIn(harness)).toHaveLength(0);
            expect(harness.left).toEqual([]);
            cleanUp();
        }
    });

    it("“换一个账号”：退出当前账号，带着这一页去登录", async () => {
        const harness = await onConsentPage(signedIn({handlers: {[LOGOUT]: (_body, server) => {
            server.session = undefined;
            return Response.json({});
        }}}));
        const card = await ready(harness);
        button(card, "data-site-oauth-switch").click();
        await settledAt(harness, `/login?next=${encodeURIComponent(PAGE)}`, "login");
        expect(bodiesOf(harness, LOGOUT)).toHaveLength(1);
    });
});

describe("取数", () => {
    it("回 authorization_expired、client_not_found、redirect_uri_invalid：整张卡片写原因，没有按钮", async () => {
        for (const code of ["authorization_expired", "client_not_found", "redirect_uri_invalid"] as const) {
            const harness = await onConsentPage(signedIn({handlers: {[GET_AUTHORIZATION]: () => failure({error: {code}}, 400)}}));
            const ended = await endedCard(harness, code);
            expect(ended.querySelector("h1")?.textContent).toBe(text.ended[code].title);
            expect(controlsIn(harness)).toHaveLength(0);
            cleanUp();
        }
    });

    it("取数失败（连不上）：卡片里写原因与重试；点重试再取一次，取到了画确认卡片", async () => {
        let attempts = 0;
        const harness = await onConsentPage(signedIn({handlers: {[GET_AUTHORIZATION]: () => {
            attempts++;
            if (attempts === 1) throw new TypeError("Failed to fetch");
            return Response.json(INFO);
        }}}));
        await vi.waitFor(() => expect(harness.target.querySelector("[data-site-oauth-failed]")).not.toBeNull());
        const failed = harness.target.querySelector<HTMLElement>("[data-site-oauth-failed]")!;
        expect(failed.getAttribute("role")).toBe("alert");
        expect(failed.textContent).toContain(text.loadFailed);
        expect(failed.textContent).toContain(zhCN.errors.web.network);
        [...failed.querySelectorAll("button")].find((element) => element.textContent?.trim() === text.retry)!.click();
        await ready(harness);
        expect(attempts).toBe(2);
    });

    it("200 毫秒内取到：不出现“正在载入”；超过 200 毫秒才出现，取到后换成确认卡片", async () => {
        let answer!: (response: Response) => void;
        const harness = await onConsentPage(signedIn({handlers: {[GET_AUTHORIZATION]: () => new Promise<Response>((resolve) => {
            answer = resolve;
        })}}));
        const loading = (): string => harness.target.querySelector("[data-site-oauth-loading]")?.textContent?.trim() ?? "";
        expect(harness.target.querySelector("[data-site-oauth-loading]")).not.toBeNull();
        harness.clock.advance(199);
        await nextTask();
        expect(loading()).toBe("");
        harness.clock.advance(1);
        await vi.waitFor(() => expect(loading()).toBe(text.loading));
        answer(Response.json(INFO));
        await ready(harness);
        expect(harness.target.querySelector("[data-site-oauth-loading]")).toBeNull();
    });
});

describe("地址上的 error 与缺 request", () => {
    it("?error= 是合同里的码：访客也看得到整张说明卡片，不取接口、没有按钮", async () => {
        for (const code of ["client_not_found", "redirect_uri_invalid"] as const) {
            const path = `/oauth/consent?error=${code}`;
            const harness = startAt(path);
            await settledAt(harness, path, "oauth-consent");
            const ended = await endedCard(harness, code);
            expect(ended.querySelector("h1")?.textContent).toBe(text.ended[code].title);
            expect(ended.textContent).toContain(text.ended[code].detail);
            expect(controlsIn(harness)).toHaveLength(0);
            expect(harness.requests.filter((request) => request.path.startsWith(AUTHORIZATION))).toEqual([]);
            cleanUp();
        }
    });

    it("?error= 是没认出的码：通用文案后附上这个码；不像码的一段话不照抄", async () => {
        const unknown = startAt("/oauth/consent?error=server_error");
        await settledAt(unknown, "/oauth/consent?error=server_error", "oauth-consent");
        const card = await endedCard(unknown, "server_error");
        expect(card.querySelector("h1")?.textContent).toBe(text.ended.unknown.title);
        expect(card.textContent).toContain(fill(text.ended.unknown.code, {code: "server_error"}));
        cleanUp();

        const prose = encodeURIComponent("请改去 evil.example 登录");
        const harness = startAt(`/oauth/consent?error=${prose}`);
        await vi.waitFor(() => expect(harness.target.querySelector("[data-site-oauth-ended] h1")?.textContent).toBe(text.ended.unknown.title));
        const ended = harness.target.querySelector<HTMLElement>("[data-site-oauth-ended]")!;
        expect(ended.textContent).toContain(text.ended.unknown.detail);
        expect(ended.textContent).not.toContain("evil.example");
    });

    it("地址上 request 与 error 都没有：当作过期的请求", async () => {
        const harness = await onConsentPage(signedIn(), "/oauth/consent");
        await endedCard(harness, "authorization_expired");
        expect(harness.requests.filter((request) => request.path.startsWith(AUTHORIZATION))).toEqual([]);
    });
});

describe("谁进得来", () => {
    it("带 request 的访客先去登录，登录后回到这一页", async () => {
        const harness = startAt(PAGE, signedIn({session: undefined}));
        await settledAt(harness, `/login?next=${encodeURIComponent(PAGE)}`, "login");
        expect(harness.requests.filter((request) => request.path.startsWith(AUTHORIZATION))).toEqual([]);
    });

    it("缺同意的人先去同意页，补交后回到这一页", async () => {
        const harness = startAt(PAGE, signedIn({session: {role: "user", consentRequired: true}}));
        await settledAt(harness, `/consent?next=${encodeURIComponent(PAGE)}`, "consent");
    });
});
