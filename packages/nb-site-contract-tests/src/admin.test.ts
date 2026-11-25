/**
 * 管理接口的黑盒合同（docs/specs/site/admin.md 验收 1 到 4、输出 1 到 10；`site.accounts` 验收 3、输出 4 与 6 里管理员那一半）：
 * 起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。注册码、账号的处置与列表、全站邀请码、审计列表各一组。
 *
 * 本文件测不到、在别处的：
 * - 处置的写事务复核操作者（中间件认过身份之后被降级、封禁、结束会话）：要在两步之间插入动作；在账号包的
 *   `admin/users.test.ts` 与 `admin/registration-codes.test.ts`。两个管理员互相处置是它在合同里看得到的那一面，在本文件。
 * - 审计与操作同时生效（写审计失败时操作也不生效）：要让写审计失败；在同两个文件。
 * - 重置密码的字母表与长度：合同只说给出一个新密码；在 `admin/users.test.ts`。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {
    ADMIN_USER_ACTIONS,
    AdminInviteCodeListResponse,
    AdminUserDetail,
    AdminUserItem,
    AUDIT_CLI_ACTOR,
    AuditListResponse,
    ErrorBody,
    IDENTITY_PATHS,
    identityPath,
    RegistrationCodeItem,
    RegistrationCodeListResponse,
    ResetPasswordResponse,
    UserListResponse,
    type AdminUserAction,
    type RegisterResponse,
} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests admin.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "admin-PW-q8Wd51";
const MEMBER_PASSWORD = "member-PW-h2Js60";
const CODES = IDENTITY_PATHS.adminRegistrationCodes;

function outcome(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return outcome(response);
}

const validationFailed = (fields: string[]) => ({status: 400, body: {error: {code: "validation_failed", fields}}});

describe("注册码（输出 1、7、9、10）", () => {
    let site: SiteProcess;
    let admin: CookieJar;
    let member: CookieJar;
    let address = 0;
    const from = () => `192.0.2.${String(++address)}`;

    async function consented(username: string, password: string): Promise<CookieJar> {
        const jar = cookieJar();
        const source = from();
        if ((await login(site.url, username, password, {from: source, jar})).status !== 200) throw new Error(`${username} could not sign in`);
        const consent = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consent.status !== 200) throw new Error(`${username} could not consent`);
        return jar;
    }

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        admin = await consented("root", PASSWORD);
        // 一个普通用户：经注册建出来（合同里能建普通账号的只有注册）。
        const issued = await identityRequest(site.url, CODES, {method: "POST", from: from(), jar: admin, body: {maxUses: 1}});
        member = cookieJar();
        const registered = await identityRequest(site.url, IDENTITY_PATHS.register, {
            method: "POST",
            from: from(),
            jar: member,
            body: {username: "plain", email: "plain@example.com", password: MEMBER_PASSWORD, registrationCode: (issued.body as RegistrationCodeItem).code, termsVersion: TERMS_VERSION, overseasStorage: true},
        });
        if (registered.status !== 200) throw new Error(`registering the member answered ${String(registered.status)}`);
    }, SETUP_TIMEOUT_MS);

    async function issue(body: Record<string, unknown> = {maxUses: null}): Promise<RegistrationCodeItem> {
        const response = await identityRequest(site.url, CODES, {method: "POST", from: from(), jar: admin, body});
        expect(response.status).toBe(200);
        expect(Value.Check(RegistrationCodeItem, response.body)).toBe(true);
        return response.body as RegistrationCodeItem;
    }

    async function page(query: string): Promise<RegistrationCodeListResponse> {
        const response = await identityRequest(site.url, `${CODES}${query}`, {from: from(), jar: admin});
        expect({status: response.status, valid: Value.Check(RegistrationCodeListResponse, response.body)}).toEqual({status: 200, valid: true});
        return response.body as RegistrationCodeListResponse;
    }

    it("权限（输出 1）：普通用户调三个接口都得 forbidden；没有会话得 unauthenticated", async () => {
        const forbidden = {status: 403, body: {error: {code: "forbidden"}}};
        expect(failure(await identityRequest(site.url, CODES, {from: from(), jar: member}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, CODES, {method: "POST", from: from(), jar: member, body: {maxUses: 1}}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, identityPath.adminRegistrationCode(1), {method: "PATCH", from: from(), jar: member, body: {disabled: true}}))).toEqual(forbidden);
        expect(failure(await identityRequest(site.url, CODES, {from: from()}))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
    });

    it("发放（输出 7）：码是 16 个字符、两次不同；回的条目有可用次数、过期时间、备注、发放人，还能用", async () => {
        const expiresAt = new Date((await site.advanceClock(1)) + 86_400_000).toISOString();
        const first = await issue({maxUses: 3, expiresAt, note: "beta"});
        const second = await issue();
        expect([first.code.length, second.code.length]).toEqual([16, 16]);
        expect(first.code).not.toBe(second.code);
        expect(first).toMatchObject({maxUses: 3, usedCount: 0, expiresAt, note: "beta", disabled: false, usable: true, createdBy: {username: "root"}});
        expect(second).toMatchObject({maxUses: null, expiresAt: null, note: null});
    });

    it("发放的参数不合规则：validation_failed，fields 是那几个键", async () => {
        const post = (body: unknown) => identityRequest(site.url, CODES, {method: "POST", from: from(), jar: admin, body});
        expect(failure(await post({}))).toEqual(validationFailed(["maxUses"]));
        expect(failure(await post({maxUses: 0}))).toEqual(validationFailed(["maxUses"]));
        expect(failure(await post({maxUses: 1, expiresAt: "2026-11-20"}))).toEqual(validationFailed(["expiresAt"]));
        expect(failure(await post({maxUses: 1, note: "x".repeat(201)}))).toEqual(validationFailed(["note"]));
        expect(failure(await post({maxUses: 1, code: "MINE"}))).toEqual(validationFailed(["code"]));
    });

    // 超出 200 毫秒的预算：停用前后各注册一次，各算一次密码哈希。
    it("改备注与停用（输出 7）：备注可改可清；停用后注册得 registration_code_invalid，已用它注册的账号照常登录；列表里的已用次数与是否还能用", async () => {
        const code = await issue({maxUses: 5});
        const path = identityPath.adminRegistrationCode(code.id);
        const patch = (body: unknown) => identityRequest(site.url, path, {method: "PATCH", from: from(), jar: admin, body});
        expect(outcome(await patch({note: "renamed"}))).toEqual({status: 200, body: {...code, note: "renamed"}});
        expect(outcome(await patch({note: null}))).toEqual({status: 200, body: {...code, note: null}});

        const register = (username: string) =>
            identityRequest(site.url, IDENTITY_PATHS.register, {
                method: "POST",
                from: from(),
                body: {username, email: `${username}@example.com`, password: MEMBER_PASSWORD, registrationCode: code.code, termsVersion: TERMS_VERSION, overseasStorage: true},
            });
        expect((await register("before")).status).toBe(200);
        const disabled = await patch({disabled: true});
        expect(outcome(disabled)).toEqual({status: 200, body: {...code, note: null, usedCount: 1, disabled: true, usable: false}});
        expect(outcome(await patch({disabled: true}))).toEqual(outcome(disabled));
        expect(failure(await register("after"))).toEqual({status: 422, body: {error: {code: "registration_code_invalid"}}});
        expect((await login(site.url, "before", MEMBER_PASSWORD, {from: from()})).status).toBe(200);
        expect((await page("?filter=disabled")).items.find((item) => item.id === code.id)).toMatchObject({usedCount: 1, disabled: true, usable: false});
    });

    it("改动的参数不合规则：空对象、disabled 为 false、多余的键得 validation_failed；id 不合写法 fields 是 id；没有这个码得 not_found", async () => {
        const code = await issue();
        const patch = (path: string, body: unknown) => identityRequest(site.url, path, {method: "PATCH", from: from(), jar: admin, body});
        const path = identityPath.adminRegistrationCode(code.id);
        expect(failure(await patch(path, {}))).toEqual(validationFailed([]));
        expect(failure(await patch(path, {disabled: false}))).toEqual(validationFailed(["disabled"]));
        expect(failure(await patch(path, {maxUses: 3}))).toEqual(validationFailed(["maxUses"]));
        expect(failure(await patch(`${CODES}/abc`, {disabled: true}))).toEqual(validationFailed(["id"]));
        expect(failure(await patch(identityPath.adminRegistrationCode(999_999), {disabled: true}))).toEqual({status: 404, body: {error: {code: "not_found"}}});
    });

    it("筛选与 counts（输出 9）：四个筛选项的条数相加对得上，按筛选项取到的都符合它；排序是建立时间倒序", async () => {
        const all = await page("?pageSize=100");
        expect(all.total).toBe(all.counts.all);
        expect(all.counts.usable + all.counts.exhausted_or_expired + all.counts.disabled).toBe(all.counts.all);
        for (const filter of ["usable", "exhausted_or_expired", "disabled"] as const) {
            const filtered = await page(`?pageSize=100&filter=${filter}`);
            expect({filter, total: filtered.total, items: filtered.items.length}).toEqual({filter, total: all.counts[filter], items: all.counts[filter]});
            const matches = (item: RegistrationCodeItem) => (filter === "usable" ? item.usable : filter === "disabled" ? item.disabled : !item.usable && !item.disabled);
            expect({filter, mismatched: filtered.items.filter((item) => !matches(item)).map((item) => item.id)}).toEqual({filter, mismatched: []});
        }
        const order = all.items.map((item) => [item.createdAt, item.id] as const);
        const sorted = [...order].sort(([leftAt, leftId], [rightAt, rightId]) => (leftAt === rightAt ? rightId - leftId : rightAt.localeCompare(leftAt)));
        expect(order).toEqual(sorted);
    });

    it("翻页（输出 9）：带着 anchor 取第 2 页时之后新发的码不进 items 与 total、不重复；不带 anchor 新码排最前、total 多 1", async () => {
        await issue();
        await issue();
        const first = await page("?pageSize=2");
        const added = await issue();
        const second = await page(`?pageSize=2&page=2&anchor=${first.anchor}`);
        expect({total: second.total, anchor: second.anchor, counts: second.counts}).toEqual({total: first.total, anchor: first.anchor, counts: first.counts});
        expect(second.items[0]?.id).not.toBe(first.items[1]?.id);
        expect(second.items.map((item) => item.id).filter((id) => first.items.some((item) => item.id === id) || id === added.id)).toEqual([]);
        const again = await page("?pageSize=2");
        expect({firstId: again.items[0]?.id, total: again.total}).toEqual({firstId: added.id, total: first.total + 1});
    });

    it("页码越界（输出 10）：items 为空、total 照给；page=0、pageSize=101、坏的 anchor 得 validation_failed", async () => {
        const all = await page("");
        expect(await page(`?page=${String(all.total + 1)}&pageSize=1&anchor=${all.anchor}`)).toMatchObject({items: [], total: all.total});
        const list = (query: string) => identityRequest(site.url, `${CODES}${query}`, {from: from(), jar: admin});
        expect(failure(await list("?page=0"))).toEqual(validationFailed(["page"]));
        expect(failure(await list("?pageSize=101"))).toEqual(validationFailed(["pageSize"]));
        const beyond = Number(all.anchor.slice(2)) + 1;
        for (const anchor of ["u1", `rc${String(beyond)}`, "rc-1", "RC1"]) expect({anchor, ...failure(await list(`?anchor=${anchor}`))}).toEqual({anchor, ...validationFailed(["anchor"])});
    });

    it("查询串里多余的键、给了两次的键：validation_failed，fields 是那个键；__proto__ 这个名字也一样", async () => {
        const list = (query: string) => identityRequest(site.url, `${CODES}${query}`, {from: from(), jar: admin});
        const cases: readonly (readonly [string, string])[] = [
            ["?q=a", "q"],
            ["?page=1&page=2", "page"],
            ["?__proto__=a", "__proto__"],
            ["?__proto__=a&__proto__=b", "__proto__"],
        ];
        for (const [query, field] of cases) expect({query, ...failure(await list(query))}).toEqual({query, ...validationFailed([field])});
    });
});

describe("空列表的 anchor（输出 10）", () => {
    let site: SiteProcess;
    let admin: CookieJar;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["empty"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        admin = cookieJar();
        if ((await login(site.url, "empty", PASSWORD, {from: "192.0.2.250", jar: admin})).status !== 200) throw new Error("the admin could not sign in");
        await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: "192.0.2.250", jar: admin, body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
    }, SETUP_TIMEOUT_MS);

    it("还没有码时列表为空，给出的 anchor 带回来照样能翻页，之后发的码不进那一次翻页", async () => {
        const empty = await identityRequest(site.url, CODES, {from: "192.0.2.251", jar: admin});
        expect(Value.Check(RegistrationCodeListResponse, empty.body)).toBe(true);
        const body = empty.body as RegistrationCodeListResponse;
        expect(body).toMatchObject({items: [], total: 0, counts: {all: 0, usable: 0, exhausted_or_expired: 0, disabled: 0}});
        expect((await identityRequest(site.url, CODES, {method: "POST", from: "192.0.2.252", jar: admin, body: {maxUses: 1}})).status).toBe(200);
        const again = await identityRequest(site.url, `${CODES}?anchor=${body.anchor}`, {from: "192.0.2.253", jar: admin});
        expect(outcome(again)).toEqual({status: 200, body});
    });
});

// ---- 账号（第 7 片） ----

/** 来源地址：每个请求一个，限流按来源计（`site.accounts` 输出 19），一个进程上发的请求多，不用 /24 里的 254 个。 */
function addresses(): () => string {
    let next = 0;
    return () => {
        next += 1;
        return `198.18.${String(Math.floor(next / 250))}.${String((next % 250) + 1)}`;
    };
}

