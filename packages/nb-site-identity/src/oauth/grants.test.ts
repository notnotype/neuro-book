/**
 * 已给的授权（`oauth/grants.ts`）依赖的库的存法：同意记录由库在确认时写，列表读它的 `scopes` 与 `createdAt`（包说明 `AGENTS.md`
 * 升级清单“授权的存法”一行）。列表与撤销的行为在合同 `oauth-invalidation.test.ts`；这里只看合同看不到的库表与两只时钟。
 *
 * 模块的时钟起在一天之前：库写 `createdAt` 用系统时间，起点不同才分得出列表的时间取自哪一只。不起在之后：确认标识的 10 分钟
 * 按模块的时钟从库按系统时间签的时刻算（`continue.ts`），时钟快一天时标识一签出就过期。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {GrantListResponse, IDENTITY_PATHS, OAUTH_ENDPOINT_PATHS, OAUTH_PAGES, OAuthDecisionResponse} from "@notnotype/nb-site-identity-contract";

import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, CONSENTED, registerClient, TEST_REDIRECT_URI, type TestClient} from "../testing/oauth";

const DAY_MS = 24 * 60 * 60 * 1000;

let identity: TestIdentity;
let client: TestClient;
let cookie: string;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-grants", {start: Date.now() - DAY_MS});
    client = await registerClient(identity, "admin", {skipConsent: false});
    cookie = (await identity.issue(await addOAuthUser(identity, "alice", CONSENTED))).cookie;
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

/** 发起授权、在确认页同意；回同意前后的系统时间。 */
async function consentTo(scope: string): Promise<{readonly before: number; readonly after: number}> {
    const query = new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: TEST_REDIRECT_URI,
        scope,
        state: "st",
        code_challenge: new Bun.CryptoHasher("sha256").update("v".repeat(43)).digest("base64url"),
        code_challenge_method: "S256",
    });
    const toConsent = await identity.request(`${OAUTH_ENDPOINT_PATHS.authorize}?${query}`, {headers: {cookie}});
    const location = new URL(toConsent.headers.get("location") ?? "", TEST_SITE_URL);
    expect({status: toConsent.status, path: location.pathname}).toEqual({status: 302, path: OAUTH_PAGES.consent});
    const before = Date.now();
    const decided = await identity.fetch(IDENTITY_PATHS.oauthAuthorization, {
        method: "POST",
        headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie},
        body: JSON.stringify({request: location.searchParams.get("request"), accept: true}),
    });
    const after = Date.now();
    expect({status: decided.status, shape: Value.Check(OAuthDecisionResponse, await decided.json())}).toEqual({status: 200, shape: true});
    return {before, after};
}

async function listed(): Promise<GrantListResponse> {
    const response = await identity.fetch(IDENTITY_PATHS.meGrants, {headers: {cookie}});
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(GrantListResponse, body)}).toEqual({status: 200, shape: true});
    return body as GrantListResponse;
}

describe("授权的存法", () => {
    it("库在确认时写一行：scopes 是 JSON 数组文本，createdAt 是系统时间取整到秒的 ISO 文本；列表原样读出，不取模块的时钟", async () => {
        const {before, after} = await consentTo("openid email");
        const rows = await identity.conn.read((tx) => tx.query<{scopes: string; createdAt: string}, []>(`SELECT "scopes", "createdAt" FROM "oauthConsent"`).all());
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(JSON.parse(row.scopes) as unknown).toEqual(["openid", "email"]);
        const createdMs = Date.parse(row.createdAt);
        expect({iso: new Date(createdMs).toISOString() === row.createdAt, wholeSecond: createdMs % 1000, inWindow: createdMs >= Math.floor(before / 1000) * 1000 && createdMs <= after}).toEqual({
            iso: true,
            wholeSecond: 0,
            inWindow: true,
        });

        const {items} = await listed();
        expect(items.map(({scopes, createdAt}) => ({scopes, createdAt}))).toEqual([{scopes: ["openid", "email"], createdAt: row.createdAt}]);
        // 模块的时钟慢了一天：列表的时间取自它就会落在一天之前。
        expect(Date.parse(items[0]!.createdAt)).toBeGreaterThan(identity.clock.now() + DAY_MS / 2);
    });

    it("范围变宽再同意：库改同一行的 scopes，createdAt 不变，列表仍是一项", async () => {
        await consentTo("openid");
        const [first] = (await listed()).items;
        await consentTo("openid profile email");
        const {items} = await listed();
        expect(items.map(({id, scopes, createdAt}) => ({id, scopes: [...scopes].sort(), createdAt}))).toEqual([{id: first!.id, scopes: ["email", "openid", "profile"], createdAt: first!.createdAt}]);
    });
});
