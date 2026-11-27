/**
 * 管理面板的注册码与邀请码页（`CodesPage.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开 `/admin/codes`，两份列表由
 * 注入的 `fetch` 按查询参数回答（`testing/admin-answers.ts`），时间由手动时钟推进。断言页签上的总数、两份列表各取了什么、筛选与页签
 * 写进地址、停用注册码的确认与失败、发放注册码对话框的校验、请求与成功后显示的码。版式在 `e2e/admin-lists.e2e.ts`。
 */

import {identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {AdminInviteCodeListResponse, RegistrationCodeFilter, RegistrationCodeItem, RegistrationCodeListResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";

import zhCN from "../../locales/zh-CN.json";
import {ADMIN_LIST_URLS, ANCHOR, codeCounts, inviteCode, pageOf, registrationCode} from "../../testing/admin-answers";
import {cleanUp, failure, held, identityUrl, invalidNames, leaveField, nextTask, NOW, openMenu, SETTLE_TIMEOUT_MS, settledAt, startAt, type} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import {endOfLocalDay} from "./format";
import adminZhCN from "./locales/zh-CN.json";

const text = adminZhCN.admin.codes;
const errors = zhCN.errors.identity;

afterEach(cleanUp);

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values[key]));
}

/** 25 个注册码：4 号已停用、5 号已用完，其余可用。 */
function codes(): RegistrationCodeItem[] {
    return Array.from({length: 25}, (_, index) => {
        const id = index + 1;
        if (id === 4) return registrationCode(4, {disabled: true, usable: false});
        if (id === 5) return registrationCode(5, {usedCount: 5, usable: false});
        return registrationCode(id);
    });
}

const MATCHES: Readonly<Record<RegistrationCodeFilter, (item: RegistrationCodeItem) => boolean>> = {
    all: () => true,
    usable: (item) => item.usable,
    exhausted_or_expired: (item) => !item.disabled && !item.usable,
    disabled: (item) => item.disabled,
};

function listCodes(items: () => readonly RegistrationCodeItem[]): Handler {
    return (_body, _server, query) => {
        const counts = codeCounts(Object.fromEntries(Object.entries(MATCHES).map(([name, matches]) => [name, items().filter(matches).length])));
        const filter = (query.get("filter") ?? "all") as RegistrationCodeFilter;
        return Response.json({...pageOf(items().filter(MATCHES[filter]), query), counts} satisfies RegistrationCodeListResponse);
    };
}

const INVITES = [inviteCode(1), inviteCode(2, {owner: null}), inviteCode(3, {usable: false})];
const listInvites: Handler = (_body, _server, query) => Response.json(pageOf(INVITES, query) satisfies AdminInviteCodeListResponse);

const CODES = `GET ${ADMIN_LIST_URLS.registrationCodes}`;
const INVITE_LIST = `GET ${ADMIN_LIST_URLS.inviteCodes}`;

async function openCodes(path = "/admin/codes", handlers: Readonly<Record<string, Handler>> = {}, items = codes()): Promise<Harness> {
    const harness = startAt(path, {session: {role: "admin", consentRequired: false}, handlers: {[CODES]: listCodes(() => items), [INVITE_LIST]: listInvites, ...handlers}});
    const url = new URL(path, "http://site.invalid");
    await settledAt(harness, `${url.pathname}${url.search}`, "admin-codes");
    await vi.waitFor(() => expect(rows(harness).length).toBeGreaterThan(0));
    return harness;
}

function list(harness: Harness): HTMLElement {
    return harness.target.querySelector<HTMLElement>("[data-site-admin-list]")!;
}

/** 当前表格里每一行的码。 */
function rows(harness: Harness): string[] {
    return [...list(harness).querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent?.trim() ?? "").filter((code) => code !== "");
}

function queriesOf(harness: Harness, url: string): Record<string, string>[] {
    return harness.requests.filter((request) => request.method === "GET" && request.path.startsWith(url)).map((request) => Object.fromEntries(new URL(request.path, "http://site.invalid").searchParams));
}

