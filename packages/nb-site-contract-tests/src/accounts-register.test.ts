/**
 * 注册的黑盒合同（docs/specs/site/accounts.md 输出 1 到 3、22，失败表里注册的先后，时序“注册成功的响应返回时会话已经可用”，验收 1、
 * 2）：起真实的 `nb-site` 进程，只经 HTTP 与命令行看它。注册码由 `create-admin` 建的管理员经管理接口发放（`site.admin` 输出 7）。
 * 注册的限流在 `accounts-limits.test.ts`。
 *
 * 本文件测不到、在别处的：
 * - 邀请码的那半句（扣邀请码的次数、停用的邀请码）：要先经邀请码接口生成，在 `accounts-me.test.ts`；这里只测“不存在的邀请码”。
 *   经管理详情看记下的邀请人在 `admin.test.ts` 的账号详情用例；库里那一列在账号包的 `invite-codes.test.ts`、`register.test.ts`。
 * - 扣码之后建账号失败时码不被扣、预检之后被别人占用：要让事务中途失败、在两步之间插入动作，在账号包的 `register.test.ts`。
 *
 * 时间预算：起进程、跑命令放在 `beforeAll` 里；用例只发请求。超出 200 毫秒的用例在旁边写明原因。
 */

import {beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {ErrorBody, IDENTITY_PATHS, identityPath, MeResponse, MetaResponse, RegisterResponse, RegistrationCodeItem, RegistrationCodeListResponse} from "@notnotype/nb-site-identity-contract";

import {cookieJar, createAdmin, IDENTITY_SITE_ENV, identityRequest, login, type CookieJar} from "./testing/identity";
import {useSiteSandbox, type JsonResponse, type SiteProcess} from "./testing/site";

const sandbox = useSiteSandbox("nb-site-contract-tests accounts-register.test.ts");

const SETUP_TIMEOUT_MS = 30_000;
const TERMS_VERSION = "2026-11-20";
const ADMIN_PASSWORD = "issuer-PW-k3Vb72";
const PASSWORD = "member-PW-t5Nc48";
const HOUR_MS = 3_600_000;
/** 会话 Cookie 的名字（`site.accounts` 输出 5）。 */
const SESSION_COOKIE = "__Host-nbsite.session_token";

function outcome(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    return {status: response.status, body: response.body};
}

/** 失败的响应：形状合 `ErrorBody`，再比状态码与体。 */
function failure(response: JsonResponse): {readonly status: number; readonly body: unknown} {
    expect(Value.Check(ErrorBody, response.body)).toBe(true);
    return outcome(response);
}

const rejected = (code: string, status: number) => ({status, body: {error: {code}}});
const codeInvalid = rejected("registration_code_invalid", 422);

describe("注册（输出 1 到 3，验收 1、2）", () => {
    let site: SiteProcess;
    let admin: CookieJar;
    let address = 0;
    /** 每次请求一个来源地址：注册按来源每小时 5 次（输出 19），这一组不测限流。 */
    const from = () => `198.51.100.${String(++address)}`;
    let serial = 0;
    /** 每次注册一个新的用户名与邮箱。 */
    const fresh = (prefix: string) => {
        serial += 1;
        return {username: `${prefix}${String(serial)}`, email: `${prefix}${String(serial)}@example.com`};
    };

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        await createAdmin(sandbox, dataDir, ["issuer", "issuer@example.com"], ADMIN_PASSWORD);
        site = await sandbox.start({dataDir, env: IDENTITY_SITE_ENV});
        admin = cookieJar();
        const source = from();
        if ((await login(site.url, "issuer", ADMIN_PASSWORD, {from: source, jar: admin})).status !== 200) throw new Error("the admin could not sign in");
        const consent = await identityRequest(site.url, IDENTITY_PATHS.meConsent, {method: "POST", from: source, jar: admin, body: {termsVersion: TERMS_VERSION, overseasStorage: true}});
        if (consent.status !== 200) throw new Error("the admin could not consent");
    }, SETUP_TIMEOUT_MS);

    async function issueCode(body: Record<string, unknown> = {maxUses: null}): Promise<RegistrationCodeItem> {
        const response = await identityRequest(site.url, IDENTITY_PATHS.adminRegistrationCodes, {method: "POST", from: from(), jar: admin, body});
        expect(response.status).toBe(200);
        expect(Value.Check(RegistrationCodeItem, response.body)).toBe(true);
        return response.body as RegistrationCodeItem;
    }

    async function codeById(id: number): Promise<RegistrationCodeItem> {
        const response = await identityRequest(site.url, `${IDENTITY_PATHS.adminRegistrationCodes}?pageSize=100`, {from: from(), jar: admin});
        expect(Value.Check(RegistrationCodeListResponse, response.body)).toBe(true);
        const item = (response.body as RegistrationCodeListResponse).items.find((candidate) => candidate.id === id);
        if (item === undefined) throw new Error(`registration code ${String(id)} is not in the first page`);
        return item;
    }

    function register(body: Record<string, unknown>, init: {readonly jar?: CookieJar; readonly from?: string} = {}): Promise<JsonResponse> {
        return identityRequest(site.url, IDENTITY_PATHS.register, {method: "POST", from: init.from ?? from(), body, ...(init.jar === undefined ? {} : {jar: init.jar})});
    }

    function body(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {...fresh("member"), password: PASSWORD, registrationCode: code, termsVersion: TERMS_VERSION, overseasStorage: true, ...overrides};
    }

    // 超出 200 毫秒的预算：注册与随后的登录各算一次密码哈希。
    it("注册（Smoke）：回公开资料与会话 Cookie，随即 me 与 whoami 可用；省略显示名时取用户名；注册码用了 1 次；新密码能登录", async () => {
        const code = await issueCode({maxUses: 3});
        const jar = cookieJar();
        const response = await register({username: "NewMember", email: "NewMember@Example.com", password: PASSWORD, registrationCode: code.code, termsVersion: TERMS_VERSION, overseasStorage: true}, {jar});
        expect(response.status).toBe(200);
        expect(Value.Check(RegisterResponse, response.body)).toBe(true);
        const user = (response.body as RegisterResponse).user;
        expect(user).toMatchObject({username: "newmember", displayName: "NewMember", role: "user", avatarUrl: null, website: null, bio: null});
        const cookie = jar.last(SESSION_COOKIE);
        expect({
            set: cookie !== undefined && cookie.value !== "",
            httpOnly: cookie?.attributes.has("httponly"),
            secure: cookie?.attributes.has("secure"),
            sameSite: cookie?.attributes.get("samesite")?.toLowerCase(),
            path: cookie?.attributes.get("path"),
            domain: cookie?.attributes.has("domain"),
        }).toEqual({set: true, httpOnly: true, secure: true, sameSite: "lax", path: "/", domain: false});

        const me = await identityRequest(site.url, IDENTITY_PATHS.me, {from: from(), jar});
        expect(me.status).toBe(200);
        expect(Value.Check(MeResponse, me.body)).toBe(true);
        expect(me.body).toMatchObject({id: user.id, email: "newmember@example.com", emailPending: false, hasPassword: true, consentRequired: false});
        expect(outcome(await identityRequest(site.url, IDENTITY_PATHS.whoami, {from: from(), jar}))).toEqual({status: 200, body: {state: "authenticated", user: {id: user.id, username: "newmember", role: "user"}}});

        expect(await codeById(code.id)).toMatchObject({usedCount: 1, usable: true});
        expect((await login(site.url, "NEWMEMBER@example.com", PASSWORD, {from: from()})).status).toBe(200);
    });

    it("给了显示名时用它", async () => {
        const code = await issueCode();
        const response = await register(body(code.code, {displayName: "Shown Name"}));
        expect(response.status).toBe(200);
        expect((response.body as RegisterResponse).user.displayName).toBe("Shown Name");
    });

    // 超出 200 毫秒的预算：8 个注册同时算密码哈希，受哈希的并发上限约束。
    it("验收 1：只剩一次的注册码，8 个并发注册（8 个来源）恰好 1 个成功，码显示用了 1 次", async () => {
        const code = await issueCode({maxUses: 1});
        const responses = await Promise.all(Array.from({length: 8}, () => register(body(code.code))));
        const statuses = responses.map((response) => response.status);
        expect(statuses.filter((status) => status === 200).length).toBe(1);
        for (const response of responses.filter((candidate) => candidate.status !== 200)) expect(failure(response)).toEqual(codeInvalid);
        expect(await codeById(code.id)).toMatchObject({usedCount: 1, usable: false});
    });

    // 超出 200 毫秒的预算：两次注册各算一次密码哈希。
    it("验收 2：用重复的用户名注册失败，同一个注册码随后注册另一个用户名成功", async () => {
        const code = await issueCode({maxUses: 1});
        const taken = fresh("dup");
        expect((await register(body((await issueCode()).code, taken))).status).toBe(200);
        expect(failure(await register(body(code.code, {username: taken.username.toUpperCase()})))).toEqual(rejected("username_taken", 409));
        expect(await codeById(code.id)).toMatchObject({usedCount: 0, usable: true});
        expect((await register(body(code.code))).status).toBe(200);
        expect(await codeById(code.id)).toMatchObject({usedCount: 1, usable: false});
    });

    it("邮箱被占（大小写不同也算）：email_taken", async () => {
        const code = await issueCode();
        const first = fresh("mail");
        expect((await register(body(code.code, first))).status).toBe(200);
        expect(failure(await register(body(code.code, {email: first.email.toUpperCase()})))).toEqual(rejected("email_taken", 409));
    });

    it("注册码不存在、码的大小写不同：registration_code_invalid；首尾空白不算", async () => {
        const code = await issueCode();
        expect(failure(await register(body("NO-SUCH-CODE")))).toEqual(codeInvalid);
        expect(failure(await register(body(code.code.toLowerCase())))).toEqual(codeInvalid);
        expect((await register(body(` ${code.code}\t`))).status).toBe(200);
    });

    it("邀请码不存在：invite_code_invalid", async () => {
        const code = await issueCode();
        expect(failure(await register(body(code.code, {inviteCode: "NO-SUCH-INVITE"})))).toEqual(rejected("invite_code_invalid", 422));
        expect(await codeById(code.id)).toMatchObject({usedCount: 0});
    });

    it("条款版本不是当前版本、没有同意境外存放：consent_required", async () => {
        const code = await issueCode();
        expect(failure(await register(body(code.code, {termsVersion: "2026-01-01"})))).toEqual(rejected("consent_required", 403));
        expect(failure(await register(body(code.code, {overseasStorage: false})))).toEqual(rejected("consent_required", 403));
    });

    it("字段不合规则：validation_failed，fields 就是那几个键；邮箱以 .invalid 结尾被拒；多余的键与缺的键都列出", async () => {
        const code = await issueCode();
        const fields = (response: JsonResponse) => {
            expect(Value.Check(ErrorBody, response.body)).toBe(true);
            expect(response.status).toBe(400);
            return [...((response.body as {error: {fields?: string[]}}).error.fields ?? [])].sort();
        };
        expect(fields(await register(body(code.code, {username: "ab", password: "short"})))).toEqual(["password", "username"]);
        expect(fields(await register(body(code.code, {email: "someone@example.invalid"})))).toEqual(["email"]);
        expect(fields(await register(body(code.code, {email: "someone@Example.INVALID"})))).toEqual(["email"]);
        expect(fields(await register(body(code.code, {username: "KKelvin"})))).toEqual(["username"]);
        const {termsVersion: _omitted, ...missing} = body(code.code);
        expect(fields(await register({...missing, extra: 1}))).toEqual(["extra", "termsVersion"]);
        expect(await codeById(code.id)).toMatchObject({usedCount: 0});
    });

    // 超出 200 毫秒的预算：合法的那一次算一次密码哈希。
    it("请求体不是合法的 UTF-8（显示名里一个无效字节）：validation_failed、fields 为空数组，不建号、不扣码；JSON 里的 U+FFFD 照收（输出 22）", async () => {
        const code = await issueCode({maxUses: 1});
        const fields = body(code.code, {displayName: "x�y"});
        // 把 JSON 文字里的 U+FFFD 换成一个不能出现在 UTF-8 里的字节 0xFF，其余字节不变。
        const text = new TextEncoder().encode(JSON.stringify(fields));
        const replacement = [0xef, 0xbf, 0xbd];
        const at = text.findIndex((_, index) => replacement.every((byte, offset) => text[index + offset] === byte));
        const invalid = new Uint8Array([...text.subarray(0, at), 0xff, ...text.subarray(at + replacement.length)]);
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.register, {method: "POST", from: from(), body: invalid}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: []}}});
        expect(await codeById(code.id)).toMatchObject({usedCount: 0, usable: true});

        // 同一个用户名、同一个只能用一次的码：前一次没建号、没扣码，这一次才成功。
        const accepted = await register(fields);
        expect({status: accepted.status, displayName: (accepted.body as RegisterResponse).user.displayName}).toEqual({status: 200, displayName: "x�y"});
        expect(await codeById(code.id)).toMatchObject({usedCount: 1, usable: false});
    });

    it("先后（失败表“注册”一行）：同时缺几样时回排在最前的那个码", async () => {
        const used = await issueCode({maxUses: 1});
        const owner = fresh("owner");
        expect((await register(body(used.code, owner))).status).toBe(200);

        // 被限流的来源：5 次过了字段校验、因缺同意被拒的注册用掉这一小时的额度。
        const limitedSource = from();
        for (let index = 0; index < 5; index += 1) expect(failure(await register(body(used.code, {overseasStorage: false}), {from: limitedSource}))).toEqual(rejected("consent_required", 403));

        // 每一行把它和它之后的毛病都带上：只有它排在最前，才会是回答。
        const faults = {
            validation_failed: {password: "short"},
            consent_required: {overseasStorage: false},
            registration_code_invalid: {registrationCode: "NO-SUCH-CODE"},
            invite_code_invalid: {inviteCode: "NO-SUCH-INVITE"},
            username_taken: {username: owner.username},
            email_taken: {email: owner.email},
        } as const;
        const order = ["validation_failed", "rate_limited", "consent_required", "registration_code_invalid", "invite_code_invalid", "username_taken", "email_taken"] as const;
        const statuses = {validation_failed: 400, rate_limited: 429, consent_required: 403, registration_code_invalid: 422, invite_code_invalid: 422, username_taken: 409, email_taken: 409} as const;
        const valid = await issueCode();
        for (const [index, expected] of order.entries()) {
            const later = order.slice(index);
            const request = Object.assign(body(valid.code), ...later.filter((fault) => fault !== "rate_limited").map((fault) => faults[fault]));
            const source = later.includes("rate_limited") ? limitedSource : from();
            const response = await register(request, {from: source});
            expect({expected, code: (response.body as {error?: {code?: string}}).error?.code, status: response.status}).toEqual({expected, code: expected, status: statuses[expected]});
        }
        expect(await codeById(valid.id)).toMatchObject({usedCount: 0});
    });

    // 超出 200 毫秒的预算：每种失效先注册一个账号、再登录它，各算两次密码哈希。
    it("注册码用完、停用、过期（拨钟）后不能注册，已用它注册的账号照常登录", async () => {
        const exhausted = await issueCode({maxUses: 1});
        const disabled = await issueCode({maxUses: null});
        const now = await site.advanceClock(1);
        const expiring = await issueCode({maxUses: null, expiresAt: new Date(now + HOUR_MS).toISOString()});
        const members = {exhausted: fresh("used"), disabled: fresh("off"), expiring: fresh("late")};
        expect((await register(body(exhausted.code, members.exhausted))).status).toBe(200);
        expect((await register(body(disabled.code, members.disabled))).status).toBe(200);
        expect((await register(body(expiring.code, members.expiring))).status).toBe(200);

        const patch = await identityRequest(site.url, identityPath.adminRegistrationCode(disabled.id), {method: "PATCH", from: from(), jar: admin, body: {disabled: true}});
        expect(patch.status).toBe(200);
        await site.advanceClock(HOUR_MS);

        for (const code of [exhausted, disabled, expiring]) expect({id: code.id, ...failure(await register(body(code.code)))}).toEqual({id: code.id, ...codeInvalid});
        for (const member of Object.values(members)) expect({member: member.username, status: (await login(site.url, member.username, PASSWORD, {from: from()})).status}).toEqual({member: member.username, status: 200});
    });
});

