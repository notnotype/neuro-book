/**
 * 对外 OAuth 的令牌随账号失效、已给的授权与重启的黑盒合同（docs/specs/site/oauth-provider.md）：起真实的 `nb-site` 进程，扮演接入的
 * 第三方应用（`testing/oauth-client.ts`），只经 HTTP 看它。覆盖输出 8 的每一项（封禁、改角色、管理员重置密码、管理员结束全部会话、
 * 自己改密码、登出、结束单个会话、会话到期加 `purge`、撤销授权、停用客户端与再启用）、输出 15、输出 17、副作用一节的撤销不写审计与时序一节的重启；验收 3、
 * 5、9、10、16、17、19，验收 22 的改密码那半；`site.admin` 输出 2、3、4 与结束全部会话的 OAuth 那一半。
 *
 * “失效”按 Spec 看两样：访问令牌调用户信息得 401，没用掉的授权码换码得 `invalid_grant`。每条另带一个不受影响的对照（别的会话、
 * 别的账号或别的客户端的令牌照用），撤多了也看得出。
 *
 * 本文件测不到、在账号包里的：会话到期只撤到期那次会话的（合同里拨钟要过会话时长，拨过之后库按系统时间写的令牌与码的到期时刻
 * 都早于模块的时钟，`purge` 把它们都当作过期删掉，分不出是撤的还是删的；`oauth/revoke.test.ts` 的清理一条）；撤销与变更同一个
 * 事务、变更失败时一起回滚（`oauth/revoke.test.ts`）；同意记录的存法（`oauth/grants.test.ts`）。
 *
 * 时间预算：起进程、建管理员、登记共用的客户端放在 `beforeAll` 里。超出 200 毫秒的用例在旁边写明原因：多数要注册或登录账号，各算
 * 一次密码哈希。拨模块时钟与重启的用例各在自己的进程里。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {
    AuditListResponse,
    GrantListResponse,
    IDENTITY_PATHS,
    identityPath,
    OAUTH_ENDPOINT_PATHS,
    OIDC_DISCOVERY_PATHS,
    RegisterResponse,
    RegistrationCodeItem,
    SessionListResponse,
    type AdminUserAction,
    type CreateOAuthClientRequest,
    type DiscoveryDocument,
} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, SITE_ORIGIN, type CookieJar} from "./testing/identity";
import {authorizationRequest, exchangeCode, fetchUserInfo, registerOAuthClient, revokeToken, siteFetch, step, verifyIdToken, type RegisteredClient, type Step} from "./testing/oauth-client";
import {holdWriteLock} from "./testing/fault";
import {useSiteSandbox, type CommandResult, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests oauth-invalidation.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const PASSWORD = "admin-PW-t5Rk82";
const NEW_PASSWORD = "renewed-PW-q8Lm31";
const CLIENT_REDIRECT = "https://client.example/cb";
const DAY_MS = 24 * 60 * 60 * 1000;

/** 一个客户端的登记请求：缺省是机密、免确认的测试客户端。 */
function clientBody(overrides: Partial<CreateOAuthClientRequest> = {}): CreateOAuthClientRequest {
    return {name: "合同测试客户端", redirectUris: [CLIENT_REDIRECT], type: "confidential", skipConsent: true, ...overrides};
}

/** 跳转地址上的授权码；不是带码跳回客户端时抛错（用例接着要用它）。 */
function codeOf(answer: Step): string {
    const code = answer.location.searchParams.get("code");
    if (answer.kind !== "redirect-back" || code === null) throw new Error(`authorization ended at ${answer.kind} (${answer.location.search}), not back at the client with a code`);
    return code;
}

/** 没用掉的授权码与换它要的 PKCE 校验值。 */
interface PendingCode {
    readonly client: RegisteredClient;
    readonly code: string;
    readonly verifier: string;
}

interface Issued {
    readonly accessToken: string;
    readonly idToken: string;
}

