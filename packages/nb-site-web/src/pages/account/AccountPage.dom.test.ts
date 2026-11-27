/**
 * 账号页（`AccountPage.vue` 与四节）：装起整个站点（`site-harness.ts`），账号服务由注入的 `fetch` 按方法与路径回答，时间由手动时钟
 * 推进。断言的是他看得到、做得到的：每一行写了什么、按钮能不能点、发了哪些请求与请求体、状态行的字、标红与焦点、最后停在哪一页。
 * 量位置的验收（两种账号版式相同、状态行不推动内容、没有横向滚动、目录随滚动高亮）要真实布局，在 `e2e/account.e2e.ts`。
 */

import {IDENTITY_PATHS, INVITE_CODE_ACTIVE_LIMIT, identityPath} from "@notnotype/nb-site-identity-contract/constants";
import type {
    ChangePasswordRequest,
    IdentityItem,
    IdentityListResponse,
    InviteCodeItem,
    InviteCodeListResponse,
    MeResponse,
    MetaResponse,
    PatchMeRequest,
    SessionItem,
    SessionListResponse,
    SocialStartResponse,
} from "@notnotype/nb-site-identity-contract/constants";
import {afterEach, describe, expect, it, vi} from "vitest";

import zhCN from "../../locales/zh-CN.json";
import {cleanUp, failure, identityUrl, invalidNames, me, settledAt, startAt, statusTextOf, type} from "../../testing/site-harness";
import type {Handler, Harness} from "../../testing/site-harness";

const SESSIONS = identityUrl(IDENTITY_PATHS.meSessions);
const IDENTITIES = identityUrl(IDENTITY_PATHS.meIdentities);
const INVITES = identityUrl(IDENTITY_PATHS.meInviteCodes);
const ME = identityUrl(IDENTITY_PATHS.me);
const PASSWORD = identityUrl(IDENTITY_PATHS.mePassword);
const LOGOUT = identityUrl(IDENTITY_PATHS.logout);
const sessionUrl = (id: number): string => identityUrl(identityPath.meSession(id));
const identityItemUrl = (id: number): string => identityUrl(identityPath.meIdentity(id));
const inviteUrl = (id: number): string => identityUrl(identityPath.meInviteCode(id));
const socialStartUrl = (provider: "github" | "google"): string => identityUrl(identityPath.socialStart(provider));

const text = zhCN.account;
const errors = zhCN.errors.identity;

afterEach(cleanUp);

/** 把文案里的 `{{名字}}` 换成值。 */
function fill(template: string, values: Readonly<Record<string, string | number>>): string {
    return template.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => String(values[key]));
}

/** 状态行上“做到哪了”加原因的那一句（`form.leadReason`）。 */
const withLead = (lead: string, reason: string): string => fill(zhCN.form.leadReason, {lead, reason});

const rateLimited = (headers: Record<string, string>): Response => failure({error: {code: "rate_limited"}}, 429, headers);

/** 账号服务里这个人的三份列表；处理器改它，下一次 `GET` 就按改过的回答。 */
interface AccountData {
    sessions: SessionItem[];
    identities: IdentityItem[];
    invites: InviteCodeItem[];
}

const CURRENT: SessionItem = {id: 1, createdAt: "2026-11-20T08:00:00.000Z", lastUsedAt: "2026-11-26T10:00:00.000Z", browser: "Chrome", os: "Windows", current: true};
const PHONE: SessionItem = {id: 2, createdAt: "2026-11-19T08:00:00.000Z", lastUsedAt: "2026-11-26T07:30:00.000Z", browser: "Safari", os: "iOS", current: false};
const UNKNOWN: SessionItem = {id: 3, createdAt: "2026-11-18T08:00:00.000Z", lastUsedAt: "2026-11-24T09:00:00.000Z", browser: null, os: null, current: false};
const TABLET: SessionItem = {id: 4, createdAt: "2026-11-17T08:00:00.000Z", lastUsedAt: "2026-11-26T09:20:00.000Z", browser: "Firefox", os: "Android", current: false};
const OLD_LAPTOP: SessionItem = {id: 5, createdAt: "2025-10-01T08:00:00.000Z", lastUsedAt: "2025-11-24T09:00:00.000Z", browser: "Edge", os: "Windows", current: false};
const GITHUB: IdentityItem = {id: 21, provider: "github", accountName: "alice-writes", linkedAt: "2026-11-02T00:00:00.000Z"};

function invite(id: number, overrides: Partial<InviteCodeItem> = {}): InviteCodeItem {
    return {id, code: `NB-CODE-${id}`, createdAt: "2026-11-10T00:00:00.000Z", usedCount: 0, maxUses: null, expiresAt: null, usable: true, ...overrides};
}

function defaultData(): AccountData {
    return {sessions: [CURRENT, PHONE, UNKNOWN], identities: [GITHUB], invites: [invite(31, {usedCount: 1, maxUses: 3, expiresAt: "2026-12-24T00:00:00.000Z"}), invite(32)]};
}

function listHandlers(data: AccountData): Record<string, Handler> {
    return {
        [`GET ${SESSIONS}`]: () => Response.json({items: data.sessions} satisfies SessionListResponse),
        [`GET ${IDENTITIES}`]: () => Response.json({items: data.identities} satisfies IdentityListResponse),
        [`GET ${INVITES}`]: () => Response.json({items: data.invites} satisfies InviteCodeListResponse),
    };
}

interface OpenOptions {
    readonly me?: Partial<MeResponse>;
    readonly data?: Partial<AccountData>;
    /** 在列表的处理器之外再加的；处理器拿到同一份 `data`。 */
    readonly handlers?: (data: AccountData) => Record<string, Handler>;
    readonly meta?: MetaResponse | (() => Response | Promise<Response>);
    readonly path?: string;
}

interface Opened {
    readonly harness: Harness;
    readonly data: AccountData;
    readonly page: HTMLElement;
}

async function openAccount(options: OpenOptions = {}): Promise<Opened> {
    const data: AccountData = {...defaultData(), ...options.data};
    const session = {role: "user" as const, consentRequired: false};
    const harness = startAt(options.path ?? "/account", {
        session: {...session, me: {...me(session), ...options.me}},
        ...(options.meta === undefined ? {} : {meta: options.meta}),
        handlers: {...listHandlers(data), ...options.handlers?.(data)},
    });
    await settledAt(harness, "/account", "account");
    await vi.waitFor(() => expect(harness.target.querySelector('[data-site-account-section="invites"]')).not.toBeNull());
    return {harness, data, page: harness.target.querySelector<HTMLElement>('[data-site-page="account"]')!};
}