describe("注册关闭（输出 3，配置 NB_SITE_IDENTITY_REGISTRATION_OPEN）", () => {
    let site: SiteProcess;

    beforeAll(async () => {
        const dataDir = await sandbox.dataDir();
        site = await sandbox.start({dataDir, env: {...IDENTITY_SITE_ENV, NB_SITE_IDENTITY_REGISTRATION_OPEN: "false"}});
    }, SETUP_TIMEOUT_MS);

    it("meta 说注册没开放；注册回 registration_closed，排在字段校验之前", async () => {
        const meta = await identityRequest(site.url, IDENTITY_PATHS.meta, {from: "198.51.100.200"});
        expect(Value.Check(MetaResponse, meta.body)).toBe(true);
        expect(meta.body).toMatchObject({registrationOpen: false});
        const closed = rejected("registration_closed", 403);
        expect(failure(await identityRequest(site.url, IDENTITY_PATHS.register, {method: "POST", from: "198.51.100.201", body: {username: "ab"}}))).toEqual(closed);
        expect(
            failure(
                await identityRequest(site.url, IDENTITY_PATHS.register, {
                    method: "POST",
                    from: "198.51.100.202",
                    body: {username: "closedmember", email: "closed@example.com", password: PASSWORD, registrationCode: "ANY", termsVersion: TERMS_VERSION, overseasStorage: true},
                }),
            ),
        ).toEqual(closed);
    });
});
