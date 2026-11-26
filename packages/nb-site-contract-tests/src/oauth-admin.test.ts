/**
 * 管理员登记与管理对外 OAuth 客户端的黑盒合同（docs/specs/site/oauth-provider.md 输入一节的客户端属性与回调地址规则、输出 9、16、
 * 失败表、副作用的审计、验收 2 的前一半与验收 18）：起真实的 `nb-site` 进程，只经 HTTP 看它。
 *
 * 本文件测不到、在账号包里的：改动写库的表与库自己写的一样（存法契约）、停用时撤令牌与码且再启用不复活、审计与操作同时生效、
 * 换密钥后旧密钥换码 `invalid_client`、库拒收自家规则放过的地址时的映射（`admin/oauth-clients.test.ts`）；回调地址规则与库的
 * 对照（`oauth/clients.test.ts`）。授权端点与令牌端点的挂载在第 5 片，那时停用与换密钥在合同里看得到的那一面进
 * `oauth-provider.test.ts`。
 *
 * 时间预算：起进程、建账号放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {
    AuditListResponse,
    CreateOAuthClientResponse,
    ErrorBody,
    IDENTITY_PATHS,
    identityPath,
    OAuthClientItem,
    OAuthClientListResponse,
    RotateSecretResponse,
    type OAuthClientType,
    type RegistrationCodeItem,
} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests oauth-admin.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "admin-PW-q8Wd51";
const MEMBER_PASSWORD = "member-PW-h2Js60";
const CLIENTS = IDENTITY_PATHS.adminOAuthClients;
const AUDIT = `${IDENTITY_PATHS.adminAudit}?targetType=oauth_client&pageSize=100`;

const REDIRECT_URI_INVALID = {status: 400, body: {error: {code: "redirect_uri_invalid"}}};
const validationFailed = (fields: string[]) => ({status: 400, body: {error: {code: "validation_failed", fields}}});

function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return {status: response.status, body: response.body};
}

/**
 * 回调地址按种类的规则（输入一节）。合格的两种都登记得进；不合格的回 `redirect_uri_invalid`。改动用同一张表（输出 16 的“规则同登记”）。
 */
const RULES: readonly (readonly [uri: string, type: OAuthClientType, accepted: boolean])[] = [
    ["https://client.example/cb", "confidential", true],
    ["https://client.example:8443/cb?x=1", "confidential", true],
    ["http://127.0.0.1:8080/cb", "confidential", false],
    ["http://localhost:8080/cb", "confidential", false],
    ["https://localhost/cb", "confidential", false],
    ["https://127.0.0.1/cb", "confidential", false],
    ["https://[::1]/cb", "confidential", false],
    ["http://client.example/cb", "confidential", false],
    ["https://client.example/cb#part", "confidential", false],
    ["https://user@client.example/cb", "confidential", false],
    ["https://client.example/c b", "confidential", false],
    ["com.example.app:/cb", "confidential", false],
    ["https://client.example/cb", "public", true],
    ["http://127.0.0.1:8123/cb", "public", true],
    ["http://127.0.0.1/cb", "public", true],
    ["http://[::1]:9/cb", "public", true],
    ["http://localhost:3000/cb", "public", true],
    ["https://localhost/cb", "public", false],
    ["https://127.0.0.1:8443/cb", "public", false],
    ["http://127.0.0.2/cb", "public", false],
    ["http://client.example/cb", "public", false],
    ["com.example.app:/cb", "public", false],
    ["myapp://callback", "public", false],
    ["http://127.0.0.1:8123/cb#part", "public", false],
    ["http://user@127.0.0.1:8123/cb", "public", false],
    ["http://127.0.0.1:8123/c\tb", "public", false],
];

/** 恰好 500 个码点的合格地址：上限之内。 */
const LONGEST_URI = `https://client.example/${"a".repeat(500 - "https://client.example/".length)}`;

