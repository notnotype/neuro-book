/**
 * 库的对外 OAuth 装配（`auth.ts` 的 `jwt`、`oauthProvider`、`disabledPaths`）在包内的可观察结果：授权码、访问令牌与 id_token 的
 * 寿命，客户端密钥按自家的存法认，令牌 id 不重用，同一个授权码并发换也至多换出一次，关掉的库端点经 `handler` 是 404。经真实的库在进程内走授权与换码
 * （`testing/oauth.ts`），不经挂载层：这里看的是库本身的装配，挂载层的白名单在 `mount.test.ts`。
 *
 * 寿命不拨时钟：库按系统时间写这几行的创建与到期时刻，用例读行里两者之差（与令牌响应的 `expires_in`、id_token 的 `exp - iat`）。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {ID_TOKEN_SECONDS, LIBRARY_ACCESS_TOKEN_SECONDS, LIBRARY_CODE_SECONDS, LIBRARY_PUBLIC_ENDPOINTS} from "../auth";
import {libDateMs} from "../db/library-rows";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {addOAuthUser, authorize, CONSENTED, decodeJwt, exchange, grantTokens, libraryRequest, registerClient, type TestClient} from "../testing/oauth";
import {clientSecretHash, generateClientSecret} from "./client-secret";

let identity: TestIdentity;
let client: TestClient;
let cookie: string;

beforeEach(async () => {
    identity = await createTestIdentity("oauth-provider");
    client = await registerClient(identity);
    ({cookie} = await identity.issue(await identity.addUser("alice", CONSENTED)));
});

afterEach(async () => {
    await identity.assembly.close();
    await identity.root.cleanup();
});

/** 一行的到期与创建时刻之差，以秒计。 */
function lifetimeSeconds(row: {readonly expiresAt: string; readonly createdAt: string}): number {
    return (libDateMs(row.expiresAt) - libDateMs(row.createdAt)) / 1000;
}

function accessTokenIds(): Promise<number[]> {
    return identity.conn.read((tx) => tx.query<{id: number}, []>(`SELECT "id" FROM "oauthAccessToken" ORDER BY "id"`).all().map((row) => row.id));
}

describe("寿命", () => {
    it("授权码 10 分钟、访问令牌 1 小时（库的缺省），id_token 1 小时", async () => {
        expect({code: LIBRARY_CODE_SECONDS, access: LIBRARY_ACCESS_TOKEN_SECONDS, idToken: ID_TOKEN_SECONDS}).toEqual({code: 600, access: 3600, idToken: 3600});
        const grant = await authorize(identity, cookie, client);
        // 授权码存在库的一次性凭据表里，换码时删掉；换码之前读。
        const codes = await identity.conn.read((tx) => tx.query<{expiresAt: string; createdAt: string}, []>(`SELECT "expiresAt", "createdAt" FROM "verification"`).all());
        expect(codes.map(lifetimeSeconds)).toEqual([LIBRARY_CODE_SECONDS]);

        const response = await exchange(identity, client, grant);
        expect(response.status).toBe(200);
        const tokens = (await response.json()) as {expires_in: number; id_token: string};
        expect(tokens.expires_in).toBe(LIBRARY_ACCESS_TOKEN_SECONDS);
        const rows = await identity.conn.read((tx) => tx.query<{expiresAt: string; createdAt: string}, []>(`SELECT "expiresAt", "createdAt" FROM "oauthAccessToken"`).all());
        expect(rows.map(lifetimeSeconds)).toEqual([LIBRARY_ACCESS_TOKEN_SECONDS]);
        const {payload} = decodeJwt(tokens.id_token);
        expect((payload.exp as number) - (payload.iat as number)).toBe(ID_TOKEN_SECONDS);
    });

    it("授权码过了 10 分钟换码得 invalid_grant，差一秒满 10 分钟的照常换出（输出 6）", async () => {
        // 库按系统时间判码过期，拨不到；拨的是模块的时钟，过期的码由清理任务按它删掉（`revoke.ts` 的 `purgeExpiredOAuthRows`），
        // 删掉之后库查不到这个码，回 invalid_grant。模块的时钟按发码前后的系统时间设：库写下的到期时刻在这两个时刻各加 10 分钟之间。
        const purge = identity.jobs.find((job) => job.name === "purge")!;
        const before = Date.now();
        const early = await authorize(identity, cookie, client);
        const late = await authorize(identity, cookie, client);
        const after = Date.now();
        identity.clock.set(before + LIBRARY_CODE_SECONDS * 1000 - 1000);
        await purge.run();
        expect((await exchange(identity, client, early)).status).toBe(200);
        identity.clock.set(after + LIBRARY_CODE_SECONDS * 1000 + 1000);
        await purge.run();
        const expired = await exchange(identity, client, late);
        expect({status: expired.status, error: ((await expired.json()) as {error?: unknown}).error}).toEqual({status: 400, error: "invalid_grant"});
    });
});

