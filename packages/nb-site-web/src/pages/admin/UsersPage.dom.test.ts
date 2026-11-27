/**
 * 管理面板的用户页（`UsersPage.vue`）：装起整个站点（`testing/site-harness.ts`），以管理员身份打开 `/admin/users`，账号列表由注入的
 * `fetch` 按查询参数回答（`testing/admin-answers.ts`），时间由手动时钟推进。断言看得到的与发出去的：表格里有哪几行、筛选项写着几条、
 * 地址怎样变、请求带了什么参数，每行菜单里各项处置的确认、失败与成功，重置密码的新密码只出现一次。
 * 版式（只有表格区滚动、分页条贴底、没有页面级横向滚动）要真实布局，在 `e2e/admin-lists.e2e.ts`。
 */

import {identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {AdminUserItem, UserFilter, UserListResponse} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {ADMIN_LIST_URLS, ANCHOR, adminUser, pageOf, userCounts} from "../../testing/admin-answers";
import {SETTLE_TIMEOUT_MS, cleanUp, failure, identityUrl, nextTask, settledAt, startAt} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";
import {SEARCH_PAUSE_MS} from "./use-admin-list";

const text = zhCN.admin.users;
const errors = zhCN.errors.identity;

afterEach(cleanUp);

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values[key]));
}

/** 45 个账号：第 1 个是管理员，3、6、9…… 已封禁，第 7 个是当前登录的管理员 alice。 */
function people(count = 45): AdminUserItem[] {
    return Array.from({length: count}, (_, index) => {
        const id = index + 1;
        if (id === 7) return adminUser(7, {username: "alice", displayName: "Alice", role: "admin"});
        return adminUser(id, {role: id === 1 ? "admin" : "user", banned: id % 3 === 0});
    });
}

const MATCHES: Readonly<Record<UserFilter, (user: AdminUserItem) => boolean>> = {
    all: () => true,
    admin: (user) => user.role === "admin",
    banned: (user) => user.banned,
    email_pending: (user) => user.emailPending,
};

/** 照合同回答 `GET users`：按 `q` 的前缀与 `filter` 筛，`counts` 是当前搜索下各筛选项的条数。 */
function listUsers(users: () => readonly AdminUserItem[]): Handler {
    return (_body, _server, query) => {
        const q = query.get("q")?.toLowerCase() ?? "";
        const searched = users().filter((user) => q === "" || [user.username, user.displayName, user.email ?? ""].some((value) => value.toLowerCase().startsWith(q)));
        const filter = (query.get("filter") ?? "all") as UserFilter;
        const counts = userCounts(Object.fromEntries(Object.entries(MATCHES).map(([name, matches]) => [name, searched.filter(matches).length])));
        return Response.json({...pageOf(searched.filter(MATCHES[filter]), query), counts} satisfies UserListResponse);
    };
}

const LIST = `GET ${ADMIN_LIST_URLS.users}`;

async function openUsers(path = "/admin/users", handlers: Readonly<Record<string, Handler>> = {}, users = people()): Promise<Harness> {
    const harness = startAt(path, {session: {role: "admin", consentRequired: false}, handlers: {[LIST]: listUsers(() => users), ...handlers}});
    const url = new URL(path, "http://site.invalid");
    await settledAt(harness, `${url.pathname}${url.search}`, "admin-users");
    await vi.waitFor(() => expect(rows(harness).length).toBeGreaterThan(0));
    return harness;
}

function table(harness: Harness): HTMLElement {
    return harness.target.querySelector<HTMLElement>('[data-site-admin-list="users"]')!;
}

/** 表格里每一行的用户名。 */
function rows(harness: Harness): string[] {
    return [...table(harness).querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent?.replace(text.admin, "").trim() ?? "").filter((name) => name !== "");
}

