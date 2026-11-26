/**
 * 对外 OAuth 令牌与授权码的撤销，以及清理任务删过期的这两种行（w00037 t08 计划 3.5、3.11；`site.oauth-provider` 输出 8）。
 *
 * 撤令牌与删授权码的 SQL 只在这里（`architecture.test.ts` 守着），调用方是 `session.ts` 的“结束会话”一组函数、撤销授权与停用
 * 客户端。每个函数都在调用方的写事务里执行，与那次操作的其余写入一起提交或回滚：变更的响应返回时撤销已经生效（输出 8 下的
 * 时序一节），变更失败时令牌与码照旧有效。
 *
 * 为什么要自己撤：库的访问令牌记着发它时的会话，但令牌的 `sessionId` 外键是 `ON DELETE SET NULL`，库只在它不为空时查会话。
 * 直接删会话行之后令牌照用（第七轮探针问 2 实测），所以要在删会话之前、同一个事务里给令牌写上 `revoked`。删了以后再撤就按会话
 * 找不到它们了：按会话撤的调用方必须先撤后删。
 *
 * 依赖库的存法（包说明 `AGENTS.md` 升级清单“撤销”两行）：
 * - 令牌是 `oauthAccessToken` 的一行，`revoked` 不为空时库回 401；时间写成库的 ISO 文本（`libDate`），与库自己撤销时一样是时刻。
 * - 没用掉的授权码是 `verification` 的一行，`value` 是 JSON：`type` 为 `"authorization_code"`，`userId`、`sessionId` 是数字 id 的
 *   字符串，`query.client_id` 是客户端 id。删掉这一行，换码就得 `invalid_grant`。`verification` 里还有库别的行（社交登录的
 *   state 等），`value` 不一定是 JSON，所以先判 `json_valid`：放在 `CASE` 里，SQLite 不会对非 JSON 的值调 `json_extract` 而报错
 *   （`WHERE` 里 `AND` 两边的先后不保证，`CASE` 的保证）。
 */

import type {IdentityTx} from "../db/connection";
import {libDate} from "../db/library-rows";

/** 授权码 `value` 里的一个字段；不是 JSON 的行得 NULL，任何比较都不成立。 */
function codeField(path: string): string {
    return `CASE WHEN json_valid("value") THEN json_extract("value", '${path}') END`;
}

const IS_CODE = `${codeField("$.type")} = 'authorization_code'`;
const CODE_USER = `CAST(${codeField("$.userId")} AS INTEGER)`;
const CODE_SESSION = `CAST(${codeField("$.sessionId")} AS INTEGER)`;
const CODE_CLIENT = codeField("$.query.client_id");

/** 到期的会话：`expiresAt` 不晚于参数，与 `session.ts` 的 `purgeExpiredSessions` 同一个边界。 */
const EXPIRED_SESSIONS = `SELECT "id" FROM "session" WHERE "expiresAt" <= ?`;

/** 一次会话里发出的（登出、结束单个会话、会话到期时读出后当场删）。调用方先调它，再删这个会话。 */
export function revokeOAuthForSession(tx: IdentityTx, sessionId: number, nowMs: number): void {
    tx.query(`UPDATE "oauthAccessToken" SET "revoked" = ? WHERE "sessionId" = ? AND "revoked" IS NULL`).run(libDate(nowMs), sessionId);
    tx.query(`DELETE FROM "verification" WHERE ${IS_CODE} AND ${CODE_SESSION} = ?`).run(sessionId);
}

/**
 * 一个账号名下的全部（封禁、改角色、重置密码、结束全部会话、自己改密码）。按账号找，不经会话：自己改密码时当前会话保留，
 * 它里面发出的也要撤（开发者 2026-11-25 定 2）；会话删没删都找得到。
 */
