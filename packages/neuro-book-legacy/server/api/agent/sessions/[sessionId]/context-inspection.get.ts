import {createError, getQuery} from "h3";
import {requireAgentSessionId, useAgentHarness, withAgentSessionHttpError} from "nbook/server/agent/http";
import {isValidTraceId} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

/**
 * 上下文检查面板数据（Task 126）：分区组成、缓存时间轴、运行事实与诊断。
 *
 * 只读且不含消息正文——正文按需走 `/api/agent/traces/[bucket]/[id]`。
 * `traceId` 会直接参与文件路径拼接，必须过白名单防路径穿越。
 */
export default defineEventHandler(async (event): Promise<AgentContextInspectionDto> => {
    const sessionId = requireAgentSessionId(event);
    const rawTraceId = getQuery(event).traceId;
    if (rawTraceId !== undefined && (typeof rawTraceId !== "string" || !isValidTraceId(rawTraceId))) {
        throw createError({statusCode: 400, message: "traceId 必须是 trace 序号"});
    }
    return withAgentSessionHttpError(
        sessionId,
        () => useAgentHarness().getSessionContextInspection(sessionId, rawTraceId),
    );
});
