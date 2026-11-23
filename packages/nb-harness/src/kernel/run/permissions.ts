/**
 * 发出者与权限（docs/specs/harness/runtime.md 输出 105、108）：谁能放行、改、取消哪条话，谁能停、能接着跑哪次运行。
 * 指令里不各写各的判断，都经这里；内核相信宿主给的发出者（输出 45）。
 */

import type {BufferedInput, Issuer, SessionHeader} from "../api/index.js";
import type {LastChatRun} from "../state/kernel-state.js";

const USER: Issuer = {kind: "user"};

/** 判等：会话按 `id`，宿主按 `source.plugin`。 */
export function sameIssuer(a: Issuer, b: Issuer): boolean {
    if (a.kind === "user" || b.kind === "user") return a.kind === b.kind;
    if (a.kind === "session") return b.kind === "session" && a.id === b.id;
    return b.kind === "host" && a.source.plugin === b.source.plugin;
}

/** 条目的发出者：没有 `by` 的是用户。 */
export const ownerOf = (item: {readonly by?: Issuer}): Issuer => item.by ?? USER;

const heldByUser = (item: BufferedInput): boolean => item.heldBy?.kind === "user";

/** 这个发出者能放行的留着的话：用户能放行全部；会话、宿主只能放行自己排的、且不是用户停止留下的（输出 105）。 */
export function releasable(buffer: readonly BufferedInput[], issuer: Issuer): BufferedInput[] {
    return buffer.filter((item) => item.state === "held" && (issuer.kind === "user" || (sameIssuer(ownerOf(item), issuer) && !heldByUser(item))));
}

/** 发出者不是用户、放行不了任何一条，而留着的话里有用户停止留下的：`held-by-user`（输出 106、107），告诉它只有用户能放行。 */
export function blockedByUser(buffer: readonly BufferedInput[], issuer: Issuer): boolean {
    if (issuer.kind === "user") return false;
    return releasable(buffer, issuer).length === 0 && buffer.some((item) => item.state === "held" && heldByUser(item));
}

/** 能不能改这条：只能改自己排的（用户也只能改用户排的）（输出 29、108）。 */
export const canEdit = (item: BufferedInput, issuer: Issuer): boolean => sameIssuer(ownerOf(item), issuer);

/** 能不能取消或替换这条话或提醒：用户能取消任何一条，会话、宿主只能取消（撤回）自己排的。 */
export const canRemove = (item: {readonly by?: Issuer}, issuer: Issuer): boolean => issuer.kind === "user" || sameIssuer(ownerOf(item), issuer);

/** 能不能停这次运行：用户能；会话只能停会话头 `caller` 是它的会话；宿主只能停自己开的运行（输出 108）。 */
export function canAbort(header: SessionHeader, runBy: Issuer, issuer: Issuer): boolean {
    if (issuer.kind === "user") return true;
    if (issuer.kind === "session") return header.caller?.kind === "session" && header.caller.id === issuer.id;
    return sameIssuer(runBy, issuer);
}

/**
 * 能不能接着跑这次运行：用户能；别的发出者只能接着跑自己开的、且不是用户停止的（输出 4、108）。
 * `runBy` 是那次运行的开启者（旧日志没有 `by` 时按用户算）。
 */
export function canContinue(runBy: Issuer, stoppedBy: Issuer | null, issuer: Issuer): boolean {
    if (issuer.kind === "user") return true;
    return sameIssuer(runBy, issuer) && stoppedBy?.kind !== "user";
}

/** 叶子上已收口、能接着跑的对话运行：最后一轮停在当中（没以 completed 结束）的中断、出错或停止（输出 4）。 */
export function continuableEnded(last: LastChatRun | null): LastChatRun | null {
    if (last === null || last.end === null || last.end === "completed" || last.end === "finished" || last.lastTurnCompleted) return null;
    return last;
}