/** 页签：值、写着的字与总数、选中没有。 */
function tabs(harness: Harness): {value: string; text: string; selected: boolean}[] {
    return [...harness.target.querySelectorAll<HTMLButtonElement>("[data-site-admin-code-tabs] [role=tab]")].map((tab) => ({
        value: tab.dataset.tabValue ?? "",
        text: tab.textContent?.replace(/\s+/gu, "") ?? "",
        selected: tab.getAttribute("aria-selected") === "true",
    }));
}

function tab(harness: Harness, value: string): HTMLButtonElement {
    return harness.target.querySelector<HTMLButtonElement>(`[data-site-admin-code-tabs] [role=tab][data-tab-value="${value}"]`)!;
}

function filterButton(harness: Harness, value: string): HTMLButtonElement {
    return harness.target.querySelector<HTMLButtonElement>(`[data-site-admin-filter] [role=radio][data-value="${value}"]`)!;
}

function writes(harness: Harness): {method: string; path: string; body: unknown}[] {
    return harness.requests.filter((request) => request.method !== "GET").map(({method, path, body}) => ({method, path, body}));
}

function dialogStatus(found: HTMLElement): string {
    return found.querySelector("[data-dialog-status]")?.textContent?.trim() ?? "";
}

describe("两份列表与页签", () => {
    it("进页时两份列表都取第 1 页；页签上写着注册码的总数（counts.all）与邀请码的总数", async () => {
        const harness = await openCodes();
        await vi.waitFor(() => expect(tabs(harness)).toEqual([
            {value: "registration", text: `${text.registration}25`, selected: true},
            {value: "invite", text: `${text.invite}3`, selected: false},
        ]));
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toEqual([{page: "1", pageSize: "20"}]);
        expect(queriesOf(harness, ADMIN_LIST_URLS.inviteCodes)).toEqual([{page: "1", pageSize: "20"}]);
        expect(list(harness).dataset.siteAdminList).toBe("registration-codes");
        expect(rows(harness)).toHaveLength(20);
        expect(rows(harness)[0]).toBe(registrationCode(1).code);
    });

    it("注册码的状态列：可用、已停用、已用完各有自己的字；可用次数写“已用 / 上限”", async () => {
        const harness = await openCodes();
        const states = [...list(harness).querySelectorAll("[data-site-admin-code-state]")].slice(0, 5).map((node) => node.textContent?.trim());
        expect(states).toEqual([text.states.usable, text.states.usable, text.states.usable, text.states.disabled, text.states.exhausted]);
        expect(list(harness).querySelector("tbody tr td:nth-child(3)")?.textContent?.trim()).toBe(fill(text.usedOf, {used: 1, max: 5}));
    });

    it("注册码不能用、没停用、没用完，过期时间在浏览器看来还没到（时钟比服务端慢）：写“已过期”，不写“已停用”", async () => {
        const items = codes();
        items[0] = registrationCode(1, {usable: false, expiresAt: new Date(NOW + 60_000).toISOString()});
        const harness = await openCodes("/admin/codes", {}, items);
        expect(list(harness).querySelector("[data-site-admin-code-state]")?.textContent?.trim()).toBe(text.states.expired);
    });

    it("换到邀请码页签：地址写上 kind=invite（push），表格换成邀请码，不再取一次；后退回到注册码", async () => {
        const harness = await openCodes();
        tab(harness, "invite").click();
        await settledAt(harness, "/admin/codes?kind=invite", "admin-codes");
        await vi.waitFor(() => expect(list(harness).dataset.siteAdminList).toBe("invite-codes"));
        expect(rows(harness)).toEqual(INVITES.map((item) => item.code));
        expect(list(harness).textContent).toContain(text.noOwner);
        expect(queriesOf(harness, ADMIN_LIST_URLS.inviteCodes)).toHaveLength(1);
        expect(tabs(harness).find((entry) => entry.selected)?.value).toBe("invite");

        harness.site.router.back();
        await settledAt(harness, "/admin/codes", "admin-codes");
        await vi.waitFor(() => expect(list(harness).dataset.siteAdminList).toBe("registration-codes"));
    });

    it("注册码的筛选写进地址、回到第 1 页、不带旧基准；条数取回答", async () => {
        const harness = await openCodes("/admin/codes?page=2");
        filterButton(harness, "usable").click();
        await settledAt(harness, "/admin/codes?filter=usable", "admin-codes");
        await vi.waitFor(() => expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).at(-1)).toEqual({page: "1", pageSize: "20", filter: "usable"}));
        expect(filterButton(harness, "usable").textContent?.replace(/\s+/gu, "")).toBe(`${text.filters.usable}23`);
        expect(filterButton(harness, "disabled").textContent?.replace(/\s+/gu, "")).toBe(`${text.filters.disabled}1`);
    });

    it("从邀请码页签的地址打开（刷新）：邀请码那份照地址取，注册码那份取第 1 页", async () => {
        const harness = startAt("/admin/codes?kind=invite", {session: {role: "admin", consentRequired: false}, handlers: {[CODES]: listCodes(() => codes()), [INVITE_LIST]: listInvites}});
        await settledAt(harness, "/admin/codes?kind=invite", "admin-codes");
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(3));
        expect(list(harness).dataset.siteAdminList).toBe("invite-codes");
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toEqual([{page: "1", pageSize: "20"}]);
    });
});

