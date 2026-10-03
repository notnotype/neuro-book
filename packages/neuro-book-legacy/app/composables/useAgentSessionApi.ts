import {readSseStream} from "nbook/app/utils/http/read-sse";
import type {
    AgentComposerDraftIdentity,
    AgentComposerDraftLoadResult,
    AgentComposerDraftMigrationRequest,
    AgentComposerDraftMigrationResult,
    AgentComposerDraftSaveRequest,
    AgentComposerDraftSaveResult,
} from "nbook/shared/dto/agent-composer-draft.dto";
import type {
    AgentAbortRequestDto,
    AgentAbortResult,
    AgentCommandResult,
    AgentCommandRequestDto,
    AgentCreateSessionRequestDto,
    AgentCurrentProjectRequestDto,
    AgentInvokeRequestDto,
    AgentSessionEventDto,
    AgentSessionEventsQueryDto,
    AgentSessionAttachmentItemDto,
    AgentSessionAttachmentListQueryDto,
    AgentSessionAttachmentPageDto,
    AgentSessionAttachmentSnapshotRequestDto,
    AgentSessionAttachmentResolveResultDto,
    AgentSessionHistoryPageDto,
    AgentSessionListPageDto,
    AgentSessionListQueryDto,
    AgentSessionRelationsDto,
    AgentSessionRecoveryDto,
    AgentSessionSystemPromptDto,
    AgentTreeResult,
    AgentTreeRequestDto,
    AgentUserMessageContentDto,
    ClientVariablePatchAckDto,
    InvokeAgentResult,
} from "nbook/shared/dto/agent-session.dto";

/**
 * Agent session HTTP API。新前端只使用 /api/agent/sessions/**。
 */
