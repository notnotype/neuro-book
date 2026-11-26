/**
 * 签 id_token 的钥匙在启动时备好（`site.oauth-provider` 输出 11、17；计划 3.4“签名钥在启动时备好”、第 10 节第 3 条）。`module.ts`
 * 在库的结构检查之后调 `prepareSigningKey`，失败时启动失败，入口按 `start_failed` 收口。
 *
 * 三件事：
 * - `jwks` 表里有不是 RS256 的钥匙就拒绝启动。库挑签名钥时先找配置的算法，找不到就退回“最新的任意一把”（`resolveSigningKey`
 *   的回退），表里混进别的算法的钥匙时，客户端按发现文档的 RS256 验签会失败（第六轮问 2）。`alg` 为空的行库当作配置的算法，
 *   但它的钥匙材料不一定是 RS256，同样拒绝：库 1.7.27 建钥时总写 `alg`。
 * - 没有活钥时现在就建一把。放在启动时，第一次签发时两个并发请求不会各建一把（计划第 9 节 P10）。
 * - 最新的活钥解不开（`NB_SITE_SESSION_SECRET` 换过：库用它加密私钥）时，把它标成刚刚过期、再建一把新的，记一行 warn。不这样
 *   做时库每次签发都解不开、令牌端点 500，对外 OAuth 整个不可用（问 12）。标过期而不删：库在宽限期（`jwks.gracePeriod` 缺省
 *   30 天）里仍把过期钥的公钥列在公钥地址里，重启前签发、还没到期（1 小时）的 id_token 照样验得过；过期钥库不再拿来签。
 *
 * 判“活”与“最新”的口径照库挑签名钥的口径（`getLatestKeyByAlg`）：`expiresAt` 为空或晚于此刻、`createdAt` 最新。此刻取系统
 * 时间，不取模块的时钟：库判钥匙过期用的是系统时间，两边口径不同时这里认为的“最新活钥”就不是库签发时挑的那一把。
 * 依赖的库行为对着升级清单“签名钥”几行。
 */

import type {GenericEndpointContext} from "@better-auth/core";
import {symmetricDecrypt} from "better-auth/crypto";
import {createJwk, type JwtOptions} from "better-auth/plugins";

import type {IdentityAuth} from "../auth";
import type {IdentityConnection} from "../db/connection";
import {libDate, libDateMs} from "../db/library-rows";
import type {IdentityLog} from "../index";

/** 签名钥的算法：发现文档与 Spec 输出 11 只写 RS256。 */
export const SIGNING_ALG = "RS256";

/** `jwks` 表里有不是 RS256 的钥匙（含 `alg` 为空的行）：拒绝启动，要部署的人查清这把钥匙从哪来。 */
export class IdentitySigningKeyError extends Error {
    override readonly name = "IdentitySigningKeyError";

    constructor(
        readonly reason: "unsupported_algorithm",
        readonly kid: string,
    ) {
        super(`the identity database holds a signing key (kid ${kid}) whose algorithm is not ${SIGNING_ALG}`);
    }
}

export interface SigningKeyInput {
    readonly context: Awaited<IdentityAuth["$context"]>;
    readonly conn: IdentityConnection;
    /** 交给库的 jwt 插件的同一份选项（`auth.ts` 的 `identityJwtOptions`）：新钥匙的算法与长度由它定。 */
    readonly jwtOptions: JwtOptions;
    readonly log: Pick<IdentityLog, "warn">;
}

interface KeyRow {
    readonly id: number;
    readonly alg: string | null;
    readonly privateKey: string;
    readonly createdAt: string;
    readonly expiresAt: string | null;
}

export async function prepareSigningKey(input: SigningKeyInput): Promise<void> {
    const {context, conn, jwtOptions, log} = input;
    const rows = await conn.read((tx) => tx.query<KeyRow, []>(`SELECT "id", "alg", "privateKey", "createdAt", "expiresAt" FROM "jwks"`).all());
    const foreign = rows.find((row) => row.alg !== SIGNING_ALG);
    if (foreign !== undefined) throw new IdentitySigningKeyError("unsupported_algorithm", String(foreign.id));

    const now = Date.now();
    const newest = rows
        .filter((row) => row.expiresAt === null || libDateMs(row.expiresAt) > now)
        .sort((left, right) => libDateMs(right.createdAt) - libDateMs(left.createdAt))
        .at(0);
    // createJwk 只用端点上下文里的 `context`（`secretConfig` 加密私钥、`adapter` 写行），启动时没有请求，只给它这一项。
    const mint = () => createJwk({context} as GenericEndpointContext, jwtOptions);
    if (newest === undefined) {
        await mint();
        return;
    }
    if (await decrypts(context.secretConfig, newest.privateKey)) return;

    // 先标过期、再建新钥，两步之间崩溃时表里没有活钥，下次启动走上面“没有活钥”那条路。建钥要生成 RSA 钥匙对，不放进写事务里占着队列。
    await conn.write((tx) => tx.query(`UPDATE "jwks" SET "expiresAt" = ? WHERE "id" = ?`).run(libDate(now - 1), newest.id));
    const fresh = await mint();
    log.warn("identity.signing_key_rotated", "the newest signing key could not be decrypted with the current session secret; it was expired and a new key was created", {
        oldKid: String(newest.id),
        newKid: String(fresh.id),
    });
}

/**
 * 用库上下文的 `secretConfig` 试解私钥，照库签发时的解法（`JSON.parse` 之后交 `symmetricDecrypt`）。存的不是 JSON 时 `JSON.parse`
 * 抛出、启动失败：那是数据被别的写法改过，不是换了密钥。`symmetricDecrypt` 抛出时一律当作解不开：它对密钥不对与密文损坏抛的是
 * 同一种错误，分不开；两种情况下这把钥匙都签不了名，换一把新的是同一个处理。
 */
async function decrypts(secretConfig: SigningKeyInput["context"]["secretConfig"], stored: string): Promise<boolean> {
    const data: unknown = JSON.parse(stored);
    if (typeof data !== "string") throw new TypeError("a stored signing key is not an encrypted envelope");
    try {
        await symmetricDecrypt({key: secretConfig, data});
        return true;
    } catch {
        // 不吞：调用方据此标过期并记 warn `identity.signing_key_rotated`。
        return false;
    }
}
