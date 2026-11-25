/**
 * 关联时认下一个上游身份（w00037 t08 计划 3.10 的 `claimUpstreamName`；`site.accounts` 输出 15、24，时序一节“同一个身份并发关联”）。
 *
 * “一个账号在一个上游至多一个身份”“一个上游身份只属于一个账号”由 `identity_upstream_name` 在关联钩子的一个写事务里判，不靠先查库的
 * `account` 表：库的 `account` 行在钩子提交之后才插，两个并发的关联都看不到对方的 `account` 行（设计审查第 11 条），而本表的行在
 * 钩子的事务里就写下了，后一个排在同一条队列里，一定看得到前一个。
 *
 * 本表的行与库的 `account` 行分两步写，两步之间可能断开：钩子提交之后库插 `account` 失败，或进程在两步之间退出，留下没有 `account`
 * 行与它对上的孤行。孤行不能永远占着这个身份，所以“在用”是：有 `account` 行与它对上，或关联时间在 1 分钟之内（另一个关联可能还在
 * 进行、库还没插 `account`；一次关联从钩子到库插入只隔一条插入语句，1 分钟是宽裕的上限）。不在用的就是孤行，删掉再认。
 */

import {SQLiteError} from "bun:sqlite";

import type {SocialErrorCode, SocialProvider} from "@notnotype/nb-site-identity-contract";

import type {IdentityTx} from "../db/connection";
import {libDate} from "../db/library-rows";

/** 关联时间在这之内的行，没有 `account` 行与它对上也算在用。 */
export const UPSTREAM_NAME_CLAIM_GRACE_MS = 60_000;

export interface UpstreamClaim {
    readonly userId: number;
    readonly provider: SocialProvider;
    readonly upstreamAccountId: string;
    /** 上游账号的名字，已截断到 200 个字符（`providers.ts`）。 */
    readonly name: string;
    readonly nowMs: number;
}

interface NameRow {
    readonly id: number;
    readonly user_id: number;
    readonly upstream_account_id: string;
    readonly linked_at: string;
}

/**
 * 在 `tx`（一个模块的写事务）里认下这个身份。认得下回 null 并已写入；这个账号在该上游已有在用的身份回 `identity_exists`；这个身份已
 * 被别的账号在用回 `identity_taken`（两样都有时先报前一样）。两个 `UNIQUE` 是兜底：先查后插在同一个写事务里，撞上约束说明本函数的
 * 判断与表对不上，是程序错误，不换成哪一个码。
 */
export function claimUpstreamName(tx: IdentityTx, claim: UpstreamClaim): Extract<SocialErrorCode, "identity_exists" | "identity_taken"> | null {
    const inUse = (row: NameRow): boolean => {
        if (row.linked_at > libDate(claim.nowMs - UPSTREAM_NAME_CLAIM_GRACE_MS)) return true;
        const account = tx
            .query<{id: number}, [string, string, number]>(`SELECT "id" FROM "account" WHERE "providerId" = ? AND "accountId" = ? AND "userId" = ?`)
            .get(claim.provider, row.upstream_account_id, row.user_id);
        return account !== null;
    };
    const mine = tx.query<NameRow, [number, string]>(`SELECT id, user_id, upstream_account_id, linked_at FROM identity_upstream_name WHERE user_id = ? AND provider = ?`).get(claim.userId, claim.provider);
    const owner = tx
        .query<NameRow, [string, string]>(`SELECT id, user_id, upstream_account_id, linked_at FROM identity_upstream_name WHERE provider = ? AND upstream_account_id = ?`)
        .get(claim.provider, claim.upstreamAccountId);
    if (mine !== null && inUse(mine)) return "identity_exists";
    if (owner !== null && inUse(owner)) return "identity_taken";
    for (const orphan of [mine, owner]) if (orphan !== null) tx.query(`DELETE FROM identity_upstream_name WHERE id = ?`).run(orphan.id);
    try {
        tx.query(`INSERT INTO identity_upstream_name (user_id, provider, upstream_account_id, name, linked_at) VALUES (?, ?, ?, ?, ?)`).run(
            claim.userId,
            claim.provider,
            claim.upstreamAccountId,
            claim.name,
            libDate(claim.nowMs),
        );
    } catch (error) {
        if (error instanceof SQLiteError && error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("claimUpstreamName hit a unique constraint its checks should have ruled out", {cause: error});
        throw error;
    }
    return null;
}
