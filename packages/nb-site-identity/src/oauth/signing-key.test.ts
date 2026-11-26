/**
 * 签名钥的启动检查（`signing-key.ts`；`site.oauth-provider` 输出 11、17）。重启在同一个数据目录上重新组装模块；换会话密钥就是
 * 重启时给另一个 `sessionSecret`。签发与验签都经真实的库：授权、换码拿 id_token，用公钥地址列出的公钥验。
 */

import {afterEach, describe, expect, it} from "bun:test";

import type {GenericEndpointContext} from "@better-auth/core";
import {createJwk} from "better-auth/plugins";

import {IdentityConnection} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import {createTestIdentity, type TestIdentity} from "../testing/module";
import {TEST_SITE_URL} from "../testing/library";
import {CONSENTED, decodeJwt, grantTokens, publicKeys, registerClient, verifiesWith, type TestClient} from "../testing/oauth";
import {IdentitySigningKeyError} from "./signing-key";

const OTHER_SECRET = "nb-site-identity-another-secret-fedcba9876543210";

let first: TestIdentity | undefined;
const opened: TestIdentity[] = [];

afterEach(async () => {
    for (const identity of opened.splice(0)) await identity.assembly.close();
    await first?.root.cleanup();
    first = undefined;
});

async function start(options: {readonly sessionSecret?: string} = {}): Promise<TestIdentity> {
    const identity = await createTestIdentity("signing-key", {
        ...(first === undefined ? {} : {root: first.root}),
        ...(options.sessionSecret === undefined ? {} : {config: {sessionSecret: options.sessionSecret}}),
    });
    first ??= identity;
    opened.push(identity);
    return identity;
}

/** 关掉 `identity`，在同一个数据目录上再起一个。 */
async function restart(identity: TestIdentity, options: {readonly sessionSecret?: string} = {}): Promise<TestIdentity> {
    opened.splice(opened.indexOf(identity), 1);
    await identity.assembly.close();
    return start(options);
}

interface KeyRow {
    readonly id: number;
    readonly alg: string | null;
    readonly expiresAt: string | null;
}

function keyRows(identity: TestIdentity): Promise<KeyRow[]> {
    return identity.conn.read((tx) => tx.query<KeyRow, []>(`SELECT "id", "alg", "expiresAt" FROM "jwks" ORDER BY "id"`).all());
}

/** 一个有同意记录的用户在 `identity` 上拿一张 id_token。 */
async function idToken(identity: TestIdentity, client: TestClient, userId: number): Promise<string> {
    const {cookie} = await identity.issue(userId);
    return (await grantTokens(identity, cookie, client)).id_token;
}

