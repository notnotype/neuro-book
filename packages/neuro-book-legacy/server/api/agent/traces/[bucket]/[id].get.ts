import {createError, getRouterParam} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {PiTraceReader, isValidTraceBucket, isValidTraceId} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentTraceRecordDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * 读单条完整 trace 记录（含 context / payload）。
 */
export default defineEventHandler(async (event): Promise<AgentTraceRecordDto> => {
    const bucket = getRouterParam(event, "bucket") ?? "";
    if (!isValidTraceBucket(bucket)) {
        throw createError({statusCode: 400, message: "trace bucket 必须是 sessionId 或 _system"});
    }
    const id = getRouterParam(event, "id") ?? "";
    if (!isValidTraceId(id)) {
        throw createError({statusCode: 400, message: "trace id 必须是正整数"});
    }
    const reader = new PiTraceReader({tracesRoot: useAgentHarness().repo.tracesRoot});
    const record = await reader.readRecord(bucket, id);
    if (!record) {
        throw createError({statusCode: 404, message: "trace 记录不存在或已被保留策略清理"});
    }
    return record;
});