const unauthenticated = {status: 401, body: {error: {code: "unauthenticated"}}};
const forbidden = {status: 403, body: {error: {code: "forbidden"}}};
const notFound = {status: 404, body: {error: {code: "not_found"}}};
const selfForbidden = {status: 409, body: {error: {code: "self_forbidden"}}};

/** 一个账号接口的站点：发请求、登录、注册、读审计的几个小函数，各 describe 自己起进程，共用这一套。 */
function siteClient(site: () => SiteProcess) {
    const from = addresses();
    const request = (path: string, init: {readonly method?: string; readonly jar?: CookieJar; readonly body?: unknown; readonly headers?: Readonly<Record<string, string | null>>} = {}) =>
        identityRequest(site().url, path, {from: from(), ...init});
    const signIn = async (identifier: string, password: string): Promise<CookieJar> => {
        const jar = cookieJar();
        const response = await login(site().url, identifier, password, {from: from(), jar});
        if (response.status !== 200) throw new Error(`${identifier} could not sign in: ${String(response.status)}`);
        return jar;
    };
    const consented = async (username: string, password: string): Promise<CookieJar> => {
        const jar = await signIn(username, password);
        if ((await request(IDENTITY_PATHS.meConsent, {method: "POST", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status !== 200) throw new Error(`${username} could not consent`);
        return jar;
    };
    const act = (jar: CookieJar | undefined, id: number, action: AdminUserAction, body?: unknown) =>
        request(identityPath.adminUserAction(id, action), {method: "POST", ...(jar === undefined ? {} : {jar}), ...(body === undefined ? {} : {body})});
    const me = (jar: CookieJar) => request(IDENTITY_PATHS.me, {jar});
    const auditPage = async (jar: CookieJar, query = ""): Promise<AuditListResponse> => {
        const response = await request(`${IDENTITY_PATHS.adminAudit}${query}`, {jar});
        expect({status: response.status, valid: Value.Check(AuditListResponse, response.body)}).toEqual({status: 200, valid: true});
        return response.body as AuditListResponse;
    };
    return {from, request, signIn, consented, act, me, auditPage};
}

describe("账号的处置（输出 1 到 5、8；site.accounts 验收 3、输出 4 与 6 的封禁、改角色、重置）", () => {
    let site: SiteProcess;
    let dataDir: string;
    let root: CookieJar;
    let deputy: CookieJar;
    let rootId: number;
    let deputyId: number;
    let registrationCode: string;
    const client = siteClient(() => site);
    const {request, signIn, consented, act, me, auditPage} = client;
    let serial = 0;

    /** 经注册建一个普通用户（合同里能建普通账号的只有注册），回它的 id、密码与注册时拿到的会话。 */
    async function member(prefix: string): Promise<{readonly id: number; readonly username: string; readonly password: string; readonly jar: CookieJar}> {
        serial += 1;
        const username = `${prefix}${String(serial)}`;
        const password = `${username}-PW-x4Tg72`;
        const jar = cookieJar();
        const response = await request(IDENTITY_PATHS.register, {
            method: "POST",
            jar,
            body: {username, email: `${username}@example.com`, password, registrationCode, termsVersion: TERMS_VERSION, overseasStorage: true},
        });
        if (response.status !== 200) throw new Error(`registering ${username} answered ${String(response.status)}`);
        return {id: (response.body as RegisterResponse).user.id, username, password, jar};
    }

    function item(response: JsonResponse): AdminUserItem {
        expect({status: response.status, valid: Value.Check(AdminUserItem, response.body)}).toEqual({status: 200, valid: true});
        return response.body as AdminUserItem;
    }

    async function detail(id: number): Promise<AdminUserDetail> {
        const response = await request(identityPath.adminUser(id), {jar: root});
        expect({status: response.status, valid: Value.Check(AdminUserDetail, response.body)}).toEqual({status: 200, valid: true});
        return response.body as AdminUserDetail;
    }

    async function auditOf(id: number): Promise<AuditListResponse["items"]> {
        return (await auditPage(root, `?targetType=user&targetId=${String(id)}&pageSize=100`)).items;
    }

    beforeAll(async () => {
        dataDir = await sandbox.dataDir();
        rootId = await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        deputyId = await createAdmin(sandbox, dataDir, ["deputy", "deputy@example.com"], PASSWORD);
        await createAdmin(sandbox, dataDir, ["selfish", "selfish@example.com"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        root = await consented("root", PASSWORD);
        deputy = await consented("deputy", PASSWORD);
        const issued = await request(CODES, {method: "POST", jar: root, body: {maxUses: null}});
        registrationCode = (issued.body as RegistrationCodeItem).code;
    }, SETUP_TIMEOUT_MS);

    // 超出 200 毫秒的预算：注册算一次密码哈希。
    it("权限（输出 1，验收 1）：普通用户调每个账号、邀请码、审计的管理接口都得 forbidden，审计没有新记录；没有会话得 unauthenticated", async () => {
        const plain = await member("plain");
        const before = (await auditPage(root)).total;
        const cases = [
            ["GET users", await request(IDENTITY_PATHS.adminUsers, {jar: plain.jar})],
            ["GET users/:id", await request(identityPath.adminUser(rootId), {jar: plain.jar})],
            ...(await Promise.all(ADMIN_USER_ACTIONS.map(async (action) => [action, await act(plain.jar, rootId, action, action === "role" ? {role: "user"} : undefined)] as const))),
            ["GET invite-codes", await request(IDENTITY_PATHS.adminInviteCodes, {jar: plain.jar})],
            ["GET audit", await request(IDENTITY_PATHS.adminAudit, {jar: plain.jar})],
        ] as const;
        for (const [name, response] of cases) expect({name, ...failure(response)}).toEqual({name, ...forbidden});
        expect((await auditPage(root)).total).toBe(before);
        expect((await me(plain.jar)).status).toBe(200);
        for (const path of [IDENTITY_PATHS.adminUsers, IDENTITY_PATHS.adminInviteCodes, IDENTITY_PATHS.adminAudit, identityPath.adminUser(rootId)]) {
            expect({path, ...failure(await request(path))}).toEqual({path, ...unauthenticated});
        }
        expect(failure(await act(undefined, plain.id, "ban"))).toEqual(unauthenticated);
    });

    // 超出 200 毫秒的预算：注册与几次登录各算一次密码哈希。Smoke（site.admin 验收与 Smoke 一节）。
    it("封禁（输出 2，site.accounts 验收 3、输出 4 与 6，Smoke）：原 Cookie 调 me 得 unauthenticated，对的密码登录得 account_banned、错的得 invalid_credentials；解封后能登录，旧 Cookie 仍无效", async () => {
        const target = await member("banned");
        expect((await me(target.jar)).status).toBe(200);
        expect(item(await act(root, target.id, "ban"))).toMatchObject({id: target.id, username: target.username, banned: true});
        expect(failure(await me(target.jar))).toEqual(unauthenticated);
        expect(failure(await login(site.url, target.username, target.password, {from: client.from()}))).toEqual({status: 403, body: {error: {code: "account_banned"}}});
        // 封禁在密码之后查（site.accounts 失败的先后）：不知道密码的人试不出谁被封了。
        expect(failure(await login(site.url, target.username, "wrong-PW-000000", {from: client.from()}))).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});

        expect(item(await act(root, target.id, "unban"))).toMatchObject({id: target.id, banned: false});
        expect(failure(await me(target.jar))).toEqual(unauthenticated);
        expect((await me(await signIn(target.username, target.password))).status).toBe(200);
    });

    // 超出 200 毫秒的预算：注册与登录各算一次密码哈希。
    it("改角色（输出 3）：改成原来的角色不结束会话；改成别的角色后旧会话失效，新登录的会话是新角色", async () => {
        const target = await member("role");
        expect(item(await act(root, target.id, "role", {role: "user"}))).toMatchObject({id: target.id, role: "user"});
        expect((await me(target.jar)).status).toBe(200);
        expect(item(await act(root, target.id, "role", {role: "admin"}))).toMatchObject({id: target.id, role: "admin"});
        expect(failure(await me(target.jar))).toEqual(unauthenticated);
        const fresh = await signIn(target.username, target.password);
        expect((await request(IDENTITY_PATHS.whoami, {jar: fresh})).body).toEqual({state: "authenticated", user: {id: target.id, username: target.username, role: "admin"}});
        expect((await request(IDENTITY_PATHS.adminUsers, {jar: fresh})).status).toBe(200);
    });

    // 超出 200 毫秒的预算：注册、重置与三次登录各算一次密码哈希。Smoke（site.admin 验收与 Smoke 一节）。
    it("重置密码（输出 4，验收 2，Smoke）：响应给出新密码；旧密码登录失败、新密码成功，原有的 Cookie 失效；审计里一条、参数里没有新密码；进程输出里找不到它", async () => {
        const target = await member("reset");
        const response = await act(root, target.id, "reset-password");
        expect({status: response.status, valid: Value.Check(ResetPasswordResponse, response.body)}).toEqual({status: 200, valid: true});
        const {password} = response.body as ResetPasswordResponse;
        expect(password).not.toBe(target.password);
        expect(failure(await me(target.jar))).toEqual(unauthenticated);
        expect(failure(await login(site.url, target.username, target.password, {from: client.from()}))).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
        expect((await me(await signIn(target.username, password))).status).toBe(200);

        const records = await auditOf(target.id);
        expect(records.map((record) => ({action: record.action, actor: record.actor, params: record.params}))).toEqual([{action: "user.reset_password", actor: {id: rootId, username: "root"}, params: {}}]);
        expect(JSON.stringify(records).includes(password)).toBe(false);
        expect(`${site.stdout()}\n${site.stderr()}`.includes(password)).toBe(false);
    });

    // 超出 200 毫秒的预算：注册与登录各算一次密码哈希。
    it("结束全部会话：两个会话都失效，审计记结束的条数；账号仍能登录", async () => {
        const target = await member("revoke");
        const second = await signIn(target.username, target.password);
        expect(item(await act(root, target.id, "revoke-sessions"))).toMatchObject({id: target.id, banned: false});
        expect(failure(await me(target.jar))).toEqual(unauthenticated);
        expect(failure(await me(second))).toEqual(unauthenticated);
        expect((await auditOf(target.id)).map((record) => record.params)).toEqual([{count: 2}]);
        expect((await me(await signIn(target.username, target.password))).status).toBe(200);
    });

    it("不能处置自己（输出 5）：对自己封禁、改角色（改成原来的角色也一样）得 self_forbidden，自己照常可用，审计没有新记录", async () => {
        const before = (await auditPage(root)).total;
        expect(failure(await act(root, rootId, "ban"))).toEqual(selfForbidden);
        expect(failure(await act(root, rootId, "role", {role: "user"}))).toEqual(selfForbidden);
        expect(failure(await act(root, rootId, "role", {role: "admin"}))).toEqual(selfForbidden);
        expect(await detail(rootId)).toMatchObject({role: "admin", banned: false});
        expect((await auditPage(root)).total).toBe(before);
    });

    // 超出 200 毫秒的预算：两次登录与一次重置各算一次密码哈希。
    it("结束自己的全部会话、重置自己的密码不受限（输出 5）：当前会话一起结束、响应清掉 Cookie；重置后用新密码能登录", async () => {
        const selfish = await consented("selfish", PASSWORD);
        const selfishId = ((await me(selfish)).body as {id: number}).id;
        expect(item(await act(selfish, selfishId, "revoke-sessions"))).toMatchObject({id: selfishId});
        expect(selfish.names()).toEqual([]);
        const again = await signIn("selfish", PASSWORD);
        const reset = await act(again, selfishId, "reset-password");
        expect(reset.status).toBe(200);
        expect(again.names()).toEqual([]);
        expect(failure(await login(site.url, "selfish", PASSWORD, {from: client.from()}))).toEqual({status: 401, body: {error: {code: "invalid_credentials"}}});
        expect((await me(await signIn("selfish", (reset.body as ResetPasswordResponse).password))).status).toBe(200);
    });

    // 超出 200 毫秒的预算：注册与重置各算一次密码哈希。
    it("审计（输出 8）：每种处置成功一次各一条，操作者、对象、动作与参数对；没有变化的处置照样写；失败的处置不写", async () => {
        const target = await member("audited");
        const steps: readonly (readonly [AdminUserAction, unknown?])[] = [["ban"], ["ban"], ["unban"], ["role", {role: "user"}], ["role", {role: "admin"}], ["revoke-sessions"], ["reset-password"]];
        for (const [action, body] of steps) expect({action, status: (await act(root, target.id, action, body)).status}).toEqual({action, status: 200});
        const records: unknown = (await auditOf(target.id)).map((record) => ({actor: record.actor, target: record.target, action: record.action, params: record.params}));
        expect(records).toEqual(
            [
                {action: "user.ban", params: {}},
                {action: "user.ban", params: {}},
                {action: "user.unban", params: {}},
                {action: "user.role", params: {from: "user", to: "user"}},
                {action: "user.role", params: {from: "user", to: "admin"}},
                // 注册时建的会话在第一次封禁时已结束，之后没再登录。
                {action: "user.revoke_sessions", params: {count: 0}},
                {action: "user.reset_password", params: {}},
            ]
                .reverse()
                .map((record) => ({actor: {id: rootId, username: "root"}, target: {type: "user", id: target.id}, ...record})),
        );

        const before = (await auditPage(root)).total;
        expect(failure(await act(root, 999_999, "ban"))).toEqual(notFound);
        expect(failure(await act(root, 999_999, "reset-password"))).toEqual(notFound);
        expect(failure(await act(root, target.id, "role", {role: "owner"}))).toEqual(validationFailed(["role"]));
        expect(failure(await act(root, target.id, "ban", {reason: "spam"}))).toEqual(validationFailed([]));
        expect(failure(await request(`${IDENTITY_PATHS.adminUsers}/abc/ban`, {method: "POST", jar: root}))).toEqual(validationFailed(["id"]));
        expect((await auditPage(root)).total).toBe(before);
    });

    // 超出 200 毫秒的预算：注册算一次密码哈希。
    it("两个管理员同时封同一个人（时序一节）：两次都成功，各有一条审计", async () => {
        const target = await member("twice");
        const [first, second] = await Promise.all([act(root, target.id, "ban"), act(deputy, target.id, "ban")]);
        expect([first.status, second.status]).toEqual([200, 200]);
        const actors = (await auditOf(target.id)).map((record) => `${record.action} ${String(record.actor?.id)}`).sort();
        expect(actors).toEqual([`user.ban ${String(deputyId)}`, `user.ban ${String(rootId)}`].sort());
    });

    // 超出 200 毫秒的预算：在用例里跑一次 create-admin（它要在封禁之后跑），另有注册与登录。
    it("create-admin 对被封的已有账号：解封并改成管理员（site.operations 输出 5），新密码能登录，审计里有一条操作者为命令行的记录", async () => {
        const target = await member("lifted");
        expect((await act(root, target.id, "ban")).status).toBe(200);
        const password = "lifted-PW-r8Kc35";
        expect(await createAdmin(sandbox, dataDir, [target.username], password)).toBe(target.id);
        const jar = await signIn(target.username, password);
        expect((await request(IDENTITY_PATHS.whoami, {jar})).body).toEqual({state: "authenticated", user: {id: target.id, username: target.username, role: "admin"}});
        expect(await detail(target.id)).toMatchObject({banned: false, role: "admin"});
        // 按动作筛：命令行进程的时钟不是站点的测试时钟，按时间排时它与站点写的记录谁先谁后不一定。
        const upserts = await auditPage(root, `?targetType=user&targetId=${String(target.id)}&action=admin.cli_upsert`);
        expect(upserts.items.map((record) => ({actor: record.actor, params: record.params}))).toEqual([{actor: null, params: {created: false}}]);
    });
});

describe("账号列表与详情、全站邀请码、审计列表（输出 8 到 10，验收 4；site.accounts 输出 1 的邀请人）", () => {
    let site: SiteProcess;
    let root: CookieJar;
    let rootId: number;
    let pendingId: number;
    let registrationCode: RegistrationCodeItem;
    const client = siteClient(() => site);
    const {request, consented, auditPage} = client;

    async function register(username: string, extra: {readonly displayName?: string; readonly inviteCode?: string} = {}): Promise<number> {
        const response = await request(IDENTITY_PATHS.register, {
            method: "POST",
            body: {username, email: `${username}@example.com`, password: MEMBER_PASSWORD, registrationCode: registrationCode.code, termsVersion: TERMS_VERSION, overseasStorage: true, ...extra},
        });
        if (response.status !== 200) throw new Error(`registering ${username} answered ${String(response.status)}`);
        return (response.body as RegisterResponse).user.id;
    }

    async function users(query: string): Promise<UserListResponse> {
        const response = await request(`${IDENTITY_PATHS.adminUsers}${query}`, {jar: root});
        expect({status: response.status, valid: Value.Check(UserListResponse, response.body)}).toEqual({status: 200, valid: true});
        return response.body as UserListResponse;
    }

    const names = (list: UserListResponse) => list.items.map((entry) => entry.username);

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        rootId = await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        // 不给邮箱：邮箱待补，存的是占位邮箱（site.operations 输出 5）。
        pendingId = await createAdmin(sandbox, dataDir, ["pending"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        root = await consented("root", PASSWORD);
        registrationCode = (await request(CODES, {method: "POST", jar: root, body: {maxUses: null, note: "secret-note-k2Pq"}})).body as RegistrationCodeItem;
        // 搜索的转义：用户名里能有 `_`，显示名里能有 `%` 与反斜杠。
        await register("esc_one");
        await register("escxone");
        await register("pct1", {displayName: "100%off"});
        await register("pct2", {displayName: "100xoff"});
        await register("bsl1", {displayName: "back\\slash"});
        await register("bsl2", {displayName: "backslash"});
    }, SETUP_TIMEOUT_MS);

    it("搜索（输入与前置条件）：用户名、显示名、邮箱的前缀，ASCII 字母不分大小写；% 、_ 与反斜杠按字面匹配；邮箱待补的账号不按占位邮箱匹配", async () => {
        expect(names(await users("?q=esc_"))).toEqual(["esc_one"]);
        expect(names(await users("?q=ESC"))).toEqual(["escxone", "esc_one"]);
        expect(names(await users(`?q=${encodeURIComponent("100%")}`))).toEqual(["pct1"]);
        expect(names(await users(`?q=${encodeURIComponent("back\\")}`))).toEqual(["bsl1"]);
        expect(names(await users("?q=pct2%40example"))).toEqual(["pct2"]);
        // 占位邮箱是 u<id>@placeholder.invalid（site.legacy-import 的写法）；按它的前缀搜不到这个账号，按用户名搜得到。
        expect(names(await users(`?q=${encodeURIComponent(`u${String(pendingId)}@`)}`))).toEqual([]);
        expect((await users("?q=pending")).items).toEqual([expect.objectContaining({id: pendingId, email: null, emailPending: true, role: "admin", banned: false})]);
        const searched = await users("?q=esc");
        expect({total: searched.total, all: searched.counts.all}).toEqual({total: 2, all: 2});
    });

    it("账号的一条（输入与前置条件最后一段）：邮箱、角色、封禁、注册时间；登录过的有最近一次登录的时间，没登录过的为空", async () => {
        const list = await users("?pageSize=100");
        const byName = new Map(list.items.map((entry) => [entry.username, entry]));
        expect(byName.get("root")).toMatchObject({id: rootId, email: "root@example.com", emailPending: false, role: "admin", banned: false, lastLoginAt: expect.any(String)});
        // 注册当场建会话，但不是一次登录。
        expect(byName.get("pct1")).toMatchObject({displayName: "100%off", email: "pct1@example.com", role: "user", lastLoginAt: null});
        expect(byName.get("pending")).toMatchObject({lastLoginAt: null});
    });

    // 超出 200 毫秒的预算：封禁之前注册一个账号，算一次密码哈希。
    it("筛选与 counts（输出 9）：每个筛选项的条数与按它取到的条目对得上，取到的都符合它；排序是注册时间倒序、再按 id 倒序", async () => {
        const bannedId = await register("filterban");
        expect((await request(identityPath.adminUserAction(bannedId, "ban"), {method: "POST", jar: root})).status).toBe(200);
        const all = await users("?pageSize=100");
        expect(all.total).toBe(all.counts.all);
        const matches = {
            admin: (entry: AdminUserItem) => entry.role === "admin",
            banned: (entry: AdminUserItem) => entry.banned,
            email_pending: (entry: AdminUserItem) => entry.emailPending,
        } as const;
        for (const filter of ["admin", "banned", "email_pending"] as const) {
            const filtered = await users(`?pageSize=100&filter=${filter}`);
            expect({filter, total: filtered.total, items: filtered.items.length, count: all.counts[filter]}).toEqual({filter, total: all.items.filter(matches[filter]).length, items: all.counts[filter], count: all.counts[filter]});
            expect({filter, mismatched: filtered.items.filter((entry) => !matches[filter](entry)).map((entry) => entry.id)}).toEqual({filter, mismatched: []});
        }
        expect(all.counts).toMatchObject({admin: 2, banned: 1, email_pending: 1});
        const order = all.items.map((entry) => [entry.createdAt, entry.id] as const);
        const sorted = [...order].sort(([leftAt, leftId], [rightAt, rightId]) => (leftAt === rightAt ? rightId - leftId : rightAt.localeCompare(leftAt)));
        expect(order).toEqual(sorted);
    });

    // 超出 200 毫秒的预算：翻页之间注册一个新账号，算一次密码哈希。
    it("验收 4：取第 1 页后注册一个新账号，带着 anchor 取第 2 页，第一条不是第 1 页的最后一条、total 相同；不带 anchor 时新账号排最前、total 多 1", async () => {
        const first = await users("?pageSize=2");
        expect(first.total).toBeGreaterThan(2);
        const added = await register("latecomer");
        const second = await users(`?pageSize=2&page=2&anchor=${first.anchor}`);
        expect({total: second.total, anchor: second.anchor, counts: second.counts}).toEqual({total: first.total, anchor: first.anchor, counts: first.counts});
        expect(second.items[0]?.id).not.toBe(first.items[1]?.id);
        expect(second.items.map((entry) => entry.id).filter((id) => id === added || first.items.some((entry) => entry.id === id))).toEqual([]);
        const again = await users("?pageSize=2");
        expect({firstId: again.items[0]?.id, total: again.total}).toEqual({firstId: added, total: first.total + 1});
    });

    it("页码越界与参数不合规则（输出 10）：越界 items 为空、total 照给；page=0、pageSize=101、超过安全整数的 page 与 pageSize、坏的 anchor、不认识的 filter 得 validation_failed", async () => {
        const all = await users("");
        expect(await users(`?page=${String(all.total + 1)}&pageSize=1&anchor=${all.anchor}`)).toMatchObject({items: [], total: all.total});
        const list = (query: string) => request(`${IDENTITY_PATHS.adminUsers}${query}`, {jar: root});
        const beyond = Number(all.anchor.slice(1)) + 1;
        const cases: readonly (readonly [string, string])[] = [
            ["?page=0", "page"],
            ["?pageSize=101", "pageSize"],
            // 2^53：超过安全整数，按数读会丢精度。
            ["?page=9007199254740992", "page"],
            ["?pageSize=9007199254740992", "pageSize"],
            ["?page=1.5", "page"],
            ["?anchor=rc1", "anchor"],
            [`?anchor=u${String(beyond)}`, "anchor"],
            ["?filter=deleted", "filter"],
            ["?role=admin", "role"],
        ];
        for (const [query, field] of cases) expect({query, ...failure(await list(query))}).toEqual({query, ...validationFailed([field])});
    });

    // 超出 200 毫秒的预算：用邀请码注册算一次密码哈希。
    it("详情（site.accounts 输出 1 的邀请人）：用 root 的邀请码注册的账号，邀请人是 root、注册码是那个码；有密码、没有上游、一个会话；没有这个账号得 not_found", async () => {
        const invite = (await request(IDENTITY_PATHS.meInviteCodes, {method: "POST", jar: root})).body as {code: string};
        const invitedId = await register("invited", {inviteCode: invite.code});
        const response = await request(identityPath.adminUser(invitedId), {jar: root});
        expect({status: response.status, valid: Value.Check(AdminUserDetail, response.body)}).toEqual({status: 200, valid: true});
        expect(response.body).toMatchObject({
            id: invitedId,
            username: "invited",
            hasPassword: true,
            providers: [],
            sessionCount: 1,
            registrationCode: {id: registrationCode.id, code: registrationCode.code},
            inviter: {id: rootId, username: "root"},
        });
        expect((await request(identityPath.adminUser(pendingId), {jar: root})).body).toMatchObject({email: null, emailPending: true, registrationCode: null, inviter: null, sessionCount: 0});
        expect(failure(await request(identityPath.adminUser(999_999), {jar: root}))).toEqual(notFound);
        expect(failure(await request(`${IDENTITY_PATHS.adminUsers}/0`, {jar: root}))).toEqual(validationFailed(["id"]));
    });

    // 超出 200 毫秒的预算：用邀请码注册算一次密码哈希。
    it("全站邀请码（接口表，输出 9）：每个码有主人与已用次数；带着 anchor 翻页时之后生成的不进来", async () => {
        const generate = async () => (await request(IDENTITY_PATHS.meInviteCodes, {method: "POST", jar: root})).body as {id: number; code: string};
        const used = await generate();
        await register("viainvite", {inviteCode: used.code});
        const page = async (query: string): Promise<AdminInviteCodeListResponse> => {
            const response = await request(`${IDENTITY_PATHS.adminInviteCodes}${query}`, {jar: root});
            expect({status: response.status, valid: Value.Check(AdminInviteCodeListResponse, response.body)}).toEqual({status: 200, valid: true});
            return response.body as AdminInviteCodeListResponse;
        };
        const first = await page("?pageSize=1");
        expect(first.items[0]).toMatchObject({id: used.id, code: used.code, usedCount: 1, usable: true, owner: {id: rootId, username: "root"}});
        const added = await generate();
        const withAnchor = await page(`?pageSize=100&anchor=${first.anchor}`);
        expect({total: withAnchor.total, ids: withAnchor.items.map((entry) => entry.id).includes(added.id)}).toEqual({total: first.total, ids: false});
        expect((await page("?pageSize=1")).items[0]?.id).toBe(added.id);
        expect(failure(await request(`${IDENTITY_PATHS.adminInviteCodes}?anchor=u1`, {jar: root}))).toEqual(validationFailed(["anchor"]));
        expect(failure(await request(`${IDENTITY_PATHS.adminInviteCodes}?filter=all`, {jar: root}))).toEqual(validationFailed(["filter"]));
    });

    it("审计列表（输出 8 到 10）：命令行建管理员、发放与停用注册码各有记录，参数不含码与备注；只改备注不写；按操作者、对象、动作筛", async () => {
        const cli = await auditPage(root, `?actorId=${AUDIT_CLI_ACTOR}`);
        expect(cli.items.map((record) => ({actor: record.actor, action: record.action, target: record.target, params: record.params}))).toEqual([
            {actor: null, action: "admin.cli_upsert", target: {type: "user", id: pendingId}, params: {created: true}},
            {actor: null, action: "admin.cli_upsert", target: {type: "user", id: rootId}, params: {created: true}},
        ]);

        const codePath = identityPath.adminRegistrationCode(registrationCode.id);
        expect((await request(codePath, {method: "PATCH", jar: root, body: {note: "renamed-note-z9Wd"}})).status).toBe(200);
        expect((await request(codePath, {method: "PATCH", jar: root, body: {disabled: true}})).status).toBe(200);
        const codeRecords = await auditPage(root, `?targetType=registration_code&targetId=${String(registrationCode.id)}`);
        expect(codeRecords.items.map((record) => ({actor: record.actor, action: record.action, params: record.params}))).toEqual([
            {actor: {id: rootId, username: "root"}, action: "registration_code.disable", params: {}},
            {actor: {id: rootId, username: "root"}, action: "registration_code.create", params: {maxUses: null, expiresAt: null}},
        ]);
        const text = JSON.stringify((await auditPage(root, "?pageSize=100")).items);
        for (const secret of [registrationCode.code, "secret-note-k2Pq", "renamed-note-z9Wd"]) expect({secret, found: text.includes(secret)}).toEqual({secret, found: false});

        const byActor = await auditPage(root, `?actorId=${String(rootId)}&pageSize=100`);
        expect(byActor.items.length).toBeGreaterThan(0);
        expect(byActor.items.filter((record) => record.actor?.id !== rootId)).toEqual([]);
        const byAction = await auditPage(root, "?action=registration_code.create&pageSize=100");
        expect(byAction.items.map((record) => record.target)).toEqual([{type: "registration_code", id: registrationCode.id}]);
        const byType = await auditPage(root, "?targetType=registration_code&pageSize=100");
        expect(byType.items.filter((record) => record.target.type !== "registration_code")).toEqual([]);
        expect(byType.total).toBe(2);
        const all = await auditPage(root, "?pageSize=100");
        const order = all.items.map((record) => [record.createdAt, record.id] as const);
        expect(order).toEqual([...order].sort(([leftAt, leftId], [rightAt, rightId]) => (leftAt === rightAt ? rightId - leftId : rightAt.localeCompare(leftAt))));
    });

    it("审计列表的参数（输出 10）：只给对象 id 不给类型、不认识的动作、坏的 actorId 与 anchor 得 validation_failed；带着 anchor 翻页时之后的记录不进来", async () => {
        const list = (query: string) => request(`${IDENTITY_PATHS.adminAudit}${query}`, {jar: root});
        const cases: readonly (readonly [string, string])[] = [
            ["?targetId=1", "targetType"],
            ["?action=user.delete", "action"],
            ["?actorId=root", "actorId"],
            ["?targetType=session&targetId=1", "targetType"],
            ["?anchor=u1", "anchor"],
        ];
        for (const [query, field] of cases) expect({query, ...failure(await list(query))}).toEqual({query, ...validationFailed([field])});

        const first = await auditPage(root, "?pageSize=1");
        expect((await request(CODES, {method: "POST", jar: root, body: {maxUses: 1}})).status).toBe(200);
        const anchored = await auditPage(root, `?pageSize=1&anchor=${first.anchor}`);
        expect({total: anchored.total, firstId: anchored.items[0]?.id}).toEqual({total: first.total, firstId: first.items[0]?.id});
        expect((await auditPage(root, "?pageSize=1")).total).toBe(first.total + 1);
    });
});

describe("只有一个管理员（输出 6，验收 3）", () => {
    let site: SiteProcess;
    let only: CookieJar;
    let onlyId: number;
    const client = siteClient(() => site);

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        onlyId = await createAdmin(sandbox, dataDir, ["only"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        only = await client.consented("only", PASSWORD);
    }, SETUP_TIMEOUT_MS);

    it("把自己降级或封禁被拒（self_forbidden）；之后仍是未封禁的管理员", async () => {
        expect(failure(await client.act(only, onlyId, "role", {role: "user"}))).toEqual(selfForbidden);
        expect(failure(await client.act(only, onlyId, "ban"))).toEqual(selfForbidden);
        const admins = await client.request(`${IDENTITY_PATHS.adminUsers}?filter=admin`, {jar: only});
        expect((admins.body as UserListResponse).items.map((entry) => ({id: entry.id, banned: entry.banned}))).toEqual([{id: onlyId, banned: false}]);
    });
});

describe("两个管理员互相处置（输出 6）", () => {
    let site: SiteProcess;
    const jars = new Map<string, CookieJar>();
    const ids = new Map<string, number>();
    const client = siteClient(() => site);
    // 取不到时抛错：拿 undefined 当会话发出去，请求会因为没有会话得 401，像是赢输分明，用例空过。
    const jarOf = (name: string): CookieJar => {
        const jar = jars.get(name);
        if (jar === undefined) throw new Error(`no session for ${name}`);
        return jar;
    };
    const idOf = (name: string): number => {
        const id = ids.get(name);
        if (id === undefined) throw new Error(`no account for ${name}`);
        return id;
    };

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        for (const name of ["alpha", "beta", "gamma", "delta"]) ids.set(name, await createAdmin(sandbox, dataDir, [name], PASSWORD));
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        for (const name of ids.keys()) jars.set(name, await client.consented(name, PASSWORD));
    }, SETUP_TIMEOUT_MS);

    /** 两人同时对对方做同一种处置：恰好一个成功，后到的那个操作者已被处置，得 unauthenticated；赢的那个仍是未封禁的管理员。 */
    async function mutual(left: string, right: string, action: "ban" | "role") {
        const body = action === "role" ? {role: "user"} : undefined;
        const [toRight, toLeft] = await Promise.all([client.act(jarOf(left), idOf(right), action, body), client.act(jarOf(right), idOf(left), action, body)]);
        const statuses = [toRight.status, toLeft.status].sort();
        expect({action, statuses}).toEqual({action, statuses: [200, 401]});
        expect(failure(toRight.status === 401 ? toRight : toLeft)).toEqual(unauthenticated);
        const winner = toRight.status === 200 ? left : right;
        const admins = await client.request(`${IDENTITY_PATHS.adminUsers}?filter=admin&pageSize=100`, {jar: jarOf(winner)});
        expect((admins.body as UserListResponse).items.filter((entry) => !entry.banned).map((entry) => entry.id)).toContain(idOf(winner));
        const loser = winner === left ? right : left;
        const records = await client.auditPage(jarOf(winner), `?targetType=user&targetId=${String(idOf(loser))}`);
        expect(records.items.map((record) => record.actor?.id)).toEqual([idOf(winner)]);
        const missed = await client.auditPage(jarOf(winner), `?targetType=user&targetId=${String(idOf(winner))}&action=user.${action}`);
        expect(missed.total).toBe(0);
    }

    it("同时封禁对方：一个成功，另一个得 unauthenticated、没有审计；站里仍有未封禁的管理员", () => mutual("alpha", "beta", "ban"));

    it("同时把对方降级：一个成功，另一个得 unauthenticated、没有审计；站里仍有未封禁的管理员", () => mutual("gamma", "delta", "role"));
});
