import {createError, getRouterParam} from "h3";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {AgentHistoryQueryError} from "nbook/server/agent/session/history-query";
import {isAttachmentError} from "nbook/server/agent/attachments/types";
import {isAgentAbortNotAllowedError} from "nbook/server/agent/session/abort-not-allowed-error";
import {isAgentAbortDurabilityError} from "nbook/server/agent/session/abort-durability-error";
import {isSessionCurrentProjectError} from "nbook/server/agent/session/current-project-error";
import {isAgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";
import {requireReadyAgentSessionStore} from "nbook/server/agent/session/agent-session-store-runtime";
import {projectPublicInvocationResult} from "nbook/server/agent/events/public-invocation-result-projection";
import type {InvokeAgentInput} from "nbook/server/agent/harness/types";
import type {ServerTimingSink} from "nbook/server/utils/server-timing-sink";
import {
    AgentSessionIdSchema,
    type AgentAbortRequestDto,
    type AgentCommandRequestDto,
    type AgentCreateSessionRequestDto,
    type AgentCurrentProjectRequestDto,
    type ClientVariablePatchAckDto,
    type AgentInvokeRequestDto,
    type AgentSessionEventsQueryDto,
    type AgentSessionAttachmentItemDto,
    type AgentSessionAttachmentListQueryDto,
    type AgentSessionAttachmentPageDto,
    type AgentSessionAttachmentResolveResultDto,
    type AgentSessionAttachmentSnapshotRequestDto,
    type AgentSessionListPageDto,
    type AgentSessionListQueryDto,
    type AgentSessionQueryDto,
    type AgentSessionQueryResultDto,
    type AgentTreeRequestDto,
    type AgentTreeResult,
    type AgentUserMessageContentDto,
    type InvokeAgentResult,
} from "nbook/shared/dto/agent-session.dto";

type GlobalAgentHttp = {
    agentHarness?: NeuroAgentHarness;
};

const globalForAgentHttp = globalThis as typeof globalThis & GlobalAgentHttp;

/**
 * 获取 Agent Harness 单例。session 真相在 JSONL，单例只持有运行期事件中心和依赖。
 */
export function useAgentHarness(): NeuroAgentHarness {
    if (!globalForAgentHttp.agentHarness) {
        const runtimePaths = runtimePathsFromEnv();
        const sessionStore = requireReadyAgentSessionStore(runtimePaths.workspaceRoot);
        if (sessionStore.rootWorkspace !== runtimePaths.workspaceRoot) {
            throw new Error("Agent Session Store capability 与 Runtime Workspace Root 不一致。");
        }
        globalForAgentHttp.agentHarness = new NeuroAgentHarness({
            runtimePaths,
            repo: new JsonlSessionRepository(runtimePaths.workspaceRoot),
            watchProfiles: true,
        });
    }
    return globalForAgentHttp.agentHarness;
}

/** 释放 HTTP 单例持有的 Workspace Root runtime lease。 */
export async function disposeAgentHarness(): Promise<void> {
    const harness = globalForAgentHttp.agentHarness;
    globalForAgentHttp.agentHarness = undefined;
    await harness?.dispose();
}

/**
 * 读取数字 sessionId 路由参数。
 */
export function requireAgentSessionId(event: Parameters<typeof getRouterParam>[0]): number {
    const raw = getRouterParam(event, "sessionId");
    const parsed = AgentSessionIdSchema.safeParse(Number(raw));
    if (!parsed.success) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    return parsed.data;
}

/**
 * 解析请求体中的可选 Session ID；未提供时保留 undefined，提供但不是安全正整数时返回 400。
 */
export function requireAgentSessionIdValue(raw: string | undefined): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    if (!/^\d+$/u.test(raw)) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    const parsed = AgentSessionIdSchema.safeParse(Number(raw));
    if (!parsed.success || !Number.isSafeInteger(parsed.data)) {
        throw createError({
            statusCode: 400,
            message: "sessionId 必须是正整数",
        });
    }
    return parsed.data;
}

/**
 * 创建 Agent session。
 */
export async function createAgentSession(body: AgentCreateSessionRequestDto, harness = useAgentHarness()) {
    return withAgentHttpError(undefined, () => harness.createAgent({
        profileKey: body.profileKey,
        initial: body.initial,
        currentProjectRoot: body.currentProjectRoot,
        parentSessionId: body.parentSessionId,
    }));
}

/** 重新绑定或清除 Session Current Project。 */
export async function updateAgentSessionCurrentProject(
    sessionId: number,
    body: AgentCurrentProjectRequestDto,
    harness = useAgentHarness(),
) {
    return withAgentSessionHttpError(sessionId, () => harness.updateCurrentProject(sessionId, body.projectRoot));
}

/**
 * 列出 Agent session 摘要。
 */
export async function listAgentSessions(query: AgentSessionListQueryDto, harness = useAgentHarness()): Promise<AgentSessionListPageDto> {
    if ("listSessionPage" in harness && typeof harness.listSessionPage === "function") {
        return harness.listSessionPage(query);
    }
    const items = await harness.listSessions(query);
    return {
        items,
        total: items.length,
        offset: query.offset ?? 0,
        limit: query.limit ?? items.length,
        hasMore: false,
    };
}

