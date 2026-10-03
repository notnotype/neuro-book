import type {InboxGroup, OperationActor, OperationLogEntry} from "@notnotype/nb-history";
import {workspaceHistoryGroupRevision} from "nbook/server/workspace-history/history-inbox";
import type {WorkspaceHistoryEntryDto, WorkspaceHistoryInboxGroupDto} from "nbook/shared/dto/workspace-history.dto";

/**
 * vendor 收件箱结构 → DTO 映射（摘要化：条目只留归因与操作类型，不内联内容）。
 */
export function toWorkspaceHistoryInboxGroupDto(group: InboxGroup): WorkspaceHistoryInboxGroupDto {
    return {
        path: group.path,
        revision: workspaceHistoryGroupRevision(group),
        baseHash: group.baseHash,
        endHash: group.endHash,
        entries: group.entries.map(toWorkspaceHistoryEntryDto),
    };
}

function toWorkspaceHistoryEntryDto(entry: OperationLogEntry): WorkspaceHistoryEntryDto {
    return {
        id: entry.id,
        occurredAt: entry.occurredAt,
        actorKind: entry.actor.kind,
        actorDetail: actorDetail(entry.actor),
        operationType: entry.operation.type,
    };
}

/** 归因细节：agent = sessionId、system = source、user = userId；external 无细节。 */
function actorDetail(actor: OperationActor): string | null {
    switch (actor.kind) {
        case "user":
            return actor.userId;
        case "agent":
            return actor.sessionId;
        case "system":
            return actor.source;
        case "external":
            return null;
    }
}
