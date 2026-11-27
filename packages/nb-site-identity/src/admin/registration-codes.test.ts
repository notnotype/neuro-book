/**
 * 注册码的管理接口（`admin/registration-codes.ts`、`operator.ts`、`pagination.ts`；`site.admin` 输出 1、7 到 10）。
 *
 * 合同测试（`nb-site-contract-tests` 的 `admin.test.ts`）覆盖经 HTTP 看得到的部分：发放、停用后不能注册、列表的字段、筛选与
 * `counts`、翻页、审计的记录。这里测合同里造不出的（计划第 6 节的“位置”一列）：
 * - 审计与操作同时生效：要让写审计那一步失败，在审计表上临时加一个拒绝插入的触发器。
 * - 处置的写事务复核操作者：要在“中间件认过身份”与“写事务”之间降级、封禁操作者或结束他的会话。这里直接用 SQL 改，
 *   不经角色与封禁的接口；时机靠一个慢慢到的请求体：处理函数先认身份、再读请求体，读请求体时才向流要数据（`highWaterMark: 0`），
 *   流被要数据的那一刻中间件已经认过身份，写事务还没开始。
 */

import {afterEach, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {RegistrationCodeItem, RegistrationCodeListResponse} from "@notnotype/nb-site-identity-contract";

import {libDate} from "../db/library-rows";
import {endAllSessions} from "../session";
import {TEST_SITE_URL} from "../testing/library";
import {createTestIdentity, TEST_TERMS_VERSION, type TestIdentity} from "../testing/module";

let identity: TestIdentity | undefined;

afterEach(async () => {
    await identity?.root.cleanup();
    identity = undefined;
});

const CONSENTED = {termsVersion: TEST_TERMS_VERSION, overseasStorage: true} as const;
const CODES = "/admin/registration-codes";

async function outcome(response: Response): Promise<{readonly status: number; readonly body: unknown}> {
    return {status: response.status, body: await response.json()};
}

/** 一个管理员与他的会话。 */
async function admin(target: TestIdentity, username = "root"): Promise<{readonly userId: number; readonly cookie: string; readonly sessionId: number}> {
    const userId = await target.addUser(username, {role: "admin", consent: CONSENTED});
    const {cookie, sessionId} = await target.issue(userId);
    return {userId, cookie, sessionId};
}

function send(target: TestIdentity, cookie: string, method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
    return target.fetch(path, {method, headers: {origin: TEST_SITE_URL, "content-type": "application/json", cookie}, body: JSON.stringify(body)});
}

function list(target: TestIdentity, cookie: string, query = ""): Promise<Response> {
    return target.fetch(`${CODES}${query}`, {headers: {cookie}});
}

async function create(target: TestIdentity, cookie: string, body: unknown = {maxUses: null}): Promise<RegistrationCodeItem> {
    const response = await send(target, cookie, "POST", CODES, body);
    expect(response.status).toBe(200);
    const item = await response.json();
    expect(Value.Check(RegistrationCodeItem, item)).toBe(true);
    return item as RegistrationCodeItem;
}

function auditRows(target: TestIdentity): Promise<unknown[]> {
    return target.conn.read((tx) => tx.query(`SELECT actor_id, action, target_type, target_id, params FROM identity_audit ORDER BY id`).all());
}

function codeCount(target: TestIdentity): Promise<number> {
    return target.conn.read((tx) => tx.query<{n: number}, []>(`SELECT COUNT(*) AS n FROM identity_registration_code`).get()!.n);
}

/**
 * 慢慢到的请求体：处理函数第一次读它时 `requested` resolve，`deliver` 之后才给出内容。带 `content-length`：没有它时请求体上限
 * 的中间件会先把整个体读完，处理函数还没认身份就向流要了数据。
 */
function slowBody(body: unknown): {readonly stream: ReadableStream<Uint8Array>; readonly length: number; readonly requested: Promise<void>; deliver(): void} {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const requested = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    const stream = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                requested.resolve();
                await delivered.promise;
                controller.enqueue(bytes);
                controller.close();
            },
        },
        {highWaterMark: 0},
    );
    return {stream, length: bytes.byteLength, requested: requested.promise, deliver: () => delivered.resolve()};
}