/** 列表请求的查询参数，按发出的先后。 */
function listQueries(harness: Harness): Record<string, string>[] {
    return harness.requests.filter((request) => request.method === "GET" && request.path.startsWith(ADMIN_LIST_URLS.users)).map((request) => Object.fromEntries(new URL(request.path, "http://site.invalid").searchParams));
}

function query(harness: Harness): Record<string, unknown> {
    return {...harness.site.router.currentRoute.value.query};
}

/** 筛选项：值、写着的字与条数、选中没有。 */
function filters(harness: Harness): {value: string; text: string; checked: boolean}[] {
    return [...harness.target.querySelectorAll<HTMLButtonElement>("[data-site-admin-filter] [role=radio]")].map((button) => ({
        value: button.dataset.value ?? "",
        text: button.textContent?.replace(/\s+/gu, "") ?? "",
        checked: button.getAttribute("aria-checked") === "true",
    }));
}

function filterButton(harness: Harness, value: string): HTMLButtonElement {
    return harness.target.querySelector<HTMLButtonElement>(`[data-site-admin-filter] [role=radio][data-value="${value}"]`)!;
}

function searchInput(harness: Harness): HTMLInputElement {
    return harness.target.querySelector<HTMLInputElement>("[data-site-admin-search] input")!;
}

