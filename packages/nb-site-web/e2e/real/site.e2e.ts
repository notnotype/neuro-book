/**
 * 真实冒烟（t10 计划 3.10，段 B 第 10 片）：真的 `nb-site serve` 发本次构建的前端，浏览器经 HTTPS 以 `https://site.test` 打开，
 * 每个用例一个新进程、新数据目录。浏览器怎么到达站点、为什么这样选，见 `site.ts` 的文件头。
 *
 * 量的是假接口量不到的东西：真的 Cookie（`__Host-` 前缀、`Secure`、`HttpOnly`、`SameSite=Lax`）存进浏览器并带回、登录与写操作的
 * `Origin` 过得了服务端的核对、服务端的 SPA 回退与内容安全策略、跨进程重启后的会话、真的授权码。每个用例结束时断言浏览器里
 * 没有 CSP 拦截与没接住的异常（`problems` fixture），收到的 `Set-Cookie` 属性附在用例的输出里。各页的逻辑与版式在 dom 测试与
 * 假接口的场景里，这里不重复。
 */

import {authorizationRequest, exchangeCode, type RegisteredClient} from "@notnotype/nb-site-contract-tests/testing";
import type {Page} from "@playwright/test";

import {ADMIN, LEGAL_VERSION, adminZhCN, agreeToBoth, expect, fill, issueRegistrationCode, register, signIn, signInAdmin, test, zhCN} from "./site";

const PASSWORD = "writer-password-1";
const SESSION_COOKIE = "__Host-nbsite.session_token";

/** 会话 Cookie 在浏览器里存成的样子：只属于 `site.test`，只走 https，脚本读不到，跨站的子请求不带。 */
async function sessionCookie(page: Page): Promise<unknown> {
    const cookies = await page.context().cookies();
    return cookies.filter((cookie) => cookie.name === SESSION_COOKIE).map(({name, domain, path, secure, httpOnly, sameSite}) => ({name, domain, path, secure, httpOnly, sameSite}));
}

const STORED_SESSION = [{name: SESSION_COOKIE, domain: "site.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax"}];