describe("启动时备好签名钥", () => {
    it("第一次启动后恰有一把 RS256 钥，id_token 用它签、签发者是站点地址；重启后还是这一把", async () => {
        const identity = await start();
        const rows = await keyRows(identity);
        expect(rows.map(({alg, expiresAt}) => ({alg, expiresAt}))).toEqual([{alg: "RS256", expiresAt: null}]);
        const kid = String(rows[0]!.id);
        const keys = await publicKeys(identity);
        expect(keys.map(({kid, kty, alg}) => ({kid, kty, alg}))).toEqual([{kid, kty: "RSA", alg: "RS256"}]);

        const client = await registerClient(identity);
        const userId = await identity.addUser("alice", CONSENTED);
        const token = await idToken(identity, client, userId);
        const {header, payload} = decodeJwt(token);
        expect({alg: header.alg, kid: header.kid, iss: payload.iss}).toEqual({alg: "RS256", kid, iss: TEST_SITE_URL});
        expect(verifiesWith(token, keys)).toBe(true);

        const again = await restart(identity);
        expect(await keyRows(again)).toEqual(rows);
        expect(decodeJwt(await idToken(again, client, userId)).header.kid).toBe(kid);
        expect(again.log.lines.filter((line) => line.event === "identity.signing_key_rotated")).toEqual([]);
    });

    it("私钥加密存放：库文件里那一列读不出 JWK，也不含公钥的模数（副作用与数据）", async () => {
        const identity = await start();
        const [publicKey] = await publicKeys(identity);
        // 从库文件另开一条连接读：看的是落在盘上的样子。
        const stored = first!.root.openOther().query<{privateKey: string}, []>(`SELECT "privateKey" FROM "jwks"`).all();
        expect(stored).toHaveLength(1);
        const text = stored[0]!.privateKey;
        // 明文的 RSA 私钥 JWK 带着与公钥相同的 n，另有私钥的 d；加密之后两样都看不到。
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            // 不是 JSON 也是“不是明文 JWK”。
        }
        const asJwk = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
        expect({hasD: "d" in asJwk, hasKty: "kty" in asJwk, containsModulus: text.includes(String(publicKey!.n))}).toEqual({hasD: false, hasKty: false, containsModulus: false});
    });

    it("表里有一把别的算法的钥匙时启动失败，表不变", async () => {
        const identity = await start();
        // 照库自己建钥的路子放进一把 EdDSA 钥（库只配 EdDSA 时就是这样建的）。它比 RS256 那把新：不拒绝时库挑签名钥退回“最新的
        // 任意一把”，拿它签。
        const context = await identity.assembly.auth.$context;
        await createJwk({context} as GenericEndpointContext, {jwks: {keyPairConfig: {alg: "EdDSA"}}});
        const rows = await keyRows(identity);
        expect(rows.map((row) => row.alg)).toEqual(["RS256", "EdDSA"]);

        opened.splice(opened.indexOf(identity), 1);
        await identity.assembly.close();
        const failure = await start().then(
            () => null,
            (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(IdentitySigningKeyError);
        expect(failure).toMatchObject({reason: "unsupported_algorithm", kid: String(rows[1]!.id)});
        const conn = new IdentityConnection(first!.root.openOther(), {log: first!.log});
        try {
            expect(await conn.read((tx) => tx.query<KeyRow, []>(`SELECT "id", "alg", "expiresAt" FROM "jwks" ORDER BY "id"`).all())).toEqual(rows);
        } finally {
            await conn.close(0);
        }
    });

    it("换了会话密钥后启动：旧钥标成过期、新钥签发，公钥地址同时列两把，换之前签的 id_token 仍验得过；再重启不再换", async () => {
        const identity = await start();
        const client = await registerClient(identity);
        const userId = await identity.addUser("alice", CONSENTED);
        const before = await idToken(identity, client, userId);
        const oldKid = decodeJwt(before).header.kid as string;

        const rotated = await restart(identity, {sessionSecret: OTHER_SECRET});
        const rows = await keyRows(rotated);
        expect(rows.map((row) => String(row.id))[0]).toBe(oldKid);
        expect(rows.length).toBe(2);
        const [old, fresh] = rows as [KeyRow, KeyRow];
        expect(old.expiresAt).not.toBeNull();
        expect(libDateMs(old.expiresAt!)).toBeLessThanOrEqual(Date.now());
        expect({alg: fresh.alg, expiresAt: fresh.expiresAt}).toEqual({alg: "RS256", expiresAt: null});
        const newKid = String(fresh.id);
        expect(rotated.log.lines.filter((line) => line.event === "identity.signing_key_rotated")).toEqual([{level: "warn", event: "identity.signing_key_rotated", fields: {oldKid, newKid}}]);

        const after = await idToken(rotated, client, userId);
        expect(decodeJwt(after).header.kid).toBe(newKid);
        const keys = await publicKeys(rotated);
        expect(keys.map((key) => key.kid).sort()).toEqual([oldKid, newKid].sort());
        expect(verifiesWith(before, keys)).toBe(true);
        expect(verifiesWith(after, keys)).toBe(true);

        const again = await restart(rotated, {sessionSecret: OTHER_SECRET});
        expect(await keyRows(again)).toEqual(rows);
        expect(decodeJwt(await idToken(again, client, userId)).header.kid).toBe(newKid);
        expect(again.log.lines.filter((line) => line.event === "identity.signing_key_rotated")).toEqual([]);
    });

    it("换下来的公钥在过期后 30 天内仍列在公钥地址里，过了 30 天不再列（输出 17）", async () => {
        const rotated = await restart(await start(), {sessionSecret: OTHER_SECRET});
        const [old, fresh] = (await keyRows(rotated)) as [KeyRow, KeyRow];
        // 库按系统时间判宽限期，所以过期时刻按系统时间往回拨；29 天与 31 天离边界各一天，用例跑多久都分得开。
        const expireAgo = (days: number) =>
            rotated.conn.write((tx) => tx.query(`UPDATE "jwks" SET "expiresAt" = ? WHERE "id" = ?`).run(libDate(Date.now() - days * 86_400_000), old.id));
        const listed = async () => (await publicKeys(rotated)).map((key) => key.kid).sort();
        await expireAgo(29);
        expect(await listed()).toEqual([String(old.id), String(fresh.id)].sort());
        await expireAgo(31);
        expect(await listed()).toEqual([String(fresh.id)]);
    });
});
