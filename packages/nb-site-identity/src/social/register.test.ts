/**
 * 社交注册（`start.ts` 的注册意图、`hooks.ts` 的建用户与建账号前钩子、建会话前的判断、`callback.ts` 的查询串上限；`site.accounts`
 * 输出 2、3、11、13、14、23、24，验收 4、5、8、9、14）。
 *
 * 上游是仿真上游（第三方的替身），站点是真的模块。合同测试（`nb-site-contract-tests` 的 `accounts-social.test.ts`）走同样的
 * 场景；这里另测合同里造不出、或要读库才看得到的：
 * - 注册写到一半失败（在补充资料的表、库的 `account` 表上临时加拒绝插入的触发器）时全部回滚，码不扣、没有会话。
 * - 建出的账号的库列：`emailVerified`、头像、原样的用户名写法、没有密码登录方式，`account` 行不含上游令牌。
 * - 关联与注册争同一个上游身份时按固定的先后认名字（验收 14）：经占住连接的队列让两边一步一步走（`lockstep`），合同测试只能
 *   并发打开、不定先后。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {startFakeUpstream, type FakeGitHubUser, type FakeGoogleUser, type FakeUpstream} from "@notnotype/neuro-book-test-support/oauth-upstream";

import {libDate} from "../db/library-rows";
import {ManualTimers, TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, SESSION_COOKIE, sessionCookieOf, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {
    fakeSocialConfig,
    followSocial,
    holdQueue,
    insertSocialAccount,
    landing,
    lockstep,
    openCallback,
    startedSocial,
    startSocial,
    upstreamCallback,
} from "../testing/social";
import {MAX_CALLBACK_QUERY_CHARS} from "./callback";

let upstream: FakeUpstream;
let identity: TestIdentity | undefined;

beforeEach(async () => {
    upstream = await startFakeUpstream();
});

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
    await upstream.close();
});

const CONSENTED = {consent: {termsVersion: TEST_TERMS_VERSION, overseasStorage: true}} as const;

let address = 0;
/** 每次发起换一个来源地址：注册按来源每小时 5 次，限流只在专门的用例里测。 */
const nextAddress = () => `198.51.100.${String(++address % 250)}`;

async function socialIdentity(name: string, config: {readonly registrationOpen?: boolean} = {}, timers?: ManualTimers): Promise<TestIdentity> {
    identity = await createTestIdentity(name, {config: {social: fakeSocialConfig(upstream), ...config}, ...(timers === undefined ? {} : {timers})});
    return identity;
}

function googleUser(sub: string, email: string | null = `${sub}@gmail.test`, verified = true): FakeGoogleUser {
    return {sub, ...(email === null ? {} : {email}), email_verified: verified, name: `Name ${sub}`};
}

function githubUser(id: number, emails: FakeGitHubUser["emails"]): FakeGitHubUser {
    return {id, login: `gh-${String(id)}`, name: null, email: null, emails};
}

function registerFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {intent: "register", username: "Erin", registrationCode: "REG-CODE", termsVersion: TEST_TERMS_VERSION, overseasStorage: true, ...overrides};
}

function startRegister(target: TestIdentity, provider: string, overrides: Record<string, unknown> = {}, clientAddress = nextAddress()): Promise<Response> {
    return startSocial(target, provider, registerFields(overrides), undefined, clientAddress);
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

function hasSessionCookie(response: Response): boolean {
    return response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !cookie.startsWith(`${SESSION_COOKIE}=;`));
}

interface CodeOptions {
    readonly maxUses?: number | null;
    readonly ownerId?: number;
}

/** 往注册码或邀请码表里放一个码，回 id。 */
function addCode(target: TestIdentity, table: "identity_registration_code" | "identity_invite_code", code: string, options: CodeOptions = {}): Promise<number> {
    const now = libDate(target.clock.now());
    return target.conn.write((tx) =>
        table === "identity_registration_code"
            ? Number(tx.query(`INSERT INTO identity_registration_code (code, max_uses, created_at) VALUES (?, ?, ?)`).run(code, options.maxUses ?? null, now).lastInsertRowid)
            : Number(tx.query(`INSERT INTO identity_invite_code (code, owner_id, max_uses, created_at) VALUES (?, ?, ?, ?)`).run(code, options.ownerId ?? null, options.maxUses ?? null, now).lastInsertRowid),
    );
}

