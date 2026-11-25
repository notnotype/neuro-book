/**
 * OAuth 客户端的管理接口（`admin/oauth-clients.ts`；`site.oauth-provider` 输出 8 末项、9、16，副作用一节的审计）。
 *
 * 合同测试（`nb-site-contract-tests` 的 `oauth-admin.test.ts`）覆盖经 HTTP 看得到的部分：权限、两种登记、回调地址的规则表、
 * `client_public`、列表与翻页、三种审计的参数。这里测合同里造不出或看不到的（计划第 5 节第 4 行）：
 * - 存法契约：改动用自家 SQL 写库的表，写出的行要与库的 `adminUpdateOAuthClient` 写的逐列一样、库读回来也一样。
 * - 停用时撤令牌与码、再启用不复活：要在进程内拿到令牌、调库的用户信息与换码（挂载层在第 5 片才有）。
 * - 审计与操作同时生效：要在审计表上临时加拒绝插入的触发器。
 * - 换密钥后旧密钥换码 `invalid_client`。
 * - 库拒收回调地址时的映射：要让自家的规则放过库拒收的地址，经路由选项换掉规则。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Hono} from "hono";
import {Value} from "typebox/value";

import {CreateOAuthClientResponse, OAuthClientItem, RotateSecretResponse} from "@notnotype/nb-site-identity-contract";

import {failureFor, respondFailure} from "../errors";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, authorize, CONSENTED, exchange, grantTokens, TEST_REDIRECT_URI, userinfo, type TestClient} from "../testing/oauth";
import {registerOAuthClientAdminRoutes} from "./oauth-clients";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.assembly.close();
    await identity?.root.cleanup();
    identity = undefined;
});

const CLIENTS = "/admin/oauth-clients";
const INTERNAL = {status: 500, body: {error: {code: "internal"}}};

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

async function admin(target: TestIdentity, username = "root"): Promise<{readonly userId: number; readonly cookie: string}> {
    const userId = await target.addUser(username, {role: "admin", ...CONSENTED});
    const {cookie} = await target.issue(userId);
    return {userId, cookie};
}

function send(target: TestIdentity, cookie: string, method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
    return target.fetch(path, {method, headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

/** 经接口登记一个机密客户端（回调地址是测试客户端的，免确认），回登记的响应。 */
async function register(target: TestIdentity, cookie: string, body: Partial<{name: string; redirectUris: string[]; type: string; skipConsent: boolean}> = {}): Promise<CreateOAuthClientResponse> {
    const response = await send(target, cookie, "POST", CLIENTS, {name: "测试客户端", redirectUris: [TEST_REDIRECT_URI], type: "confidential", skipConsent: true, ...body});
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(Value.Check(CreateOAuthClientResponse, created)).toBe(true);
    return created as CreateOAuthClientResponse;
}

function testClient(created: CreateOAuthClientResponse): TestClient {
    if (created.clientSecret === null) throw new Error("expected a confidential client");
    return {clientId: created.client.clientId, clientSecret: created.clientSecret};
}

function clientRow(target: TestIdentity, clientId: string): Promise<Record<string, unknown> | null> {
    return target.conn.read((tx) => tx.query<Record<string, unknown>, [string]>(`SELECT * FROM "oauthClient" WHERE "clientId" = ?`).get(clientId));
}

function clientCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "oauthClient"`).get()!.n);
}

function auditActions(target: TestIdentity): Promise<string[]> {
    return target.conn.read((tx) => tx.query<{action: string}, []>(`SELECT action FROM identity_audit ORDER BY id`).all().map((row) => row.action));
}

function rejectAudit(target: TestIdentity): Promise<void> {
    return target.conn.write((tx) => void tx.query(`CREATE TRIGGER reject_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
}

/** 换码响应的 `error`；200 时为 null。 */
async function tokenError(response: Response): Promise<string | null> {
    if (response.status === 200) return null;
    return ((await response.json()) as {error: string}).error;
}

/** 库写的时间列取整到秒（`adminUpdateOAuthClient` 的写法）。 */
const LIB_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;