/**
 * 按 query view 返回 session recovery、history 或 system prompt。
 */
export async function getAgentSessionQuery(
    sessionId: number,
    query: AgentSessionQueryDto,
    harness = useAgentHarness(),
    timingSink?: ServerTimingSink,
): Promise<AgentSessionQueryResultDto> {
    return withAgentSessionHttpError(sessionId, () => timingSink
        ? harness.getSessionQuery(sessionId, query, timingSink)
        : harness.getSessionQuery(sessionId, query));
}

/**
 * 返回关联 Agent 面板使用的轻量关系投影。
 */
export async function getAgentSessionRelations(sessionId: number, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return withAgentSessionHttpError(sessionId, () => timingSink
        ? harness.getSessionRelations(sessionId, timingSink)
        : harness.getSessionRelations(sessionId));
}

/**
 * 阻塞调用 Agent session。
 */
export async function invokeAgentSession(sessionId: number, body: AgentInvokeRequestDto, harness = useAgentHarness()): Promise<InvokeAgentResult> {
    return withAgentSessionHttpError(sessionId, async () => {
        const result = await harness.invokeAgent(toInvokeInput(sessionId, body));
        return projectPublicInvocationResult(result);
    });
}

/** 查询 Session 全分支附件目录。 */
export async function listAgentSessionAttachments(
    sessionId: number,
    query: AgentSessionAttachmentListQueryDto,
    harness = useAgentHarness(),
): Promise<AgentSessionAttachmentPageDto> {
    return withAgentSessionHttpError(sessionId, () => harness.listSessionAttachments(sessionId, query));
}

/** 按请求顺序批量解析当前 Session 已授权附件。 */
export async function resolveAgentSessionAttachments(
    sessionId: number,
    attachmentIds: readonly import("nbook/shared/dto/agent-attachment.dto").AttachmentId[],
    harness = useAgentHarness(),
): Promise<AgentSessionAttachmentResolveResultDto> {
    return withAgentSessionHttpError(sessionId, async () => ({
        items: await harness.resolveSessionAttachments(sessionId, attachmentIds),
    }));
}

/** 保存 multipart 上传图片并登记到 Session。 */
export async function uploadAgentSessionAttachment(
    sessionId: number,
    input: {bytes: Uint8Array; mimeType?: string; name?: string},
    harness = useAgentHarness(),
): Promise<AgentSessionAttachmentItemDto> {
    return withAgentSessionHttpError(sessionId, () => harness.uploadSessionAttachment(sessionId, input));
}

/** 上传路由在消费 multipart body 前执行的 Session 交互门禁。 */
export async function preflightAgentSessionAttachmentRegistration(
    sessionId: number,
    harness = useAgentHarness(),
): Promise<void> {
    return withAgentSessionHttpError(sessionId, async () => {
        await harness.preflightSessionAttachmentRegistration(sessionId);
    });
}

/** 快照本地图片并登记到 Session。 */
export async function snapshotAgentSessionAttachment(
    sessionId: number,
    input: AgentSessionAttachmentSnapshotRequestDto,
    harness = useAgentHarness(),
): Promise<AgentSessionAttachmentItemDto> {
    return withAgentSessionHttpError(sessionId, () => harness.snapshotSessionAttachment(sessionId, input));
}

/** 返回历史用户消息按 stored content 顺序重建的完整 Markdown。 */
export async function getAgentSessionUserContent(
    sessionId: number,
    entryId: string,
    harness = useAgentHarness(),
): Promise<AgentUserMessageContentDto> {
    return withAgentSessionHttpError(sessionId, () => harness.getSessionUserContent(sessionId, entryId));
}

/**
 * 执行 session command。slash command 在前端识别后进入这里。
 */
export async function runAgentSessionCommand(sessionId: number, body: AgentCommandRequestDto, harness = useAgentHarness(), timingSink?: ServerTimingSink) {
    return withAgentSessionHttpError(sessionId, () => timingSink
        ? harness.runCommand(sessionId, body, timingSink)
        : harness.runCommand(sessionId, body));
}

/**
 * 切换 session tree，并可在切换后立即 invoke。
 *
 * 当前实现先移动 leaf 再 invoke；若 invoke 失败，leaf 不会自动回滚。
 */
export async function moveAgentSessionTree(sessionId: number, body: AgentTreeRequestDto, harness = useAgentHarness()): Promise<AgentTreeResult> {
    return withAgentSessionHttpError(sessionId, async () => {
        const result = await harness.moveTree(sessionId, body);
        return result.invocation
            ? {...result, invocation: projectPublicInvocationResult(result.invocation)}
            : {status: result.status, state: result.state};
    });
}

/**
 * 请求中断当前 invocation。
 */
export async function abortAgentSession(sessionId: number, body: AgentAbortRequestDto, harness = useAgentHarness()) {
    return withAgentSessionHttpError(sessionId, () => harness.abortInvocation(sessionId, body));
}

/**
 * 前端确认 client.* variable patch 已应用。
 */
