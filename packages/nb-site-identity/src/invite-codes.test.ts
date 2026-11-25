/**
 * 自己的邀请码（`invite-codes.ts`；`site.accounts` 输出 18，输出 1 的邀请归属）。
 *
 * 合同测试经 HTTP 覆盖生成、上限、停用与用邀请码注册；这里补合同里造不出的：旧站导入的码（有可用次数、过期时间）与停用、过期、
 * 用完的码不占名额（直接写表），并发的生成不越过上限，以及用生成的码注册后库里记下的邀请人（管理详情在第 7 片）。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {InviteCodeItem, InviteCodeListResponse, type RegisterResponse} from "@notnotype/nb-site-identity-contract";

import {libDate} from "./db/library-rows";
import {TEST_SITE_URL} from "./testing/library";
import {createTestIdentity, TEST_CLIENT_ADDRESS_HEADER, TEST_TERMS_VERSION, type TestIdentity} from "./testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;
const DAY_MS = 86_400_000;

function generate(target: TestIdentity, cookie: string, body?: string): Promise<Response> {
    return target.fetch("/me/invite-codes", {method: "POST", headers: {origin: TEST_SITE_URL, cookie, ...(body === undefined ? {} : {"content-type": "application/json"})}, ...(body === undefined ? {} : {body})});
}

function disable(target: TestIdentity, cookie: string, id: number, body: unknown = {disabled: true}): Promise<Response> {
    return target.fetch(`/me/invite-codes/${String(id)}`, {method: "PATCH", headers: {origin: TEST_SITE_URL, cookie, "content-type": "application/json"}, body: JSON.stringify(body)});
}

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

async function generated(target: TestIdentity, cookie: string): Promise<InviteCodeItem> {
    const response = await generate(target, cookie);
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(InviteCodeItem, body)}).toEqual({status: 200, shape: true});
    return body as InviteCodeItem;
}

async function listed(target: TestIdentity, cookie: string): Promise<InviteCodeListResponse> {
    const response = await target.fetch("/me/invite-codes", {headers: {cookie}});
    const body = await response.json();
    expect({status: response.status, shape: Value.Check(InviteCodeListResponse, body)}).toEqual({status: 200, shape: true});
    return body as InviteCodeListResponse;
}

/** 直接往表里放一个码（旧站导入的、停用的、过期的、用完的经接口造不出）。 */
function addInviteCode(target: TestIdentity, code: string, ownerId: number, columns: {maxUses?: number; usedCount?: number; expiresAt?: number; disabled?: boolean} = {}): Promise<number> {
    const now = libDate(target.clock.now());
    return target.conn.write((tx) =>
        Number(
            tx
                .query(`INSERT INTO identity_invite_code (code, owner_id, max_uses, used_count, expires_at, disabled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(code, ownerId, columns.maxUses ?? null, columns.usedCount ?? 0, columns.expiresAt === undefined ? null : libDate(columns.expiresAt), columns.disabled === true ? now : null, now).lastInsertRowid,
        ),
    );
}

describe("生成与列表（输出 18）", () => {
    it("新码 16 个字符、不限次数、不过期；列表是自己的全部码，新的在前，别人的不在里面", async () => {
        identity = await createTestIdentity("identity-invite-generate");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const bob = await identity.addUser("bob", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        const first = await generated(identity, cookie);
        expect(first).toEqual({id: first.id, code: first.code, createdAt: new Date(identity.clock.now()).toISOString(), usedCount: 0, maxUses: null, expiresAt: null, usable: true});
        expect(first.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/u);
        // 同一时刻生成的按 id 倒序。
        const second = await generated(identity, cookie);
        identity.clock.advance(1000);
        const third = await generated(identity, cookie);
        await addInviteCode(identity, "BOB-CODE", bob);
        expect((await listed(identity, cookie)).items).toEqual([third, second, first]);
    });

    it("请求体只能为空或没有键的对象（输出 22）", async () => {
        identity = await createTestIdentity("identity-invite-generate-body");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        expect((await generate(identity, cookie, "{}")).status).toBe(200);
        expect(await outcome(await generate(identity, cookie, JSON.stringify({maxUses: 5})))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: []}}});
        expect((await listed(identity, cookie)).items).toHaveLength(1);
    });

    it("可用的满 10 个时再生成得 invite_code_limit；停用、过期、用完的与别人的不占名额；停用一个后又能生成", async () => {
        identity = await createTestIdentity("identity-invite-limit");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const bob = await identity.addUser("bob", {consent: CONSENTED});
        const now = identity.clock.now();
        await addInviteCode(identity, "OLD-DISABLED", alice, {disabled: true});
        await addInviteCode(identity, "OLD-EXPIRED", alice, {expiresAt: now});
        await addInviteCode(identity, "OLD-EXHAUSTED", alice, {maxUses: 3, usedCount: 3});
        const imported = await addInviteCode(identity, "OLD-LIVE", alice, {maxUses: 3, usedCount: 1, expiresAt: now + DAY_MS});
        for (let index = 0; index < 10; index += 1) await addInviteCode(identity, `BOB-${String(index)}`, bob);
        const {cookie} = await identity.issue(alice);

        // 导入的那个还能用的占一个名额，再生成 9 个就满。
        for (let index = 0; index < 9; index += 1) await generated(identity, cookie);
        expect(await outcome(await generate(identity, cookie))).toEqual({status: 409, body: {error: {code: "invite_code_limit"}}});

        const items = (await listed(identity, cookie)).items;
        expect(items).toHaveLength(13);
        expect(items.filter((item) => item.usable)).toHaveLength(10);
        expect(items.find((item) => item.id === imported)).toMatchObject({code: "OLD-LIVE", maxUses: 3, usedCount: 1, expiresAt: new Date(now + DAY_MS).toISOString(), usable: true});
        expect(items.filter((item) => item.code.startsWith("OLD-") && !item.usable).map((item) => item.code).sort()).toEqual(["OLD-DISABLED", "OLD-EXHAUSTED", "OLD-EXPIRED"]);

        expect((await disable(identity, cookie, imported)).status).toBe(200);
        await generated(identity, cookie);
        expect(await outcome(await generate(identity, cookie))).toEqual({status: 409, body: {error: {code: "invite_code_limit"}}});
    });

    it("并发的生成不越过上限：同时发 12 个，10 个成功、2 个 invite_code_limit，表里正好 10 个", async () => {
        identity = await createTestIdentity("identity-invite-concurrent");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        const responses = await Promise.all(Array.from({length: 12}, () => generate(identity!, cookie)));
        const statuses = responses.map((response) => response.status).sort();
        expect(statuses).toEqual([...Array.from({length: 10}, () => 200), 409, 409]);
        expect(await identity.conn.read((tx) => tx.query<{n: number}, [number]>(`SELECT count(*) AS n FROM identity_invite_code WHERE owner_id = ?`).get(alice)!.n)).toBe(10);
    });

    it("在同意门槛之内：缺同意时列表、生成、停用都得 consent_required，不生成也不停用", async () => {
        identity = await createTestIdentity("identity-invite-consent");
        const alice = await identity.addUser("alice", {consent: {termsVersion: "2020-01-01", overseasStorage: true}});
        const codeId = await addInviteCode(identity, "MINE", alice);
        const {cookie} = await identity.issue(alice);
        const required = {status: 403, body: {error: {code: "consent_required"}}};
        expect(await outcome(await identity.fetch("/me/invite-codes", {headers: {cookie}}))).toEqual(required);
        expect(await outcome(await generate(identity, cookie))).toEqual(required);
        expect(await outcome(await disable(identity, cookie, codeId))).toEqual(required);
        expect(await identity.conn.read((tx) => tx.query(`SELECT count(*) AS n, max(disabled_at) AS disabled FROM identity_invite_code`).get())).toEqual({n: 1, disabled: null});
    });
});

describe("停用（输出 18）", () => {
    it("停用自己的码：回停用后的码；再停用照样成功，停用时间保留第一次的", async () => {
        identity = await createTestIdentity("identity-invite-disable");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        const code = await generated(identity, cookie);
        const first = await disable(identity, cookie, code.id);
        const body = await first.json();
        expect({status: first.status, shape: Value.Check(InviteCodeItem, body), body}).toEqual({status: 200, shape: true, body: {...code, usable: false}});
        const disabledAt = () => identity!.conn.read((tx) => tx.query<{disabled_at: string}, [number]>(`SELECT disabled_at FROM identity_invite_code WHERE id = ?`).get(code.id)!.disabled_at);
        const firstAt = await disabledAt();
        identity.clock.advance(60_000);
        expect(await outcome(await disable(identity, cookie, code.id))).toEqual({status: 200, body: {...code, usable: false}});
        expect(await disabledAt()).toBe(firstAt);
    });

    it("别人的码与不存在的码：not_found，别人的码没被停用", async () => {
        identity = await createTestIdentity("identity-invite-disable-not-own");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const bob = await identity.addUser("bob", {consent: CONSENTED});
        const theirs = await addInviteCode(identity, "BOB-CODE", bob);
        const {cookie} = await identity.issue(alice);
        expect(await outcome(await disable(identity, cookie, theirs))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await outcome(await disable(identity, cookie, theirs + 100))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await identity.conn.read((tx) => tx.query(`SELECT disabled_at FROM identity_invite_code WHERE id = ?`).get(theirs))).toEqual({disabled_at: null});
    });

    it("只收 {disabled: true}：别的写法 validation_failed", async () => {
        identity = await createTestIdentity("identity-invite-disable-body");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        const code = await generated(identity, cookie);
        const cases: readonly (readonly [body: unknown, fields: readonly string[]])[] = [
            [{}, ["disabled"]],
            [{disabled: false}, ["disabled"]],
            [{disabled: true, note: "x"}, ["note"]],
        ];
        for (const [body, fields] of cases) expect({request: body, ...(await outcome(await disable(identity, cookie, code.id, body)))}).toEqual({request: body, status: 400, body: {error: {code: "validation_failed", fields}}});
        expect((await listed(identity, cookie)).items[0]!.usable).toBe(true);
    });
});

describe("用生成的码注册（输出 1 的邀请归属）", () => {
    it("列表里已用次数加 1、码照样能用；库里新账号的邀请码与邀请人是这个码与它的主人", async () => {
        identity = await createTestIdentity("identity-invite-register");
        const alice = await identity.addUser("alice", {consent: CONSENTED});
        const {cookie} = await identity.issue(alice);
        const code = await generated(identity, cookie);
        await identity.conn.write((tx) => tx.query(`INSERT INTO identity_registration_code (code, created_at) VALUES ('REG-CODE', ?)`).run(libDate(identity!.clock.now())));
        const response = await identity.fetch("/register", {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", [TEST_CLIENT_ADDRESS_HEADER]: "198.51.100.7"},
            body: JSON.stringify({username: "carol", email: "carol@example.com", password: "correct horse battery", registrationCode: "REG-CODE", inviteCode: code.code, termsVersion: TEST_TERMS_VERSION, overseasStorage: true}),
        });
        expect(response.status).toBe(200);
        const carol = ((await response.json()) as RegisterResponse).user.id;
        expect((await listed(identity, cookie)).items).toEqual([{...code, usedCount: 1}]);
        expect(await identity.conn.read((tx) => tx.query(`SELECT invite_code_id, inviter_id FROM identity_profile WHERE user_id = ?`).get(carol))).toEqual({invite_code_id: code.id, inviter_id: alice});
    });
});