describe("页码越界", () => {
    /**
     * 从审计页进来，好让“后退”有一个不是越界页的去处。不从看板进：看板的块连着 ECharts，这个文件里第一次进时要现编译，
     * 几个测试文件并行、机器又忙时能超过等页面落定的上限，与这里要看的越界无关。
     */
    async function fromElsewhere(path: string): Promise<Harness> {
        const harness = startAt("/admin/audit", {session: {role: "admin", consentRequired: false}, handlers: {[CODES]: listCodes(() => codes()), [INVITE_LIST]: listInvites}});
        await settledAt(harness, "/admin/audit", "admin-audit");
        void harness.site.router.push(path);
        return harness;
    }

    it("注册码页签的页码超过最后一页：地址换成最后一页（replace），邀请码那份不动；后退不回到越界的那一页", async () => {
        const harness = await fromElsewhere("/admin/codes?page=9");
        await settledAt(harness, "/admin/codes?page=2", "admin-codes");
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(5));
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).map((params) => params.page)).toEqual(["9", "2"]);
        expect(queriesOf(harness, ADMIN_LIST_URLS.inviteCodes)).toEqual([{page: "1", pageSize: "20"}]);

        harness.site.router.back();
        await settledAt(harness, "/admin/audit", "admin-audit");
    });

    it("邀请码页签的页码超过最后一页：地址换成邀请码的第 1 页（replace），注册码那份不动；后退不回到越界的那一页", async () => {
        const harness = await fromElsewhere("/admin/codes?kind=invite&page=9");
        await settledAt(harness, "/admin/codes?kind=invite", "admin-codes");
        await vi.waitFor(() => expect(rows(harness)).toEqual(INVITES.map((item) => item.code)));
        expect(queriesOf(harness, ADMIN_LIST_URLS.inviteCodes).map((params) => params.page)).toEqual(["9", "1"]);
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toEqual([{page: "1", pageSize: "20"}]);

        harness.site.router.back();
        await settledAt(harness, "/admin/audit", "admin-audit");
    });

    it("第 2 页的请求在途时去了用户页，回答才到、而且越界（码少了）：仍停在用户页，不再取注册码", async () => {
        const items = codes();
        const late = held((_body, _server, query) => Response.json({...pageOf([], query), total: 5, counts: codeCounts({all: 5})} satisfies RegistrationCodeListResponse));
        const harness = await openCodes("/admin/codes", {
            [CODES]: (body, server, params) => (params.get("page") === "2" ? late.handler(body, server, params) : listCodes(() => items)(body, server, params)),
        }, items);
        void harness.site.router.push("/admin/codes?page=2");
        await vi.waitFor(() => expect(late.asked).toBe(true));
        void harness.site.router.push("/admin/users");
        await settledAt(harness, "/admin/users", "admin-users");
        const before = queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).length;

        late.release();
        await vi.waitFor(() => expect(late.read).toBe(true));
        // 读完正文到改地址都只排微任务：让出一轮，拽回去的话这时地址已经换了。
        await nextTask();
        expect(harness.site.router.currentRoute.value.fullPath).toBe("/admin/users");
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toHaveLength(before);
    });

    it("在途时离开又回到注册码页（换了筛选），旧页面的越界回答才到：地址不被旧页面改掉", async () => {
        const items = codes();
        const late = held((_body, _server, query) => Response.json({...pageOf([], query), total: 5, counts: codeCounts({all: 5})} satisfies RegistrationCodeListResponse));
        const harness = await openCodes("/admin/codes", {
            [CODES]: (body, server, params) => (params.get("page") === "2" ? late.handler(body, server, params) : listCodes(() => items)(body, server, params)),
        }, items);
        void harness.site.router.push("/admin/codes?page=2");
        await vi.waitFor(() => expect(late.asked).toBe(true));
        void harness.site.router.push("/admin/users");
        await settledAt(harness, "/admin/users", "admin-users");
        void harness.site.router.push("/admin/codes?filter=usable");
        await settledAt(harness, "/admin/codes?filter=usable", "admin-codes");
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(20));

        late.release();
        await vi.waitFor(() => expect(late.read).toBe(true));
        await nextTask();
        expect(harness.site.router.currentRoute.value.fullPath).toBe("/admin/codes?filter=usable");
    });
});