export async function acknowledgeClientVariablePatch(sessionId: number, body: ClientVariablePatchAckDto, harness = useAgentHarness()) {
    return withAgentSessionHttpError(sessionId, async () => {
        await harness.acknowledgeClientVariablePatch(sessionId, body);
        return {ok: true};
    });
}

/**
 * 订阅 session 事件。
 */
export function subscribeAgentSessionEvents(sessionId: number, cursor: AgentSessionEventsQueryDto = {}, harness = useAgentHarness()) {
    return harness.subscribeSessionEvents(sessionId, cursor);
}

/**
 * 将 HTTP DTO 转成 harness invoke 输入。
 */
export function toInvokeInput(
    sessionId: number,
    body: AgentInvokeRequestDto,
    onEvent?: InvokeAgentInput["onEvent"],
): InvokeAgentInput {
    return {
        sessionId,
        mode: body.mode,
        clientMessageId: body.clientMessageId,
        message: body.message,
        payload: body.input,
        title: body.title,
        resolution: body.resolution as InvokeAgentInput["resolution"],
        resolutions: body.resolutions as InvokeAgentInput["resolutions"],
        clientState: body.clientState,
        caller: {kind: "user"},
        block: body.block,
        onEvent,
    };
}

/** 统一保护 Session HTTP helper，避免各路由重复识别领域错误。 */
export async function withAgentHttpError<TResult>(requestSessionId: number | undefined, operation: () => Promise<TResult>): Promise<TResult> {
    try {
        return await operation();
    } catch (error) {
        throw mapAgentHttpError(error, requestSessionId);
    }
}

/** 以 Session 为主资源的 HTTP 边界；关联读取缺失会与主资源 404 明确区分。 */
export async function withAgentSessionHttpError<TResult>(
    requestSessionId: number,
    operation: () => Promise<TResult>,
): Promise<TResult> {
    return withAgentHttpError(requestSessionId, operation);
}

/** 将 Attachment 稳定错误映射为前端可处理的 HTTP 合同。 */
function mapAgentAttachmentHttpError(error: unknown): Error {
    if (!isAttachmentError(error)) {
        return error instanceof Error ? error : new Error(String(error));
    }
    if (error.code === "limit_exceeded") {
        return createError({
            statusCode: 413,
            message: "图片超过允许预算",
            data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED", retryable: false},
        });
    }
    if (error.code === "storage_failed") {
        return createError({
            statusCode: 503,
            message: "Attachment 存储暂不可用",
            data: {code: "ATTACHMENT_STORAGE_UNAVAILABLE", retryable: true},
        });
    }
    if (error.code === "not_found") {
        return createError({
            statusCode: 404,
            message: error.message,
            data: {code: "ATTACHMENT_NOT_FOUND", retryable: false},
        });
    }
    if (error.code === "corrupt") {
        return createError({
            statusCode: 409,
            message: "Session Attachment 数据已损坏",
            data: {code: "ATTACHMENT_CATALOG_CORRUPT", retryable: false},
        });
    }
    return createError({
        statusCode: 400,
        message: error.message || "图片输入无效",
        data: {code: "INVALID_IMAGE_INPUT", retryable: false},
    });
}

/** Session HTTP 路由共享的稳定错误出口。 */
export function mapAgentHttpError(error: unknown, requestSessionId: number | undefined): Error {
    if (isAgentAbortNotAllowedError(error)) {
        return createError({
            statusCode: error.statusCode,
            message: error.message,
            data: {code: error.code, retryable: false},
        });
    }
    if (isAgentAbortDurabilityError(error)) {
        return createError({
            statusCode: error.statusCode,
            message: error.message,
            data: {code: error.code, retryable: error.retryable},
        });
    }
    if (isAgentSessionNotFoundError(error)) {
        const primaryMissing = error.sessionId === requestSessionId;
        return createError({
            statusCode: primaryMissing ? 404 : 409,
            message: primaryMissing ? "Session 不存在或已不可用" : "关联对话不存在或已不可用",
            data: {code: primaryMissing ? "SESSION_NOT_FOUND" : "SESSION_DEPENDENCY_NOT_FOUND"},
        });
    }
    if (error instanceof AgentHistoryQueryError) {
        return createError({
            statusCode: error.statusCode,
            message: error.message,
            data: {code: error.code},
        });
    }
    if (isSessionCurrentProjectError(error)) {
        return createError({
            statusCode: error.statusCode,
            message: error.message,
            data: {
                code: error.code,
                ...(error.projectRoot === undefined ? {} : {projectRoot: error.projectRoot}),
            },
        });
    }
    return mapAgentAttachmentHttpError(error);
}

/** 宽泛 entry/attachment Adapter 用稳定 HTTP code 保留两类 Session 生命周期错误。 */
export function isAgentSessionLifecycleHttpError(error: unknown): boolean {
    if (!(error instanceof Error) || !("data" in error) || typeof error.data !== "object" || error.data === null) {
        return false;
    }
    return "code" in error.data
        && (error.data.code === "SESSION_NOT_FOUND" || error.data.code === "SESSION_DEPENDENCY_NOT_FOUND");
}
