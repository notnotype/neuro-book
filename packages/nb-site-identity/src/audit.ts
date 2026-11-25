/**
 * 写审计记录（`site.admin` 输出 8 与副作用一节；w00037 t07 计划 3.10）。
 *
 * 审计与它记的操作同时生效，所以只在调用方的写事务里写：参数 `tx` 是 `IdentityConnection.write`（或库的事务里的 `write`）交给
 * 回调的句柄，操作回滚时这一行一起回滚，不存在“操作生效了却没有记录”。表只追加：改与删由迁移里的触发器拒绝，本模块也没有
 * 改或删它的语句。
 *
 * `params` 只放 `site.admin` 输出 8 列的动作参数，不放密码、哈希、码与备注；由各调用处守，这里不逐个检查。
 */

import type {AuditAction, AuditTargetType} from "@notnotype/nb-site-identity-contract";

import type {IdentityTx} from "./db/connection";
import {libDate} from "./db/library-rows";

export interface AuditEntry {
    /** 操作者的账号 id；命令行为 null。 */
    readonly actorId: number | null;
    readonly action: AuditAction;
    readonly targetType: AuditTargetType;
    readonly targetId: number;
    /** 动作的参数，存成一个 JSON 对象。 */
    readonly params: Readonly<Record<string, unknown>>;
    /** 模块时钟的当前时间（毫秒）。 */
    readonly now: number;
}

/** 追加一条审计记录，回它的 id。时间与库的表同一种写法（到毫秒的 ISO 8601 UTC）。 */
export function appendAudit(tx: IdentityTx, entry: AuditEntry): number {
    const result = tx
        .query(`INSERT INTO identity_audit (created_at, actor_id, action, target_type, target_id, params) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(libDate(entry.now), entry.actorId, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.params));
    return Number(result.lastInsertRowid);
}
