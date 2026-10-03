import {createError, getRouterParam} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {PiTraceReader, isValidTraceBucket} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentTraceIndexListDto} from "nbook/shared/dto/agent-trace.dto";

/**
 * 读某 bucket 的 trace index 条目（轻量汇总行，不含 payload），最新在前。
 */
export default defineEventHandler(async (event): Promise<AgentTraceIndexListDto> => {
    const bucket = getRouterParam(event, "bucket") ?? "";
    if (!isValidTraceBucket(bucket)) {
        throw createError({statusCode: 400, message: "trace bucket 必须是 sessionId 或 _system"});
    }
    const reader = new PiTraceReader({tracesRoot: useAgentHarness().repo.tracesRoot});
    return {entries: await reader.listIndex(bucket)};
});