/** 打开某个码那一行的“…”菜单。 */
async function openRowMenu(harness: Harness, code: string): Promise<HTMLElement[]> {
    await openMenu(list(harness).querySelector<HTMLElement>(`[data-site-admin-row-menu="${code}"]`)!);
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function confirmDialog(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-confirm]")).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
    return document.body.querySelector<HTMLElement>("[data-site-admin-confirm]")!;
}

describe("停用注册码", () => {
    const code = registrationCode(2).code;
    const PATCH = `PATCH ${identityUrl(identityPath.adminRegistrationCode(2))}`;

    it("先确认，确认后发 disabled: true、关掉对话框，重取这一页（沿用基准）", async () => {
        const items = codes();
        const harness = await openCodes("/admin/codes", {
            [PATCH]: () => {
                items[1] = {...items[1]!, disabled: true, usable: false};
                return Response.json(items[1]);
            },
        }, items);
        const before = queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).length;
        (await openRowMenu(harness, code))[0]!.click();
        const found = await confirmDialog();
        expect(found.textContent).toContain(fill(text.disable.title, {code}));
        expect(found.textContent).toContain(text.disable.description);
        expect(writes(harness)).toEqual([]);

        found.querySelector<HTMLButtonElement>("[data-site-admin-confirm-button]")!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-confirm]")).toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
        expect(writes(harness)).toEqual([{method: "PATCH", path: identityUrl(identityPath.adminRegistrationCode(2)), body: {disabled: true}}]);
        await vi.waitFor(() => expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toHaveLength(before + 1));
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).at(-1)).toEqual({page: "1", pageSize: "20", anchor: ANCHOR});
        await vi.waitFor(() => expect(list(harness).querySelectorAll("[data-site-admin-code-state]")[1]?.textContent?.trim()).toBe(text.states.disabled));
    });

    it("已停用的码：菜单里“停用”不可用", async () => {
        const harness = await openCodes();
        const items = await openRowMenu(harness, registrationCode(4).code);
        expect(items[0]!.hasAttribute("data-disabled") || items[0]!.getAttribute("aria-disabled") === "true").toBe(true);
    });

    it("码已经不在了（not_found）：原因写在对话框的状态行，列表重取", async () => {
        const harness = await openCodes("/admin/codes", {[PATCH]: () => failure({error: {code: "not_found"}}, 404)});
        const before = queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).length;
        (await openRowMenu(harness, code))[0]!.click();
        const found = await confirmDialog();
        found.querySelector<HTMLButtonElement>("[data-site-admin-confirm-button]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.not_found));
        await vi.waitFor(() => expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toHaveLength(before + 1));
    });

    it("太频繁（rate_limited）：状态行写一句不带秒数的话，倒数完之前确认按钮不可用", async () => {
        const harness = await openCodes("/admin/codes", {[PATCH]: () => failure({error: {code: "rate_limited"}}, 429, {"Retry-After": "3"})});
        (await openRowMenu(harness, code))[0]!.click();
        const found = await confirmDialog();
        const confirm = found.querySelector<HTMLButtonElement>("[data-site-admin-confirm-button]")!;
        confirm.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken));
        expect(confirm.disabled).toBe(true);
        harness.clock.advance(3_000);
        await vi.waitFor(() => expect(confirm.disabled).toBe(false));
    });
});