function section(page: HTMLElement, id: string): HTMLElement {
    const found = page.querySelector<HTMLElement>(`[data-site-account-section="${id}"]`);
    if (found === null) throw new Error(`没有 ${id} 这一节`);
    return found;
}

function statusOf(root: HTMLElement): string {
    return statusTextOf(root.querySelector<HTMLElement>("[data-site-form-status]")!);
}

function toneOf(root: HTMLElement): string | null {
    return root.querySelector<HTMLElement>("[data-site-form-status]")!.getAttribute("data-site-form-status-tone");
}

function button(root: ParentNode, label: string): HTMLButtonElement {
    const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (found === undefined) throw new Error(`没有“${label}”按钮`);
    return found;
}

function hasButton(root: ParentNode, label: string): boolean {
    return [...root.querySelectorAll<HTMLButtonElement>("button")].some((candidate) => candidate.textContent?.trim() === label);
}

function input(root: ParentNode, name: string): HTMLInputElement {
    const found = root.querySelector<HTMLInputElement>(`input[name="${name}"], textarea[name="${name}"]`);
    if (found === null) throw new Error(`没有 ${name} 这一格`);
    return found;
}

function dialog(): HTMLElement {
    const found = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (found === null) throw new Error("对话框没开");
    return found;
}

async function openedDialog(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    return dialog();
}

/** 对话框页脚状态行上的字。 */
function dialogStatus(found: HTMLElement): string {
    return found.querySelector("[data-dialog-status]")?.textContent?.trim() ?? "";
}

/** 除了读列表与 `meta` 以外的请求：他的操作发出去的。 */
function actions(harness: Harness): {method: string; path: string; body: unknown}[] {
    return harness.requests.filter((request) => request.method !== "GET").map(({method, path, body}) => ({method, path, body}));
}

function gets(harness: Harness, path: string): number {
    return harness.requests.filter((request) => request.method === "GET" && request.path === path).length;
}

/** 一个手动放行的回答：处理器等它，用例决定什么时候让请求完成。 */
function gate(): {readonly wait: Promise<void>; open(): void} {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {wait, open};
}

describe("登录与安全：密码", () => {
    it("有密码的账号：写“已设置”、按钮是“修改密码”；对话框要当前密码，提交带上它，成功后写“密码已修改”并重取设备列表", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${PASSWORD}`]: () => Response.json({})}),
        });
        const security = section(page, "security");
        const row = security.querySelector<HTMLElement>("[data-site-account-password]")!;
        expect(row.textContent).toContain(text.security.passwordSet);
        expect(hasButton(row, text.security.setPassword)).toBe(false);
        const sessionsBefore = gets(harness, SESSIONS);

        button(row, text.security.changePassword).click();
        const found = await openedDialog();
        const save = button(found, text.save);
        type(input(found, "currentPassword"), "old-password");
        type(input(found, "newPassword"), "short");
        await vi.waitFor(() => expect(save.disabled).toBe(true));
        type(input(found, "newPassword"), "new-password-1");
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(security)).toBe(text.security.passwordChanged));
        expect(toneOf(security)).toBe("success");
        expect(actions(harness)).toEqual([{method: "POST", path: PASSWORD, body: {currentPassword: "old-password", newPassword: "new-password-1"} satisfies ChangePasswordRequest}]);
        expect(gets(harness, SESSIONS)).toBe(sessionsBefore + 1);
        await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    });

    it("没有密码的账号：写“没有设置”、按钮是“设置密码”；对话框里没有当前密码，请求也不带；设好后这一行变成“已设置”", async () => {
        const {harness, page} = await openAccount({
            me: {hasPassword: false},
            handlers: () => ({[`POST ${PASSWORD}`]: () => Response.json({})}),
        });
        const security = section(page, "security");
        const row = security.querySelector<HTMLElement>("[data-site-account-password]")!;
        expect(row.textContent).toContain(text.security.passwordUnset);
        expect(hasButton(row, text.security.changePassword)).toBe(false);

        button(row, text.security.setPassword).click();
        const found = await openedDialog();
        expect(found.querySelector('input[name="currentPassword"]')).toBeNull();
        type(input(found, "newPassword"), "new-password-1");
        await vi.waitFor(() => expect(button(found, text.save).disabled).toBe(false));
        button(found, text.save).click();

        await vi.waitFor(() => expect(statusOf(security)).toBe(text.security.passwordCreated));
        expect(actions(harness)).toEqual([{method: "POST", path: PASSWORD, body: {newPassword: "new-password-1"} satisfies ChangePasswordRequest}]);
        await vi.waitFor(() => expect(row.textContent).toContain(text.security.passwordSet));
        expect(hasButton(row, text.security.changePassword)).toBe(true);
    });

    it("当前密码不对（invalid_credentials）：那一格标红并得到焦点，原因写在对话框的状态行，对话框留着", async () => {
        const {page} = await openAccount({
            handlers: () => ({[`POST ${PASSWORD}`]: () => failure({error: {code: "invalid_credentials"}}, 401)}),
        });
        button(section(page, "security"), text.security.changePassword).click();
        const found = await openedDialog();
        type(input(found, "currentPassword"), "wrong-password");
        type(input(found, "newPassword"), "new-password-1");
        await vi.waitFor(() => expect(button(found, text.save).disabled).toBe(false));
        button(found, text.save).click();

        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.invalid_credentials));
        expect(invalidNames(found)).toEqual(["currentPassword"]);
        await vi.waitFor(() => expect(document.activeElement).toBe(input(found, "currentPassword")));
    });

    it("设好密码后对话框关掉的整个过程里，标题一直是“设置密码”，也不多出当前密码那一格", async () => {
        const {page} = await openAccount({
            me: {hasPassword: false},
            handlers: () => ({[`POST ${PASSWORD}`]: () => Response.json({})}),
        });
        const security = section(page, "security");
        button(security.querySelector("[data-site-account-password]")!, text.security.setPassword).click();
        const found = await openedDialog();
        type(input(found, "newPassword"), "new-password-1");
        await vi.waitFor(() => expect(button(found, text.save).disabled).toBe(false));

        // 每次页面有变化都记下对话框里的样子，直到它没了。
        const seen: {readonly changing: boolean; readonly currentField: boolean}[] = [];
        const observer = new MutationObserver(() => {
            const open = document.body.querySelector('[role="dialog"]');
            if (open !== null) seen.push({changing: open.textContent?.includes(text.security.changePassword) === true, currentField: open.querySelector('input[name="currentPassword"]') !== null});
        });
        observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true});
        button(found, text.save).click();
        await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
        observer.disconnect();

        expect(statusOf(security)).toBe(text.security.passwordCreated);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.filter((entry) => entry.changing || entry.currentField)).toEqual([]);
    });

    it("rate_limited：对话框页脚只写一句不带秒数的话，倒数完之前不能再提交", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${PASSWORD}`]: () => rateLimited({"Retry-After": "5"})}),
        });
        button(section(page, "security"), text.security.changePassword).click();
        const found = await openedDialog();
        type(input(found, "currentPassword"), "old-password");
        type(input(found, "newPassword"), "new-password-1");
        await vi.waitFor(() => expect(button(found, text.save).disabled).toBe(false));
        button(found, text.save).click();

        await vi.waitFor(() => expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken));
        expect(button(found, text.save).disabled).toBe(true);
        harness.clock.advance(1_000);
        await Promise.resolve();
        expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken);
        harness.clock.advance(4_000);
        await vi.waitFor(() => expect(dialogStatus(found)).toBe(""));
        expect(button(found, text.save).disabled).toBe(false);
    });
});