/** 一个站点进程与它上面的管理员；`member` 经注册建普通账号（注册即登录、已同意条款）。 */
interface InvalidationSite {
    readonly site: SiteProcess;
    readonly dataDir: string;
    readonly root: CookieJar;
    readonly rootId: number;
    readonly from: () => string;
    member(prefix: string): Promise<Member>;
    /** 以账号再登录一次，回新会话的 Cookie 罐（已同意条款：同意按账号记）。 */
    signIn(username: string, password?: string): Promise<CookieJar>;
    register(overrides?: Partial<CreateOAuthClientRequest>): Promise<RegisteredClient>;
    /** 以 `jar` 发起授权，回没用掉的码；客户端要确认时由用例先同意过。 */
    pending(jar: CookieJar, client: RegisteredClient, extra?: Readonly<Record<string, string>>): Promise<PendingCode>;
    /** 以 `jar` 拿码并换出令牌；`exchangeExtra` 加进换码的表单。 */
    issue(jar: CookieJar, client: RegisteredClient, extra?: Readonly<Record<string, string>>, exchangeExtra?: Readonly<Record<string, string>>): Promise<Issued>;
    /** 令牌调用户信息的状态码。 */
    userInfoStatus(accessToken: string): Promise<number>;
    /** 换码的结果：成功为 `"ok"`，否则是响应里的 `error`。 */
    exchanged(pending: PendingCode): Promise<string>;
}

interface Member {
    readonly id: number;
    readonly username: string;
    readonly password: string;
    /** 注册时拿到的会话。 */
    readonly jar: CookieJar;
}

let addressBlock = 0;

async function startInvalidationSite(env: Readonly<Record<string, string>> = {}): Promise<InvalidationSite> {
    const dataDir = await sandbox.dataDir();
    const rootId = await createAdmin(sandbox, dataDir, ["root", "root@example.com"], PASSWORD);
    const site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, ...env}});
    // 每个进程一段自己的来源地址：限流按来源计（`site.accounts` 输出 19），注册与登录都吃额度。
    const block = ++addressBlock;
    let address = 0;
    const from = () => `10.${String(block)}.${String(Math.floor(++address / 250))}.${String((address % 250) + 1)}`;
    const root = cookieJar();
    if ((await login(site.url, "root", PASSWORD, {from: from(), jar: root})).status !== 200) throw new Error("root could not sign in");
    if ((await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", jar: root, from: from(), body: {termsVersion: TERMS_VERSION, overseasStorage: true}})).status !== 200) {
        throw new Error("root could not consent");
    }
    const issuedCode = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", jar: root, from: from(), body: {maxUses: 100}});
    if (issuedCode.status !== 200 || !Value.Check(RegistrationCodeItem, issuedCode.body)) throw new Error(`issuing a registration code answered ${String(issuedCode.status)}`);
    const registrationCode = issuedCode.body.code;
    let serial = 0;

    const pending = async (jar: CookieJar, client: RegisteredClient, extra: Readonly<Record<string, string>> = {}): Promise<PendingCode> => {
        const request = authorizationRequest(client, extra);
        return {client, code: codeOf(await step(site.url, jar, request.url, client)), verifier: request.verifier};
    };

    return {
        site,
        dataDir,
        root,
        rootId,
        from,
        member: async (prefix) => {
            serial += 1;
            const username = `${prefix}${String(serial)}`;
            const password = `${username}-PW-x4Tg72`;
            const jar = cookieJar();
            const response = await identityRequest(site.url, IDENTITY_PATHS.register, {
                method: "POST",
                jar,
                from: from(),
                body: {username, email: `${username}@example.com`, password, registrationCode, termsVersion: TERMS_VERSION, overseasStorage: true},
            });
            if (response.status !== 200 || !Value.Check(RegisterResponse, response.body)) throw new Error(`registering ${username} answered ${String(response.status)}`);
            return {id: response.body.user.id, username, password, jar};
        },
        signIn: async (username, password) => {
            const jar = cookieJar();
            const response = await login(site.url, username, password ?? `${username}-PW-x4Tg72`, {from: from(), jar});
            if (response.status !== 200) throw new Error(`${username} could not sign in: ${String(response.status)}`);
            return jar;
        },
        register: (overrides) => registerOAuthClient(site.url, root, from(), clientBody(overrides)),
        pending,
        issue: async (jar, client, extra, exchangeExtra) => {
            const {code, verifier} = await pending(jar, client, extra);
            const response = await exchangeCode(site.url, client, code, verifier, exchangeExtra);
            if (response.status !== 200) throw new Error(`exchanging the code answered ${String(response.status)}: ${response.text}`);
            const tokens = JSON.parse(response.text) as {access_token: string; id_token: string};
            return {accessToken: tokens.access_token, idToken: tokens.id_token};
        },
        userInfoStatus: async (accessToken) => (await fetchUserInfo(site.url, accessToken)).status,
        exchanged: async ({client, code, verifier}) => {
            const response = await exchangeCode(site.url, client, code, verifier);
            return response.status === 200 ? "ok" : String((JSON.parse(response.text) as {error?: unknown}).error);
        },
    };
}