describe("改动的存法与库一样（存法契约）", () => {
    it("同一个改动经库的 adminUpdateOAuthClient 与经接口：原始行除 id、客户端 id、密钥与时间外逐列相同，库读回的也相同", async () => {
        identity = await createTestIdentity("identity-admin-oauth-storage");
        const root = await admin(identity);
        const api = identity.assembly.auth.api;
        const headers = new Headers({cookie: root.cookie});
        const body = {name: "公开", redirectUris: ["http://127.0.0.1:8123/cb"], type: "public", skipConsent: false};
        const viaLibrary = (await register(identity, root.cookie, body)).client.clientId;
        const viaModule = (await register(identity, root.cookie, body)).client.clientId;

        const update = {name: "改过的名字", redirectUris: ["http://[::1]:9/cb", "https://client.example/cb"], skipConsent: true, disabled: true};
        await api.adminUpdateOAuthClient({headers, body: {client_id: viaLibrary, update: {client_name: update.name, redirect_uris: update.redirectUris, skip_consent: update.skipConsent, disabled: update.disabled}}});
        expect((await send(identity, root.cookie, "PATCH", `${CLIENTS}/${viaModule}`, update)).status).toBe(200);

        const libraryRow = (await clientRow(identity, viaLibrary))!;
        const moduleRow = (await clientRow(identity, viaModule))!;
        const strip = ({id: _id, clientId: _clientId, clientSecret: _secret, createdAt: _created, updatedAt: _updated, ...rest}: Record<string, unknown>) => rest;
        expect(strip(moduleRow)).toEqual(strip(libraryRow));
        expect(moduleRow.updatedAt).toMatch(LIB_SECOND);
        expect(libraryRow.updatedAt).toMatch(LIB_SECOND);

        const read = async (clientId: string) => {
            const {client_id: _id, client_id_issued_at: _issued, ...rest} = await api.getOAuthClient({headers, query: {client_id: clientId}});
            return rest;
        };
        expect(await read(viaModule)).toEqual(await read(viaLibrary));
    });
});

describe("停用（输出 8 末项）", () => {
    it("停用时撤掉已发的令牌与没用掉的码；再启用后旧令牌仍 401、旧码换不出，新的授权照常", async () => {
        identity = await createTestIdentity("identity-admin-oauth-disable");
        const root = await admin(identity);
        const client = testClient(await register(identity, root.cookie));
        const {cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED));
        const tokens = await grantTokens(identity, cookie, client);
        const pending = await authorize(identity, cookie, client);
        expect((await userinfo(identity, tokens.access_token)).status).toBe(200);

        const path = `${CLIENTS}/${client.clientId}`;
        expect((await send(identity, root.cookie, "PATCH", path, {disabled: true})).status).toBe(200);
        expect((await userinfo(identity, tokens.access_token)).status).toBe(401);

        const enabled = await outcome(await send(identity, root.cookie, "PATCH", path, {disabled: false}));
        expect(enabled.status).toBe(200);
        expect((enabled.body as OAuthClientItem).disabled).toBe(false);
        expect((await userinfo(identity, tokens.access_token)).status).toBe(401);
        expect(await tokenError(await exchange(identity, client, pending))).toBe("invalid_grant");
        const fresh = await grantTokens(identity, cookie, client);
        expect((await userinfo(identity, fresh.access_token)).status).toBe(200);
    });

    it("写审计失败时停用不生效：回 500，客户端没停用，令牌照用", async () => {
        identity = await createTestIdentity("identity-admin-oauth-disable-audit-fails");
        const root = await admin(identity);
        const client = testClient(await register(identity, root.cookie));
        const {cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED));
        const tokens = await grantTokens(identity, cookie, client);
        await rejectAudit(identity);
        expect(await outcome(await send(identity, root.cookie, "PATCH", `${CLIENTS}/${client.clientId}`, {disabled: true, name: "改名"}))).toEqual(INTERNAL);
        expect(await clientRow(identity, client.clientId)).toMatchObject({disabled: 0, name: "测试客户端"});
        expect((await userinfo(identity, tokens.access_token)).status).toBe(200);
    });
});