describe("客户端密钥", () => {
    function storedSecret(): Promise<string | null> {
        return identity.conn.read((tx) => tx.query<{clientSecret: string | null}, [string]>(`SELECT "clientSecret" FROM "oauthClient" WHERE "clientId" = ?`).get(client.clientId)?.clientSecret ?? null);
    }

    it("库登记时按自家的存法存哈希；换码只认对的密钥", async () => {
        expect(await storedSecret()).toBe(clientSecretHash(client.clientSecret));
        const wrong = await exchange(identity, {...client, clientSecret: generateClientSecret()}, await authorize(identity, cookie, client));
        expect(wrong.status).toBe(401);
        expect(await wrong.json()).toMatchObject({error: "invalid_client"});
        expect((await exchange(identity, client, await authorize(identity, cookie, client))).status).toBe(200);
    });

    it("自家写进去的密钥哈希库能认，旧密钥随之失效（计划第 9 节 P7）", async () => {
        const fresh = generateClientSecret();
        await identity.conn.write((tx) => tx.query(`UPDATE "oauthClient" SET "clientSecret" = ? WHERE "clientId" = ?`).run(clientSecretHash(fresh), client.clientId));
        expect((await exchange(identity, {...client, clientSecret: fresh}, await authorize(identity, cookie, client))).status).toBe(200);
        const old = await exchange(identity, client, await authorize(identity, cookie, client));
        expect(old.status).toBe(401);
        expect(await old.json()).toMatchObject({error: "invalid_client"});
    });
});

describe("访问令牌的存法", () => {
    it("只存摘要：库文件里访问令牌那张表的每一列都不含发出去的令牌，令牌照常可用（副作用与数据）", async () => {
        // 用户信息要读资料行，`addUser` 不写它。
        const {cookie: bobCookie} = await identity.issue(await addOAuthUser(identity, "bob", CONSENTED));
        const {access_token: accessToken} = await grantTokens(identity, bobCookie, client);
        // 从库文件另开一条连接读：看的是落在盘上的样子。
        const rows = identity.root.openOther().query<Record<string, unknown>, []>(`SELECT * FROM "oauthAccessToken"`).all();
        expect(rows).toHaveLength(1);
        expect(Object.entries(rows[0]!).filter(([, value]) => String(value).includes(accessToken)).map(([column]) => column)).toEqual([]);
        expect((await libraryRequest(identity, "/oauth2/userinfo", {headers: {authorization: `Bearer ${accessToken}`}})).status).toBe(200);
    });
});

describe("令牌 id", () => {
    it("删掉 id 最大的访问令牌之后，新授权的令牌 id 更大", async () => {
        await grantTokens(identity, cookie, client);
        await grantTokens(identity, cookie, client);
        const ids = await accessTokenIds();
        expect(ids.length).toBe(2);
        const max = ids[1]!;
        await identity.conn.write((tx) => tx.query(`DELETE FROM "oauthAccessToken" WHERE "id" = ?`).run(max));
        await grantTokens(identity, cookie, client);
        const after = await accessTokenIds();
        expect(after.length).toBe(2);
        expect(after[1]).toBeGreaterThan(max);
    });
});

