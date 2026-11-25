/**
 * 管理接口的黑盒合同（docs/specs/site/admin.md 输出 1、7、9、10）：起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。t07 第 5 片只有
 * 注册码的三个接口（发放、列表、改备注或停用）；账号、全站邀请码与审计的接口在第 7 片，用例跟着它们补进这个文件。
 *
 * 本文件测不到、在别处的：
 * - 审计（输出 8）：读审计的 `GET admin/audit` 在第 7 片，那之前合同里看不到审计记录；发放与停用各写一条、只改备注不写、失败的不写、
 *   与操作同时生效，在账号包的 `admin/registration-codes.test.ts`。
 * - 处置的写事务复核操作者（中间件认过身份之后被降级、封禁、结束会话）：要在两步之间插入动作，降级与封禁的接口也在第 7 片；在账号包
 *   的 `admin/registration-codes.test.ts`。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {ErrorBody, IDENTITY_PATHS, identityPath, RegistrationCodeItem, RegistrationCodeListResponse} from "@notnotype/nb-site-identity-contract";

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