describe("客户端的登记与管理（输入一节、输出 9、16、失败表、副作用的审计）", () => {
    let site: SiteProcess;
    let admin: CookieJar;
    let member: CookieJar;
    let confidential: CreateOAuthClientResponse;
    let publicClient: CreateOAuthClientResponse;
    let address = 0;
    const from = () => `192.0.2.${String(++address % 250)}`;
    const request = (path: string, init: {readonly method?: string; readonly jar?: CookieJar; readonly body?: unknown} = {}) => identityRequest(site.url, path, {from: from(), ...init});

    async function consented(username: string, password: string): Promise<CookieJar> {
        const jar = cookieJar();
        if ((await login(site.url, username, password, {from: from(), jar})).status !== 200) throw new Error(`${username} could not sign in`);
        if ((await request(IDENTITY_PATHS.meConsent, {method: "POST", jar, body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status !== 200) throw new Error(`${username} could not consent`);
        return jar;
    }

    const create = (body: Record<string, unknown>, jar: CookieJar = admin) => request(CLIENTS, {method: "POST", jar, body});
    const patch = (clientId: string, body: Record<string, unknown>, jar: CookieJar = admin) => request(identityPath.adminOAuthClient(clientId), {method: "PATCH", jar, body});
    const rotate = (clientId: string, jar: CookieJar = admin) => request(identityPath.adminOAuthClientRotate(clientId), {method: "POST", jar, body: {}});

    async function registered(body: Record<string, unknown>): Promise<CreateOAuthClientResponse> {
        const response = await create(body);
        if (response.status !== 200 || !Value.Check(CreateOAuthClientResponse, response.body)) throw new Error(`registering a client answered ${String(response.status)}`);
        return response.body;
    }

    async function auditItems(): Promise<AuditListResponse["items"]> {
        const response = await request(AUDIT, {jar: admin});
        expect({status: response.status, valid: Value.Check(AuditListResponse, response.body)}).toEqual({status: 200, valid: true});
        return (response.body as AuditListResponse).items;
    }

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        admin = await consented("root", PASSWORD);
        // 一个普通用户：经注册建出来（合同里能建普通账号的只有注册）。
        const issued = await request(IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", jar: admin, body: {maxUses: 1}});
        member = cookieJar();
        const registeredMember = await request(IDENTITY_PATHS.register, {
            method: "POST",
            jar: member,
            body: {username: "plain", email: "plain@example.com", password: MEMBER_PASSWORD, registrationCode: (issued.body as RegistrationCodeItem).code, termsVersion: TERMS_VERSION, overseasStorage: true},
        });
        if (registeredMember.status !== 200) throw new Error(`registering the member answered ${String(registeredMember.status)}`);
        confidential = await registered({name: "机密客户端", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: false});
        publicClient = await registered({name: "公开客户端", redirectUris: ["http://127.0.0.1:8123/cb"], type: "public", skipConsent: true});
    }, SETUP_TIMEOUT_MS);

    it("普通用户调四个接口都是 forbidden（验收 2 的前一半）", async () => {
        const answers = [
            await request(CLIENTS, {jar: member}),
            await create({name: "x", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: false}, member),
            await patch(confidential.client.clientId, {disabled: true}, member),
            await rotate(confidential.client.clientId, member),
        ];
        for (const answer of answers) expect(failure(answer)).toEqual({status: 403, body: {error: {code: "forbidden"}}});
    });

    it("登记机密客户端：回客户端与只出现这一次的密钥", async () => {
        const response = await create({name: "机密 2", redirectUris: ["https://a.example/cb", "https://b.example/cb"], type: "confidential", skipConsent: true});
        expect({status: response.status, valid: Value.Check(CreateOAuthClientResponse, response.body)}).toEqual({status: 200, valid: true});
        const {client, clientSecret} = response.body as CreateOAuthClientResponse;
        expect(client).toEqual({id: client.id, clientId: client.clientId, name: "机密 2", redirectUris: ["https://a.example/cb", "https://b.example/cb"], type: "confidential", skipConsent: true, disabled: false, createdAt: client.createdAt});
        expect(typeof clientSecret).toBe("string");
    });

    it("登记公开客户端：没有密钥", async () => {
        const response = await create({name: "公开 2", redirectUris: ["http://localhost:3000/cb"], type: "public", skipConsent: false});
        expect({status: response.status, valid: Value.Check(CreateOAuthClientResponse, response.body)}).toEqual({status: 200, valid: true});
        const {client, clientSecret} = response.body as CreateOAuthClientResponse;
        expect({type: client.type, disabled: client.disabled, skipConsent: client.skipConsent, clientSecret}).toEqual({type: "public", disabled: false, skipConsent: false, clientSecret: null});
    });

    describe("回调地址的规则", () => {
        it.each(RULES)("登记 %p 作为 %p 客户端的回调地址：合格 %p", async (uri, type, accepted) => {
            const response = await create({name: "规则", redirectUris: [uri], type, skipConsent: false});
            if (accepted) expect({status: response.status, redirectUris: (response.body as CreateOAuthClientResponse).client.redirectUris}).toEqual({status: 200, redirectUris: [uri]});
            else expect(failure(response)).toEqual(REDIRECT_URI_INVALID);
        });

        it.each(RULES)("把回调地址改为 %p（%p 客户端，按它的种类判）：合格 %p", async (uri, type, accepted) => {
            const target = type === "confidential" ? confidential : publicClient;
            const response = await patch(target.client.clientId, {redirectUris: [uri]});
            if (accepted) expect({status: response.status, redirectUris: (response.body as OAuthClientItem).redirectUris}).toEqual({status: 200, redirectUris: [uri]});
            else expect(failure(response)).toEqual(REDIRECT_URI_INVALID);
        });

        it("一个不合格的混在合格的里面：整个登记不进", async () => {
            expect(failure(await create({name: "混", redirectUris: ["https://client.example/cb", "https://localhost/cb"], type: "confidential", skipConsent: false}))).toEqual(REDIRECT_URI_INVALID);
        });

        it("个数与长度：一到五个、每个至多 500 个码点；超出是 validation_failed", async () => {
            const five = ["1", "2", "3", "4", "5"].map((n) => `https://client.example/${n}`);
            expect((await create({name: "五个", redirectUris: five, type: "confidential", skipConsent: false})).status).toBe(200);
            expect((await create({name: "最长", redirectUris: [LONGEST_URI], type: "confidential", skipConsent: false})).status).toBe(200);
            expect(failure(await create({name: "六个", redirectUris: [...five, "https://client.example/6"], type: "confidential", skipConsent: false}))).toEqual(validationFailed(["redirectUris"]));
            expect(failure(await create({name: "超长", redirectUris: [`${LONGEST_URI}a`], type: "confidential", skipConsent: false}))).toEqual(validationFailed(["redirectUris"]));
            expect(failure(await create({name: "没有", redirectUris: [], type: "confidential", skipConsent: false}))).toEqual(validationFailed(["redirectUris"]));
            expect(failure(await patch(confidential.client.clientId, {redirectUris: [...five, "https://client.example/6"]}))).toEqual(validationFailed(["redirectUris"]));
        });
    });

    it("改名字、免确认、停用与再启用：回改后的客户端；种类不能改", async () => {
        const target = await registered({name: "将被改", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: false});
        const id = target.client.clientId;
        const changed = await patch(id, {name: "改过", skipConsent: true, disabled: true});
        expect({status: changed.status, body: changed.body}).toEqual({status: 200, body: {...target.client, name: "改过", skipConsent: true, disabled: true}});
        expect((await patch(id, {disabled: false})).body).toEqual({...target.client, name: "改过", skipConsent: true});
        expect(failure(await patch(id, {type: "public"}))).toEqual(validationFailed(["type"]));
        expect(failure(await patch(id, {}))).toEqual(validationFailed([]));
    });

    it("换密钥：机密客户端回新密钥；公开客户端 client_public；没有这个客户端 not_found", async () => {
        const rotated = await rotate(confidential.client.clientId);
        expect({status: rotated.status, valid: Value.Check(RotateSecretResponse, rotated.body)}).toEqual({status: 200, valid: true});
        expect((rotated.body as RotateSecretResponse).clientSecret).not.toBe(confidential.clientSecret);
        expect(failure(await rotate(publicClient.client.clientId))).toEqual({status: 409, body: {error: {code: "client_public"}}});
        expect(failure(await rotate("no-such-client"))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(failure(await patch("no-such-client", {disabled: true}))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(failure(await rotate("bad.id"))).toEqual(validationFailed(["id"]));
    });

    it("列表：每项的字段合 schema、不含密钥；多于一页时带第 1 页的 anchor 取第 2 页，期间新登记的不出现（验收 18）", async () => {
        const secret = await registered({name: "列表里的机密", redirectUris: ["https://client.example/cb"], type: "confidential", skipConsent: false});
        const first = await request(`${CLIENTS}?pageSize=2`, {jar: admin});
        expect({status: first.status, valid: Value.Check(OAuthClientListResponse, first.body)}).toEqual({status: 200, valid: true});
        const page1 = first.body as OAuthClientListResponse;
        expect(page1.total).toBeGreaterThan(2);
        expect(page1.items[0]).toEqual(secret.client);
        expect(JSON.stringify(page1)).not.toContain(secret.clientSecret!);

        const added = await registered({name: "翻页期间登记", redirectUris: ["https://client.example/cb"], type: "public", skipConsent: false});
        const second = await request(`${CLIENTS}?page=2&pageSize=2&anchor=${page1.anchor}`, {jar: admin});
        const page2 = second.body as OAuthClientListResponse;
        expect({status: second.status, total: page2.total, anchor: page2.anchor}).toEqual({status: 200, total: page1.total, anchor: page1.anchor});
        const ids = (page: OAuthClientListResponse) => page.items.map((item) => item.clientId);
        expect(ids(page2)).not.toContain(added.client.clientId);
        expect(ids(page2).filter((id) => ids(page1).includes(id))).toEqual([]);

        const fresh = (await request(CLIENTS, {jar: admin})).body as OAuthClientListResponse;
        expect({total: fresh.total, first: fresh.items[0]?.clientId}).toEqual({total: page1.total + 1, first: added.client.clientId});
        expect(failure(await request(`${CLIENTS}?anchor=rc1`, {jar: admin}))).toEqual(validationFailed(["anchor"]));
    });

    it("三种审计各一条：对象是同一个客户端，参数只有种类与是否免确认、改了哪些属性，不含密钥与回调地址；失败的不写", async () => {
        const uri = "https://audited.example/cb";
        const before = (await auditItems()).length;
        expect(failure(await create({name: "不合格", redirectUris: ["https://localhost/cb"], type: "confidential", skipConsent: false}))).toEqual(REDIRECT_URI_INVALID);
        const created = await registered({name: "被审计", redirectUris: [uri], type: "confidential", skipConsent: true});
        expect((await patch(created.client.clientId, {name: "被审计 2", redirectUris: [`${uri}2`], disabled: true})).status).toBe(200);
        const rotated = (await rotate(created.client.clientId)).body as RotateSecretResponse;

        const items = await auditItems();
        expect(items.length).toBe(before + 3);
        const [rotation, update, creation] = items;
        expect(creation).toMatchObject({action: "oauth_client.create", params: {type: "confidential", skipConsent: true}});
        expect(update).toMatchObject({action: "oauth_client.update", params: {properties: "name,redirectUris,disabled"}});
        expect(rotation).toMatchObject({action: "oauth_client.rotate_secret", params: {}});
        expect([creation, update, rotation].map((item) => ({target: item!.target, actor: item!.actor?.username}))).toEqual(
            Array.from({length: 3}, () => ({target: {type: "oauth_client", id: created.client.id}, actor: "root"})),
        );
        const recorded = JSON.stringify([creation, update, rotation]);
        for (const leaked of [created.clientSecret!, rotated.clientSecret, uri, created.client.clientId]) expect(recorded).not.toContain(leaked);
    });
});
