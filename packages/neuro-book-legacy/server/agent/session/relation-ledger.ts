import type {JsonValue} from "nbook/server/agent/messages/types";
import type {LinkedAgentSummary, SessionEntry, SessionId} from "nbook/server/agent/session/types";

export type SessionRelationLedgerChange =
    | {
        kind: "link";
        targetSessionId: SessionId;
        profileKey: string;
    }
    | {
        kind: "detach";
        targetSessionId: SessionId;
    };

/**
 * 判断 entry 是否属于 session 级 Agent 关系账本。
 *
 * 关系账本来自全量 session entries，不跟随 active path/tree 分支回滚；projection entry
 * 是运行态投影，不参与 Agent link/detach 语义。
 */
export function relationLedgerChange(entry: SessionEntry): SessionRelationLedgerChange | null {
    if (entry.type !== "custom" || entry.origin === "projection") {
        return null;
    }
    if (entry.key.startsWith("agent.link.") && isRelationLinkValue(entry.value)) {
        return {
            kind: "link",
            targetSessionId: entry.value.sessionId,
            profileKey: entry.value.profileKey,
        };
    }
    if (entry.key.startsWith("agent.detach.") && isRelationDetachValue(entry.value)) {
        return {
            kind: "detach",
            targetSessionId: entry.value.sessionId,
        };
    }
    return null;
}

/**
 * 把一条 relation 账本变更应用到 owner session 的 linkedAgents map。
 */
export function applyRelationLedgerChange(
    linkedAgents: Map<SessionId, LinkedAgentSummary>,
    change: SessionRelationLedgerChange,
): void {
    if (change.kind === "link") {
        linkedAgents.set(change.targetSessionId, {
            sessionId: change.targetSessionId,
            profileKey: change.profileKey,
            detached: false,
        });
        return;
    }
    const current = linkedAgents.get(change.targetSessionId);
    if (!current) {
        return;
    }
    linkedAgents.set(change.targetSessionId, {
        sessionId: change.targetSessionId,
        profileKey: current.profileKey,
        detached: true,
    });
}

/**
 * 从全量 session entries 归约出 session 级 linked agent 账本。
 */
export function reduceRelationLedger(entries: Iterable<SessionEntry>): LinkedAgentSummary[] {
    const linkedAgents = new Map<SessionId, LinkedAgentSummary>();
    for (const entry of entries) {
        const change = relationLedgerChange(entry);
        if (change) {
            applyRelationLedgerChange(linkedAgents, change);
        }
    }
    return [...linkedAgents.values()].sort((left, right) => left.sessionId - right.sessionId);
}

/**
 * 校验 agent.link.* entry payload。
 */
function isRelationLinkValue(value: JsonValue): value is {sessionId: number; profileKey: string} {
    return Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof value.sessionId === "number"
        && typeof value.profileKey === "string",
    );
}

/**
 * 校验 agent.detach.* entry payload。
 */
function isRelationDetachValue(value: JsonValue): value is {sessionId: number} {
    return Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof value.sessionId === "number",
    );
}