export function revokeOAuthForUser(tx: IdentityTx, userId: number, nowMs: number): void {
    tx.query(`UPDATE "oauthAccessToken" SET "revoked" = ? WHERE "userId" = ? AND "revoked" IS NULL`).run(libDate(nowMs), userId);
    tx.query(`DELETE FROM "verification" WHERE ${IS_CODE} AND ${CODE_USER} = ?`).run(userId);
}

/** 一个账号在一个客户端名下的全部（撤销对这个客户端的授权）。 */
export function revokeOAuthForGrant(tx: IdentityTx, userId: number, clientId: string, nowMs: number): void {
    tx.query(`UPDATE "oauthAccessToken" SET "revoked" = ? WHERE "userId" = ? AND "clientId" = ? AND "revoked" IS NULL`).run(libDate(nowMs), userId, clientId);
    tx.query(`DELETE FROM "verification" WHERE ${IS_CODE} AND ${CODE_USER} = ? AND ${CODE_CLIENT} = ?`).run(userId, clientId);
}

/** 一个客户端名下的全部（停用客户端；之后再启用也不恢复，输出 8 末项）。 */
export function revokeOAuthForClient(tx: IdentityTx, clientId: string, nowMs: number): void {
    tx.query(`UPDATE "oauthAccessToken" SET "revoked" = ? WHERE "clientId" = ? AND "revoked" IS NULL`).run(libDate(nowMs), clientId);
    tx.query(`DELETE FROM "verification" WHERE ${IS_CODE} AND ${CODE_CLIENT} = ?`).run(clientId);
}

/**
 * 到期的会话里发出的（清理任务）。会话到期没有响应，令牌至迟在这一次清理之后失效（输出 8 下的时序一节）；调用方先调它，再删
 * 到期的会话。
 */
export function revokeOAuthForExpiredSessions(tx: IdentityTx, nowMs: number): void {
    const at = libDate(nowMs);
    tx.query(`UPDATE "oauthAccessToken" SET "revoked" = ? WHERE "sessionId" IN (${EXPIRED_SESSIONS}) AND "revoked" IS NULL`).run(at, at);
    tx.query(`DELETE FROM "verification" WHERE ${IS_CODE} AND ${CODE_SESSION} IN (${EXPIRED_SESSIONS})`).run(at);
}

/**
 * 清理任务删过期的行（计划 3.11）：`verification` 里到期的（过期的授权码与库的别的一次性凭据，例如社交登录的 state）与过期的
 * 访问令牌。过期的行库自己也不认，删掉只是不让表一直长下去。
 *
 * 这几行的到期时刻是库按系统时间写的，库认不认它们也按系统时间判；这里按模块的时钟比。生产里两只钟相同。测试里模块的时钟可快
 * 可慢，与系统时间差任意方向：快时（`advance` 过了 10 分钟）这里删掉库还认的授权码与社交 state，码与 state 提前消失；慢时（起点
 * 拨到过去，或不拨、墙钟照走）库已不认的行留到模块的时钟追上。拨时钟的用例要按这两种情况推断清理之后表里剩什么。
 *
 * 另删 `sessionId` 为空的访问令牌，不论到没到期：本模块只发授权码流程的令牌，每个都带会话，自家删会话前先撤令牌，所以这种行
 * 只来自别的写方删了会话（外键 `ON DELETE SET NULL`），例如换回上一个版本期间那个版本的登出（`site.oauth-provider` 时序一节）。
 * 库对这种令牌不再查会话，不删就一直可用到过期。
 */
export function purgeExpiredOAuthRows(tx: IdentityTx, nowMs: number): {readonly verifications: number; readonly accessTokens: number} {
    const at = libDate(nowMs);
    const verifications = tx.query(`DELETE FROM "verification" WHERE "expiresAt" <= ?`).run(at).changes;
    const accessTokens = tx.query(`DELETE FROM "oauthAccessToken" WHERE "expiresAt" <= ? OR "sessionId" IS NULL`).run(at).changes;
    return {verifications, accessTokens};
}