describe("登录与安全：已关联的账号", () => {
    it("每个上游一行：关联了的写上游名与上游账号的名字、可以解绑；没关联的写“没有关联”、可以关联", async () => {
        const {page} = await openAccount();
        const rows = [...section(page, "security").querySelectorAll<HTMLElement>("[data-site-account-identity]")];
        expect(rows.map((row) => row.getAttribute("data-site-account-identity"))).toEqual(["github", "google"]);
        expect(rows[0]!.textContent).toContain(text.security.provider.github);
        expect(rows[0]!.textContent).toContain(GITHUB.accountName);
        expect(hasButton(rows[0]!, text.security.unlink)).toBe(true);
        expect(rows[1]!.textContent).toContain(text.security.provider.google);
        expect(rows[1]!.textContent).toContain(text.security.notLinked);
        expect(hasButton(rows[1]!, text.security.link)).toBe(true);
    });

    it("每行按钮的读屏名字带上是哪个上游", async () => {
        const {page} = await openAccount();
        const security = section(page, "security");
        expect(button(security.querySelector('[data-site-account-identity="github"]')!, text.security.unlink).getAttribute("aria-label")).toBe(fill(text.security.unlinkNamed, {provider: "GitHub"}));
        expect(button(security.querySelector('[data-site-account-identity="google"]')!, text.security.link).getAttribute("aria-label")).toBe(fill(text.security.linkNamed, {provider: "Google"}));
    });

    it("没开放的上游没关联时不列出；关联着的照样列出，好让他解绑", async () => {
        const {page} = await openAccount({meta: {termsVersion: "2026-11-01", registrationOpen: true, providers: {github: false, google: false}}});
        await vi.waitFor(() => {
            const rows = [...section(page, "security").querySelectorAll("[data-site-account-identity]")];
            expect(rows.map((row) => row.getAttribute("data-site-account-identity"))).toEqual(["github"]);
        });
    });

    it("有密码的账号关联：先弹对话框要当前密码，带着它发起，拿到上游地址就离开站点", async () => {
        const upstream = "https://accounts.google.example/authorize?state=s1";
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${socialStartUrl("google")}`]: () => Response.json({url: upstream} satisfies SocialStartResponse)}),
        });
        button(section(page, "security").querySelector('[data-site-account-identity="google"]')!, text.security.link).click();
        const found = await openedDialog();
        expect(actions(harness)).toEqual([]);
        type(input(found, "currentPassword"), "my-password");
        await vi.waitFor(() => expect(button(found, text.security.linkContinue).disabled).toBe(false));
        button(found, text.security.linkContinue).click();

        await vi.waitFor(() => expect(harness.left.map((entry) => entry.url)).toEqual([upstream]));
        expect(actions(harness)).toEqual([{method: "POST", path: socialStartUrl("google"), body: {intent: "link", currentPassword: "my-password"}}]);
    });

    it("关联时当前密码不对：密码那一格标红，原因写在对话框里，不离开站点", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${socialStartUrl("google")}`]: () => failure({error: {code: "invalid_credentials"}}, 401)}),
        });
        button(section(page, "security").querySelector('[data-site-account-identity="google"]')!, text.security.link).click();
        const found = await openedDialog();
        type(input(found, "currentPassword"), "wrong");
        await vi.waitFor(() => expect(button(found, text.security.linkContinue).disabled).toBe(false));
        button(found, text.security.linkContinue).click();

        await vi.waitFor(() => expect(dialogStatus(found)).toBe(errors.invalid_credentials));
        expect(invalidNames(found)).toEqual(["currentPassword"]);
        expect(harness.left).toEqual([]);
    });

    it("关联时回 rate_limited：对话框页脚只写一句不带秒数的话，倒数完之前“继续”不可用", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${socialStartUrl("google")}`]: () => rateLimited({"Retry-After": "3"})}),
        });
        button(section(page, "security").querySelector('[data-site-account-identity="google"]')!, text.security.link).click();
        const found = await openedDialog();
        type(input(found, "currentPassword"), "my-password");
        await vi.waitFor(() => expect(button(found, text.security.linkContinue).disabled).toBe(false));
        button(found, text.security.linkContinue).click();

        await vi.waitFor(() => expect(dialogStatus(found)).toBe(zhCN.form.rateLimitedSpoken));
        expect(button(found, text.security.linkContinue).disabled).toBe(true);
        harness.clock.advance(3_000);
        await vi.waitFor(() => expect(button(found, text.security.linkContinue).disabled).toBe(false));
        expect(harness.left).toEqual([]);
    });

    it("没有密码的账号发起关联、离开之后从上游点返回（往返缓存恢复，pageshow 的 persisted 为真）：这一节的按钮又能点了", async () => {
        const upstream = "https://accounts.google.example/authorize?state=s3";
        const {harness, page} = await openAccount({
            me: {hasPassword: false},
            handlers: () => ({[`POST ${socialStartUrl("google")}`]: () => Response.json({url: upstream} satisfies SocialStartResponse)}),
        });
        const security = section(page, "security");
        const unlinkGithub = button(security.querySelector('[data-site-account-identity="github"]')!, text.security.unlink);
        button(security.querySelector('[data-site-account-identity="google"]')!, text.security.link).click();
        await vi.waitFor(() => expect(harness.left.map((entry) => entry.url)).toEqual([upstream]));
        await vi.waitFor(() => expect(unlinkGithub.disabled).toBe(true));

        window.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: false}));
        await Promise.resolve();
        expect(unlinkGithub.disabled).toBe(true);

        window.dispatchEvent(Object.assign(new Event("pageshow"), {persisted: true}));
        await vi.waitFor(() => expect(unlinkGithub.disabled).toBe(false));
        expect(button(security.querySelector('[data-site-account-identity="google"]')!, text.security.link).disabled).toBe(false);
    });

    it("没有密码的账号关联：不弹对话框，直接发起、不带密码", async () => {
        const upstream = "https://accounts.google.example/authorize?state=s2";
        const {harness, page} = await openAccount({
            me: {hasPassword: false},
            handlers: () => ({[`POST ${socialStartUrl("google")}`]: () => Response.json({url: upstream} satisfies SocialStartResponse)}),
        });
        button(section(page, "security").querySelector('[data-site-account-identity="google"]')!, text.security.link).click();

        await vi.waitFor(() => expect(harness.left.map((entry) => entry.url)).toEqual([upstream]));
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
        expect(actions(harness)).toEqual([{method: "POST", path: socialStartUrl("google"), body: {intent: "link"}}]);
    });

    it("解绑最后一种登录方式（last_login_method）：状态行写“先设一个密码再解绑”，焦点给“设置密码”，那一行还在", async () => {
        const {harness, page} = await openAccount({
            me: {hasPassword: false},
            handlers: () => ({[`DELETE ${identityItemUrl(GITHUB.id)}`]: () => failure({error: {code: "last_login_method"}}, 409)}),
        });
        const security = section(page, "security");
        button(security.querySelector('[data-site-account-identity="github"]')!, text.security.unlink).click();

        await vi.waitFor(() => expect(statusOf(security)).toBe(errors.last_login_method));
        expect(toneOf(security)).toBe("danger");
        await vi.waitFor(() => expect(document.activeElement).toBe(button(security.querySelector("[data-site-account-password]")!, text.security.setPassword)));
        expect(security.querySelector('[data-site-account-identity="github"]')?.textContent).toContain(GITHUB.accountName);
        expect(actions(harness)).toEqual([{method: "DELETE", path: identityItemUrl(GITHUB.id), body: undefined}]);
    });

    it("解绑回 not_found（那个关联已经不在了）：状态行写明，重取列表，那一行变成“没有关联”", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`DELETE ${identityItemUrl(GITHUB.id)}`]: () => {
                    // 在别的标签页里已经解绑过了。
                    data.identities = [];
                    return failure({error: {code: "not_found"}}, 404);
                },
            }),
        });
        const security = section(page, "security");
        const before = gets(harness, IDENTITIES);
        button(security.querySelector('[data-site-account-identity="github"]')!, text.security.unlink).click();

        await vi.waitFor(() => expect(statusOf(security)).toBe(text.security.identityGone));
        await vi.waitFor(() => expect(security.querySelector('[data-site-account-identity="github"]')?.textContent).toContain(text.security.notLinked));
        expect(gets(harness, IDENTITIES)).toBe(before + 1);
    });

    it("从上游带着 social_error 回到账号页：写在“登录与安全”的状态行，参数从地址里去掉，锚点停在这一节", async () => {
        const {harness, page} = await openAccount({path: "/account?social_error=identity_taken"});
        const security = section(page, "security");
        await vi.waitFor(() => expect(statusOf(security)).toBe(errors.identity_taken));
        await vi.waitFor(() => {
            const route = harness.site.router.currentRoute.value;
            expect({query: route.query, hash: route.hash}).toEqual({query: {}, hash: "#security"});
        });
        expect(statusOf(section(page, "profile"))).toBe("");
    });
});

describe("已登录的设备", () => {
    it("每个会话一行：浏览器与系统、认不出时的说法、“这台设备”；只写一个相对的最后使用时间（到小时），登录时间在悬停提示里；这台设备没有“退出”", async () => {
        const {page} = await openAccount({data: {sessions: [CURRENT, PHONE, TABLET, UNKNOWN, OLD_LAPTOP]}});
        const rows = [...section(page, "sessions").querySelectorAll<HTMLElement>("[data-site-account-session]")];
        expect(rows.map((row) => row.querySelector("[data-site-account-session-device]")?.textContent)).toEqual([
            "Chrome，Windows",
            "Safari，iOS",
            "Firefox，Android",
            text.sessions.unknownDevice,
            "Edge，Windows",
        ]);
        expect(rows.map((row) => row.hasAttribute("data-site-account-session-current"))).toEqual([true, false, false, false, false]);
        expect(rows[0]!.textContent).toContain(text.sessions.current);
        expect(rows.slice(1).every((row) => !row.textContent?.includes(text.sessions.current))).toBe(true);
        // 现在是 2026-11-26 10:00（UTC）：两个半小时前、四十分钟前、两天前、去年。
        const meta = rows.map((row) => row.querySelector<HTMLElement>("[data-site-account-session-created]")!);
        expect(meta.map((element) => element.textContent?.trim())).toEqual([text.sessions.inUse, "2小时前", text.sessions.withinHour, "11月24日", "2025年11月24日"]);
        expect(rows.map((row) => row.querySelector("[data-site-account-session-last-used]")?.getAttribute("datetime") ?? null)).toEqual([
            null,
            PHONE.lastUsedAt,
            TABLET.lastUsedAt,
            UNKNOWN.lastUsedAt,
            OLD_LAPTOP.lastUsedAt,
        ]);
        // 登录时间写到分钟，按浏览器所在的时区。
        const local = (iso: string): string => {
            const at = new Date(iso);
            return `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
        };
        expect(meta.map((element) => element.getAttribute("title"))).toEqual(
            [CURRENT, PHONE, TABLET, UNKNOWN, OLD_LAPTOP].map((session) => fill(text.sessions.createdAt, {time: local(session.createdAt)})),
        );
        expect(rows.map((row) => hasButton(row, text.sessions.end))).toEqual([false, true, true, true, true]);
        // 每行的“退出”读屏名字带上是哪台设备。
        expect(rows.slice(1).map((row) => button(row, text.sessions.end).getAttribute("aria-label"))).toEqual(
            ["Safari，iOS", "Firefox，Android", text.sessions.unknownDevice, "Edge，Windows"].map((device) => fill(text.sessions.endNamed, {device})),
        );
    });

    it("结束一个会话：发 DELETE、重取列表，那一行没了", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`DELETE ${sessionUrl(PHONE.id)}`]: () => {
                    data.sessions = data.sessions.filter((session) => session.id !== PHONE.id);
                    return Response.json({});
                },
            }),
        });
        const sessions = section(page, "sessions");
        button(sessions.querySelector(`[data-site-account-session="${PHONE.id}"]`)!, text.sessions.end).click();

        await vi.waitFor(() => expect([...sessions.querySelectorAll("[data-site-account-session]")].map((row) => row.getAttribute("data-site-account-session"))).toEqual(["1", "3"]));
        expect(actions(harness)).toEqual([{method: "DELETE", path: sessionUrl(PHONE.id), body: undefined}]);
    });

    it("结束一个会话回 not_found（已经不在了）：当作结束了，重取列表，状态行不写失败", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`DELETE ${sessionUrl(PHONE.id)}`]: () => {
                    // 到期了，或在别处被结束了。
                    data.sessions = data.sessions.filter((session) => session.id !== PHONE.id);
                    return failure({error: {code: "not_found"}}, 404);
                },
            }),
        });
        const sessions = section(page, "sessions");
        const before = gets(harness, SESSIONS);
        button(sessions.querySelector(`[data-site-account-session="${PHONE.id}"]`)!, text.sessions.end).click();

        await vi.waitFor(() => expect([...sessions.querySelectorAll("[data-site-account-session]")].map((row) => row.getAttribute("data-site-account-session"))).toEqual(["1", "3"]));
        expect(gets(harness, SESSIONS)).toBe(before + 1);
        expect(statusOf(sessions)).toBe("");
    });

    it("退出其它所有设备：一个一个地发、不碰这台设备；第一次失败（not_found 以外）就停，写“结束了 N 个，M 个没结束”与那次的原因，完成后重取列表", async () => {
        const first = gate();
        const {harness, page} = await openAccount({
            data: {sessions: [CURRENT, PHONE, UNKNOWN, TABLET]},
            handlers: (data) => ({
                [`DELETE ${sessionUrl(PHONE.id)}`]: async () => {
                    await first.wait;
                    data.sessions = data.sessions.filter((session) => session.id !== PHONE.id);
                    return Response.json({});
                },
                [`DELETE ${sessionUrl(UNKNOWN.id)}`]: () => failure({error: {code: "internal"}}, 500),
            }),
        });
        const sessions = section(page, "sessions");
        const before = gets(harness, SESSIONS);
        button(sessions, text.sessions.endOthers).click();

        // 第一个还没完成时，第二个不发。
        await vi.waitFor(() => expect(actions(harness).map((request) => request.path)).toEqual([sessionUrl(PHONE.id)]));
        for (let turn = 0; turn < 5; turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(actions(harness).map((request) => request.path)).toEqual([sessionUrl(PHONE.id)]);
        first.open();

        // 没结束的两个：失败的那个与没发的那个。
        await vi.waitFor(() => expect(statusOf(sessions)).toBe(withLead(fill(text.sessions.partial, {ended: 1, failed: 2}), errors.internal)));
        expect(toneOf(sessions)).toBe("danger");
        expect(actions(harness).map((request) => `${request.method} ${request.path}`)).toEqual([`DELETE ${sessionUrl(PHONE.id)}`, `DELETE ${sessionUrl(UNKNOWN.id)}`]);
        expect(gets(harness, SESSIONS)).toBe(before + 1);
        await vi.waitFor(() => expect([...sessions.querySelectorAll("[data-site-account-session]")].map((row) => row.getAttribute("data-site-account-session"))).toEqual(["1", "3", "4"]));
    });

    it("退出其它所有设备中途回 rate_limited：停下，写做到哪了与按分钟的倒数；倒数期间这一节的按钮都不可用，过了一分钟改按秒写", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`DELETE ${sessionUrl(PHONE.id)}`]: () => {
                    data.sessions = data.sessions.filter((session) => session.id !== PHONE.id);
                    return Response.json({});
                },
                [`DELETE ${sessionUrl(UNKNOWN.id)}`]: () => rateLimited({"Retry-After": "125"}),
            }),
        });
        const sessions = section(page, "sessions");
        button(sessions, text.sessions.endOthers).click();

        const lead = fill(text.sessions.partial, {ended: 1, failed: 1});
        await vi.waitFor(() => expect(statusOf(sessions)).toBe(withLead(lead, fill(zhCN.form.rateLimitedMinutes, {minutes: 3}))));
        await vi.waitFor(() => expect([...sessions.querySelectorAll("[data-site-account-session]")].map((row) => row.getAttribute("data-site-account-session"))).toEqual(["1", "3"]));
        expect(button(sessions, text.sessions.endOthers).disabled).toBe(true);
        expect(button(sessions.querySelector(`[data-site-account-session="${UNKNOWN.id}"]`)!, text.sessions.end).disabled).toBe(true);

        harness.clock.advance(65_000);
        await vi.waitFor(() => expect(statusOf(sessions)).toBe(withLead(lead, fill(errors.rate_limited, {seconds: 60}))));
        harness.clock.advance(60_000);
        await vi.waitFor(() => expect(statusOf(sessions)).toBe(""));
        expect(button(sessions, text.sessions.endOthers).disabled).toBe(false);
        expect(button(sessions.querySelector(`[data-site-account-session="${UNKNOWN.id}"]`)!, text.sessions.end).disabled).toBe(false);
    });

    it("退出其它所有设备都成功：写“其它设备都已退出”，3 秒后清掉；只剩这台设备时按钮不可用", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`DELETE ${sessionUrl(PHONE.id)}`]: () => {
                    data.sessions = data.sessions.filter((session) => session.id !== PHONE.id);
                    return Response.json({});
                },
                // 已经不在了（到期、在别处被结束）：当作结束了。
                [`DELETE ${sessionUrl(UNKNOWN.id)}`]: () => {
                    data.sessions = data.sessions.filter((session) => session.id !== UNKNOWN.id);
                    return failure({error: {code: "not_found"}}, 404);
                },
            }),
        });
        const sessions = section(page, "sessions");
        button(sessions, text.sessions.endOthers).click();

        await vi.waitFor(() => expect(statusOf(sessions)).toBe(text.sessions.endedOthers));
        expect(toneOf(sessions)).toBe("success");
        await vi.waitFor(() => expect(button(sessions, text.sessions.endOthers).disabled).toBe(true));
        harness.clock.advance(3000);
        await vi.waitFor(() => expect(statusOf(sessions)).toBe(""));
    });
});