test("管理员：登录、同意条款后到看板，每块都落定、不停在载入中，页面不崩；在注册码页发一个码，列表里有它", async ({server, openPage}) => {
    expect(server.process.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
    const page = await openPage();
    await signInAdmin(page);

    // 只看进得去、每块都落定：落成有数据、空还是出错取决于进程里有没有统计的查询接口与数据，不是这条冒烟要量的。
    // 页面不崩由 `problems` 在用例结束时断言（没有没接住的异常）。
    const panels = page.locator("[data-site-dashboard-panel]");
    await expect(panels.first()).toBeVisible();
    const SETTLED = ["ready", "empty", "failed"];
    await expect.poll(async () => (await panels.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-site-panel-state")))).filter((state) => state === null || !SETTLED.includes(state))).toEqual([]);

    const code = await issueRegistrationCode(page, "real smoke");
    await expect(page.getByRole("row").filter({hasText: code})).toContainText("real smoke");
});

test("访客：用注册码注册到账号页，改资料保存、刷新后还在，退出登录，再登录回到账号页；会话 Cookie 带着 __Host- 的全部属性", async ({server, openPage, problems}) => {
    expect(server.dataDir).not.toBe("");
    const admin = await openPage();
    await signInAdmin(admin);
    const code = await issueRegistrationCode(admin, "visitor");

    const page = await openPage();
    await register(page, code, "writer", PASSWORD);
    expect(await sessionCookie(page)).toEqual(STORED_SESSION);
    const issued = problems.setCookies.filter((line) => line.includes(`${SESSION_COOKIE}=…`));
    expect(issued.length).toBeGreaterThan(0);
    for (const line of issued) for (const attribute of ["; Path=/", "; HttpOnly", "; Secure", "; SameSite=Lax"]) expect(line).toContain(attribute);

    const profile = page.locator('[data-site-account-section="profile"]');
    await profile.getByRole("textbox", {name: zhCN.account.profile.bio}).fill("在真实的进程上写下的签名");
    await profile.locator("[data-site-account-save]").click();
    await expect(profile.locator("[data-site-form-status]")).toContainText(zhCN.account.saved);
    await page.reload();
    await expect(page.locator('[data-site-account-section="profile"]').getByRole("textbox", {name: zhCN.account.profile.bio})).toHaveValue("在真实的进程上写下的签名");

    await page.getByRole("button", {name: fill(zhCN.account.menu, {username: "writer"})}).click();
    await page.getByRole("menuitem", {name: zhCN.account.signOut}).click();
    // 退出后到站点的首页，首页就是登录页（路由名是 home）。
    await expect(page.locator('[data-site-page="home"] input[name="identifier"]')).toBeVisible();
    expect(await sessionCookie(page)).toEqual([]);

    await signIn(page, "writer", PASSWORD);
    await expect(page.locator('[data-site-page="account"]')).toBeVisible();
    expect(await sessionCookie(page)).toEqual(STORED_SESSION);
});

test("深链与刷新：没登录打开 /account 先到带 next 的登录页，登录后回到 /account；在 /admin/users?page=1 刷新还停在这一页（服务端回退到 index.html）", async ({server, openPage}) => {
    expect(server.dataDir).not.toBe("");
    // 新造的管理员先在另一个浏览器里同意条款，这里的登录才直接回到 next，不经同意页。
    await signInAdmin(await openPage());

    const page = await openPage();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)account$/u);
    await signIn(page, ADMIN.username, ADMIN.password);
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.locator('[data-site-page="account"]')).toBeVisible();

    await page.goto("/admin/users?page=1");
    await expect(page.locator('[data-site-page="admin-users"]')).toBeVisible();
    const reloaded = await page.reload();
    expect({status: reloaded?.status(), type: reloaded?.headers()["content-type"]}).toEqual({status: 200, type: expect.stringContaining("text/html")});
    await expect(page).toHaveURL(/\/admin\/users\?page=1$/u);
    await expect(page.locator('[data-site-page="admin-users"]')).toBeVisible();
});