describe("发放注册码", () => {
    const CREATE = `POST ${ADMIN_LIST_URLS.registrationCodes}`;
    const ISSUED = registrationCode(99, {code: "REG-NEW-CODE", maxUses: 3, usedCount: 0, note: "给 bob"});

    async function openIssue(harness: Harness): Promise<HTMLElement> {
        harness.target.querySelector<HTMLButtonElement>("[data-site-admin-issue]")!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-issue-dialog]")).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
        return document.body.querySelector<HTMLElement>("[data-site-admin-issue-dialog]")!;
    }

    function field(found: HTMLElement, name: string): HTMLInputElement {
        return found.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    }

    function submit(found: HTMLElement): HTMLButtonElement {
        return found.querySelector<HTMLButtonElement>("[data-site-admin-issue-submit]")!;
    }

    /** 在日期控件的年、月、日三段里逐位敲数字（reka 的日期段收键盘输入）。 */
    async function typeDate(found: HTMLElement, day: string): Promise<void> {
        const [year, month, date] = day.split("-") as [string, string, string];
        for (const [part, digits] of [["year", year], ["month", month], ["day", date]] as const) {
            const segment = found.querySelector<HTMLElement>(`[data-site-admin-issue-expires] [data-reka-date-field-segment="${part}"]`)!;
            segment.focus();
            for (const digit of digits) segment.dispatchEvent(new KeyboardEvent("keydown", {key: digit, bubbles: true, cancelable: true}));
            await Promise.resolve();
        }
    }

    it("不填次数、日期与备注就是不限、不过期：发 maxUses: null；成功后对话框换成发出来的码，列表丢掉基准重取", async () => {
        const harness = await openCodes("/admin/codes", {[CREATE]: () => Response.json(ISSUED)});
        const before = queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).length;
        const found = await openIssue(harness);
        expect(found.dataset.siteAdminIssueStep).toBe("form");
        expect(submit(found).disabled).toBe(false);
        submit(found).click();

        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-issued-code]")?.textContent).toBe("REG-NEW-CODE"), {timeout: SETTLE_TIMEOUT_MS});
        expect(writes(harness)).toEqual([{method: "POST", path: ADMIN_LIST_URLS.registrationCodes, body: {maxUses: null}}]);
        expect(found.textContent).toContain(text.issue.doneDescription);
        await vi.waitFor(() => expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes)).toHaveLength(before + 1));
        // 新码建在旧基准之后：重取不带基准，否则列表里没有它。
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).at(-1)).toEqual({page: "1", pageSize: "20"});

        found.querySelector<HTMLButtonElement>("[data-site-admin-issue-finish]")!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-issue-dialog]")).toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
        // 再打开是一张空白的表。
        const again = await openIssue(harness);
        expect(again.dataset.siteAdminIssueStep).toBe("form");
        expect(field(again, "maxUses").value).toBe("");
    });

    it("点了“完成”马上又点“发放”（上一次还没关完）：也是一张空白的表，对话框里没有上一次的码", async () => {
        const harness = await openCodes("/admin/codes", {[CREATE]: () => Response.json(ISSUED)});
        const found = await openIssue(harness);
        type(field(found, "maxUses"), "3");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-issued-code]")?.textContent).toBe("REG-NEW-CODE"), {timeout: SETTLE_TIMEOUT_MS});

        // 两次点击之间只让 Vue 画一次（微任务），不让出事件循环：nb-ui 的 `closed` 排在之后的宏任务里，这时一定还没发。
        found.querySelector<HTMLButtonElement>("[data-site-admin-issue-finish]")!.click();
        await nextTick();
        harness.target.querySelector<HTMLButtonElement>("[data-site-admin-issue]")!.click();
        await nextTick();
        const again = document.body.querySelector<HTMLElement>("[data-site-admin-issue-dialog]")!;
        expect(again.dataset.siteAdminIssueStep).toBe("form");
        await vi.waitFor(() => expect(field(again, "maxUses")?.value).toBe(""), {timeout: SETTLE_TIMEOUT_MS});
        expect(again.textContent).not.toContain("REG-NEW-CODE");
    });

    it("在第 2 页发放：成功后回到第 1 页（push），不带旧基准取，新码在最前", async () => {
        const harness = await openCodes("/admin/codes?page=2", {[CREATE]: () => Response.json(ISSUED)});
        const found = await openIssue(harness);
        submit(found).click();
        await settledAt(harness, "/admin/codes", "admin-codes");
        await vi.waitFor(() => expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).at(-1)).toEqual({page: "1", pageSize: "20"}));
        // 回到第 1 页之后只取了这一次：没有先带旧基准取一次第 1 页。
        expect(queriesOf(harness, ADMIN_LIST_URLS.registrationCodes).map((params) => params.page)).toEqual(["2", "1"]);

        harness.site.router.back();
        await settledAt(harness, "/admin/codes?page=2", "admin-codes");
    });

    it("填了次数、过期日期与备注：照填的发出去，日期是那一天在本地结束的一刻，备注去掉前后空白", async () => {
        const harness = await openCodes("/admin/codes", {[CREATE]: () => Response.json(ISSUED)});
        const found = await openIssue(harness);
        type(field(found, "maxUses"), "3");
        type(field(found, "note"), "  给 bob ");
        await typeDate(found, "2026-12-31");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        submit(found).click();
        await vi.waitFor(() => expect(writes(harness)).toHaveLength(1));
        expect(writes(harness)[0]!.body).toEqual({maxUses: 3, expiresAt: endOfLocalDay("2026-12-31"), note: "给 bob"});
    });

    it("次数不是正整数：提交按钮不可用，离开那一格时状态行写规则、那一格标红", async () => {
        const harness = await openCodes();
        const found = await openIssue(harness);
        for (const value of ["0", "-1", "1.5", "abc", "99999999999999999"]) {
            type(field(found, "maxUses"), value);
            await vi.waitFor(() => expect({value, disabled: submit(found).disabled}).toEqual({value, disabled: true}));
        }
        leaveField(field(found, "maxUses"));
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(text.issue.rules.maxUses));
        expect(invalidNames(found)).toEqual(["maxUses"]);
        type(field(found, "maxUses"), "12");
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
        expect(writes(harness)).toEqual([]);
    });

    it("过期日期早于今天：状态行写规则，提交按钮不可用；改到今天以后就好", async () => {
        const harness = await openCodes();
        const found = await openIssue(harness);
        await typeDate(found, "2026-11-25");
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(text.issue.rules.expiresAt));
        expect(submit(found).disabled).toBe(true);
        await typeDate(found, new Date(NOW).toISOString().slice(0, 10));
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(""));
        expect(submit(found).disabled).toBe(false);
    });

    it("服务端回 validation_failed：按 fields 标红，状态行写原因，对话框留在表单那一步", async () => {
        const harness = await openCodes("/admin/codes", {[CREATE]: () => failure({error: {code: "validation_failed", fields: ["note"]}}, 400)});
        const found = await openIssue(harness);
        type(field(found, "note"), "备注");
        submit(found).click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.validation_failed));
        expect(invalidNames(found)).toEqual(["note"]);
        expect(found.dataset.siteAdminIssueStep).toBe("form");
    });

    it("太频繁（rate_limited）：状态行写一句不带秒数的话，倒数完之前不能再提交", async () => {
        const harness = await openCodes("/admin/codes", {[CREATE]: () => failure({error: {code: "rate_limited"}}, 429, {"Retry-After": "4"})});
        const found = await openIssue(harness);
        submit(found).click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken));
        expect(submit(found).disabled).toBe(true);
        harness.clock.advance(4_000);
        await vi.waitFor(() => expect(submit(found).disabled).toBe(false));
    });
});