function typeSearch(harness: Harness, value: string): void {
    const input = searchInput(harness);
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

/** 分页条上写着这个页码的按钮。 */
function pageButton(harness: Harness, page: number): HTMLButtonElement {
    const found = [...table(harness).querySelectorAll<HTMLButtonElement>("nav button")].find((button) => button.textContent?.trim() === String(page));
    if (found === undefined) throw new Error(`分页条上没有第 ${page} 页`);
    return found;
}

/** 一个先不回答的请求：`release` 之后才交给 `respond` 回答。 */
function held(respond: Handler): {readonly handler: Handler; release(): void; readonly asked: boolean; readonly read: boolean} {
    let release: (() => void) | undefined;
    let answered: Response | undefined;
    return {
        handler: (body, server, params) => new Promise<Response>((resolve) => {
            release = () => void Promise.resolve(respond(body, server, params)).then((response) => {
                answered = response;
                resolve(response);
            });
        }),
        release: () => release?.(),
        get asked() {
            return release !== undefined;
        },
        /** 页面开始读这份回答的正文了（接口层 `response.json()`）。之后到用不用它，只隔几个微任务。 */
        get read() {
            return answered?.bodyUsed === true;
        },
    };
}

describe("最后登录", () => {
    /** 每一行“最后登录”那一格的字，按用户名。 */
    function lastLogins(harness: Harness): Record<string, string> {
        const headers = [...table(harness).querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
        const column = headers.indexOf(text.columns.lastLoginAt);
        return Object.fromEntries([...table(harness).querySelectorAll("tbody tr")].map((row) => {
            const cells = row.querySelectorAll("td");
            return [cells[1]?.textContent?.replace(text.admin, "").trim() ?? "", cells[column]?.textContent?.trim() ?? ""];
        }));
    }

    // 现在（`NOW`）是 11 月 26 日 10:00 UTC。
    const users = (): AdminUserItem[] => [
        adminUser(1, {username: "minutes", lastLoginAt: "2026-11-26T09:30:00.000Z"}),
        adminUser(2, {username: "hours", lastLoginAt: "2026-11-26T07:00:00.000Z"}),
        adminUser(3, {username: "yesterday", lastLoginAt: "2026-11-25T08:00:00.000Z"}),
        adminUser(4, {username: "earlier", lastLoginAt: "2026-11-10T08:00:00.000Z"}),
        adminUser(5, {username: "never", lastLoginAt: null}),
        ...Array.from({length: 20}, (_, index) => adminUser(10 + index)),
    ];

    it("一小时内写“刚刚”，一天内写几小时前，昨天写“昨天”，更早的写短日期，没有登录过的写明；准确时刻在悬停提示里", async () => {
        const harness = await openUsers("/admin/users", {}, users());
        expect(lastLogins(harness)).toMatchObject({minutes: text.justNow, hours: "3小时前", yesterday: "昨天", earlier: "11-10", never: text.neverSignedIn});
        const time = [...table(harness).querySelectorAll<HTMLTimeElement>("tbody time")].find((element) => element.dateTime === "2026-11-10T08:00:00.000Z")!;
        expect(time.title).toMatch(/2026/u);
    });

    it("时间往前走了：再画这一页（翻页回来）时按新的现在写", async () => {
        const harness = await openUsers("/admin/users", {}, users());
        expect(lastLogins(harness)).toMatchObject({minutes: text.justNow, hours: "3小时前"});
        harness.clock.advance(2 * 60 * 60 * 1000);
        pageButton(harness, 2).click();
        await settledAt(harness, "/admin/users?page=2", "admin-users");
        await vi.waitFor(() => expect(rows(harness)).not.toContain("minutes"));
        harness.site.router.back();
        await settledAt(harness, "/admin/users", "admin-users");
        await vi.waitFor(() => expect(lastLogins(harness)).toMatchObject({minutes: "2小时前", hours: "5小时前"}));
    });
});

describe("取数与地址", () => {
    it("第一次打开取第 1 页、每页 20 条、不带基准；筛选项的条数取回答的 counts", async () => {
        const harness = await openUsers();
        expect(listQueries(harness)).toEqual([{page: "1", pageSize: "20"}]);
        expect(rows(harness)).toHaveLength(20);
        expect(rows(harness)[0]).toBe("user1");
        expect(filters(harness)).toEqual([
            {value: "all", text: `${text.filters.all}45`, checked: true},
            {value: "admin", text: `${text.filters.admin}2`, checked: false},
            {value: "banned", text: `${text.filters.banned}15`, checked: false},
            {value: "email_pending", text: `${text.filters.email_pending}0`, checked: false},
        ]);
        expect(table(harness).querySelector(".nb-data-table-count")?.textContent).toContain("45");
    });

    it("翻页写进地址（push），同一次翻页带着第一次回来的基准；后退回到上一页", async () => {
        const harness = await openUsers();
        pageButton(harness, 2).click();
        await settledAt(harness, "/admin/users?page=2", "admin-users");
        await vi.waitFor(() => expect(rows(harness)[0]).toBe("user21"));
        expect(listQueries(harness).at(-1)).toEqual({page: "2", pageSize: "20", anchor: ANCHOR});

        harness.site.router.back();
        await settledAt(harness, "/admin/users", "admin-users");
        await vi.waitFor(() => expect(rows(harness)[0]).toBe("user1"));
        expect(listQueries(harness).at(-1)).toEqual({page: "1", pageSize: "20", anchor: ANCHOR});
    });

    it("从带着页码、筛选与搜索词的地址打开（刷新）：照地址取，不带基准；框里是地址里的搜索词", async () => {
        const harness = await openUsers("/admin/users?filter=all&q=user&page=2");
        expect(listQueries(harness)).toEqual([{page: "2", pageSize: "20", q: "user"}]);
        expect(rows(harness)[0]).toBe("user21");
        expect(searchInput(harness).value).toBe("user");

        const banned = await openUsers("/admin/users?filter=banned");
        expect(filters(banned).find((filter) => filter.checked)?.value).toBe("banned");
        expect(listQueries(banned)).toEqual([{page: "1", pageSize: "20", filter: "banned"}]);
    });

    it("地址里不合的值读成缺省", async () => {
        const harness = await openUsers("/admin/users?filter=nobody&page=abc");
        expect(listQueries(harness)).toEqual([{page: "1", pageSize: "20"}]);
        expect(filters(harness).find((filter) => filter.checked)?.value).toBe("all");
    });

    it("换筛选回到第 1 页、不带旧基准；条数随回答更新", async () => {
        let anchor = 0;
        const harness = await openUsers("/admin/users?page=2", {
            [LIST]: (body, server, params) => {
                // 90 个账号：封禁的有 30 个，筛完还有第 2 页。
                const response = listUsers(() => people(90))(body, server, params) as Response;
                // 每次不带基准的请求回一个新基准，看得出后来的请求沿用的是哪一个。
                if (params.has("anchor")) return response;
                anchor += 1;
                return response.json().then((value: UserListResponse) => Response.json({...value, anchor: `t${anchor}`}));
            },
        });
        filterButton(harness, "banned").click();
        await settledAt(harness, "/admin/users?filter=banned", "admin-users");
        await vi.waitFor(() => expect(rows(harness)[0]).toBe("user3"));
        expect(listQueries(harness).at(-1)).toEqual({page: "1", pageSize: "20", filter: "banned"});

        pageButton(harness, 2).click();
        await settledAt(harness, "/admin/users?filter=banned&page=2", "admin-users");
        expect(listQueries(harness).at(-1)).toEqual({page: "2", pageSize: "20", filter: "banned", anchor: "t2"});
    });

    it("页码超过最后一页：地址换成最后一页（replace），再取一次；后退不回到越界的那一页", async () => {
        const harness = startAt("/admin", {session: {role: "admin", consentRequired: false}, handlers: {[LIST]: listUsers(() => people())}});
        await settledAt(harness, "/admin", "admin-dashboard");
        void harness.site.router.push("/admin/users?page=9");
        await settledAt(harness, "/admin/users?page=3", "admin-users");
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(5));
        expect(listQueries(harness).map((params) => params.page)).toEqual(["9", "3"]);
        expect(table(harness).querySelector(".nb-data-table-count")?.textContent).toContain("41");

        harness.site.router.back();
        await settledAt(harness, "/admin", "admin-dashboard");
    });

    it("先发后到的回答丢掉：换了筛选之后，上一个筛选的结果晚到也不盖掉", async () => {
        const users = people();
        const late = held(listUsers(() => users));
        const harness = await openUsers("/admin/users", {
            [LIST]: (body, server, params) => (params.get("filter") === "admin" ? late.handler(body, server, params) : listUsers(() => users)(body, server, params)),
        }, users);

        filterButton(harness, "admin").click();
        await vi.waitFor(() => expect(late.asked).toBe(true));
        filterButton(harness, "banned").click();
        await vi.waitFor(() => expect(rows(harness)[0]).toBe("user3"));

        late.release();
        await vi.waitFor(() => expect(late.read).toBe(true));
        // 读完正文到“用还是丢”再到重画都是微任务：让出一轮事件循环，它们就都跑完了；丢不掉的话这时表格已经换成管理员。
        await nextTask();
        expect(rows(harness)[0]).toBe("user3");
        expect(filters(harness).find((filter) => filter.checked)?.value).toBe("banned");
    });

    it("取数失败：表格区写原因，点重试再取", async () => {
        let fail = true;
        const harness = startAt("/admin/users", {
            session: {role: "admin", consentRequired: false},
            handlers: {[LIST]: (body, server, params) => (fail ? failure({error: {code: "unavailable"}}, 503) : listUsers(() => people())(body, server, params))},
        });
        await settledAt(harness, "/admin/users", "admin-users");
        await vi.waitFor(() => expect(table(harness).querySelector("[role=alert]")?.textContent).toContain(errors.unavailable));
        fail = false;
        table(harness).querySelector<HTMLButtonElement>("[role=alert] button")!.click();
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(20));
    });
});

