/**
 * 管理处置的写事务第一步：复核操作者（w00037 t07 计划“设计审查的处理”第 5 条，`site.admin` 输出 1、6）。
 *
 * 中间件认管理员身份是在请求刚进来时、写事务之外读的；之后到写事务拿到锁之间，操作者可能已被降级、封禁或结束了会话。处置要在
 * 生效的那一刻仍由一个未封禁的管理员做，所以每个处置的写事务先在同一个事务里再读一次：会话行还在且没到期、账号的角色是管理员、
 * 没被封。不成立回 `unauthenticated`，事务里什么也没写（也就没有审计）。`site.admin` 输出 6 的“不会让站里没有未封禁的管理员”
 * 靠的就是这一步：操作者在生效那一刻是未封禁的管理员，又不能封禁或降级自己，处置完至少还剩他自己。
 */

import type {IdentityConnection, IdentityTx} from "../db/connection";
import {IdentityFailure} from "../errors";
import {isSessionLive, type CurrentSession} from "../session";

type Operator = Pick<CurrentSession, "sessionId" | "token" | "userId">;

export function requireLiveAdmin(tx: IdentityTx, session: Operator, nowMs: number): void {
    if (!isSessionLive(tx, session, nowMs)) throw new IdentityFailure("unauthenticated");
    const row = tx.query<{role: string; banned: number}, [number]>(`SELECT "role" AS role, "banned" AS banned FROM "user" WHERE "id" = ?`).get(session.userId);
    if (row === null || row.role !== "admin" || row.banned === 1) throw new IdentityFailure("unauthenticated");
}

/**
 * 一个管理处置的写事务：取模块时钟的现在、复核操作者，再交给 `fn` 做检查、改动与写审计。所有处置（账号的五种、注册码的发放与停用）
 * 都经它，复核不会在哪一处漏掉。`fn` 同步执行（写事务的规则，`db/connection.ts`），抛出的失败让整个事务回滚。
 */
export function adminWrite<T>(conn: IdentityConnection, clock: {now(): number}, session: Operator, fn: (tx: IdentityTx, nowMs: number) => T): Promise<T> {
    return conn.write((tx) => {
        const nowMs = clock.now();
        requireLiveAdmin(tx, session, nowMs);
        return fn(tx, nowMs);
    });
}