function disableCode(target: TestIdentity, table: "identity_registration_code" | "identity_invite_code", id: number): Promise<void> {
    return target.conn.write((tx) => void tx.query(`UPDATE ${table} SET disabled_at = ? WHERE id = ?`).run(libDate(target.clock.now()), id));
}

function usedCount(target: TestIdentity, table: "identity_registration_code" | "identity_invite_code", id: number): Promise<number> {
    return target.conn.read((tx) => tx.query<{used_count: number}, [number]>(`SELECT used_count FROM ${table} WHERE id = ?`).get(id)!.used_count);
}

function usernames(target: TestIdentity): Promise<string[]> {
    return target.conn.read((tx) => tx.query<{username: string}, []>(`SELECT "username" FROM "user" ORDER BY "id"`).all().map((row) => row.username));
}

function flowCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM identity_social_flow`).get()!.n);
}

/** 补充资料、同意记录、上游名字、库的 `account` 行各有几行：失败的注册一行都不该留下。 */
function sideRows(target: TestIdentity): Promise<Readonly<Record<string, number>>> {
    return target.conn.read((tx) => {
        const count = (sql: string) => tx.query<{n: number}, []>(sql).get()!.n;
        return {
            profiles: count(`SELECT COUNT(*) AS n FROM identity_profile`),
            consents: count(`SELECT COUNT(*) AS n FROM identity_consent`),
            upstreamNames: count(`SELECT COUNT(*) AS n FROM identity_upstream_name`),
            accounts: count(`SELECT COUNT(*) AS n FROM "account"`),
        };
    });
}

function rejected(code: string): {readonly status: number; readonly path: string; readonly socialError: string} {
    return {status: 302, path: "/register", socialError: code};
}

describe("社交注册成功（输出 13、23，验收 4）", () => {
    it("回调建出账号、发会话、落到 /；账号没有密码、邮箱不算验证过，码与邀请码各用 1 次，邀请归属、同意、上游名字都记下", async () => {
        const target = await socialIdentity("social-register-ok");
        const inviterId = await target.addUser("inviter", CONSENTED);
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {maxUses: 3});
        const inviteId = await addCode(target, "identity_invite_code", "INVITE-1", {ownerId: inviterId});
        upstream.setUser("google", {...googleUser("g-erin", "Erin@Gmail.test"), picture: "https://upstream.example/erin.png"});

        const response = await followSocial(target, await startRegister(target, "google", {registrationCode: " REG-CODE ", inviteCode: " INVITE-1 "}));
        expect(landing(response)).toEqual({status: 302, path: "/", socialError: null});
        expect(hasSessionCookie(response)).toBe(true);

        const me = await target.fetch("/me", {headers: {cookie: sessionCookieOf(response.headers.getSetCookie())}});
        expect(await me.json()).toMatchObject({username: "erin", displayName: "Erin", avatarUrl: null, email: "erin@gmail.test", emailPending: false, hasPassword: false, consentRequired: false});
        const row = await target.conn.read((tx) =>
            tx
                .query<{id: number; displayUsername: string; emailVerified: number; role: string; createdAt: string}, []>(`SELECT "id", "displayUsername", "emailVerified", "role", "createdAt" FROM "user" WHERE "username" = 'erin'`)
                .get(),
        );
        expect(row).toEqual({id: expect.any(Number), displayUsername: "Erin", emailVerified: 0, role: "user", createdAt: libDate(target.clock.now())});
        const userId = row!.id;
        const records = await target.conn.read((tx) => ({
            profile: tx.query(`SELECT registration_code_id, invite_code_id, inviter_id FROM identity_profile WHERE user_id = ?`).get(userId),
            consent: tx.query(`SELECT terms_version, overseas_storage FROM identity_consent WHERE user_id = ?`).get(userId),
            upstreamName: tx.query(`SELECT provider, upstream_account_id, name FROM identity_upstream_name WHERE user_id = ?`).get(userId),
            accounts: tx
                .query(`SELECT "providerId", "accountId", "password", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt" FROM "account" WHERE "userId" = ?`)
                .all(userId),
        }));
        expect(records).toEqual({
            profile: {registration_code_id: codeId, invite_code_id: inviteId, inviter_id: inviterId},
            consent: {terms_version: TEST_TERMS_VERSION, overseas_storage: 1},
            upstreamName: {provider: "google", upstream_account_id: "g-erin", name: "Erin@Gmail.test"},
            accounts: [{providerId: "google", accountId: "g-erin", password: null, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null}],
        });
        expect([await usedCount(target, "identity_registration_code", codeId), await usedCount(target, "identity_invite_code", inviteId)]).toEqual([1, 1]);

        // 同一个上游身份再以登录意图回来直接登录（验收 4 末句）；邮箱仍不算验证过。
        const again = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect(landing(again)).toEqual({status: 302, path: "/", socialError: null});
        expect(await target.conn.read((tx) => tx.query<{v: number}, [number]>(`SELECT "emailVerified" AS v FROM "user" WHERE "id" = ?`).get(userId)!.v)).toBe(0);
    });

    it("GitHub：邮箱取已验证的主邮箱，上游名字是 login；上游改了 login 之后再登录，列表里的名字仍是注册时记下的（输出 24）", async () => {
        const target = await socialIdentity("social-register-github");
        await addCode(target, "identity_registration_code", "REG-CODE");
        const emails = [
            {email: "other@github.test", primary: false, verified: true, visibility: null},
            {email: "erin@github.test", primary: true, verified: true, visibility: null},
        ];
        upstream.setUser("github", githubUser(77, emails));

        expect(landing(await followSocial(target, await startRegister(target, "github")))).toEqual({status: 302, path: "/", socialError: null});
        const records = await target.conn.read((tx) => ({
            email: tx.query<{email: string}, []>(`SELECT "email" FROM "user" WHERE "username" = 'erin'`).get()?.email,
            upstreamName: tx.query(`SELECT provider, upstream_account_id, name FROM identity_upstream_name`).all(),
        }));
        expect(records).toEqual({email: "erin@github.test", upstreamName: [{provider: "github", upstream_account_id: "77", name: "gh-77"}]});

        // 同一个 id 在上游改了名，再以登录意图回来：认的是 id，名字不跟着改。
        upstream.setUser("github", {...githubUser(77, emails), login: "gh-renamed"});
        const again = await followSocial(target, await startSocial(target, "github", {intent: "login"}));
        expect(landing(again)).toEqual({status: 302, path: "/", socialError: null});
        const listed = await target.fetch("/me/identities", {headers: {cookie: sessionCookieOf(again.headers.getSetCookie())}});
        expect(((await listed.json()) as {items: {provider: string; accountName: string}[]}).items.map(({provider, accountName}) => ({provider, accountName}))).toEqual([{provider: "github", accountName: "gh-77"}]);
    });
});