describe("邀请码", () => {
    it("每个码一行：已用次数、可用次数与过期时间；还能用的可以复制邀请链接与停用，不能用的写“不能再用”", async () => {
        const {page} = await openAccount({data: {invites: [invite(31, {usedCount: 1, maxUses: 3, expiresAt: "2026-12-24T00:00:00.000Z"}), invite(32, {usedCount: 4}), invite(33, {usable: false})]}});
        const rows = [...section(page, "invites").querySelectorAll<HTMLElement>("[data-site-account-invite]")];
        expect(rows.map((row) => row.getAttribute("data-site-account-invite"))).toEqual(["NB-CODE-31", "NB-CODE-32", "NB-CODE-33"]);
        expect(rows[0]!.textContent).toContain(text.invites.usedOf.replace("{{count}}", "1").replace("{{max}}", "3"));
        expect(rows[0]!.querySelector("time")?.getAttribute("datetime")).toBe("2026-12-24T00:00:00.000Z");
        expect(rows[1]!.textContent).toContain(text.invites.used.replace("{{count}}", "4"));
        expect(rows[1]!.querySelector("time")).toBeNull();
        expect(rows[2]!.textContent).toContain(text.invites.unusable);
        expect(rows.map((row) => hasButton(row, text.invites.disable))).toEqual([true, true, false]);
        expect(rows.map((row) => row.querySelector("[data-copy-state]") !== null)).toEqual([true, true, false]);
        expect(section(page, "invites").querySelector("[data-site-account-invite-quota]")?.textContent?.trim()).toBe(text.invites.remaining.replace("{{count}}", String(INVITE_CODE_ACTIVE_LIMIT - 2)));
    });

    it("复制：剪贴板里是带这个码的注册链接", async () => {
        const {page} = await openAccount();
        const row = section(page, "invites").querySelector<HTMLElement>('[data-site-account-invite="NB-CODE-32"]')!;
        row.querySelector<HTMLButtonElement>("[data-copy-state] button")!.click();

        await vi.waitFor(() => expect(row.querySelector("[data-copy-state]")?.getAttribute("data-copy-state")).toBe("copied"));
        expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/register?invite=NB-CODE-32`);
    });

    it("停用：先确认，再发 PATCH、重取列表，那一行变成“不能再用”", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`PATCH ${inviteUrl(32)}`]: () => {
                    const disabled = invite(32, {usable: false});
                    data.invites = data.invites.map((item) => (item.id === 32 ? disabled : item));
                    return Response.json(disabled satisfies InviteCodeItem);
                },
            }),
        });
        const invites = section(page, "invites");
        button(invites.querySelector('[data-site-account-invite="NB-CODE-32"]')!, text.invites.disable).click();
        await vi.waitFor(() => expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull());
        expect(actions(harness)).toEqual([]);
        button(document.body.querySelector('[role="alertdialog"]')!, text.invites.disable).click();

        await vi.waitFor(() => expect(invites.querySelector('[data-site-account-invite="NB-CODE-32"]')?.textContent).toContain(text.invites.unusable));
        expect(actions(harness)).toEqual([{method: "PATCH", path: inviteUrl(32), body: {disabled: true}}]);
    });

    it("停用的读屏名字带上是哪个码", async () => {
        const {page} = await openAccount();
        const rows = [...section(page, "invites").querySelectorAll<HTMLElement>("[data-site-account-invite]")];
        expect(rows.map((row) => button(row, text.invites.disable).getAttribute("aria-label"))).toEqual(["NB-CODE-31", "NB-CODE-32"].map((code) => fill(text.invites.disableNamed, {code})));
    });

    it("停用回 not_found（那个码已经不在了）：状态行写明，重取列表，那一行没了", async () => {
        const {harness, page} = await openAccount({
            handlers: (data) => ({
                [`PATCH ${inviteUrl(32)}`]: () => {
                    data.invites = data.invites.filter((item) => item.id !== 32);
                    return failure({error: {code: "not_found"}}, 404);
                },
            }),
        });
        const invites = section(page, "invites");
        const before = gets(harness, INVITES);
        button(invites.querySelector('[data-site-account-invite="NB-CODE-32"]')!, text.invites.disable).click();
        await vi.waitFor(() => expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull());
        button(document.body.querySelector('[role="alertdialog"]')!, text.invites.disable).click();

        await vi.waitFor(() => expect(statusOf(invites)).toBe(errors.not_found));
        await vi.waitFor(() => expect(invites.querySelector('[data-site-account-invite="NB-CODE-32"]')).toBeNull());
        expect(gets(harness, INVITES)).toBe(before + 1);
    });

    it("生成回 rate_limited：等一小时写成分钟，倒数期间“生成邀请码”不可用", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`POST ${INVITES}`]: () => rateLimited({"Retry-After": "3600"})}),
        });
        const invites = section(page, "invites");
        button(invites, text.invites.generate).click();

        await vi.waitFor(() => expect(statusOf(invites)).toBe(fill(zhCN.form.rateLimitedMinutes, {minutes: 60})));
        expect(button(invites, text.invites.generate).disabled).toBe(true);
        harness.clock.advance(60_000);
        await vi.waitFor(() => expect(statusOf(invites)).toBe(fill(zhCN.form.rateLimitedMinutes, {minutes: 59})));
        harness.clock.advance(3_540_000);
        await vi.waitFor(() => expect(statusOf(invites)).toBe(""));
        expect(button(invites, text.invites.generate).disabled).toBe(false);
    });

    it(`有效的码已有 ${INVITE_CODE_ACTIVE_LIMIT} 个：“生成邀请码”不可用，旁边写原因`, async () => {
        const full = Array.from({length: INVITE_CODE_ACTIVE_LIMIT}, (_, index) => invite(40 + index));
        const {page} = await openAccount({data: {invites: [...full, invite(60, {usable: false})]}});
        const invites = section(page, "invites");
        expect(button(invites, text.invites.generate).disabled).toBe(true);
        expect(invites.querySelector("[data-site-account-invite-quota]")?.textContent?.trim()).toBe(text.invites.full.replace("{{limit}}", String(INVITE_CODE_ACTIVE_LIMIT)));
    });

    it("生成时服务端回 invite_code_limit（列表旧了）：状态行写原因，重取之后按钮不可用", async () => {
        const nine = Array.from({length: INVITE_CODE_ACTIVE_LIMIT - 1}, (_, index) => invite(40 + index));
        const {harness, page} = await openAccount({
            data: {invites: nine},
            handlers: (data) => ({
                [`POST ${INVITES}`]: () => {
                    // 别的标签页刚生成了第十个。
                    data.invites = [...nine, invite(70)];
                    return failure({error: {code: "invite_code_limit"}}, 409);
                },
            }),
        });
        const invites = section(page, "invites");
        expect(invites.querySelector("[data-site-account-invite-quota]")?.textContent?.trim()).toBe(text.invites.remaining.replace("{{count}}", "1"));
        button(invites, text.invites.generate).click();

        await vi.waitFor(() => expect(statusOf(invites)).toBe(errors.invite_code_limit));
        await vi.waitFor(() => expect(button(invites, text.invites.generate).disabled).toBe(true));
        expect(actions(harness)).toEqual([{method: "POST", path: INVITES, body: undefined}]);
    });

    it("生成成功：重取列表，新码出现，还能生成的个数少一", async () => {
        const {page} = await openAccount({
            handlers: (data) => ({
                [`POST ${INVITES}`]: () => {
                    const created = invite(80);
                    data.invites = [...data.invites, created];
                    return Response.json(created satisfies InviteCodeItem);
                },
            }),
        });
        const invites = section(page, "invites");
        button(invites, text.invites.generate).click();

        await vi.waitFor(() => expect(invites.querySelector('[data-site-account-invite="NB-CODE-80"]')).not.toBeNull());
        expect(invites.querySelector("[data-site-account-invite-quota]")?.textContent?.trim()).toBe(text.invites.remaining.replace("{{count}}", String(INVITE_CODE_ACTIVE_LIMIT - 3)));
    });
});

describe("资料", () => {
    it("只发改过的项，清空的网站发 null；保存成功写“已保存”，按注入的时钟 3 秒后清掉", async () => {
        const {harness, page} = await openAccount({
            me: {website: "https://alice.example", bio: "写悬疑"},
            handlers: () => ({
                [`PATCH ${ME}`]: (body, server) => {
                    const next: MeResponse = {...me(server.session!), ...(body as PatchMeRequest)} as MeResponse;
                    server.session!.me = next;
                    return Response.json(next);
                },
            }),
        });
        const profile = section(page, "profile");
        const save = profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!;
        expect(save.disabled).toBe(true);
        type(input(profile, "displayName"), "老猫");
        type(input(profile, "website"), "");
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(profile)).toBe(text.saved));
        expect(toneOf(profile)).toBe("success");
        expect(actions(harness)).toEqual([{method: "PATCH", path: ME, body: {displayName: "老猫", website: null} satisfies PatchMeRequest}]);
        expect(harness.site.account.state.value).toMatchObject({kind: "signed-in", me: {displayName: "老猫", website: null}});
        await vi.waitFor(() => expect(save.disabled).toBe(true));

        harness.clock.advance(2999);
        expect(statusOf(profile)).toBe(text.saved);
        harness.clock.advance(1);
        await vi.waitFor(() => expect(statusOf(profile)).toBe(""));
    });

    it("服务端把改过的项规范化了（邮箱转小写）：保存后格子里是服务端的值，不再算有改动", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({
                [`PATCH ${ME}`]: (body, server) => {
                    const patch = body as PatchMeRequest;
                    const next: MeResponse = {...me(server.session!), ...(patch.email === undefined ? {} : {email: patch.email.toLowerCase()})};
                    server.session!.me = next;
                    return Response.json(next);
                },
            }),
        });
        const profile = section(page, "profile");
        const save = profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!;
        type(input(profile, "email"), "Bob@Example.COM");
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(profile)).toBe(text.saved));
        expect(actions(harness)).toEqual([{method: "PATCH", path: ME, body: {email: "Bob@Example.COM"} satisfies PatchMeRequest}]);
        await vi.waitFor(() => expect(input(profile, "email").value).toBe("bob@example.com"));
        expect(save.disabled).toBe(true);
    });

    it("保存回 rate_limited：状态行按秒倒数，倒数完之前保存不可用", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({[`PATCH ${ME}`]: () => rateLimited({"Retry-After": "5"})}),
        });
        const profile = section(page, "profile");
        const save = profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!;
        type(input(profile, "displayName"), "老猫");
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(profile)).toBe(fill(errors.rate_limited, {seconds: 5})));
        expect(save.disabled).toBe(true);
        harness.clock.advance(5_000);
        await vi.waitFor(() => expect(statusOf(profile)).toBe(""));
        expect(save.disabled).toBe(false);
    });

    it("validation_failed：按 fields 标红对应的格子，焦点给第一个", async () => {
        const {page} = await openAccount({
            handlers: () => ({[`PATCH ${ME}`]: () => failure({error: {code: "validation_failed", fields: ["website", "bio"]}}, 400)}),
        });
        const profile = section(page, "profile");
        type(input(profile, "website"), "https://alice.example/");
        type(input(profile, "bio"), "写悬疑");
        const save = profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!;
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(profile)).toBe(errors.validation_failed));
        expect([...profile.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]')].map((element) => element.getAttribute("name"))).toEqual(["website", "bio"]);
        await vi.waitFor(() => expect(document.activeElement).toBe(input(profile, "website")));
    });

    it("email_taken：邮箱那一格标红并得到焦点，原因写状态行", async () => {
        const {page} = await openAccount({
            handlers: () => ({[`PATCH ${ME}`]: () => failure({error: {code: "email_taken"}}, 409)}),
        });
        const profile = section(page, "profile");
        type(input(profile, "email"), "bob@example.com");
        const save = profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!;
        await vi.waitFor(() => expect(save.disabled).toBe(false));
        save.click();

        await vi.waitFor(() => expect(statusOf(profile)).toBe(errors.email_taken));
        expect(invalidNames(profile)).toEqual(["email"]);
        await vi.waitFor(() => expect(document.activeElement).toBe(input(profile, "email")));
    });

    it("离开一个不合规则的格子：标红、状态行写规则、保存不可用；有邮箱的账号不能把邮箱清空", async () => {
        const {page} = await openAccount();
        const profile = section(page, "profile");
        const website = input(profile, "website");
        type(website, "alice.example");
        website.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));

        await vi.waitFor(() => expect(statusOf(profile)).toBe(text.rules.webUrl));
        expect(invalidNames(profile)).toEqual(["website"]);
        expect(profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!.disabled).toBe(true);

        type(website, "");
        type(input(profile, "email"), "");
        await vi.waitFor(() => expect(statusOf(profile)).toBe(""));
        expect(profile.querySelector<HTMLButtonElement>("[data-site-account-save]")!.disabled).toBe(true);
    });

    it("没有邮箱的账号：邮箱格里显示“待补”，目录“资料”后面有点；填了字“待补”收起", async () => {
        const {page} = await openAccount({me: {email: null, emailPending: true}});
        const profile = section(page, "profile");
        const badge = profile.querySelector<HTMLElement>("[data-site-account-email-pending]")!;
        expect(badge.classList.contains("is-shown")).toBe(true);
        expect(badge.getAttribute("aria-hidden")).toBeNull();
        expect(page.querySelector('[data-site-account-toc-item="profile"] [data-site-account-toc-dot]')?.getAttribute("data-site-account-toc-dot")).toBe("on");

        type(input(profile, "email"), "a");
        await vi.waitFor(() => expect(badge.classList.contains("is-shown")).toBe(false));
        expect(badge.getAttribute("aria-hidden")).toBe("true");
    });

    it("有邮箱的账号：“待补”在、但看不见，目录没有点", async () => {
        const {page} = await openAccount();
        const badge = section(page, "profile").querySelector<HTMLElement>("[data-site-account-email-pending]")!;
        expect(badge.classList.contains("is-shown")).toBe(false);
        expect(badge.getAttribute("aria-hidden")).toBe("true");
        expect(page.querySelector('[data-site-account-toc-item="profile"] [data-site-account-toc-dot]')?.getAttribute("data-site-account-toc-dot")).toBe("off");
    });
});

describe("页面", () => {
    it("目录列出四节，没有“已授权的应用”；点一项，地址的锚点跟着换、那一项标为当前", async () => {
        const {harness, page} = await openAccount();
        const items = [...page.querySelectorAll<HTMLAnchorElement>("[data-site-account-toc-item]")];
        expect(items.map((item) => item.getAttribute("href"))).toEqual(["#profile", "#security", "#sessions", "#invites"]);
        expect(items.map((item) => item.getAttribute("aria-current"))).toEqual(["location", null, null, null]);

        items[2]!.click();
        await vi.waitFor(() => expect(harness.site.router.currentRoute.value.hash).toBe("#sessions"));
        expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, null, "location", null]);
        // 焦点进了那一节：给它的标题，读屏读出到了哪一节。
        expect(document.activeElement).toBe(section(page, "sessions").querySelector("h2"));
    });

    it("带着锚点进来：不抢焦点", async () => {
        const {harness} = await openAccount({path: "/account#sessions"});
        expect(harness.site.router.currentRoute.value.hash).toBe("#sessions");
        expect(document.activeElement?.closest("[data-site-account-section]") ?? null).toBeNull();
    });

    it("账号菜单的读屏名字里有用户名", async () => {
        const {page} = await openAccount();
        expect(page.querySelector("[data-site-account-menu]")?.getAttribute("aria-label")).toBe(fill(text.menu, {username: "alice"}));
    });

    it("meta 晚到：列表都到了也等它，回来之后才画各节，没开放的上游这时就不在", async () => {
        const late = gate();
        const data = defaultData();
        const harness = startAt("/account", {
            session: {role: "user", consentRequired: false},
            meta: async () => {
                await late.wait;
                return Response.json({termsVersion: "2026-11-01", registrationOpen: true, providers: {github: true, google: false}} satisfies MetaResponse);
            },
            handlers: listHandlers(data),
        });
        await settledAt(harness, "/account", "account");
        await vi.waitFor(() => expect(gets(harness, INVITES)).toBe(1));
        // 列表的回答要过几轮任务才处理完，处理完时页面看不出变化（这正是要测的）；让出几轮任务队列，再看仍是“正在载入”、各节没画。
        for (let turn = 0; turn < 5; turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(harness.target.querySelector("[data-site-account-loading]")).not.toBeNull();
        expect(harness.target.querySelector("[data-site-account-section]")).toBeNull();

        late.open();
        await vi.waitFor(() => expect(harness.target.querySelector('[data-site-account-section="security"]')).not.toBeNull());
        const rows = [...harness.target.querySelectorAll("[data-site-account-identity]")].map((row) => row.getAttribute("data-site-account-identity"));
        expect(rows).toEqual(["github"]);
    });

    it("meta 取不到：不挡页面，各节照常画出，没关联的上游照样列出", async () => {
        const {page} = await openAccount({meta: () => failure({error: {code: "unavailable"}}, 503)});
        const rows = [...section(page, "security").querySelectorAll("[data-site-account-identity]")].map((row) => row.getAttribute("data-site-account-identity"));
        expect(rows).toEqual(["github", "google"]);
    });

    it("列表取不到：同一位置写原因与重试，重试成功后画出各节", async () => {
        let broken = true;
        const data = defaultData();
        const harness = startAt("/account", {
            session: {role: "user", consentRequired: false},
            handlers: {
                ...listHandlers(data),
                [`GET ${SESSIONS}`]: () => (broken ? failure({error: {code: "unavailable"}}, 503) : Response.json({items: data.sessions} satisfies SessionListResponse)),
            },
        });
        await settledAt(harness, "/account", "account");
        await vi.waitFor(() => expect(harness.target.querySelector("[data-site-account-failed]")).not.toBeNull());
        const failed = harness.target.querySelector<HTMLElement>("[data-site-account-failed]")!;
        expect(failed.getAttribute("role")).toBe("alert");
        expect(failed.textContent).toContain(errors.unavailable);
        expect(harness.target.querySelector("[data-site-account-section]")).toBeNull();

        broken = false;
        button(failed, text.retry).click();
        await vi.waitFor(() => expect(harness.target.querySelector('[data-site-account-section="sessions"]')).not.toBeNull());
    });

    it("取列表超过 200 毫秒才显示“正在载入”", async () => {
        const slow = gate();
        const data = defaultData();
        const harness = startAt("/account", {
            session: {role: "user", consentRequired: false},
            handlers: {
                ...listHandlers(data),
                [`GET ${SESSIONS}`]: async () => {
                    await slow.wait;
                    return Response.json({items: data.sessions} satisfies SessionListResponse);
                },
            },
        });
        await settledAt(harness, "/account", "account");
        const loading = harness.target.querySelector<HTMLElement>("[data-site-account-loading]")!;
        expect(loading.getAttribute("aria-busy")).toBe("true");
        harness.clock.advance(199);
        await Promise.resolve();
        expect(loading.textContent).not.toContain(text.loading);
        harness.clock.advance(1);
        await vi.waitFor(() => expect(loading.textContent).toContain(text.loading));

        slow.open();
        await vi.waitFor(() => expect(harness.target.querySelector('[data-site-account-section="profile"]')).not.toBeNull());
    });

    it("退出登录：结束会话，回到首页的登录表单", async () => {
        const {harness, page} = await openAccount({
            handlers: () => ({
                [`POST ${LOGOUT}`]: (_body, server) => {
                    server.session = undefined;
                    return Response.json({});
                },
            }),
        });
        const trigger = page.querySelector<HTMLButtonElement>("[data-site-account-menu]")!;
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(document.body.querySelector('[role="menuitem"]')).not.toBeNull());
        const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        expect(items.map((item) => item.textContent?.trim())).toEqual([text.signOut]);
        items[0]!.click();

        await settledAt(harness, "/", "home");
        expect(actions(harness)).toEqual([{method: "POST", path: LOGOUT, body: undefined}]);
        expect(harness.site.account.state.value).toEqual({kind: "anonymous"});
    });
});