test("条款版本：隐私政策页的版本与服务端的条款版本一致；带新版本重启后，旧会话先到同意页，同意后回到原来的页面", async ({server, openPage}) => {
    const page = await openPage();
    await page.goto("/login");
    await signIn(page, ADMIN.username, ADMIN.password);
    // 同意页上的版本来自服务端（`meta`）；隐私政策页上的来自构建进前端的正文。发布时两者要一致（`site/identity` 的 S5）。
    await expect(page.locator("[data-site-consent-version]").first()).toHaveText(fill(zhCN.consent.version, {version: LEGAL_VERSION}));
    await agreeToBoth(page);
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
    await expect(page.locator('[data-site-page="admin-dashboard"]')).toBeVisible();
    await page.goto("/privacy");
    await expect(page.locator("[data-site-legal-version]")).toHaveAttribute("datetime", LEGAL_VERSION);
    await expect(page.locator("[data-site-legal-version]")).toHaveText(fill(zhCN.legal.version, {version: LEGAL_VERSION}));

    await page.goto("/account");
    await expect(page.locator('[data-site-page="account"]')).toBeVisible();
    const next = nextDay(LEGAL_VERSION);
    await server.restart({NB_SITE_IDENTITY_TERMS_VERSION: next});

    await page.reload();
    await expect(page).toHaveURL(/\/consent\?next=(?:%2F|\/)account$/u);
    await expect(page.locator("[data-site-consent-version]").first()).toHaveText(fill(zhCN.consent.version, {version: next}));
    await agreeToBoth(page);
    await page.locator('[data-site-paper-card] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.locator('[data-site-page="account"]')).toBeVisible();
});

test("封禁：管理员封禁一个已登录的用户，它的下一次请求回到登录页，再登录时状态行写着账号已被封禁", async ({server, openPage}) => {
    expect(server.dataDir).not.toBe("");
    const admin = await openPage();
    await signInAdmin(admin);
    const code = await issueRegistrationCode(admin, "to be banned");
    const user = await openPage();
    await register(user, code, "banned.writer", PASSWORD);

    await admin.goto("/admin/users?page=1");
    await admin.getByRole("button", {name: fill(adminZhCN.users.rowActions, {username: "banned.writer"})}).click();
    await admin.getByRole("menuitem", {name: adminZhCN.users.actions.ban.menu}).click();
    const confirm = admin.getByRole("dialog", {name: fill(adminZhCN.users.actions.ban.title, {username: "banned.writer"})});
    await confirm.getByRole("button", {name: adminZhCN.users.actions.ban.confirm, exact: true}).click();
    await expect(confirm).toBeHidden();
    await expect(admin.getByRole("row").filter({hasText: "banned.writer"})).toContainText(adminZhCN.users.banned);

    await user.reload();
    await expect(user).toHaveURL(/\/login\?next=(?:%2F|\/)account$/u);
    await signIn(user, "banned.writer", PASSWORD);
    await expect(user.locator("[data-site-paper-card] [data-site-form-status-error]")).toContainText(zhCN.errors.identity.account_banned!);
    await expect(user.locator('[data-site-page="login"]')).toBeVisible();
});

test("OAuth：管理员登记客户端；浏览器从授权端点进来，经 /login?continue= 登录，在确认页允许，带着授权码回到客户端，码换得到令牌", async ({server, openPage}) => {
    const admin = await openPage();
    await signInAdmin(admin);
    await admin.goto("/admin/clients");
    const text = adminZhCN.clients;
    await admin.getByRole("button", {name: text.register.open}).click();
    const form = admin.getByRole("dialog", {name: text.register.title});
    await form.getByRole("textbox", {name: text.form.name}).fill("真实冒烟的客户端");
    await form.getByRole("textbox", {name: text.form.redirectUris}).fill("https://client.test/callback");
    await form.getByRole("button", {name: text.register.submit, exact: true}).click();
    const done = admin.getByRole("dialog", {name: text.register.doneTitle});
    const client: RegisteredClient = {
        clientId: (await done.locator("[data-site-admin-created-client-id]").textContent())?.trim() ?? "",
        clientSecret: (await done.locator("[data-site-admin-created-secret]").textContent())?.trim() ?? "",
        redirectUri: "https://client.test/callback",
    };
    expect(client.clientId).not.toBe("");

    const page = await openPage();
    const callbacks: URL[] = [];
    await page.context().route("https://client.test/**", async (route) => {
        callbacks.push(new URL(route.request().url()));
        await route.fulfill({status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>client</title><h1>客户端</h1>"});
    });
    const request = authorizationRequest(client);
    await page.goto(request.url);
    await expect(page).toHaveURL(/\/login\?continue=[^&]+$/u);
    await signIn(page, ADMIN.username, ADMIN.password);
    await expect(page).toHaveURL(/\/oauth\/consent\?request=/u);
    await expect(page.getByRole("heading", {level: 1})).toContainText("真实冒烟的客户端");
    await page.locator("[data-site-oauth-allow]").click();
    await expect(page.locator("h1")).toHaveText("客户端");

    expect(callbacks.map((url) => `${url.origin}${url.pathname}`)).toEqual(["https://client.test/callback"]);
    const callback = callbacks[0]!;
    expect(callback.searchParams.get("state")).toBe(request.state);
    const code = callback.searchParams.get("code") ?? "";
    expect(code).not.toBe("");
    const token = await exchangeCode(server.process.url, client, code, request.verifier);
    expect(token.status).toBe(200);
    expect(JSON.parse(token.text) as unknown).toMatchObject({token_type: expect.stringMatching(/^bearer$/iu), access_token: expect.any(String)});
});

/** `YYYY-MM-DD` 的下一天：给重启用一个比正文新的条款版本。 */
function nextDay(version: string): string {
    const date = new Date(`${version}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}