describe("发起时的检查（输出 3、13，验收 4 前半）", () => {
    it("不合格就不跳转、不写流程行：按密码注册的先后回各自的码", async () => {
        const target = await socialIdentity("social-register-start-checks");
        const inviteId = await addCode(target, "identity_invite_code", "INVITE-OFF");
        await disableCode(target, "identity_invite_code", inviteId);
        await addCode(target, "identity_registration_code", "REG-CODE");
        await target.addUser("taken", CONSENTED);

        const {registrationCode: _omitted, ...withoutCode} = registerFields();
        const cases: readonly [Record<string, unknown>, {readonly status: number; readonly body: unknown}][] = [
            [withoutCode, {status: 400, body: {error: {code: "validation_failed", fields: ["registrationCode"]}}}],
            [registerFields({username: "a"}), {status: 400, body: {error: {code: "validation_failed", fields: ["username"]}}}],
            // 同意不对与码不对同时出现时先报同意（失败表的先后）。
            [registerFields({termsVersion: "2020-01-01", registrationCode: "NO-SUCH"}), {status: 403, body: {error: {code: "consent_required"}}}],
            [registerFields({overseasStorage: false}), {status: 403, body: {error: {code: "consent_required"}}}],
            // 码不对与用户名被占同时出现时先报码：没有可用注册码的人试不出哪些用户名已被注册（失败表“注册”一行）。
            [registerFields({registrationCode: "NO-SUCH", username: "taken"}), {status: 422, body: {error: {code: "registration_code_invalid"}}}],
            [registerFields({inviteCode: "INVITE-OFF", username: "taken"}), {status: 422, body: {error: {code: "invite_code_invalid"}}}],
            [registerFields({username: "Taken"}), {status: 409, body: {error: {code: "username_taken"}}}],
        ];
        for (const [request, expected] of cases) {
            const response = await startSocial(target, "google", request, undefined, nextAddress());
            expect({request, response: await outcome(response)}).toEqual({request, response: expected});
        }
        expect(await flowCount(target)).toBe(0);
    });

    // 两样都是库验上游 id_token 要的（`providers.ts`）：缺哪一样都不建上游。
    const discoveryGaps = [
        ["公钥地址", "jwks", (omitted: boolean) => upstream.omitJwksUri(omitted)],
        ["签发者", "issuer", (omitted: boolean) => upstream.omitIssuer(omitted)],
    ] as const;
    for (const [label, slug, omit] of discoveryGaps) {
        it(`Google 的发现文档缺${label}：发起回 503 unavailable，不写流程行、不建账号、不扣码；文档补上之后下一次发起照常（输出 11）`, async () => {
            omit(true);
            const target = await socialIdentity(`social-register-discovery-no-${slug}`);
            const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
            upstream.setUser("google", googleUser("g-erin"));

            expect(await outcome(await startRegister(target, "google"))).toEqual({status: 503, body: {error: {code: "unavailable"}}});
            expect(await outcome(await startSocial(target, "google", {intent: "login"}))).toEqual({status: 503, body: {error: {code: "unavailable"}}});
            expect({flows: await flowCount(target), users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), side: await sideRows(target)}).toEqual({
                flows: 0,
                users: [],
                used: 0,
                side: {profiles: 0, consents: 0, upstreamNames: 0, accounts: 0},
            });
            expect(await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "session"`).get()!.n)).toBe(0);
            expect(target.log.lines.filter((line) => line.event === "identity.unhandled_error")).toEqual([]);

            // 发起时库再取一次发现文档（升级清单“社交上游”一行）：缺的那一样补上了就建出上游，注册照常走完。
            omit(false);
            const landed = await followSocial(target, await startRegister(target, "google"));
            expect({...landing(landed), session: hasSessionCookie(landed), used: await usedCount(target, "identity_registration_code", codeId)}).toEqual({
                status: 302,
                path: "/",
                socialError: null,
                session: true,
                used: 1,
            });
        });
    }

    it("注册关闭：registration_closed，不看请求的内容", async () => {
        const target = await socialIdentity("social-register-closed", {registrationOpen: false});
        expect(await outcome(await startSocial(target, "google", {intent: "register"}, undefined, nextAddress()))).toEqual({status: 403, body: {error: {code: "registration_closed"}}});
        expect(await flowCount(target)).toBe(0);
    });

    it("计入注册的来源地址计数：同一个来源发起 5 次之后，密码注册与再一次社交注册都 rate_limited", async () => {
        const target = await socialIdentity("social-register-rate-limit");
        await addCode(target, "identity_registration_code", "REG-CODE");
        const from = "198.51.100.251";
        for (let i = 0; i < 5; i += 1) expect((await startRegister(target, "google", {}, from)).status).toBe(200);
        const social = await startRegister(target, "google", {}, from);
        expect({status: social.status, code: ((await social.json()) as {error: {code: string}}).error.code}).toEqual({status: 429, code: "rate_limited"});
        const password = await target.fetch("/register", {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: from},
            body: JSON.stringify({username: "pwuser", email: "pwuser@example.com", password: "correct horse battery", registrationCode: "REG-CODE", termsVersion: TEST_TERMS_VERSION, overseasStorage: true}),
        });
        expect({status: password.status, code: ((await password.json()) as {error: {code: string}}).error.code}).toEqual({status: 429, code: "rate_limited"});
    });
});

describe("回调时的拒绝：不建账号、不扣码（输出 2、13、14，验收 5、9）", () => {
    it("上游的邮箱没验证过、没有主邮箱、或已验证却不合站点的邮箱规则：social_email_missing", async () => {
        const target = await socialIdentity("social-register-unverified");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        const upstreams: readonly [string, () => void][] = [
            ["google", () => upstream.setUser("google", googleUser("g-unverified", "erin@gmail.test", false))],
            ["github", () => upstream.setUser("github", githubUser(5, [{email: "erin@github.test", primary: true, verified: false, visibility: null}]))],
            ["github", () => upstream.setUser("github", githubUser(6, [{email: "erin@github.test", primary: false, verified: true, visibility: null}]))],
            // 已验证、但不合输出 3 的邮箱规则：本地部分含非 ASCII；以留给占位邮箱的 `.invalid` 结尾。
            ["google", () => upstream.setUser("google", googleUser("g-non-ascii", "érin@gmail.test"))],
            ["github", () => upstream.setUser("github", githubUser(7, [{email: "erin@example.invalid", primary: true, verified: true, visibility: null}]))],
        ];
        for (const [provider, setUser] of upstreams) {
            setUser();
            const response = await followSocial(target, await startRegister(target, provider));
            expect({provider, ...landing(response), session: hasSessionCookie(response)}).toEqual({provider, ...rejected("social_email_missing"), session: false});
        }
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), side: await sideRows(target)}).toEqual({
            users: [],
            used: 0,
            side: {profiles: 0, consents: 0, upstreamNames: 0, accounts: 0},
        });
    });

    it("发起之后注册码、邀请码失效，用户名或邮箱被占：回各自的码，码不扣；已有密码账号仍只有密码一种登录方式", async () => {
        const target = await socialIdentity("social-register-changed");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        const inviteId = await addCode(target, "identity_invite_code", "INVITE-1");
        const cases: readonly {readonly code: string; readonly overrides: Record<string, unknown>; between(): Promise<unknown>}[] = [
            {code: "invite_code_invalid", overrides: {inviteCode: "INVITE-1"}, between: () => disableCode(target, "identity_invite_code", inviteId)},
            {code: "username_taken", overrides: {username: "frank"}, between: () => target.addUser("frank", CONSENTED)},
            // 上游给的邮箱已是别的账号的（`addUser` 的邮箱是 `<用户名>@example.com`）。
            {code: "email_taken", overrides: {username: "erin"}, between: () => target.addUser("grace", {...CONSENTED, password: "correct horse battery"})},
            {code: "registration_code_invalid", overrides: {username: "erin"}, between: () => disableCode(target, "identity_registration_code", codeId)},
        ];
        for (const [index, item] of cases.entries()) {
            upstream.setUser("google", googleUser(`g-changed-${String(index)}`, item.code === "email_taken" ? "Grace@Example.com" : `changed-${String(index)}@gmail.test`));
            const start = await startRegister(target, "google", item.overrides);
            await item.between();
            const response = await followSocial(target, start);
            expect({code: item.code, ...landing(response), session: hasSessionCookie(response)}).toEqual({code: item.code, ...rejected(item.code), session: false});
        }
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), invite: await usedCount(target, "identity_invite_code", inviteId)}).toEqual({
            users: ["frank", "grace"],
            used: 0,
            invite: 0,
        });
        // 撞了邮箱的已有账号没被关联：仍只有密码一种登录方式（验收 5）。
        const graceAccounts = await target.conn.read((tx) => tx.query<{providerId: string}, []>(`SELECT a."providerId" FROM "account" a JOIN "user" u ON u."id" = a."userId" WHERE u."username" = 'grace'`).all());
        expect(graceAccounts).toEqual([{providerId: "credential"}]);
    });

    it("注册意图碰上已关联的上游身份：identity_taken，不建账号、不建会话、不扣码；这个身份照常能登录", async () => {
        const target = await socialIdentity("social-register-linked");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        const ownerId = await target.addUser("owner", CONSENTED);
        await insertSocialAccount(target, ownerId, "google", "g-owned");
        upstream.setUser("google", googleUser("g-owned"));

        const response = await followSocial(target, await startRegister(target, "google"));
        expect({...landing(response), session: hasSessionCookie(response)}).toEqual({...rejected("identity_taken"), session: false});
        const sessions = await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "session"`).get()!.n);
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), sessions}).toEqual({users: ["owner"], used: 0, sessions: 0});

        const login = await followSocial(target, await startSocial(target, "google", {intent: "login"}));
        expect({...landing(login), session: hasSessionCookie(login)}).toEqual({status: 302, path: "/", socialError: null, session: true});
    });

    it("注册意图碰上已关联的上游身份，判 identity_taken 之前库先查邮箱与封禁：上游这次没给邮箱是 social_email_missing，那个账号被封禁是 social_failed；都不建账号、不建会话、不扣码", async () => {
        const target = await socialIdentity("social-register-linked-before-checks");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        const ownerId = await target.addUser("owner", CONSENTED);
        await insertSocialAccount(target, ownerId, "google", "g-owned");

        upstream.setUser("google", googleUser("g-owned", null));
        const noEmail = await followSocial(target, await startRegister(target, "google"));
        expect({...landing(noEmail), session: hasSessionCookie(noEmail)}).toEqual({...rejected("social_email_missing"), session: false});

        upstream.setUser("google", googleUser("g-owned"));
        await target.conn.write((tx) => void tx.query(`UPDATE "user" SET "banned" = 1 WHERE "id" = ?`).run(ownerId));
        const banned = await followSocial(target, await startRegister(target, "google"));
        expect({...landing(banned), session: hasSessionCookie(banned)}).toEqual({...rejected("social_failed"), session: false});

        const sessions = await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "session"`).get()!.n);
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), sessions}).toEqual({users: ["owner"], used: 0, sessions: 0});
    });

    it("上游给的邮箱已被别的账号占用、又没验证过：email_taken，不是 social_email_missing（输出 14）", async () => {
        const target = await socialIdentity("social-register-taken-unverified");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        // `addUser` 的邮箱是 `<用户名>@example.com`。
        await target.addUser("grace", CONSENTED);
        const upstreams: readonly [string, () => void][] = [
            ["google", () => upstream.setUser("google", googleUser("g-grace", "grace@example.com", false))],
            ["github", () => upstream.setUser("github", githubUser(8, [{email: "grace@example.com", primary: true, verified: false, visibility: null}]))],
        ];
        for (const [provider, setUser] of upstreams) {
            setUser();
            const response = await followSocial(target, await startRegister(target, provider));
            expect({provider, ...landing(response), session: hasSessionCookie(response)}).toEqual({provider, ...rejected("email_taken"), session: false});
        }
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId)}).toEqual({users: ["grace"], used: 0});
    });
});

describe("原子性与并发（输出 2，验收 8、14）", () => {
    it("写到一半失败（补充资料、库的 account 行）：全部回滚、码不扣、没有会话；去掉故障之后同一个码能注册", async () => {
        const target = await socialIdentity("social-register-injected");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {maxUses: 1});
        upstream.setUser("google", googleUser("g-erin"));
        const triggers = [
            `CREATE TRIGGER injected BEFORE INSERT ON identity_consent BEGIN SELECT RAISE(ABORT, 'injected'); END`,
            `CREATE TRIGGER injected BEFORE INSERT ON "account" BEGIN SELECT RAISE(ABORT, 'injected'); END`,
        ];
        for (const trigger of triggers) {
            await target.conn.write((tx) => tx.query(trigger).run());
            const response = await followSocial(target, await startRegister(target, "google"));
            expect({trigger, ...landing(response), session: hasSessionCookie(response)}).toEqual({trigger, ...rejected("social_failed"), session: false});
            expect({trigger, users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), side: await sideRows(target)}).toEqual({
                trigger,
                users: [],
                used: 0,
                side: {profiles: 0, consents: 0, upstreamNames: 0, accounts: 0},
            });
            await target.conn.write((tx) => tx.query(`DROP TRIGGER injected`).run());
        }

        const response = await followSocial(target, await startRegister(target, "google"));
        expect({...landing(response), session: hasSessionCookie(response)}).toEqual({status: 302, path: "/", socialError: null, session: true});
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId)}).toEqual({users: ["erin"], used: 1});
    });

    it("只剩一次的注册码，两个社交注册的回调与一个密码注册同时到：恰好一个建出账号，其余 registration_code_invalid，没有留下没有资料的账号", async () => {
        const target = await socialIdentity("social-register-race");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {maxUses: 1});
        // 仿真上游按上游各记一个用户：两个社交注册走两个上游，才是两个不同的上游身份。
        upstream.setUser("google", googleUser("g-sam"));
        upstream.setUser("github", githubUser(31, [{email: "sue@github.test", primary: true, verified: true, visibility: null}]));
        const starts = [await startRegister(target, "google", {username: "sam"}), await startRegister(target, "github", {username: "sue"})];
        // 两个发起都在码还没被用时过了预检；回调与密码注册一起发。
        const [first, second, password] = await Promise.all([
            followSocial(target, starts[0]!),
            followSocial(target, starts[1]!),
            target.fetch("/register", {
                method: "POST",
                headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: nextAddress()},
                body: JSON.stringify({username: "pat", email: "pat@example.com", password: "correct horse battery", registrationCode: "REG-CODE", termsVersion: TEST_TERMS_VERSION, overseasStorage: true}),
            }),
        ]);
        const results = [landing(first).socialError, landing(second).socialError, password.status === 200 ? null : ((await password.json()) as {error: {code: string}}).error.code];
        expect(results.filter((code) => code === null)).toHaveLength(1);
        expect(results.filter((code) => code !== null)).toEqual(["registration_code_invalid", "registration_code_invalid"]);
        const orphans = await target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM "user" u LEFT JOIN identity_profile p ON p.user_id = u."id" WHERE p.user_id IS NULL`).get()!.n);
        expect({users: (await usernames(target)).length, used: await usedCount(target, "identity_registration_code", codeId), orphans}).toEqual({users: 1, used: 1, orphans: 0});
    });

    // 两个流程同一个上游身份（仿真上游一个上游只记一个用户），换令牌都先挡住，按 `first` 放开：先放的那一个的每一步都排在另一个的
    // 同一步前面（`lockstep`）。注册在库的事务里认上游名字（`claimUpstreamName`），与关联钩子的认名排在同一轮。
    for (const first of ["link", "register"] as const) {
        it(`关联与社交注册同时争同一个上游身份（验收 14，${first === "link" ? "关联" : "注册"}先认名字）：恰好一个成，注册输了不建账号、不扣码，回 identity_taken`, async () => {
            const timers = new ManualTimers();
            const target = await socialIdentity(`social-register-vs-link-${first}`, {}, timers);
            const codeId = await addCode(target, "identity_registration_code", "REG-CODE", {maxUses: 1});
            const aliceId = await target.addUser("alice", {...CONSENTED, password: "correct horse battery"});
            const {cookie} = await target.issue(aliceId);
            upstream.setUser("google", googleUser("g-shared"));
            const link = await startedSocial(await startSocial(target, "google", {intent: "link", currentPassword: "correct horse battery"}, cookie));
            const register = await startedSocial(await startRegister(target, "google"));
            const flows = {
                link: {callback: await upstreamCallback(link), cookie: `${link.stateCookie}; ${cookie}`},
                register: {callback: await upstreamCallback(register), cookie: register.stateCookie},
            };
            const order = first === "link" ? (["link", "register"] as const) : (["register", "link"] as const);
            const held = [];
            const opened: Promise<Response>[] = [];
            for (const name of order) {
                const token = upstream.holdToken("google");
                opened.push(openCallback(target, flows[name].callback, flows[name].cookie));
                await token.arrived;
                held.push(token);
            }
            const gate = await holdQueue(target);
            await gate.started;
            held[0]!.release();
            await waitUntil("先放的那一个的第一步排上", () => timers.pending === 1);
            held[1]!.release();
            const responses = await lockstep(target, timers, gate, opened);
            const byName = Object.fromEntries(order.map((name, index) => [name, responses[index]!])) as Record<"link" | "register", Response>;

            const accounts = await target.conn.read((tx) => tx.query(`SELECT "userId", "providerId", "accountId" FROM "account" WHERE "providerId" <> 'credential'`).all());
            const names = await target.conn.read((tx) => tx.query(`SELECT user_id, provider, upstream_account_id FROM identity_upstream_name`).all());
            if (first === "link") {
                expect({link: landing(byName.link), register: {...landing(byName.register), session: hasSessionCookie(byName.register)}}).toEqual({
                    link: {status: 302, path: "/account", socialError: null},
                    register: {...rejected("identity_taken"), session: false},
                });
                expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), accounts, names}).toEqual({
                    users: ["alice"],
                    used: 0,
                    accounts: [{userId: aliceId, providerId: "google", accountId: "g-shared"}],
                    names: [{user_id: aliceId, provider: "google", upstream_account_id: "g-shared"}],
                });
            } else {
                expect({link: landing(byName.link), register: {...landing(byName.register), session: hasSessionCookie(byName.register)}}).toEqual({
                    link: {status: 302, path: "/account", socialError: "identity_taken"},
                    register: {status: 302, path: "/", socialError: null, session: true},
                });
                const erinId = await target.conn.read((tx) => tx.query<{id: number}, []>(`SELECT "id" FROM "user" WHERE "username" = 'erin'`).get()!.id);
                expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId), accounts, names}).toEqual({
                    users: ["alice", "erin"],
                    used: 1,
                    accounts: [{userId: erinId, providerId: "google", accountId: "g-shared"}],
                    names: [{user_id: erinId, provider: "google", upstream_account_id: "g-shared"}],
                });
            }
        });
    }

    it("同一个新的上游身份的两次注册同时回调（每一步排在一起跑）：恰好一个建出账号，输的一边是 email_taken，不扣码、没有会话", async () => {
        const timers = new ManualTimers();
        const target = await socialIdentity("social-register-same-identity-race", {}, timers);
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        upstream.setUser("google", googleUser("g-twice"));
        const flows = [await startedSocial(await startRegister(target, "google", {username: "first"})), await startedSocial(await startRegister(target, "google", {username: "second"}))];
        const callbacks = [await upstreamCallback(flows[0]!), await upstreamCallback(flows[1]!)];
        const held = [];
        const opened: Promise<Response>[] = [];
        for (const [index, flow] of flows.entries()) {
            const token = upstream.holdToken("google");
            opened.push(openCallback(target, callbacks[index]!, flow.stateCookie));
            await token.arrived;
            held.push(token);
        }
        const gate = await holdQueue(target);
        await gate.started;
        held[0]!.release();
        await waitUntil("先放的那一个的第一步排上", () => timers.pending === 1);
        held[1]!.release();
        const [won, lost] = await lockstep(target, timers, gate, opened);

        expect({
            won: {...landing(won!), session: hasSessionCookie(won!)},
            lost: {...landing(lost!), session: hasSessionCookie(lost!)},
        }).toEqual({
            won: {status: 302, path: "/", socialError: null, session: true},
            lost: {...rejected("email_taken"), session: false},
        });
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId)}).toEqual({users: ["first"], used: 1});
    });
});