describe("登记与审计同时生效", () => {
    it("写审计失败时登记不生效：回 500，表里没有客户端", async () => {
        identity = await createTestIdentity("identity-admin-oauth-create-audit-fails");
        const root = await admin(identity);
        await rejectAudit(identity);
        const response = await send(identity, root.cookie, "POST", CLIENTS, {name: "x", redirectUris: [TEST_REDIRECT_URI], type: "confidential", skipConsent: false});
        expect(await outcome(response)).toEqual(INTERNAL);
        expect(await clientCount(identity)).toBe(0);
    });
});

describe("换密钥（输出 9）", () => {
    it("换了以后旧密钥换码 invalid_client，新密钥换得出；写审计失败时不换", async () => {
        identity = await createTestIdentity("identity-admin-oauth-rotate");
        const root = await admin(identity);
        const old = testClient(await register(identity, root.cookie));
        const {cookie} = await identity.issue(await addOAuthUser(identity, "alice", CONSENTED));

        const rotated = await outcome(await send(identity, root.cookie, "POST", `${CLIENTS}/${old.clientId}/rotate-secret`, {}));
        expect(rotated.status).toBe(200);
        expect(Value.Check(RotateSecretResponse, rotated.body)).toBe(true);
        const renewed: TestClient = {clientId: old.clientId, clientSecret: (rotated.body as RotateSecretResponse).clientSecret};
        expect(renewed.clientSecret).not.toBe(old.clientSecret);
        expect(await tokenError(await exchange(identity, old, await authorize(identity, cookie, old)))).toBe("invalid_client");
        expect(await tokenError(await exchange(identity, renewed, await authorize(identity, cookie, renewed)))).toBeNull();

        await rejectAudit(identity);
        expect(await outcome(await send(identity, root.cookie, "POST", `${CLIENTS}/${old.clientId}/rotate-secret`, {}))).toEqual(INTERNAL);
        expect(await tokenError(await exchange(identity, renewed, await authorize(identity, cookie, renewed)))).toBeNull();
    });
});

describe("库拒收自家规则放过的回调地址", () => {
    it("回 400 redirect_uri_invalid、记一行 identity.oauth_client_rule_drift，不登记、不写审计", async () => {
        identity = await createTestIdentity("identity-admin-oauth-rule-drift");
        const root = await admin(identity);
        const assembly = identity.assembly;
        // 与模块同一套接口，只把自家的规则换成全部放过：库对这些地址的拒绝就是“两边走样”。
        const app = new Hono();
        registerOAuthClientAdminRoutes(app, {
            sessions: assembly.sessions,
            conn: identity.conn,
            clock: identity.clock,
            log: identity.log,
            auth: assembly.auth,
            adapter: (await assembly.auth.$context).adapter,
            checkRedirectUri: () => true,
        });
        app.onError((error, c) => respondFailure(c, failureFor(error, identity!.log)));

        // 前两个是库的 `invalid_redirect_uri`，片段是库的请求体 schema 拒收（`VALIDATION_ERROR`）。
        const cases = [
            ["https://localhost/cb", "confidential"],
            ["https://localhost/cb", "public"],
            ["https://client.example/cb#x", "confidential"],
        ] as const;
        for (const [uri, type] of cases) {
            const response = await app.fetch(
                new Request(`${TEST_SITE_URL}${CLIENTS}`, {
                    method: "POST",
                    headers: {"content-type": "application/json", cookie: root.cookie},
                    body: JSON.stringify({name: "x", redirectUris: [uri], type, skipConsent: false}),
                }),
            );
            expect(await outcome(response)).toEqual({status: 400, body: {error: {code: "redirect_uri_invalid"}}});
        }
        expect(identity.log.lines.filter((line) => line.event === "identity.oauth_client_rule_drift").map((line) => line.fields)).toEqual([
            {libraryCode: "invalid_redirect_uri", type: "confidential"},
            {libraryCode: "invalid_redirect_uri", type: "public"},
            {libraryCode: "VALIDATION_ERROR", type: "confidential"},
        ]);
        expect(await clientCount(identity)).toBe(0);
        expect(await auditActions(identity)).toEqual([]);
    });
});