export function useAgentSessionApi() {
    /** 读取 Workspace Root `.nbook` 中的 Composer 草稿。 */
    const getComposerDraft = (identity: AgentComposerDraftIdentity) => {
        return $fetch<AgentComposerDraftLoadResult>("/api/agent/composer-drafts", {query: identity});
    };

    /** 保存 Composer 草稿；服务端重新执行字节预算和图片安全校验。 */
    const saveComposerDraft = (body: AgentComposerDraftSaveRequest) => {
        return $fetch<AgentComposerDraftSaveResult>("/api/agent/composer-drafts", {method: "PUT", body});
    };

    /** accepted 后删除磁盘草稿。 */
    const clearComposerDraft = (body: AgentComposerDraftIdentity) => {
        return $fetch<{cleared: true}>("/api/agent/composer-drafts", {method: "DELETE", body});
    };

    /** 首次加载时批量迁移旧 WebView 草稿。 */
    const migrateComposerDrafts = (body: AgentComposerDraftMigrationRequest) => {
        return $fetch<AgentComposerDraftMigrationResult>("/api/agent/composer-drafts/migrate", {method: "POST", body});
    };

    const listSessions = (query: AgentSessionListQueryDto = {}) => {
        return $fetch<AgentSessionListPageDto>("/api/agent/sessions", {
            query,
        });
    };

    const createSession = (body: AgentCreateSessionRequestDto) => {
        return $fetch<{sessionId: number; profileKey: string; title?: string}>("/api/agent/sessions", {
            method: "POST",
            body,
        });
    };

    /** 恢复迁移待确认 Session；null 明确表示 Workspace Root Session。 */
    const updateSessionCurrentProject = (sessionId: number, body: AgentCurrentProjectRequestDto) => {
        return $fetch<{sessionId: number; currentProjectRoot?: string}>(
            "/api/agent/sessions/" + sessionId + "/current-project",
            {method: "POST", body},
        );
    };

    /** 获取打开/刷新/SSE recovery 所需的 shell 和最近 history 尾页。 */
    const getSessionRecovery = (sessionId: number) => {
        return $fetch<AgentSessionRecoveryDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "recovery"},
        });
    };

    /** 获取当前 active path 更早的一页 history。cursor 由服务端生成，前端不解析。 */
    const getSessionHistory = (sessionId: number, cursor: string) => {
        return $fetch<AgentSessionHistoryPageDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "history", cursor},
        });
    };

    /** 按需构建 provider system prompt，不将其伪装成 Chat Flow history。 */
    const getSessionSystemPrompt = (sessionId: number) => {
        return $fetch<AgentSessionSystemPromptDto>(`/api/agent/sessions/${sessionId}`, {
            query: {view: "systemPrompt"},
        });
    };

    const getSessionRelations = (sessionId: number) => {
        return $fetch<AgentSessionRelationsDto>(`/api/agent/sessions/${sessionId}/relations`);
    };

    /** 搜索并分页读取 Session 全分支附件。 */
    const getSessionAttachments = (sessionId: number, query: Partial<AgentSessionAttachmentListQueryDto> = {}) => {
        return $fetch<AgentSessionAttachmentPageDto>(`/api/agent/sessions/${sessionId}/attachments`, {query});
    };

    /** 一次请求补齐正文中稳定图片节点的 canonical metadata。 */
    const resolveSessionAttachments = (sessionId: number, attachmentIds: string[]) => {
        return $fetch<AgentSessionAttachmentResolveResultDto>(`/api/agent/sessions/${sessionId}/attachments/resolve`, {
            method: "POST",
            body: {attachmentIds},
        });
    };

    /** 上传单张图片；AbortSignal 只终止客户端等待，服务端已完成的登记仍属于原 Session。 */
    const uploadSessionAttachment = (sessionId: number, file: File, signal?: AbortSignal) => {
        const body = new FormData();
        body.append("file", file, file.name);
        return $fetch<AgentSessionAttachmentItemDto>(`/api/agent/sessions/${sessionId}/attachments`, {
            method: "POST",
            body,
            signal,
        });
    };

    /** 把 Project File Address、workspace/.nbook 地址或绝对路径快照为稳定附件。 */
    const snapshotSessionAttachment = (
        sessionId: number,
        body: AgentSessionAttachmentSnapshotRequestDto,
        signal?: AbortSignal,
    ) => {
        return $fetch<AgentSessionAttachmentItemDto>(`/api/agent/sessions/${sessionId}/attachments/snapshot`, {
            method: "POST",
            body,
            signal,
        });
    };

    /** 按需读取历史用户消息的完整 Markdown。 */
    const getSessionUserContent = (sessionId: number, entryId: string) => {
        return $fetch<AgentUserMessageContentDto>(`/api/agent/sessions/${sessionId}/entries/${encodeURIComponent(entryId)}/user-content`);
    };

    const invokeSession = (sessionId: number, body: AgentInvokeRequestDto) => {
        return $fetch<InvokeAgentResult>(`/api/agent/sessions/${sessionId}/invocations`, {
            method: "POST",
            body,
        });
    };

    const runCommand = (sessionId: number, body: AgentCommandRequestDto) => {
        return $fetch<AgentCommandResult>(`/api/agent/sessions/${sessionId}/commands`, {
            method: "POST",
            body,
        });
    };

    const moveTree = (sessionId: number, body: AgentTreeRequestDto) => {
        return $fetch<AgentTreeResult>(`/api/agent/sessions/${sessionId}/tree`, {
            method: "POST",
            body,
        });
    };

    const abortSession = (sessionId: number, body: AgentAbortRequestDto = {}) => {
        return $fetch<AgentAbortResult>(`/api/agent/sessions/${sessionId}/abort`, {
            method: "POST",
            body,
        });
    };

    const acknowledgeClientVariablePatch = (sessionId: number, body: ClientVariablePatchAckDto) => {
        return $fetch<{ok: boolean}>(`/api/agent/sessions/${sessionId}/client-variable-patch-acks`, {
            method: "POST",
            body,
        });
    };

    const subscribeSessionEvents = async (
        sessionId: number,
        cursor: AgentSessionEventsQueryDto,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options: {onOpen?: () => void} = {},
    ): Promise<void> => {
        const query = new URLSearchParams();
        if (typeof cursor.after === "number") {
            query.set("after", String(cursor.after));
        }
        if (cursor.eventEpoch) {
            query.set("eventEpoch", cursor.eventEpoch);
        }
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        const response = await fetch(`/api/agent/sessions/${sessionId}/events${suffix}`, {
            signal,
        });
        await readSseStream<AgentSessionEventDto>(response, onEvent, options);
    };

    return {
        acknowledgeClientVariablePatch,
        abortSession,
        clearComposerDraft,
        createSession,
        getComposerDraft,
        getSessionHistory,
        getSessionAttachments,
        getSessionRecovery,
        getSessionRelations,
        getSessionSystemPrompt,
        getSessionUserContent,
        invokeSession,
        listSessions,
        migrateComposerDrafts,
        moveTree,
        runCommand,
        resolveSessionAttachments,
        saveComposerDraft,
        snapshotSessionAttachment,
        subscribeSessionEvents,
        uploadSessionAttachment,
        updateSessionCurrentProject,
    };
}