/** 失效的样子与照用的样子（输出 8）。 */
const REVOKED = {token: 401, code: "invalid_grant"} as const;
const LIVE = {token: 200, code: "ok"} as const;

describe("令牌随账号失效（输出 8；验收 3、5、9、10、16、17，验收 22 的改密码那半；site.admin 输出 2、3、4）", () => {
    let s: InvalidationSite;
    let client: RegisteredClient;

    /** 一个令牌与一个没用掉的码现在的样子；码只能看一次（看就是换掉它）。 */
    async function outcome(issued: Issued, pending: PendingCode): Promise<{readonly token: number; readonly code: string}> {
        return {token: await s.userInfoStatus(issued.accessToken), code: await s.exchanged(pending)};
    }

    beforeAll(async () => {
        s = await startInvalidationSite();
        client = await s.register();
    }, SETUP_TIMEOUT_MS);

    const accountWide: ReadonlyArray<readonly [label: string, action: AdminUserAction, body: unknown]> = [
        ["封禁（验收 3，site.admin 输出 2）", "ban", undefined],
        ["改角色（site.admin 输出 3）", "role", {role: "admin"}],
        ["管理员重置密码（验收 5，site.admin 输出 4）", "reset-password", undefined],
        ["管理员结束全部会话", "revoke-sessions", undefined],
    ];
    for (const [label, action, body] of accountWide) {
        // 超出预算：注册两个账号、再登录一次，各算一次密码哈希。
        it(`${label}：这个账号两个会话里的令牌都 401、没用掉的码换不出，已发的 id_token 仍按公钥地址验得过；别的账号照用`, async () => {
            const target = await s.member("target");
            const bystander = await s.member("bystander");
            const otherSession = await s.signIn(target.username);
            const first = await s.issue(target.jar, client);
            const second = await s.issue(otherSession, client);
            const code = await s.pending(target.jar, client);
            const unaffected = await s.issue(bystander.jar, client);
            const unaffectedCode = await s.pending(bystander.jar, client);
            const acted = await identityRequest(s.site.url, identityPath.adminUserAction(target.id, action), {method: "POST", jar: s.root, from: s.from(), ...(body === undefined ? {} : {body})});
            expect(acted.status).toBe(200);
            expect({first: await outcome(first, code), second: await s.userInfoStatus(second.accessToken)}).toEqual({first: REVOKED, second: 401});
            // id_token 是签名过的自包含凭据，不随变更失效（输出 8 末句）：签它的钥还列在公钥地址里。
            expect((await verifyIdToken(s.site.url, first.idToken, `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.jwks}`)).payload.aud).toBe(client.clientId);
            expect(await outcome(unaffected, unaffectedCode)).toEqual(LIVE);
        });
    }

    // 超出预算：注册、解封后的登录各算一次密码哈希。
    it("封禁再解封：封禁前发出的令牌仍 401、没用掉的码仍换不出；解封后重新登录，新授权照常（site.admin 输出 2 的“不恢复旧令牌”）", async () => {
        const target = await s.member("unbanned");
        const before = await s.issue(target.jar, client);
        const beforeCode = await s.pending(target.jar, client);
        for (const action of ["ban", "unban"] as const) {
            expect((await identityRequest(s.site.url, identityPath.adminUserAction(target.id, action), {method: "POST", jar: s.root, from: s.from()})).status).toBe(200);
        }
        expect(await outcome(before, beforeCode)).toEqual(REVOKED);
        const again = await s.signIn(target.username);
        expect(await s.userInfoStatus((await s.issue(again, client)).accessToken)).toBe(200);
    });

    // 超出预算：注册两个账号，各算一次密码哈希。
    it("账号 A 拿到授权码后被封禁，随后账号 B 登录：A 的那个授权码仍换不出令牌（验收 10）", async () => {
        const a = await s.member("banned");
        const b = await s.member("later");
        const code = await s.pending(a.jar, client);
        expect((await identityRequest(s.site.url, identityPath.adminUserAction(a.id, "ban"), {method: "POST", jar: s.root, from: s.from()})).status).toBe(200);
        await s.signIn(b.username);
        expect(await s.exchanged(code)).toBe("invalid_grant");
    });

    // 超出预算：注册、再登录、改密码各算一次密码哈希。
    it("自己改密码：当前会话仍可用，它与别的会话里的令牌都 401、没用掉的码换不出；带 resource 拿到的令牌同形、照常有 id_token，也 401（验收 16，验收 22 的改密码那半）", async () => {
        const self = await s.member("changer");
        const otherSession = await s.signIn(self.username);
        const plain = await s.issue(self.jar, client);
        const resource = `${SITE_ORIGIN}${OAUTH_ENDPOINT_PATHS.userinfo}`;
        const withResource = await s.issue(self.jar, client, {resource}, {resource});
        const elsewhere = await s.issue(otherSession, client);
        const code = await s.pending(self.jar, client, {resource});
        // 带 resource 时与不带时同形：访问令牌不透明（不是 JWS 的三段式），id_token 按公钥地址验得过。
        const document = JSON.parse((await siteFetch(s.site.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        expect(withResource.accessToken.split(".")).toHaveLength(1);
        expect((await verifyIdToken(s.site.url, withResource.idToken, document.jwks_uri)).payload.aud).toBe(client.clientId);
        expect(await s.userInfoStatus(withResource.accessToken)).toBe(200);

        const changed = await identityRequest(s.site.url, IDENTITY_PATHS.mePassword, {method: "POST", jar: self.jar, from: s.from(), body: {currentPassword: self.password, newPassword: NEW_PASSWORD}});
        expect(changed.status).toBe(200);
        expect((await identityRequest(s.site.url, IDENTITY_PATHS.me, {jar: self.jar, from: s.from()})).status).toBe(200);
        expect({
            plain: await outcome(plain, code),
            withResource: await s.userInfoStatus(withResource.accessToken),
            elsewhere: await s.userInfoStatus(elsewhere.accessToken),
        }).toEqual({plain: REVOKED, withResource: 401, elsewhere: 401});
        // 改密码之后在当前会话里新拿的照常可用。
        expect(await s.userInfoStatus((await s.issue(self.jar, client)).accessToken)).toBe(200);
    });

    // 超出预算：注册、再登录各算一次密码哈希。
    it("登出：在那次会话里发出的令牌 401、码换不出；同一账号另一个会话里的照用", async () => {
        const self = await s.member("leaver");
        const otherSession = await s.signIn(self.username);
        const ended = await s.issue(self.jar, client);
        const endedCode = await s.pending(self.jar, client);
        const kept = await s.issue(otherSession, client);
        const keptCode = await s.pending(otherSession, client);
        expect((await identityRequest(s.site.url, IDENTITY_PATHS.logout, {method: "POST", jar: self.jar, from: s.from()})).status).toBe(200);
        expect({ended: await outcome(ended, endedCode), kept: await outcome(kept, keptCode)}).toEqual({ended: REVOKED, kept: LIVE});
    });

    // 超出预算：注册、再登录各算一次密码哈希。
    it("在会话列表里结束一个会话：它里面的令牌 401、码换不出；另一个会话里的照用（验收 17）", async () => {
        const self = await s.member("ender");
        const otherSession = await s.signIn(self.username);
        const ended = await s.issue(self.jar, client);
        const endedCode = await s.pending(self.jar, client);
        const kept = await s.issue(otherSession, client);
        const keptCode = await s.pending(otherSession, client);
        const listed = await identityRequest(s.site.url, IDENTITY_PATHS.meSessions, {jar: otherSession, from: s.from()});
        if (listed.status !== 200 || !Value.Check(SessionListResponse, listed.body)) throw new Error(`listing sessions answered ${String(listed.status)}`);
        const others = listed.body.items.filter((item) => !item.current);
        expect(others).toHaveLength(1);
        expect((await identityRequest(s.site.url, identityPath.meSession(others[0]!.id), {method: "DELETE", jar: otherSession, from: s.from()})).status).toBe(200);
        expect({ended: await outcome(ended, endedCode), kept: await outcome(kept, keptCode)}).toEqual({ended: REVOKED, kept: LIVE});
    });

    it("停用客户端：它的令牌 401、码换码得 invalid_client；再启用后停用前的令牌仍 401、码换不出，新授权照常；别的客户端照用（输出 8 末项）", async () => {
        const target = await s.register();
        const other = await s.register();
        const before = await s.issue(s.root, target);
        const beforeCode = await s.pending(s.root, target);
        const otherToken = await s.issue(s.root, other);
        const patch = async (disabled: boolean) =>
            expect((await identityRequest(s.site.url, identityPath.adminOAuthClient(target.clientId), {method: "PATCH", jar: s.root, from: s.from(), body: {disabled}})).status).toBe(200);
        await patch(true);
        expect(await s.userInfoStatus(before.accessToken)).toBe(401);
        await patch(false);
        expect(await outcome(before, beforeCode)).toEqual(REVOKED);
        expect(await s.userInfoStatus((await s.issue(s.root, target)).accessToken)).toBe(200);
        expect(await s.userInfoStatus(otherToken.accessToken)).toBe(200);
    });

    it("停用期间没用掉的码换码得 invalid_client", async () => {
        const target = await s.register();
        const code = await s.pending(s.root, target);
        expect((await identityRequest(s.site.url, identityPath.adminOAuthClient(target.clientId), {method: "PATCH", jar: s.root, from: s.from(), body: {disabled: true}})).status).toBe(200);
        expect(await s.exchanged(code)).toBe("invalid_client");
    });
});

describe("已给的授权（输出 15、输出 8 的撤销授权；验收 9）", () => {
    let s: InvalidationSite;

    beforeAll(async () => {
        s = await startInvalidationSite();
    }, SETUP_TIMEOUT_MS);

    /** 发起授权并在确认页同意，回授权码换出的令牌。 */
    async function consentAndIssue(jar: CookieJar, client: RegisteredClient, scope = "openid profile email"): Promise<Issued> {
        const request = authorizationRequest(client, {scope});
        const toConsent = await step(s.site.url, jar, request.url, client);
        if (toConsent.kind !== "consent") throw new Error(`authorization ended at ${toConsent.kind}, not at the consent page`);
        const decided = await identityRequest(s.site.url, IDENTITY_PATHS.oauthAuthorization, {method: "POST", jar, from: s.from(), body: {request: toConsent.location.searchParams.get("request"), accept: true}});
        const back = new URL((decided.body as {redirectUrl?: string}).redirectUrl ?? "");
        const exchanged = await exchangeCode(s.site.url, client, back.searchParams.get("code") ?? "", request.verifier);
        if (exchanged.status !== 200) throw new Error(`exchanging the consented code answered ${String(exchanged.status)}`);
        const tokens = JSON.parse(exchanged.text) as {access_token: string; id_token: string};
        return {accessToken: tokens.access_token, idToken: tokens.id_token};
    }

    async function grantsOf(jar: CookieJar): Promise<GrantListResponse["items"]> {
        const response = await identityRequest(s.site.url, IDENTITY_PATHS.meGrants, {jar, from: s.from()});
        expect({status: response.status, shape: Value.Check(GrantListResponse, response.body)}).toEqual({status: 200, shape: true});
        return (response.body as GrantListResponse).items;
    }

    const revokeGrant = (jar: CookieJar, id: number) => identityRequest(s.site.url, identityPath.meGrant(id), {method: "DELETE", jar, from: s.from()});

    // 超出预算：注册算一次密码哈希。
    it("列出自己的授权：客户端名字、范围、给出的时间，后给的在前；撤销一项后它的令牌 401、码换不出，下一次授权重新显示确认页；另一个客户端的照用（验收 9）", async () => {
        const self = await s.member("granter");
        const first = await s.register({name: "第一个应用", skipConsent: false});
        const second = await s.register({name: "第二个应用", skipConsent: false});
        const firstToken = await consentAndIssue(self.jar, first, "openid profile");
        // 同意过的范围再来直接发码：这就是没用掉的码。
        const firstCode = await s.pending(self.jar, first, {scope: "openid profile"});
        const secondToken = await consentAndIssue(self.jar, second);

        const items = await grantsOf(self.jar);
        // 不排序直接比：列表按给出的先后倒序，第二个应用后同意、在前（输出 15）。
        expect(items.map(({clientName, scopes}) => ({clientName, scopes: [...scopes].sort()}))).toEqual([
            {clientName: "第二个应用", scopes: ["email", "openid", "profile"]},
            {clientName: "第一个应用", scopes: ["openid", "profile"]},
        ]);
        const firstGrant = items.find((item) => item.clientName === "第一个应用")!;
        const secondGrant = items.find((item) => item.clientName === "第二个应用")!;
        // 给出的时间由库按它自己的时间写，与模块的时钟不在一条时间线上：只看先后。
        expect(Date.parse(secondGrant.createdAt)).toBeGreaterThanOrEqual(Date.parse(firstGrant.createdAt));

        const revoked = await revokeGrant(self.jar, firstGrant.id);
        expect({status: revoked.status, body: revoked.body}).toEqual({status: 200, body: {}});
        expect({token: await s.userInfoStatus(firstToken.accessToken), code: await s.exchanged(firstCode)}).toEqual(REVOKED);
        expect(await s.userInfoStatus(secondToken.accessToken)).toBe(200);
        expect((await grantsOf(self.jar)).map((item) => item.id)).toEqual([secondGrant.id]);
        expect((await step(s.site.url, self.jar, authorizationRequest(first, {scope: "openid profile"}).url, first)).kind).toBe("consent");
    });

    // 超出预算：注册两个账号，各算一次密码哈希。
    it("不是自己的、不存在的、已撤销的 id 回 not_found，别人的授权不受影响", async () => {
        const owner = await s.member("owner");
        const stranger = await s.member("stranger");
        const client = await s.register({skipConsent: false});
        const ownerToken = await consentAndIssue(owner.jar, client);
        const [grant] = await grantsOf(owner.jar);
        const notFound = {status: 404, body: {error: {code: "not_found"}}};
        const strangers = await revokeGrant(stranger.jar, grant!.id);
        expect({status: strangers.status, body: strangers.body}).toEqual(notFound);
        const missing = await revokeGrant(owner.jar, grant!.id + 1_000_000);
        expect({status: missing.status, body: missing.body}).toEqual(notFound);
        expect(await s.userInfoStatus(ownerToken.accessToken)).toBe(200);
        expect((await grantsOf(owner.jar)).map((item) => item.id)).toEqual([grant!.id]);
        expect((await revokeGrant(owner.jar, grant!.id)).status).toBe(200);
        const again = await revokeGrant(owner.jar, grant!.id);
        expect({status: again.status, body: again.body}).toEqual(notFound);
    });

    // 超出预算：注册算一次密码哈希。
    it("免确认的客户端不在列表里，登记后被改成免确认的也不在、按 id 撤销回 not_found；改回要确认后重新出现", async () => {
        const self = await s.member("lister");
        const trusted = await s.register({name: "免确认的应用", skipConsent: true});
        await s.issue(self.jar, trusted);
        const later = await s.register({name: "后来免确认的应用", skipConsent: false});
        await consentAndIssue(self.jar, later);
        const [grant] = await grantsOf(self.jar);
        expect((await grantsOf(self.jar)).map((item) => item.clientName)).toEqual(["后来免确认的应用"]);

        const setSkip = async (skipConsent: boolean) =>
            expect((await identityRequest(s.site.url, identityPath.adminOAuthClient(later.clientId), {method: "PATCH", jar: s.root, from: s.from(), body: {skipConsent}})).status).toBe(200);
        await setSkip(true);
        expect(await grantsOf(self.jar)).toEqual([]);
        const hidden = await revokeGrant(self.jar, grant!.id);
        expect({status: hidden.status, body: hidden.body}).toEqual({status: 404, body: {error: {code: "not_found"}}});
        await setSkip(false);
        expect((await grantsOf(self.jar)).map((item) => item.id)).toEqual([grant!.id]);
    });

    // 超出预算：注册算一次密码哈希。
    it("停用的客户端的授权照常列出，id 不变（输出 15）", async () => {
        const self = await s.member("disabled");
        const client = await s.register({name: "停用的应用", skipConsent: false});
        await consentAndIssue(self.jar, client);
        const before = await grantsOf(self.jar);
        expect(before.map((item) => item.clientName)).toEqual(["停用的应用"]);
        expect((await identityRequest(s.site.url, identityPath.adminOAuthClient(client.clientId), {method: "PATCH", jar: s.root, from: s.from(), body: {disabled: true}})).status).toBe(200);
        expect(await grantsOf(self.jar)).toEqual(before);
    });

    // 超出预算：注册算一次密码哈希。
    it("撤销授权、撤销令牌都不写审计记录（副作用与数据）", async () => {
        const self = await s.member("unaudited");
        const client = await s.register({skipConsent: false});
        const granted = await consentAndIssue(self.jar, client);
        const second = await s.issue(self.jar, client);
        // 登记客户端写的那条审计在这之前：从这里起只剩撤销。
        const auditTotal = async () => {
            const response = await identityRequest(s.site.url, IDENTITY_PATHS.adminAudit, {jar: s.root, from: s.from()});
            if (response.status !== 200 || !Value.Check(AuditListResponse, response.body)) throw new Error(`listing the audit answered ${String(response.status)}`);
            return response.body.total;
        };
        const before = await auditTotal();
        expect((await revokeToken(s.site.url, client, second.accessToken)).status).toBe(200);
        expect(await s.userInfoStatus(second.accessToken)).toBe(401);
        const [grant] = await grantsOf(self.jar);
        expect((await revokeGrant(self.jar, grant!.id)).status).toBe(200);
        expect(await s.userInfoStatus(granted.accessToken)).toBe(401);
        expect(await auditTotal()).toBe(before);
    });
});

describe("会话到期（输出 8 的“到期”，site.accounts 的定时任务 purge）", () => {
    let s: InvalidationSite;
    let client: RegisteredClient;

    beforeAll(async () => {
        // 会话时长取下限 2 天，拨钟拨过它就到期。
        s = await startInvalidationSite({NB_SITE_IDENTITY_SESSION_DAYS: "2"});
        // 登记要在拨钟之前：库按系统时间判管理员的会话，拨过之后模块已认为它到期（包说明的升级清单）。
        client = await s.register();
    }, SETUP_TIMEOUT_MS);

    // 超出预算：注册与拨钟之后的登录各算一次密码哈希。
    it("到期的会话里发出的令牌与没用掉的码在下一次 purge 后失效；之后新的会话照常授权、换码", async () => {
        const self = await s.member("expiring");
        const issued = await s.issue(self.jar, client);
        const code = await s.pending(self.jar, client);
        await s.site.advanceClock(2 * DAY_MS + 60_000);
        const purged = await s.site.runJob("identity", "purge");
        expect({status: purged.status, body: purged.body}).toEqual({status: 200, body: {status: "done"}});
        expect({token: await s.userInfoStatus(issued.accessToken), code: await s.exchanged(code)}).toEqual(REVOKED);
        // 清理删了 verification 里过期的行之后，库的别的路（新的授权码、换码、用户信息）照常。
        const fresh = await s.signIn(self.username);
        expect(await s.userInfoStatus((await s.issue(fresh, client)).accessToken)).toBe(200);
    });
});

describe("重启（输出 17，验收 19；时序一节的重启）", () => {
    let restarted: SiteProcess;
    let s: InvalidationSite;
    let client: RegisteredClient;
    let issued: Issued;
    let pending: PendingCode;
    let kid: unknown;

    beforeAll(async () => {
        s = await startInvalidationSite();
        client = await s.register();
        issued = await s.issue(s.root, client);
        pending = await s.pending(s.root, client);
        kid = JSON.parse(Buffer.from(issued.idToken.split(".")[0]!, "base64url").toString("utf8")).kid;
        await s.site.stop();
        restarted = await sandbox.start({dataDir: s.dataDir, env: IDENTITY_SITE_ENV});
    }, SETUP_TIMEOUT_MS);

    it("重启前发出的令牌照用、待用的码换得出、签发的 id_token 用公钥地址验得过，签名用的钥不变", async () => {
        const document = JSON.parse((await siteFetch(restarted.url, OIDC_DISCOVERY_PATHS[0])).text) as DiscoveryDocument;
        expect((await fetchUserInfo(restarted.url, issued.accessToken)).status).toBe(200);
        expect((await verifyIdToken(restarted.url, issued.idToken, document.jwks_uri)).header.kid).toBe(kid);
        const exchanged = await exchangeCode(restarted.url, client, pending.code, pending.verifier);
        expect(exchanged.status).toBe(200);
        const after = JSON.parse(exchanged.text) as {id_token: string};
        expect((await verifyIdToken(restarted.url, after.id_token, document.jwks_uri)).header.kid).toBe(kid);
    });
});

describe("第一次启动时建签名钥撞上写锁（输出 17）", () => {
    // 超出预算：迁移、一次等满写锁上限后失败的启动、再一次启动，各是一个子进程。
    it("迁移过、还没起过服务的数据目录，库被进程外占着写：serve 以 start_failed 退出；放开后启动，公钥地址列出一把钥", async () => {
        const dataDir = await sandbox.dataDir();
        // 迁移只建表，签名钥由第一次启动的账号模块建；迁移之后第一次 serve 要写的就是它。
        const migrated = await sandbox.run("migrate", {dataDir});
        expect(migrated.exitCode).toBe(0);
        const release = holdWriteLock(dataDir, "identity");
        let failed: CommandResult;
        try {
            failed = await sandbox.run("serve", {dataDir, env: IDENTITY_SITE_ENV, timeoutMs: SETUP_TIMEOUT_MS});
        } finally {
            release();
        }
        expect(failed.exitCode).not.toBe(0);
        expect(failed.failure?.code).toBe("start_failed");
        const site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        const keys = JSON.parse((await siteFetch(site.url, OAUTH_ENDPOINT_PATHS.jwks)).text) as {keys: unknown[]};
        expect(keys.keys).toHaveLength(1);
    }, SETUP_TIMEOUT_MS * 2);
});