describe("一次性检查", () => {
    // 全库自增 id 下库的 `reserveVerificationValue` 并发都会成功（计划问 5），授权码不走它：换码经 `consumeVerificationValue`，在库的
    // 事务里读出这个码的那一行、删掉它，读不到的拒。这条守着“同一个码至多换出一次”（`site.oauth-provider` 时序一节），库改了消费
    // 授权码的写法时失败。
    it("同一个授权码并发换四次：恰好一次 200，其余 400 invalid_grant，只有一个访问令牌", async () => {
        const grant = await authorize(identity, cookie, client);
        const responses = await Promise.all(Array.from({length: 4}, () => exchange(identity, client, grant)));
        const outcomes = await Promise.all(responses.map(async (response) => ({status: response.status, error: ((await response.json()) as {error?: string}).error ?? null})));
        expect(outcomes.toSorted((left, right) => left.status - right.status)).toEqual([
            {status: 200, error: null},
            {status: 400, error: "invalid_grant"},
            {status: 400, error: "invalid_grant"},
            {status: 400, error: "invalid_grant"},
        ]);
        expect(await accessTokenIds()).toHaveLength(1);
    });
});

describe("关掉的库端点", () => {
    const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

    /**
     * 带参数、不只供服务端调用、又不对外的库端点：`disabledPaths` 逐字比路径挡不住它们（`auth.ts` 的 `disabledLibraryPaths`），
     * 只靠挂载白名单（第 5 片）。库 1.7.27 只有这一条，读重置密码的一次性凭据后跳转、不写库；库新加这类端点时这里失败，要查它做
     * 什么、白名单挡没挡住。
     */
    const PARAMETERIZED_REACHABLE = ["GET /reset-password/:token"];

    it("库的全部端点乘六种方法经 handler，除对外要的路径外一律 404，带普通用户的会话也一样；普通用户经 HTTP 登记不了客户端", async () => {
        // 端点表取真实装配的 `auth.api`，不经 `disabledLibraryPaths` 的取法。对外路径上别的方法由挂载层挡，这里不看。
        const publicPaths = new Set<string>(LIBRARY_PUBLIC_ENDPOINTS.map((endpoint) => endpoint.path));
        const paths = new Set(Object.values(identity.assembly.auth.api as Record<string, {readonly path?: string}>).flatMap((endpoint) => (endpoint.path === undefined ? [] : [endpoint.path])));
        expect(paths.size).toBeGreaterThan(80);
        const reachable: string[] = [];
        for (const path of [...paths].filter((candidate) => !publicPaths.has(candidate))) {
            const concrete = path.replaceAll(/:\w+/gu, "x");
            for (const method of METHODS) {
                const init: RequestInit =
                    method === "GET" || method === "HEAD"
                        ? {method, headers: {cookie}}
                        : {method, headers: {cookie, origin: TEST_SITE_URL, "content-type": "application/json"}, body: "{}"};
                if ((await libraryRequest(identity, concrete, init)).status !== 404) reachable.push(`${method} ${path}`);
            }
        }
        expect(reachable).toEqual(PARAMETERIZED_REACHABLE);

        const created = await libraryRequest(identity, "/oauth2/create-client", {
            method: "POST",
            headers: {cookie, "content-type": "application/json"},
            body: JSON.stringify({client_name: "x", redirect_uris: ["https://evil.example/cb"]}),
        });
        expect(created.status).toBe(404);
        expect(await identity.conn.read((tx) => tx.query<{n: number}, []>(`SELECT count(*) AS n FROM "oauthClient"`).get()!.n)).toBe(1);
    });
});