describe("回调的查询串（输出 13 的回调一步）", () => {
    it(`超过 ${String(MAX_CALLBACK_QUERY_CHARS)} 个字符：social_state_invalid，落到发起意图的失败页，不认领流程；正好 ${String(MAX_CALLBACK_QUERY_CHARS)} 个时照常处理`, async () => {
        const target = await socialIdentity("social-register-long-query");
        const codeId = await addCode(target, "identity_registration_code", "REG-CODE");
        upstream.setUser("google", googleUser("g-erin"));
        const started = await startedSocial(await startRegister(target, "google"));
        const callback = await upstreamCallback(started);
        const query = callback.slice(callback.indexOf("?") + 1);
        // 补一个上游不会带、库不认的参数把查询串凑到指定长度（不含 `?`）。
        const padded = (length: number): string => {
            const prefix = `${callback}&pad=`;
            return prefix + "x".repeat(length - (query.length + "&pad=".length));
        };

        const tooLong = await openCallback(target, padded(MAX_CALLBACK_QUERY_CHARS + 1), started.stateCookie);
        expect({...landing(tooLong), session: hasSessionCookie(tooLong)}).toEqual({...rejected("social_state_invalid"), session: false});
        expect({users: await usernames(target), used: await usedCount(target, "identity_registration_code", codeId)}).toEqual({users: [], used: 0});

        const atLimit = await openCallback(target, padded(MAX_CALLBACK_QUERY_CHARS), started.stateCookie);
        expect({...landing(atLimit), session: hasSessionCookie(atLimit)}).toEqual({status: 302, path: "/", socialError: null, session: true});
        expect(await usernames(target)).toEqual(["erin"]);
    });
});