describe("搜索", () => {
    it("停 300 毫秒才取一次：连着打的几个字只发一个请求；地址换成搜索词（replace）、回到第 1 页", async () => {
        const harness = startAt("/admin", {session: {role: "admin", consentRequired: false}, handlers: {[LIST]: listUsers(() => people())}});
        await settledAt(harness, "/admin", "admin-dashboard");
        void harness.site.router.push("/admin/users?page=2");
        await settledAt(harness, "/admin/users?page=2", "admin-users");
        await vi.waitFor(() => expect(rows(harness)[0]).toBe("user21"));
        const before = listQueries(harness).length;
        // 每两个字之间让出一轮：像真人打字那样，字与字之间够一次导航与取数跑完，每个字都取的话这里就看得见。
        typeSearch(harness, "u");
        harness.clock.advance(100);
        await nextTask();
        typeSearch(harness, "us");
        harness.clock.advance(100);
        await nextTask();
        typeSearch(harness, "user4");
        harness.clock.advance(SEARCH_PAUSE_MS - 1);
        await nextTask();
        expect(listQueries(harness)).toHaveLength(before);
        expect(query(harness)).toEqual({page: "2"});

        harness.clock.advance(1);
        await settledAt(harness, "/admin/users?q=user4", "admin-users");
        await vi.waitFor(() => expect(rows(harness)).toEqual(["user4", "user40", "user41", "user42", "user43", "user44", "user45"]));
        expect(listQueries(harness).slice(before)).toEqual([{page: "1", pageSize: "20", q: "user4"}]);
        // 搜索词是 replace：后退回到进用户页之前的看板，不是搜索之前的第 2 页。
        harness.site.router.back();
        await settledAt(harness, "/admin", "admin-dashboard");
    });

    it("搜索词前后的空白不算；只有空白等于不搜；按回车立刻取", async () => {
        const harness = await openUsers("/admin/users?q=user4");
        const before = listQueries(harness).length;
        typeSearch(harness, "  user4  ");
        harness.clock.advance(SEARCH_PAUSE_MS);
        await nextTask();
        expect(listQueries(harness)).toHaveLength(before);

        typeSearch(harness, "   ");
        searchInput(harness).dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await settledAt(harness, "/admin/users", "admin-users");
        await vi.waitFor(() => expect(rows(harness)).toHaveLength(20));
        expect(listQueries(harness).slice(before)).toEqual([{page: "1", pageSize: "20"}]);
    });

    it("后退到别的搜索词时框里的字跟着换", async () => {
        const harness = await openUsers();
        filterButton(harness, "banned").click();
        await settledAt(harness, "/admin/users?filter=banned", "admin-users");
        typeSearch(harness, "user3");
        harness.clock.advance(SEARCH_PAUSE_MS);
        await settledAt(harness, "/admin/users?filter=banned&q=user3", "admin-users");
        harness.site.router.back();
        await settledAt(harness, "/admin/users", "admin-users");
        await vi.waitFor(() => expect(searchInput(harness).value).toBe(""));
    });
});