describe("发放（输出 7、8）", () => {
    it("码是 16 个字符的 Crockford base32、每次不同；回的条目有可用次数、过期时间、备注与发放人；审计记可用次数与过期时间，不记码与备注", async () => {
        identity = await createTestIdentity("identity-admin-codes-create");
        const root = await admin(identity);
        const expiresAt = libDate(identity.clock.now() + 86_400_000);
        const first = await create(identity, root.cookie, {maxUses: 5, expiresAt, note: "for the beta group"});
        const second = await create(identity, root.cookie);
        expect(first.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/u);
        expect(second.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/u);
        expect(first.code).not.toBe(second.code);
        expect(first).toEqual({
            id: first.id,
            code: first.code,
            maxUses: 5,
            usedCount: 0,
            expiresAt,
            note: "for the beta group",
            disabled: false,
            usable: true,
            createdAt: libDate(identity.clock.now()),
            createdBy: {id: root.userId, username: "root"},
        });
        expect(await auditRows(identity)).toEqual([
            {actor_id: root.userId, action: "registration_code.create", target_type: "registration_code", target_id: first.id, params: JSON.stringify({maxUses: 5, expiresAt})},
            {actor_id: root.userId, action: "registration_code.create", target_type: "registration_code", target_id: second.id, params: JSON.stringify({maxUses: null, expiresAt: null})},
        ]);
    });

    it("过期时间合写法却不是真实存在的时刻：validation_failed、fields 是 expiresAt；没有码、没有审计", async () => {
        identity = await createTestIdentity("identity-admin-codes-bad-expiry");
        const root = await admin(identity);
        expect(await outcome(await send(identity, root.cookie, "POST", CODES, {maxUses: 1, expiresAt: "2026-02-30T00:00:00.000Z"}))).toEqual({
            status: 400,
            body: {error: {code: "validation_failed", fields: ["expiresAt"]}},
        });
        expect({codes: await codeCount(identity), audit: await auditRows(identity)}).toEqual({codes: 0, audit: []});
    });

    it("写审计失败时发放不生效：回 500，表里没有这个码", async () => {
        identity = await createTestIdentity("identity-admin-codes-audit-fails");
        const root = await admin(identity);
        await identity.conn.write((tx) => tx.query(`CREATE TRIGGER reject_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
        expect(await outcome(await send(identity, root.cookie, "POST", CODES, {maxUses: 1}))).toEqual({status: 500, body: {error: {code: "internal"}}});
        expect(await codeCount(identity)).toBe(0);
    });
});

describe("改备注与停用（输出 7、8）", () => {
    it("只改备注不写审计；停用写一条、参数为空；已停用的再停用照样成功、照样写，停用时间不变", async () => {
        identity = await createTestIdentity("identity-admin-codes-patch");
        const root = await admin(identity);
        const item = await create(identity, root.cookie, {maxUses: 2});
        const path = `${CODES}/${String(item.id)}`;
        const noted = await outcome(await send(identity, root.cookie, "PATCH", path, {note: "renamed"}));
        expect(noted).toEqual({status: 200, body: {...item, note: "renamed"}});
        expect(await outcome(await send(identity, root.cookie, "PATCH", path, {note: null}))).toEqual({status: 200, body: {...item, note: null}});
        expect((await auditRows(identity)).length).toBe(1);

        const disabled = await outcome(await send(identity, root.cookie, "PATCH", path, {disabled: true}));
        expect(disabled).toEqual({status: 200, body: {...item, disabled: true, usable: false}});
        const disabledAt = await identity.conn.read((tx) => tx.query<{disabled_at: string}, [number]>(`SELECT disabled_at FROM identity_registration_code WHERE id = ?`).get(item.id)!.disabled_at);
        identity.clock.advance(60_000);
        expect((await send(identity, root.cookie, "PATCH", path, {disabled: true, note: "closed"})).status).toBe(200);
        expect(await identity.conn.read((tx) => tx.query(`SELECT disabled_at, note FROM identity_registration_code WHERE id = ?`).get(item.id))).toEqual({disabled_at: disabledAt, note: "closed"});
        const disables = {actor_id: root.userId, action: "registration_code.disable", target_type: "registration_code", target_id: item.id, params: "{}"};
        expect((await auditRows(identity)).slice(1)).toEqual([disables, disables]);
    });

    it("写审计失败时停用不生效：回 500，码仍可用", async () => {
        identity = await createTestIdentity("identity-admin-codes-disable-audit-fails");
        const root = await admin(identity);
        const item = await create(identity, root.cookie);
        await identity.conn.write((tx) => tx.query(`CREATE TRIGGER reject_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT, 'rejected by test'); END`).run());
        expect(await outcome(await send(identity, root.cookie, "PATCH", `${CODES}/${String(item.id)}`, {disabled: true, note: "x"}))).toEqual({status: 500, body: {error: {code: "internal"}}});
        expect(await identity.conn.read((tx) => tx.query(`SELECT disabled_at, note FROM identity_registration_code WHERE id = ?`).get(item.id))).toEqual({disabled_at: null, note: null});
    });

    it("没有这个码：not_found；id 不合写法：validation_failed、fields 是 id；空对象：validation_failed、fields 为空", async () => {
        identity = await createTestIdentity("identity-admin-codes-patch-invalid");
        const root = await admin(identity);
        expect(await outcome(await send(identity, root.cookie, "PATCH", `${CODES}/99`, {disabled: true}))).toEqual({status: 404, body: {error: {code: "not_found"}}});
        expect(await outcome(await send(identity, root.cookie, "PATCH", `${CODES}/0`, {disabled: true}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: ["id"]}}});
        expect(await outcome(await send(identity, root.cookie, "PATCH", `${CODES}/1`, {}))).toEqual({status: 400, body: {error: {code: "validation_failed", fields: []}}});
        expect(await auditRows(identity)).toEqual([]);
    });
});

describe("处置的写事务复核操作者（设计审查第 5 条）", () => {
    const changes = [
        {name: "被降级", apply: "UPDATE \"user\" SET \"role\" = 'user' WHERE \"id\" = ?"},
        {name: "被封禁", apply: 'UPDATE "user" SET "banned" = 1 WHERE "id" = ?'},
        {name: "会话被结束", apply: undefined},
    ] as const;
    const actions = [
        {name: "发放", method: "POST", path: () => CODES, body: {maxUses: 1}},
        {name: "停用", method: "PATCH", path: (id: number) => `${CODES}/${String(id)}`, body: {disabled: true}},
        {name: "改备注", method: "PATCH", path: (id: number) => `${CODES}/${String(id)}`, body: {note: "late"}},
    ] as const;

    for (const change of changes) {
        for (const action of actions) {
            it(`中间件认过身份之后操作者${change.name}：${action.name}得 unauthenticated，表与审计都没变`, async () => {
                identity = await createTestIdentity(`identity-admin-codes-operator-${String(changes.indexOf(change))}-${String(actions.indexOf(action))}`);
                const target = identity;
                const root = await admin(target);
                const existing = await create(target, root.cookie);
                const before = await target.conn.read((tx) => ({codes: tx.query(`SELECT * FROM identity_registration_code`).all(), audit: tx.query(`SELECT * FROM identity_audit`).all()}));

                const body = slowBody(action.body);
                const response = target.fetch(action.path(existing.id), {
                    method: action.method,
                    headers: {origin: TEST_SITE_URL, "content-type": "application/json", "content-length": String(body.length), cookie: root.cookie},
                    body: body.stream,
                    duplex: "half",
                } as RequestInit);
                await body.requested;
                await target.conn.write((tx) => {
                    if (change.apply === undefined) endAllSessions(tx, root.userId, target.clock.now());
                    else tx.query(change.apply).run(root.userId);
                });
                body.deliver();

                expect(await outcome(await response)).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
                expect(await target.conn.read((tx) => ({codes: tx.query(`SELECT * FROM identity_registration_code`).all(), audit: tx.query(`SELECT * FROM identity_audit`).all()}))).toEqual(before);
            });
        }
    }

    it("对照：操作者在同一时机没有变化时，同一个慢请求体的处置照常成功", async () => {
        identity = await createTestIdentity("identity-admin-codes-operator-control");
        const root = await admin(identity);
        const body = slowBody({maxUses: 1});
        const response = identity.fetch(CODES, {
            method: "POST",
            headers: {origin: TEST_SITE_URL, "content-type": "application/json", "content-length": String(body.length), cookie: root.cookie},
            body: body.stream,
            duplex: "half",
        } as RequestInit);
        await body.requested;
        body.deliver();
        expect((await response).status).toBe(200);
    });
});

describe("权限（输出 1）", () => {
    it("普通用户：三个接口都是 forbidden，没有审计；没有会话：unauthenticated", async () => {
        identity = await createTestIdentity("identity-admin-codes-forbidden");
        const userId = await identity.addUser("plain", {consent: CONSENTED});
        const {cookie} = await identity.issue(userId);
        const forbidden = {status: 403, body: {error: {code: "forbidden"}}};
        expect(await outcome(await list(identity, cookie))).toEqual(forbidden);
        expect(await outcome(await send(identity, cookie, "POST", CODES, {maxUses: 1}))).toEqual(forbidden);
        expect(await outcome(await send(identity, cookie, "PATCH", `${CODES}/1`, {disabled: true}))).toEqual(forbidden);
        expect(await outcome(await list(identity, ""))).toEqual({status: 401, body: {error: {code: "unauthenticated"}}});
        expect(await auditRows(identity)).toEqual([]);
    });
});

describe("列表（输出 9、10）", () => {
    async function page(target: TestIdentity, cookie: string, query: string): Promise<RegistrationCodeListResponse> {
        const response = await list(target, cookie, query);
        const body = await response.json();
        expect({status: response.status, valid: Value.Check(RegistrationCodeListResponse, body)}).toEqual({status: 200, valid: true});
        return body as RegistrationCodeListResponse;
    }

    it("建立时间倒序、同一时刻按 id 倒序；带着 anchor 翻页时之后新增的不进 items、total 与 counts，不带时新的排最前", async () => {
        identity = await createTestIdentity("identity-admin-codes-paging");
        const root = await admin(identity);
        const ids: number[] = [];
        for (let index = 0; index < 5; index += 1) {
            ids.push((await create(identity, root.cookie)).id);
            // 每两个拨一下钟：同一时刻的两个按 id 倒序，跨时刻的按时间倒序。
            if (index % 2 === 1) identity.clock.advance(1000);
        }
        const first = await page(identity, root.cookie, "?pageSize=2");
        expect({ids: first.items.map((item) => item.id), total: first.total, anchor: first.anchor}).toEqual({ids: [ids[4], ids[3]], total: 5, anchor: `rc${String(ids[4])}`});

        const added = await create(identity, root.cookie);
        const second = await page(identity, root.cookie, `?pageSize=2&page=2&anchor=${first.anchor}`);
        expect({ids: second.items.map((item) => item.id), total: second.total, counts: second.counts.all, anchor: second.anchor}).toEqual({ids: [ids[2], ids[1]], total: 5, counts: 5, anchor: first.anchor});

        const fresh = await page(identity, root.cookie, "?pageSize=2");
        expect({ids: fresh.items.map((item) => item.id), total: fresh.total}).toEqual({ids: [added.id, ids[4]], total: 6});
    });

    it("page 越界时 items 为空、total 照给；空列表给出的 anchor 能带回来翻页", async () => {
        identity = await createTestIdentity("identity-admin-codes-empty");
        const root = await admin(identity);
        const empty = await page(identity, root.cookie, "");
        expect(empty).toEqual({items: [], total: 0, page: 1, pageSize: 20, anchor: "rc0", counts: {all: 0, usable: 0, exhausted_or_expired: 0, disabled: 0}});
        await create(identity, root.cookie);
        expect(await page(identity, root.cookie, "?anchor=rc0")).toMatchObject({items: [], total: 0, anchor: "rc0"});
        expect(await page(identity, root.cookie, "?page=2")).toMatchObject({items: [], total: 1, page: 2});
        // 至多 15 位的页码乘上每页 100 条超过安全整数；越界一样只回空页。
        expect(await page(identity, root.cookie, "?page=999999999999999&pageSize=100")).toMatchObject({items: [], total: 1, page: 999999999999999, pageSize: 100});
    });

    it("参数不合规则：validation_failed，fields 是那几个键", async () => {
        identity = await createTestIdentity("identity-admin-codes-query-invalid");
        const root = await admin(identity);
        await create(identity, root.cookie);
        const invalid = (fields: string[]) => ({status: 400, body: {error: {code: "validation_failed", fields}}});
        const cases = [
            ["?page=0", ["page"]],
            ["?pageSize=101", ["pageSize"]],
            ["?pageSize=0", ["pageSize"]],
            ["?anchor=u1", ["anchor"]],
            ["?anchor=rc2", ["anchor"]],
            ["?anchor=rc01", ["anchor"]],
            ["?filter=expired", ["filter"]],
            ["?page=1&page=2", ["page"]],
            ["?q=a", ["q"]],
            // 普通对象上 `__proto__` 会被原型的 setter 吞掉（omp 实现审查第 4 条）。
            ["?__proto__=a", ["__proto__"]],
            ["?__proto__=a&__proto__=b", ["__proto__"]],
        ] as const;
        for (const [query, fields] of cases) {
            expect({query, ...(await outcome(await list(identity, root.cookie, query)))}).toEqual({query, ...invalid([...fields])});
        }
    });

    it("筛选项是一个划分：可用、用完或过期、已停用；counts 各数各的，total 是当前筛选项的条数", async () => {
        identity = await createTestIdentity("identity-admin-codes-filters");
        const root = await admin(identity);
        const now = identity.clock.now();
        const usable = await create(identity, root.cookie, {maxUses: 2});
        const expiring = await create(identity, root.cookie, {maxUses: null, expiresAt: libDate(now + 60_000)});
        const exhausted = await create(identity, root.cookie, {maxUses: 1});
        await identity.conn.write((tx) => tx.query(`UPDATE identity_registration_code SET used_count = 1 WHERE id = ?`).run(exhausted.id));
        const disabled = await create(identity, root.cookie, {maxUses: 1});
        expect((await send(identity, root.cookie, "PATCH", `${CODES}/${String(disabled.id)}`, {disabled: true})).status).toBe(200);
        // 拨过过期时间：同一个码从“可用”移到“用完或过期”，不用改表。
        identity.clock.advance(60_000);

        const ids = async (filter: string) => (await page(identity!, root.cookie, `?filter=${filter}`)).items.map((item) => item.id);
        const all = await page(identity, root.cookie, "");
        expect(all.counts).toEqual({all: 4, usable: 1, exhausted_or_expired: 2, disabled: 1});
        expect(all.items.map((item) => ({id: item.id, usable: item.usable, usedCount: item.usedCount}))).toEqual([
            {id: disabled.id, usable: false, usedCount: 0},
            {id: exhausted.id, usable: false, usedCount: 1},
            {id: expiring.id, usable: false, usedCount: 0},
            {id: usable.id, usable: true, usedCount: 0},
        ]);
        expect({usable: await ids("usable"), gone: await ids("exhausted_or_expired"), disabled: await ids("disabled")}).toEqual({
            usable: [usable.id],
            gone: [exhausted.id, expiring.id],
            disabled: [disabled.id],
        });
        expect((await page(identity, root.cookie, "?filter=exhausted_or_expired")).total).toBe(2);
    });
});