/** 打开某一行的“…”菜单，回菜单项（写着的字与能不能点）。 */
async function openRowMenu(harness: Harness, username: string): Promise<HTMLElement[]> {
    const trigger = table(harness).querySelector<HTMLButtonElement>(`[data-site-admin-row-menu="${username}"]`)!;
    expect(trigger.getAttribute("aria-label") ?? trigger.getAttribute("title")).toBe(fill(text.rowActions, {username}));
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull(), {timeout: SETTLE_TIMEOUT_MS});
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function menuItem(items: readonly HTMLElement[], label: string): HTMLElement {
    const found = items.find((item) => item.textContent?.trim() === label);
    if (found === undefined) throw new Error(`菜单里没有“${label}”`);
    return found;
}

function dialog(): HTMLElement {
    return document.body.querySelector<HTMLElement>("[data-site-admin-user-dialog]")!;
}

async function openedDialog(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-user-dialog]")).not.toBeNull());
    return dialog();
}

function dialogStatus(found: HTMLElement): string {
    return found.querySelector("[data-dialog-status]")?.textContent?.trim() ?? "";
}

function dialogTitle(found: HTMLElement): string {
    return found.querySelector(".nb-ui-dialog-title")?.textContent?.trim() ?? "";
}

async function closed(): Promise<void> {
    await vi.waitFor(() => expect(document.body.querySelector("[data-site-admin-user-dialog]")).toBeNull());
}

/** 除了读列表以外的请求。 */
function writes(harness: Harness): {method: string; path: string; body: unknown}[] {
    return harness.requests.filter((request) => request.method !== "GET").map(({method, path, body}) => ({method, path, body}));
}

const actionUrl = (id: number, action: Parameters<typeof identityPath.adminUserAction>[1]): string => identityUrl(identityPath.adminUserAction(id, action));

/** 四项会回处置之后那一条的处置：菜单上的字、对哪个账号、发到哪、带什么、成功后那一行变成什么。 */
const ACTIONS = [
    {name: "ban", user: "user2", id: 2, path: actionUrl(2, "ban"), body: undefined, after: {banned: true}},
    {name: "unban", user: "user3", id: 3, path: actionUrl(3, "unban"), body: undefined, after: {banned: false}},
    {name: "grantAdmin", user: "user2", id: 2, path: actionUrl(2, "role"), body: {role: "admin"}, after: {role: "admin"}},
    {name: "revokeAdmin", user: "user1", id: 1, path: actionUrl(1, "role"), body: {role: "user"}, after: {role: "user"}},
    {name: "revokeSessions", user: "user2", id: 2, path: actionUrl(2, "revoke-sessions"), body: undefined, after: {}},
] as const;

describe("每行的处置", () => {
    it("菜单的几项随这一行的状态换；自己那一行不能封禁、不能取消管理员", async () => {
        const harness = await openUsers();
        expect((await openRowMenu(harness, "user2")).map((item) => item.textContent?.trim())).toEqual([text.actions.resetPassword.menu, text.actions.ban.menu, text.actions.grantAdmin.menu, text.actions.revokeSessions.menu]);
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).toBeNull(), {timeout: SETTLE_TIMEOUT_MS});

        const own = await openRowMenu(harness, "alice");
        expect(own.map((item) => ({label: item.textContent?.trim(), disabled: item.hasAttribute("data-disabled") || item.getAttribute("aria-disabled") === "true"}))).toEqual([
            {label: text.actions.resetPassword.menu, disabled: false},
            {label: text.actions.ban.menu, disabled: true},
            {label: text.actions.revokeAdmin.menu, disabled: true},
            {label: text.actions.revokeSessions.menu, disabled: false},
        ]);
    });

    for (const action of ACTIONS) {
        it(`${text.actions[action.name].menu}：先确认，确认后发请求、关掉对话框，重取这一页`, async () => {
            const users = people();
            const harness = await openUsers("/admin/users", {
                [`POST ${action.path}`]: () => {
                    const index = users.findIndex((user) => user.id === action.id);
                    users[index] = {...users[index]!, ...action.after};
                    return Response.json(users[index]);
                },
            }, users);
            const listsBefore = listQueries(harness).length;
            menuItem(await openRowMenu(harness, action.user), text.actions[action.name].menu).click();
            const found = await openedDialog();
            expect(dialogTitle(found)).toBe(fill(text.actions[action.name].title, {username: action.user}));
            expect(found.textContent).toContain(text.actions[action.name].description);
            expect(writes(harness)).toEqual([]);

            found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();
            await closed();
            expect(writes(harness)).toEqual([{method: "POST", path: action.path, body: action.body}]);
            await vi.waitFor(() => expect(listQueries(harness).length).toBe(listsBefore + 1));
            expect(listQueries(harness).at(-1)).toEqual({page: "1", pageSize: "20", anchor: ANCHOR});
        });
    }

    it("取消：不发请求", async () => {
        const harness = await openUsers();
        menuItem(await openRowMenu(harness, "user2"), text.actions.ban.menu).click();
        const found = await openedDialog();
        [...found.querySelectorAll("button")].find((button) => button.textContent?.trim() === zhCN.admin.list.cancel)!.click();
        await closed();
        expect(writes(harness)).toEqual([]);
    });

    it("账号已经不在了（not_found）：原因写在对话框的状态行，对话框留着，列表重取", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${actionUrl(2, "ban")}`]: () => failure({error: {code: "not_found"}}, 404)});
        const listsBefore = listQueries(harness).length;
        menuItem(await openRowMenu(harness, "user2"), text.actions.ban.menu).click();
        const found = await openedDialog();
        found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.not_found));
        expect(document.body.querySelector("[data-site-admin-user-dialog]")).toBe(found);
        await vi.waitFor(() => expect(listQueries(harness).length).toBe(listsBefore + 1));
    });

    it("太频繁（rate_limited）：状态行写一句不带秒数的话，倒数完之前确认按钮不可用", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${actionUrl(2, "revoke-sessions")}`]: () => failure({error: {code: "rate_limited"}}, 429, {"Retry-After": "5"})});
        menuItem(await openRowMenu(harness, "user2"), text.actions.revokeSessions.menu).click();
        const found = await openedDialog();
        const confirm = found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!;
        confirm.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken));
        expect(confirm.disabled).toBe(true);
        harness.clock.advance(5_000);
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(""));
        expect(confirm.disabled).toBe(false);
    });

    it("服务端拒绝对自己的处置（self_forbidden）：原因写在状态行", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${actionUrl(7, "revoke-sessions")}`]: () => failure({error: {code: "self_forbidden"}}, 409)});
        menuItem(await openRowMenu(harness, "alice"), text.actions.revokeSessions.menu).click();
        const found = await openedDialog();
        found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.self_forbidden));
    });
});

describe("重置密码", () => {
    const RESET = actionUrl(2, "reset-password");

    it("确认后新密码出现在对话框里、带复制按钮；点“完成”关掉以后再也看不到", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${RESET}`]: () => Response.json({password: "Fresh-Secret-42"})});
        menuItem(await openRowMenu(harness, "user2"), text.actions.resetPassword.menu).click();
        const found = await openedDialog();
        expect(found.dataset.siteAdminUserDialogStep).toBe("confirm");
        found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();

        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-new-password]")?.textContent).toBe("Fresh-Secret-42"));
        expect(dialogTitle(found)).toBe(fill(text.password.title, {username: "user2"}));
        expect(found.textContent).toContain(text.password.description);
        expect([...found.querySelectorAll("button")].some((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === text.password.copy)).toBe(true);
        expect(writes(harness)).toEqual([{method: "POST", path: RESET, body: undefined}]);

        found.querySelector<HTMLButtonElement>("[data-site-admin-user-finish]")!.click();
        await closed();
        expect(document.body.textContent).not.toContain("Fresh-Secret-42");

        // 再打开同一项：回到确认那一步，旧密码不在。
        menuItem(await openRowMenu(harness, "user2"), text.actions.resetPassword.menu).click();
        const again = await openedDialog();
        expect(again.dataset.siteAdminUserDialogStep).toBe("confirm");
        expect(document.body.textContent).not.toContain("Fresh-Secret-42");
    });

    it("显示新密码时按 Esc 关掉：密码同样不留", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${RESET}`]: () => Response.json({password: "Fresh-Secret-42"})});
        menuItem(await openRowMenu(harness, "user2"), text.actions.resetPassword.menu).click();
        const found = await openedDialog();
        found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();
        await vi.waitFor(() => expect(found.querySelector("[data-site-admin-new-password]")).not.toBeNull());

        found.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await closed();
        expect(document.body.textContent).not.toContain("Fresh-Secret-42");
    });

    it("重置失败：原因写在状态行，不出现密码", async () => {
        const harness = await openUsers("/admin/users", {[`POST ${RESET}`]: () => failure({error: {code: "not_found"}}, 404)});
        menuItem(await openRowMenu(harness, "user2"), text.actions.resetPassword.menu).click();
        const found = await openedDialog();
        found.querySelector<HTMLButtonElement>("[data-site-admin-user-confirm]")!.click();
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.not_found));
        expect(found.dataset.siteAdminUserDialogStep).toBe("confirm");
    });
});
